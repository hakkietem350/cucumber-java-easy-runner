import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from './logger';

// ─── Classpath cache ────────────────────────────────────────────────────────
interface CachedClasspath {
  pomMtime: number;
  classPaths: string[];
}
const classpathCache = new Map<string, CachedClasspath>();

const MAVEN_TIMEOUT_MS = 15 * 60 * 1000;
const MAVEN_MAX_BUFFER = 32 * 1024 * 1024;

interface MavenExecError extends Error {
  killed?: boolean;
  stderr?: string;
}

function execCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveExec, rejectExec) => {
    exec(
      command,
      { cwd, maxBuffer: MAVEN_MAX_BUFFER, timeout: MAVEN_TIMEOUT_MS, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error) {
          const wrapped: MavenExecError = Object.assign(new Error(error.message), {
            killed: error.killed,
            stderr: stderr
          });
          logger.debug(`Command failed (killed=${Boolean(error.killed)}): ${command}`);
          rejectExec(wrapped);
        } else {
          resolveExec({ stdout, stderr });
        }
      }
    );
  });
}

function getPomMtime(projectRoot: string): number {
  try {
    return fs.statSync(path.join(projectRoot, 'pom.xml')).mtimeMs;
  } catch {
    return 0;
  }
}

function mavenSettingsFlag(projectRoot: string): string {
  const settingsPath = path.join(projectRoot, 'settings.xml');
  if (!fs.existsSync(settingsPath)) { return ''; }
  const escaped = settingsPath.replace(/"/g, '\\"');
  return ` -s "${escaped}"`;
}

/**
 * Resolve Maven executable for Extension Host (PATH often lacks Homebrew/Pleiades mvn).
 * Prefer VS Code / Cursor `maven.executable.path`, then common install locations, then `mvn`.
 */
function resolveMavenExecutable(): string {
  const configured = vscode.workspace.getConfiguration('maven').get<string>('executable.path');
  if (configured && configured.trim().length > 0) {
    const configuredPath = configured.trim();
    if (fs.existsSync(configuredPath)) {
      logger.info(`Using maven.executable.path: ${configuredPath}`);
      return configuredPath;
    }
    logger.warn(`maven.executable.path is set but not found: ${configuredPath}`);
  }

  const candidates = [
    '/opt/homebrew/bin/mvn',
    '/usr/local/bin/mvn',
    path.join(os.homedir(), 'Library/Application Support/Cursor/User/globalStorage/pleiades.java-extension-pack-jdk/maven/latest/bin/mvn'),
    path.join(os.homedir(), 'Library/Application Support/Code/User/globalStorage/pleiades.java-extension-pack-jdk/maven/latest/bin/mvn'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logger.info(`Using Maven from fallback path: ${candidate}`);
      return candidate;
    }
  }

  logger.warn('Maven executable not found via settings or common paths; falling back to "mvn" on PATH');
  return 'mvn';
}

function quoteShellArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildMavenCommand(args: string): string {
  const mvn = resolveMavenExecutable();
  const mvnPart = mvn === 'mvn' ? 'mvn' : quoteShellArg(mvn);
  return `${mvnPart}${args}`;
}

// ─── @CucumberOptions parser ─────────────────────────────────────────────────

function collectJavaFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectJavaFiles(full));
      } else if (entry.name.endsWith('.java')) {
        results.push(full);
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results;
}

function extractCucumberOptionsBody(source: string): string | null {
  const startIdx = source.indexOf('@CucumberOptions');
  if (startIdx === -1) { return null; }
  const openParen = source.indexOf('(', startIdx);
  if (openParen === -1) { return null; }
  let depth = 1;
  let i = openParen + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === '(') { depth++; }
    else if (source[i] === ')') { depth--; }
    i++;
  }
  if (depth !== 0) { return null; }
  return source.substring(openParen + 1, i - 1);
}

