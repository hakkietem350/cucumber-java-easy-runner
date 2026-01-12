/**
 * VS Code extension main file - Cucumber Java Easy Runner
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { runCucumberTest } from './cucumberExecutionService';
import { CucumberTestExplorer } from './cucumberTestExplorer';
import { locateExampleByLine, locateScenarioByLine } from './gherkinParser';
import { messages, paramMessages } from './i18n';
import { FeatureFileActionButtons } from './inlineRunButtons';
import { initializeLogger, logger } from './logger';
import { disposeStatusBar, getStatusBar } from './statusBar';

// Global test explorer instance
let testExplorer: CucumberTestExplorer | undefined;

export function activate(context: vscode.ExtensionContext) {
  initializeLogger(context);
  logger.info(messages.activating);

  // Dispose existing explorer if it exists
  if (testExplorer) {
    try {
      testExplorer.dispose();
    } catch (error) {
      logger.error('Error disposing previous explorer:', error);
    }
  }

  // Create new test explorer
  testExplorer = new CucumberTestExplorer(context);
  logger.info(messages.testExplorerCreated);

  // Initialize status bar
  const statusBar = getStatusBar();
  context.subscriptions.push({ dispose: () => disposeStatusBar() });

  // Check if CodeLens should be enabled (default: false since we have Test Explorer)
  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const enableCodeLens = config.get('enableCodeLens', false);

  if (enableCodeLens) {
    // Register inline action buttons only if enabled
    const actionButtons = new FeatureFileActionButtons();
    const buttonsDisposable = vscode.languages.registerCodeLensProvider(
      { pattern: '**/*.feature' },
      actionButtons
    );
    context.subscriptions.push(buttonsDisposable);
    logger.info(messages.inlineButtonsRegistered);
  } else {
    logger.info(messages.inlineButtonsDisabled);
  }

  // ==================== RUN COMMANDS ====================

  // Command to run the entire feature file
  const runFeatureCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runFeature', async (uri: vscode.Uri) => {
    let featureUri = uri;

    // If called from editor instead of explorer
    if (!featureUri && vscode.window.activeTextEditor) {
      featureUri = vscode.window.activeTextEditor.document.uri;
    }

    if (!featureUri) {
      vscode.window.showErrorMessage(messages.errorOpenFeatureFile);
      return;
    }

    await runCucumberTest(featureUri);
  });

  // CodeLens command to run the entire feature file
  const runFeatureCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runFeatureCodeLens', async (uri: vscode.Uri) => {
    logger.debug('runFeatureCodeLensCommand called with URI:', uri.toString());
    vscode.window.showInformationMessage(messages.infoFeatureTestStarting);
    await runCucumberTest(uri);
  });

  // CodeLens command to run a single scenario
  const runScenarioCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runScenarioCodeLens', async (uri: vscode.Uri, lineNumber: number) => {
    logger.debug('runScenarioCodeLensCommand called with URI:', uri.toString(), 'line:', lineNumber);
    vscode.window.showInformationMessage(paramMessages.scenarioTestStarting(lineNumber));
    await runCucumberTest(uri, lineNumber);
  });

  // CodeLens command to run a single example
  const runExampleCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runExampleCodeLens', async (uri: vscode.Uri, scenarioLine: number, exampleLine: number) => {
    logger.debug('runExampleCodeLensCommand called with URI:', uri.toString(), 'scenario line:', scenarioLine, 'example line:', exampleLine);
    vscode.window.showInformationMessage(paramMessages.exampleTestStarting(exampleLine));
    await runCucumberTest(uri, scenarioLine, exampleLine);
  });

  // Command to run a single scenario (from context menu)
  const runScenarioCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runScenario', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(messages.errorOpenFile);
      return;
    }

    const uri = editor.document.uri;
    if (path.extname(uri.fsPath) !== '.feature') {
      vscode.window.showErrorMessage(messages.errorFeatureFilesOnly);
      return;
    }

    const currentLine = editor.selection.active.line;
    const scenario = locateScenarioByLine(editor.document, currentLine);

    if (!scenario) {
      vscode.window.showErrorMessage(messages.errorRightClickScenario);
      return;
    }

    await runCucumberTest(uri, scenario.lineNumber);
  });

  // Command to run a single example row (from context menu)
  const runExampleCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runExample', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(messages.errorOpenFile);
      return;
    }

    const uri = editor.document.uri;
    if (path.extname(uri.fsPath) !== '.feature') {
      vscode.window.showErrorMessage(messages.errorFeatureFilesOnly);
      return;
    }

    const currentLine = editor.selection.active.line;
    logger.debug(`runExampleCommand called, line: ${currentLine}`);

    // First check if the line starts with |
    const lineText = editor.document.lineAt(currentLine).text.trim();
    if (!lineText.startsWith('|')) {
      vscode.window.showErrorMessage(messages.errorRightClickExample);
      return;
    }

    const examples = locateExampleByLine(editor.document, currentLine);

    if (!examples) {
      vscode.window.showErrorMessage(messages.errorExampleNotDetected);
      return;
    }

    await runCucumberTest(uri, examples.lineNumber, examples.exampleLineNumber);
  });

  // ==================== DEBUG COMMANDS ====================

  // Command to debug the entire feature file
  const debugFeatureCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.debugFeature', async (uri: vscode.Uri) => {
    let featureUri = uri;

    // If called from editor instead of explorer
    if (!featureUri && vscode.window.activeTextEditor) {
      featureUri = vscode.window.activeTextEditor.document.uri;
    }

    if (!featureUri) {
      vscode.window.showErrorMessage(messages.errorOpenFeatureFile);
      return;
    }

    await runCucumberTest(featureUri, undefined, undefined, true);
  });

  // CodeLens command to debug the entire feature file
  const debugFeatureCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.debugFeatureCodeLens', async (uri: vscode.Uri) => {
    logger.debug('debugFeatureCodeLensCommand called with URI:', uri.toString());
    vscode.window.showInformationMessage(messages.infoFeatureDebugStarting);
    await runCucumberTest(uri, undefined, undefined, true);
  });

  // CodeLens command to debug a single scenario
  const debugScenarioCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.debugScenarioCodeLens', async (uri: vscode.Uri, lineNumber: number) => {
    logger.debug('debugScenarioCodeLensCommand called with URI:', uri.toString(), 'line:', lineNumber);
    vscode.window.showInformationMessage(paramMessages.scenarioDebugStarting(lineNumber));
    await runCucumberTest(uri, lineNumber, undefined, true);
  });

  // CodeLens command to debug a single example
  const debugExampleCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.debugExampleCodeLens', async (uri: vscode.Uri, scenarioLine: number, exampleLine: number) => {
    logger.debug('debugExampleCodeLensCommand called with URI:', uri.toString(), 'scenario line:', scenarioLine, 'example line:', exampleLine);
    vscode.window.showInformationMessage(paramMessages.exampleDebugStarting(exampleLine));
    await runCucumberTest(uri, scenarioLine, exampleLine, true);
  });

  // Command to debug a single scenario (from context menu)
  const debugScenarioCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.debugScenario', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(messages.errorOpenFile);
      return;
    }

    const uri = editor.document.uri;
    if (path.extname(uri.fsPath) !== '.feature') {
      vscode.window.showErrorMessage(messages.errorFeatureFilesOnly);
      return;
    }

    const currentLine = editor.selection.active.line;
    const scenario = locateScenarioByLine(editor.document, currentLine);

    if (!scenario) {
      vscode.window.showErrorMessage(messages.errorRightClickScenario);
      return;
    }

    await runCucumberTest(uri, scenario.lineNumber, undefined, true);
  });

  // Command to debug a single example row (from context menu)
  const debugExampleCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.debugExample', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(messages.errorOpenFile);
      return;
    }

    const uri = editor.document.uri;
    if (path.extname(uri.fsPath) !== '.feature') {
      vscode.window.showErrorMessage(messages.errorFeatureFilesOnly);
      return;
    }

    const currentLine = editor.selection.active.line;
    logger.debug(`debugExampleCommand called, line: ${currentLine}`);

    // First check if the line starts with |
    const lineText = editor.document.lineAt(currentLine).text.trim();
    if (!lineText.startsWith('|')) {
      vscode.window.showErrorMessage(messages.errorRightClickExample);
      return;
    }

    const examples = locateExampleByLine(editor.document, currentLine);

    if (!examples) {
      vscode.window.showErrorMessage(messages.errorExampleNotDetected);
      return;
    }

    await runCucumberTest(uri, examples.lineNumber, examples.exampleLineNumber, true);
  });

  // ==================== REGISTER ALL COMMANDS ====================
  context.subscriptions.push(
    // Run commands
    runFeatureCommand,
    runFeatureCodeLensCommand,
    runScenarioCodeLensCommand,
    runExampleCodeLensCommand,
    runScenarioCommand,
    runExampleCommand,
    // Debug commands
    debugFeatureCommand,
    debugFeatureCodeLensCommand,
    debugScenarioCodeLensCommand,
    debugExampleCodeLensCommand,
    debugScenarioCommand,
    debugExampleCommand
  );
}

export function deactivate() {
  if (testExplorer) {
    testExplorer.dispose();
    testExplorer = undefined;
  }
}
