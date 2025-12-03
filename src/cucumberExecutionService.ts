import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findGluePath, resolveMavenClasspath } from './buildWorkspaceHelper';
import { logger } from './logger';

export interface TestExecutionResult {
  passed: boolean;
  resultFile?: string;
}

export interface FeatureToRun {
  uri: vscode.Uri;
  relativePath: string;
  lineNumber?: number;
  exampleLine?: number;
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
    vscode.window.showErrorMessage('Feature file is not inside a workspace.');
    return { passed: false };
  }

  const projectRoot = workspaceFolder.uri.fsPath;

  try {
    const gluePaths = await findGluePath(projectRoot);

    if (!gluePaths) {
      const userInput = await vscode.window.showInputBox({
        prompt: 'Enter glue path for steps directory (e.g. org.example.steps)',
        placeHolder: 'org.example.steps'
      });

      if (!userInput) {
        vscode.window.showErrorMessage('Glue path not specified, operation cancelled.');
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
    vscode.window.showErrorMessage('Feature file is not inside a workspace.');
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
    vscode.window.showErrorMessage('No workspace folder found.');
    return { passed: false };
  }

  const classPaths = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Compiling project and resolving dependencies for ${features.length} feature(s)...`,
    cancellable: false
  }, async () => await resolveMavenClasspath(projectRoot));

  const resultFile = path.join(projectRoot, 'target', `.cucumber-result-${Date.now()}.json`);

  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const customObjectFactory = config.get<string>('objectFactory');

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
    '--plugin', `json:${resultFile}`,
    ...(customObjectFactory ? ['--object-factory', customObjectFactory] : []),
    cucumberPaths
  ].join(' ');

  return await runWithVSCode(workspaceFolder, configName, classPaths, cucumberArgs, projectRoot, resultFile, isDebug);
}

async function runWithVSCode(
  workspaceFolder: vscode.WorkspaceFolder,
  configName: string,
  classPaths: string[],
  cucumberArgs: string,
  projectRoot: string,
  resultFile: string,
  isDebug: boolean
): Promise<TestExecutionResult> {
  const config: vscode.DebugConfiguration = {
    type: 'java',
    name: configName,
    request: 'launch',
    mainClass: 'io.cucumber.core.cli.Main',
    projectName: path.basename(projectRoot),
    cwd: '${workspaceFolder}',
    args: cucumberArgs,
    classPaths: classPaths,
    vmArgs: '-Dfile.encoding=UTF-8',
    console: 'integratedTerminal',
    noDebug: !isDebug,
    stopOnEntry: false,
    internalConsoleOptions: 'neverOpen',
  };

  const started = await vscode.debug.startDebugging(workspaceFolder, config);

  if (!started) {
    vscode.window.showErrorMessage(`Failed to start ${isDebug ? 'debug' : 'test'} session. Make sure you have the Java debugger extension installed.`);
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