function extractAnnotationStringArray(body: string, key: string): string[] | undefined {
  const arrayRe = new RegExp(`\\b${key}\\s*=\\s*\\{([^}]*)\\}`);
  const arrayMatch = body.match(arrayRe);
  if (arrayMatch) {
    const items = arrayMatch[1].match(/"([^"]*)"/g);
    if (items) { return items.map(s => s.slice(1, -1)); }
  }
  const singleRe = new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`);
  const singleMatch = body.match(singleRe);
  if (singleMatch) { return [singleMatch[1]]; }
  return undefined;
}

function findGlueFromRunnerClass(projectRoot: string): string[] | null {
  const testDir = path.join(projectRoot, 'src', 'test', 'java');
  if (!fs.existsSync(testDir)) { return null; }
  for (const filePath of collectJavaFiles(testDir)) {
    let source: string;
    try { source = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
    if (!source.includes('@RunWith') || !source.includes('Cucumber')) { continue; }
    if (!source.includes('@RunWith(Cucumber.class)') && !source.match(/@RunWith\s*\(\s*Cucumber\.class\s*\)/)) {
      continue;
    }
    const optionsBody = extractCucumberOptionsBody(source);
    if (!optionsBody) { continue; }
    const glue = extractAnnotationStringArray(optionsBody, 'glue');
    if (glue && glue.length > 0) {
      logger.info(`Found @CucumberOptions glue in ${path.basename(filePath)}: ${glue.join(', ')}`);
      return glue;
    }
  }
  return null;
}

async function compileMavenProject(projectRoot: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const autoCompileMaven = config.get<boolean>('autoCompileMaven', false);

  if (!autoCompileMaven) {
    logger.info('Auto-compilation is disabled in settings');
    return true;
  }

  const settings = mavenSettingsFlag(projectRoot);
  const command = buildMavenCommand(`${settings} test-compile -Dmaven.compiler.useIncrementalCompilation=false -q`);

  logger.info('Ensuring Maven project is compiled (incremental)...');
  logger.debug(`Maven compile command: ${command}`);

  try {
    const { stdout } = await execCommand(command, projectRoot);
    logger.info('Maven project compilation completed');
    if (stdout) {
      logger.debug('Maven output:', stdout);
    }
    return true;
  } catch (error) {
    const mavenError = error as MavenExecError;
    logger.error('Error compiling Maven project:', mavenError.message);
    if (mavenError.stderr) {
      logger.error('stderr:', mavenError.stderr);
    }
    return false;
  }
}

function fixSlf4jBinding(classPaths: string[]): string[] {
  // Check if classpath has slf4j-api 2.x
  const hasSlf4jApi2 = classPaths.some(p => /slf4j-api[/-]2\./i.test(p));
  if (!hasSlf4jApi2) {
    return classPaths;
  }

  // Check if a compatible SLF4J 2.x binding already exists
  const hasCompatibleBinding = classPaths.some(p =>
    (/slf4j-simple[/-]2\./i.test(p) ||
     /slf4j-jdk14[/-]2\./i.test(p) ||
     /log4j-slf4j2-impl/i.test(p) ||
     /logback-classic/i.test(p)) &&
    fs.existsSync(p)
  );

  if (hasCompatibleBinding) {
    return classPaths;
  }

  // Find slf4j-simple 2.x in local M2 repo
  const m2Slf4jSimpleDir = path.join(os.homedir(), '.m2', 'repository', 'org', 'slf4j', 'slf4j-simple');
  let bestJar: string | undefined;

  try {
    if (fs.existsSync(m2Slf4jSimpleDir)) {
      const versions = fs.readdirSync(m2Slf4jSimpleDir).filter(v => v.startsWith('2.'));
      versions.sort().reverse(); // prefer latest 2.x
      for (const version of versions) {
        const jar = path.join(m2Slf4jSimpleDir, version, `slf4j-simple-${version}.jar`);
        if (fs.existsSync(jar)) {
          bestJar = jar;
          break;
        }
      }
    }
  } catch (err) {
    logger.warn('Could not scan M2 repo for slf4j-simple 2.x:', err);
  }

  if (bestJar) {
    logger.info(`SLF4J 2.x detected without compatible binding — prepending: ${bestJar}`);
    return [bestJar, ...classPaths];
  }

  logger.warn('slf4j-api 2.x is on classpath but no compatible SLF4J binding found in M2 repo. HTTP logs may be suppressed.');
  return classPaths;
}

function getProjectClasspathRoots(projectRoot: string): string[] {
  const classPaths: string[] = [
    path.join(projectRoot, 'target', 'test-classes'),
    path.join(projectRoot, 'target', 'classes')
  ];

  // Add generated-sources subdirectories as classpath roots
  // For package "atf.generated.models", classpath root should be "target/generated-sources/swagger"
  const generatedSourcesDir = path.join(projectRoot, 'target', 'generated-sources');
  if (fs.existsSync(generatedSourcesDir)) {
    try {
      const entries = fs.readdirSync(generatedSourcesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = path.join(generatedSourcesDir, entry.name);
          // Add subdirectories (swagger, annotations, etc.) as classpath roots
          classPaths.push(subDir);
          logger.debug(`Added generated-sources classpath: ${subDir}`);

          // Check for java/main structure (some generators use this)
          const javaMainPath = path.join(subDir, 'java', 'main');
          if (fs.existsSync(javaMainPath)) {
            classPaths.push(javaMainPath);
          }
          const javaPath = path.join(subDir, 'java');
          if (fs.existsSync(javaPath)) {
            classPaths.push(javaPath);
          }
        }
      }
    } catch (err) {
      logger.debug('Error scanning generated-sources:', err);
    }
  }

  // Also check generated-test-sources
  const generatedTestSourcesDir = path.join(projectRoot, 'target', 'generated-test-sources');
  if (fs.existsSync(generatedTestSourcesDir)) {
    try {
      const entries = fs.readdirSync(generatedTestSourcesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          classPaths.push(path.join(generatedTestSourcesDir, entry.name));
        }
      }
    } catch (err) {
      logger.debug('Error scanning generated-test-sources:', err);
    }
  }

  return classPaths;
}

function getCachedClasspath(projectRoot: string): string[] | undefined {
  const currentMtime = getPomMtime(projectRoot);
  const cached = classpathCache.get(projectRoot);
  if (cached && cached.pomMtime === currentMtime && currentMtime !== 0) {
    logger.info('Using cached Maven classpath (pom.xml unchanged)');
    return cached.classPaths;
  }
  return undefined;
}

export async function resolveMavenClasspath(projectRoot: string): Promise<string[]> {
  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const autoCompileMaven = config.get<boolean>('autoCompileMaven', false);

  const cached = getCachedClasspath(projectRoot);
  if (cached) {
    // pom.xml unchanged: the dependency list is still valid, but sources may
    // have changed - compile anyway when auto-compile is enabled (previously
    // this path skipped compilation entirely and ran stale classes).
    if (autoCompileMaven) {
      await compileMavenProject(projectRoot);
    }
    return cached;
  }

  const settings = mavenSettingsFlag(projectRoot);
  const outputFile = path.join(os.tmpdir(), `cucumber-cp-${process.pid}-${Date.now()}.txt`);
  const goals = autoCompileMaven ? 'test-compile dependency:build-classpath' : 'dependency:build-classpath';
  const command = buildMavenCommand(
    `${settings} ${goals} -DincludeScope=test -q -Dmdep.outputFile=${quoteShellArg(outputFile)}`
  );

  logger.info('Resolving Maven classpath...');
  logger.debug(`Maven classpath command: ${command}`);

  let dependencyOutput = '';
  try {
    const { stdout } = await execCommand(command, projectRoot);
    dependencyOutput = tryReadClasspathFile(outputFile) || stdout.trim();
  } catch (error) {
    const mavenError = error as MavenExecError;
    if (mavenError.killed) {
      logger.error(`Maven timed out after ${MAVEN_TIMEOUT_MS / 60000} minute(s) and was killed.`);
    }
    logger.error('Error resolving Maven classpath:', mavenError.message);
    if (mavenError.stderr) {
      logger.error('stderr:', mavenError.stderr);
    }

    if (autoCompileMaven) {
      try {
        logger.warn('Retrying classpath resolution without compilation...');
        const retryCommand = buildMavenCommand(
          `${settings} dependency:build-classpath -DincludeScope=test -q -Dmdep.outputFile=${quoteShellArg(outputFile)}`
        );
        const { stdout } = await execCommand(retryCommand, projectRoot);
        dependencyOutput = tryReadClasspathFile(outputFile) || stdout.trim();
      } catch (retryError) {
        logger.error('Classpath resolution retry also failed:', retryError);
      }
    }
  } finally {
    try { fs.unlinkSync(outputFile); } catch { /* ignore */ }
  }

  const classPaths = getProjectClasspathRoots(projectRoot);

  if (dependencyOutput) {
    classPaths.push(...dependencyOutput.split(path.delimiter).filter(dep => dep.trim().length > 0));
  } else {
    logger.error('Maven dependency classpath could not be resolved; tests will likely fail to start.');
  }

  logger.debug(`Resolved ${classPaths.length} classpath entries from Maven`);

  const fixedClassPaths = fixSlf4jBinding(classPaths);

  if (dependencyOutput) {
    classpathCache.set(projectRoot, { pomMtime: getPomMtime(projectRoot), classPaths: fixedClassPaths });
  }

  return fixedClassPaths;
}

function tryReadClasspathFile(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
  } catch (err) {
    logger.debug('Could not read Maven classpath output file:', err);
  }
  return '';
}

export async function findGluePath(projectRoot: string): Promise<string[] | null> {
  const gluePaths: string[] = [];

  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const additionalGluePaths = config.get<string[]>('additionalGluePaths');

  if (additionalGluePaths && Array.isArray(additionalGluePaths) && additionalGluePaths.length > 0) {
    logger.debug(`Found ${additionalGluePaths.length} additional glue path(s) from configuration`);
    gluePaths.push(...additionalGluePaths);
  }

  // Primary: read @CucumberOptions(glue=...) from JUnit4 runner class
  const runnerGlue = findGlueFromRunnerClass(projectRoot);
  if (runnerGlue && runnerGlue.length > 0) {
    gluePaths.push(...runnerGlue);
  } else {
    // Fallback: scan for a 'steps'/'step' directory
    const testDir = path.join(projectRoot, 'src', 'test', 'java');

    if (fs.existsSync(testDir)) {
      const stepsDir = await findStepsDir(testDir, fs);

      if (stepsDir) {
        const packagePath = path.relative(testDir, stepsDir).replace(/\\/g, '/').replace(/\//g, '.');
        gluePaths.push(packagePath);
      }
    }
  }

  if (gluePaths.length === 0) {
    return null;
  }

  logger.debug(`Resolved glue path(s): ${gluePaths.join(', ')}`);
  return gluePaths;
}

async function findStepsDir(dir: string, fsModule: typeof fs): Promise<string | null> {
  const entries = fsModule.readdirSync(dir, { withFileTypes: true });

  if (dir.endsWith('steps') || dir.endsWith('step')) {
    const hasJavaFiles = entries.some((entry) => !entry.isDirectory() && entry.name.endsWith('.java'));

    if (!hasJavaFiles) {
      const checkSubDirsForJavaFiles = (subDir: string): boolean => {
        const subEntries = fsModule.readdirSync(subDir, { withFileTypes: true });

        const hasDirectJavaFiles = subEntries.some((entry) => !entry.isDirectory() && entry.name.endsWith('.java'));
        if (hasDirectJavaFiles) {
          return true;
        }

        for (const entry of subEntries) {
          if (entry.isDirectory()) {
            const hasJavaInSubDir = checkSubDirsForJavaFiles(path.join(subDir, entry.name));
            if (hasJavaInSubDir) {
              return true;
            }
          }
        }

        return false;
      };

      const hasJavaFilesInSubDirs = entries.some((entry) => {
        if (entry.isDirectory()) {
          return checkSubDirsForJavaFiles(path.join(dir, entry.name));
        }
        return false;
      });

      if (hasJavaFilesInSubDirs) {
        return dir;
      }
    } else {
      return dir;
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name);
      const result = await findStepsDir(subDir, fsModule);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

