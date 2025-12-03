import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from './logger';

async function compileMavenProject(projectRoot: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const autoCompileMaven = config.get<boolean>('autoCompileMaven', true);

  if (!autoCompileMaven) {
    logger.info('Auto-compilation is disabled in settings');
    return true;
  }

  return new Promise((resolve) => {
    const command = 'mvn compile test-compile -Dmaven.compiler.useIncrementalCompilation=true -q';

    logger.info('Ensuring Maven project is compiled (incremental)...');

    exec(command, { cwd: projectRoot }, (error, stdout, stderr) => {
      if (error) {
        logger.error('Error compiling Maven project:', error);
        logger.error('stderr:', stderr);
        logger.debug('stdout:', stdout);
        resolve(false);
        return;
      }

      logger.info('Maven project compilation completed');
      if (stdout) {
        logger.debug('Maven output:', stdout);
      }
      resolve(true);
    });
  });
}

export async function resolveMavenClasspath(projectRoot: string): Promise<string[]> {
  const compiled = await compileMavenProject(projectRoot);
  if (!compiled) {
    logger.warn('Maven compilation failed, but continuing with classpath resolution...');
  }

  return new Promise((resolve) => {
    const command = 'mvn dependency:build-classpath -DincludeScope=test -q -Dmdep.outputFile=/dev/stdout';

    exec(command, { cwd: projectRoot }, (error, stdout, stderr) => {
      const classPaths: string[] = [
        path.join(projectRoot, 'target', 'test-classes'),
        path.join(projectRoot, 'target', 'classes'),
        path.join(projectRoot, 'target', 'generated-sources', 'annotations'),
        path.join(projectRoot, 'target', 'generated-sources', 'swagger', 'java', 'main')
      ];

      if (error) {
        logger.error('Error resolving Maven classpath:', error);
        logger.error('stderr:', stderr);
        resolve(classPaths);
        return;
      }

      const output = stdout.trim();
      if (output) {
        const dependencies = output.split(':').filter(dep => dep.trim().length > 0);
        classPaths.push(...dependencies);
      }

      logger.debug(`Resolved ${classPaths.length} classpath entries from Maven`);
      resolve(classPaths);
    });
  });
}

export async function findGluePath(projectRoot: string): Promise<string[] | null> {
  const gluePaths: string[] = [];

  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const additionalGluePaths = config.get<string[]>('additionalGluePaths');

  if (additionalGluePaths && Array.isArray(additionalGluePaths) && additionalGluePaths.length > 0) {
    logger.debug(`Found ${additionalGluePaths.length} additional glue path(s) from configuration`);
    gluePaths.push(...additionalGluePaths);
  }

  const testDir = path.join(projectRoot, 'src', 'test', 'java');

  if (fs.existsSync(testDir)) {
    const stepsDir = await findStepsDir(testDir, fs);

    if (stepsDir) {
      const packagePath = path.relative(testDir, stepsDir).replace(/\\/g, '/').replace(/\//g, '.');
      gluePaths.push(packagePath);
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

