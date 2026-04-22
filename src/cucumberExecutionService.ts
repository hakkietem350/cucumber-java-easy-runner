import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findGluePath, resolveMavenClasspath } from './buildWorkspaceHelper';
import { messages, paramMessages } from './i18n';
import { logger } from './logger';

export interface TestExecutionResult {
  passed: boolean;
  resultFile?: string;
  consoleOutput?: string;
}

export interface FeatureToRun {
  uri: vscode.Uri;
  relativePath: string;
  lineNumber?: number;
  exampleLine?: number;
}

// ─── Output channel singleton ─────────────────────────────────────────────────
let _outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel('Cucumber Java Runner');
  }
  return _outputChannel;
}

// Strip ANSI escape codes so the output channel is readable plain text
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

// ─── Custom PTY terminal (clickable links) ────────────────────────────────────

class RunOutputPty implements vscode.Pseudoterminal {
  private readonly _writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite: vscode.Event<string> = this._writeEmitter.event;
  open(): void {}
  close(): void {}
  write(text: string): void {
    // Normalize LF → CRLF so the terminal renders correctly
    this._writeEmitter.fire(text.replace(/(?<!\r)\n/g, '\r\n'));
  }
  clear(): void {
    this._writeEmitter.fire('\x1b[2J\x1b[H');
  }
}

let _runTerminal: vscode.Terminal | undefined;
let _runPty: RunOutputPty | undefined;

function getRunTerminal(): { terminal: vscode.Terminal; pty: RunOutputPty } {
  if (!_runTerminal || !vscode.window.terminals.includes(_runTerminal)) {
    _runPty = new RunOutputPty();
    _runTerminal = vscode.window.createTerminal({ name: 'Cucumber Java Runner', pty: _runPty });
  }
  return { terminal: _runTerminal, pty: _runPty! };
}

export async function runCucumberTestBatch(
  features: FeatureToRun[],
  isDebug = false
): Promise<TestExecutionResult> {
  if (features.length === 0) {
    return { passed: false };
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(features[0].uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(messages.errorNoWorkspaceFolder);
    return { passed: false };
  }

  const projectRoot = workspaceFolder.uri.fsPath;

  try {
    const gluePaths = await findGluePath(projectRoot);

    if (!gluePaths) {
      const userInput = await vscode.window.showInputBox({
        prompt: messages.promptGluePath,
        placeHolder: messages.promptGluePathPlaceholder
      });

      if (!userInput) {
        vscode.window.showErrorMessage(messages.errorGluePathNotSpecified);
        return { passed: false };
      }

      return await executeCucumberTestBatch(
        projectRoot,
        features,
        [userInput],
        isDebug
      );
    } else {
      return await executeCucumberTestBatch(
        projectRoot,
        features,
        gluePaths,
        isDebug
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Error: ${errorMessage}`);
    return { passed: false };
  }
}

export async function runCucumberTest(
  uri: vscode.Uri,
  lineNumber?: number,
  exampleLine?: number,
  isDebug = false
): Promise<TestExecutionResult> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(messages.errorNoWorkspaceFolder);
    return { passed: false };
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);

  return await runCucumberTestBatch(
    [{
      uri: uri,
      relativePath: relativePath,
      lineNumber: lineNumber,
      exampleLine: exampleLine
    }],
    isDebug
  );
}

async function executeCucumberTestBatch(
  projectRoot: string,
  features: FeatureToRun[],
  gluePaths: string[],
  isDebug = false
): Promise<TestExecutionResult> {
  const configPrefix = isDebug ? 'Cucumber Debug: ' : 'Cucumber: ';

  let configName: string;
  if (features.length === 1) {
    const feature = features[0];
    if (feature.exampleLine) {
      configName = `${configPrefix}Example at line ${feature.exampleLine}`;
    } else if (feature.lineNumber) {
      configName = `${configPrefix}Scenario at line ${feature.lineNumber}`;
    } else {
      configName = `${configPrefix}${path.basename(feature.relativePath, '.feature')}`;
    }
  } else {
    configName = `${configPrefix}All Features (${features.length} files)`;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage(messages.errorNoWorkspace);
    return { passed: false };
  }

  const classPaths = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: paramMessages.compilingFeatures(features.length),
    cancellable: false
  }, async () => await resolveMavenClasspath(projectRoot));

  const resultFile = path.join(projectRoot, 'target', `.cucumber-result-${Date.now()}.json`);

  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const customObjectFactory = config.get<string>('objectFactory');
  const customVmArgs = config.get<string>('vmArgs') || '';

  const cucumberPaths = features.map(f => {
    let cucumberPath = f.relativePath.replace(/\\/g, '/');

    if (f.exampleLine) {
      cucumberPath += ':' + f.exampleLine;
    } else if (f.lineNumber) {
      cucumberPath += ':' + f.lineNumber;
    }

    return cucumberPath;
  }).join(' ');

  const cucumberArgs = [
    ...gluePaths.flatMap(gluePath => ['--glue', gluePath]),
    '--plugin', 'pretty',
    ...(!isDebug ? ['--monochrome'] : []),
    '--plugin', `json:${resultFile}`,
    ...(customObjectFactory ? ['--object-factory', customObjectFactory] : []),
    cucumberPaths
  ].join(' ');

  if (isDebug) {
    return await runWithVSCode(workspaceFolder, configName, classPaths, cucumberArgs, projectRoot, resultFile, customVmArgs);
  } else {
    return await runWithProcess(workspaceFolder, configName, classPaths, cucumberArgs, projectRoot, resultFile, customVmArgs);
  }
}

// ─── Spawn-based run (captures stdout/stderr) ─────────────────────────────────

async function runWithProcess(
  workspaceFolder: vscode.WorkspaceFolder,
  configName: string,
  classPaths: string[],
  cucumberArgs: string,
  projectRoot: string,
  resultFile: string,
  customVmArgs: string
): Promise<TestExecutionResult> {
  // Write argfile for long classpaths
  const argFilePath = await writeArgFile(projectRoot, classPaths, cucumberArgs, customVmArgs);

  const javaExecutable = await resolveJavaExecutable(projectRoot);
  const args = argFilePath ? [`@${argFilePath}`] : buildJavaArgs(classPaths, cucumberArgs, customVmArgs);

  const { terminal, pty } = getRunTerminal();
  pty.clear();
  terminal.show(true);
  pty.write(`▶ ${configName}\r\n`);
  pty.write('─'.repeat(60) + '\r\n');

  const outputLines: string[] = [];

  return new Promise<TestExecutionResult>((resolve) => {
    const proc = spawn(javaExecutable, args, {
      cwd: projectRoot,
      env: { ...process.env }
    });

    const handleData = (data: Buffer) => {
      const raw = data.toString();
      pty.write(raw);
      outputLines.push(stripAnsi(raw));
    };

    proc.stdout.on('data', handleData);
    proc.stderr.on('data', handleData);

    proc.on('error', (err) => {
      const msg = `Failed to start Java process: ${err.message}`;
      pty.write(msg + '\r\n');
      logger.error(msg);
      if (argFilePath) { tryDeleteFile(argFilePath); }
      resolve({ passed: false, consoleOutput: outputLines.join('') });
    });

    proc.on('close', async (code) => {
      pty.write('─'.repeat(60) + '\r\n');
      pty.write(`Process exited with code ${code}\r\n`);

      if (argFilePath) { tryDeleteFile(argFilePath); }

      const consoleOutput = outputLines.join('');
      const testPassed = await checkCucumberResults(resultFile);

      resolve({
        passed: testPassed,
        resultFile: resultFile,
        consoleOutput: consoleOutput
      });
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      proc.kill();
      logger.warn('Test execution timeout after 10 minutes');
      if (argFilePath) { tryDeleteFile(argFilePath); }
      resolve({ passed: false, consoleOutput: outputLines.join('') });
    }, 600000);
  });
}

function buildJavaArgs(classPaths: string[], cucumberArgs: string, customVmArgs: string): string[] {
  const vmArgsList = `-Dfile.encoding=UTF-8 ${customVmArgs}`.trim().split(/\s+/).filter(Boolean);
  const cpStr = classPaths.join(path.delimiter);
  return [
    ...vmArgsList,
    '-cp', cpStr,
    'io.cucumber.core.cli.Main',
    ...cucumberArgs.split(/\s+/).filter(Boolean)
  ];
}

async function writeArgFile(
  projectRoot: string,
  classPaths: string[],
  cucumberArgs: string,
  customVmArgs: string
): Promise<string | undefined> {
  try {
    const vmArgsList = `-Dfile.encoding=UTF-8 ${customVmArgs}`.trim().split(/\s+/).filter(Boolean);
    const cpStr = classPaths.map(p => `"${p.replace(/\\/g, '/')}"`).join(path.delimiter);
    const cucumberArgsList = cucumberArgs.split(/\s+/).filter(Boolean).map(a => `"${a}"`);

    const content = [
      ...vmArgsList,
      `-cp`,
      cpStr,
      `io.cucumber.core.cli.Main`,
      ...cucumberArgsList
    ].join('\n');

    const argFilePath = path.join(os.tmpdir(), `.cucumber-args-${Date.now()}.txt`);
    fs.writeFileSync(argFilePath, content, 'utf-8');
    logger.debug(`Wrote argfile: ${argFilePath}`);
    return argFilePath;
  } catch (err) {
    logger.warn('Could not write argfile, using inline args:', err);
    return undefined;
  }
}

async function resolveJavaExecutable(projectRoot: string): Promise<string> {
  // Try JAVA_HOME first, then fall back to 'java' on PATH
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const javaExe = path.join(javaHome, 'bin', 'java');
    if (fs.existsSync(javaExe)) {
      return javaExe;
    }
  }
  return 'java';
}

function tryDeleteFile(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// ─── Debug mode: VS Code debugger ────────────────────────────────────────────

async function runWithVSCode(
  workspaceFolder: vscode.WorkspaceFolder,
  configName: string,
  classPaths: string[],
  cucumberArgs: string,
  projectRoot: string,
  resultFile: string,
  customVmArgs: string
): Promise<TestExecutionResult> {
  const config: vscode.DebugConfiguration = {
    type: 'java',
    name: configName,
    request: 'launch',
    mainClass: 'io.cucumber.core.cli.Main',
    cwd: projectRoot,
    args: cucumberArgs,
    classPaths: classPaths,
    vmArgs: `-Dfile.encoding=UTF-8 ${customVmArgs}`.trim(),
    console: 'integratedTerminal',
    noDebug: false,
    stopOnEntry: false,
    internalConsoleOptions: 'neverOpen',
  };

  const started = await vscode.debug.startDebugging(workspaceFolder, config);

  if (!started) {
    const errorMsg = messages.errorDebugFailed;
    vscode.window.showErrorMessage(errorMsg);
    return { passed: false };
  }

  return await new Promise<TestExecutionResult>((resolve) => {
    const disposable = vscode.debug.onDidTerminateDebugSession(async (session) => {
      if (session.name === configName) {
        disposable.dispose();

        const testPassed = await checkCucumberResults(resultFile);

        resolve({
          passed: testPassed,
          resultFile: resultFile
        });
      }
    });

    setTimeout(() => {
      disposable.dispose();
      logger.warn('Test execution timeout after 10 minutes');
      resolve({ passed: false });
    }, 600000);
  });
}

async function waitForValidJsonFile(filePath: string, maxAttempts = 20, delayMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!fs.existsSync(filePath)) {
        logger.trace(`Attempt ${attempt}/${maxAttempts}: File does not exist yet:`, filePath);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        logger.trace(`Attempt ${attempt}/${maxAttempts}: File is empty:`, filePath);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');

      if (fileContent.trim().length === 0) {
        logger.trace(`Attempt ${attempt}/${maxAttempts}: File contains only whitespace`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      const jsonData = JSON.parse(fileContent);

      if (!Array.isArray(jsonData)) {
        logger.trace(`Attempt ${attempt}/${maxAttempts}: JSON is not an array`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      logger.debug(`File is valid JSON after ${attempt} attempt(s)`);
      return true;
    } catch (error) {
      logger.trace(`Attempt ${attempt}/${maxAttempts}: Error reading/parsing file - ${error instanceof Error ? error.message : 'Unknown error'}`);

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  logger.error(`Failed to get valid JSON file after ${maxAttempts} attempts`);
  return false;
}

async function checkCucumberResults(resultFile: string): Promise<boolean> {
  try {
    const isValid = await waitForValidJsonFile(resultFile);

    if (!isValid) {
      logger.error('Result file is not valid or was not created:', resultFile);
      return false;
    }

    const fileContent = fs.readFileSync(resultFile, 'utf-8');
    const results = JSON.parse(fileContent);

    logger.info('Analyzing Cucumber results from:', resultFile);

    let totalScenarios = 0;
    let passedScenarios = 0;
    let failedScenarios = 0;

    if (!Array.isArray(results)) {
      logger.error('Results is not an array');
      return false;
    }

    for (const feature of results) {
      if (feature && Array.isArray(feature.elements)) {
        for (const scenario of feature.elements) {
          totalScenarios++;

          let scenarioPassed = true;
          let hasSteps = false;

          if (Array.isArray(scenario.steps) && scenario.steps.length > 0) {
            hasSteps = true;
            for (const step of scenario.steps) {
              if (!step?.result || step.result.status !== 'passed') {
                scenarioPassed = false;
                break;
              }
            }
          } else {
            scenarioPassed = false;
          }

          if (scenarioPassed && hasSteps) {
            passedScenarios++;
          } else {
            failedScenarios++;
          }
        }
      }
    }

    logger.info(`Test Results: ${passedScenarios}/${totalScenarios} scenarios passed`);

    if (failedScenarios > 0) {
      logger.info(`❌ ${failedScenarios} scenario(s) failed`);
      return false;
    } else {
      logger.info('✅ All scenarios passed');
      return true;
    }
  } catch (error) {
    logger.error('Error reading Cucumber results:', error);
    return false;
  }
}
