// VS Code extension main file
import * as path from 'path';
import * as vscode from 'vscode';
import { FeatureToRun, runCucumberTest, runCucumberTestBatch } from './cucumberExecutionService';
import { initializeLogger, logger } from './logger';
import { cleanupResultFile, getTestErrorMessages, hasFeatureFailures, markChildrenFromResults } from './testResultMapper';

interface ScenarioInfo {
  name: string;
  lineNumber: number;
  exampleLineNumber?: number;
  examples?: ExampleInfo[];
}

interface ExampleInfo {
  lineNumber: number;
  data: string;
}

interface FeatureInfo {
  name: string;
  scenarios: ScenarioInfo[];
  filePath: string;
  lineNumber: number;
}

/**
 * Test controller for Cucumber tests
 */
class CucumberTestController {
  private controller: vscode.TestController;
  private watchedFiles = new Map<string, vscode.TestItem>();

  constructor(context: vscode.ExtensionContext) {
    this.controller = vscode.tests.createTestController('cucumberJavaEasyRunner', 'Cucumber Java Tests');
    context.subscriptions.push(this.controller);

    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/*.feature',
      false, // ignoreCreateEvents
      false, // ignoreChangeEvents  
      false  // ignoreDeleteEvents
    );
    context.subscriptions.push(watcher);

    watcher.onDidCreate(uri => this.handleFileEvent('create', uri));
    watcher.onDidChange(uri => this.handleFileEvent('change', uri));
    watcher.onDidDelete(uri => this.handleFileEvent('delete', uri));

    this.controller.createRunProfile(
      'Run Cucumber Tests',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.executeTests(request, token, false),
      true
    );

    this.controller.createRunProfile(
      'Debug Cucumber Tests',
      vscode.TestRunProfileKind.Debug,
      (request, token) => this.executeTests(request, token, true),
      true
    );

    // Add refresh button to test controller
    this.controller.refreshHandler = () => {
      logger.debug('Test controller refresh triggered');
      this.discoverTests();
    };

    setTimeout(() => {
      this.discoverTests();
    }, 500);

    // Add refresh command
    const refreshCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.refreshTests', () => {
      logger.info('Refreshing Cucumber tests...');
      this.discoverTests();
    });
    context.subscriptions.push(refreshCommand);
  }

  private handleFileEvent(eventType: string, uri: vscode.Uri) {
    // Filter out files from build/target directories
    const filePath = uri.fsPath.toLowerCase();
    const excludedPaths = ['target', 'build', 'out', 'dist', 'node_modules', '.git'];

    if (excludedPaths.some(excluded => filePath.includes(`/${excluded}/`) || filePath.includes(`\\${excluded}\\`))) {
      logger.trace(`Ignoring ${eventType} event for build directory file: ${uri.fsPath}`);
      return;
    }

    logger.debug(`Handling ${eventType} event for: ${uri.fsPath}`);

    if (eventType === 'delete') {
      this.deleteTest(uri);
    } else {
      // Add small delay to ensure file is fully written
      setTimeout(() => {
        this.createOrUpdateTest(uri);
      }, 100);
    }
  }

  private async discoverTests() {
    this.controller.items.replace([]);
    this.watchedFiles.clear();

    const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
    const excludeDirs = config.get<string[]>('excludeBuildDirectories', [
      'target',
      'build',
      'out',
      'dist',
      'node_modules',
      '.git'
    ]);

    const excludePattern = '{' + excludeDirs.map(dir => `**/${dir}/**`).join(',') + '}';

    logger.debug('Excluding directories:', excludePattern);

    const featureFiles = await vscode.workspace.findFiles(
      '**/*.feature',
      excludePattern
    );

    logger.info(`Found ${featureFiles.length} feature files`);

    for (const uri of featureFiles) {
      logger.debug(`Processing feature file: ${uri.fsPath}`);
      await this.createOrUpdateTest(uri);
    }
  }

  private async createOrUpdateTest(uri: vscode.Uri) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const featureInfo = parseFeatureFile(document);

      if (!featureInfo) return;

      // Create unique feature ID using normalized file path
      const featureId = path.normalize(uri.fsPath);

      // Check if feature already exists
      if (this.watchedFiles.has(featureId)) {
        logger.trace(`Feature already exists: ${featureId}`);
        return;
      }

      const featureItem = this.controller.createTestItem(featureId, featureInfo.name, uri);

      // Set range for feature to show play button in gutter
      featureItem.range = new vscode.Range(
        featureInfo.lineNumber - 1, 0,
        featureInfo.lineNumber - 1, 0
      );

      this.controller.items.add(featureItem);
      this.watchedFiles.set(featureId, featureItem);

      // Add scenarios as children
      for (const scenario of featureInfo.scenarios) {
        const scenarioId = `${featureId}:scenario:${scenario.lineNumber}`;
        const scenarioItem = this.controller.createTestItem(
          scenarioId,
          scenario.name,
          uri
        );

        scenarioItem.range = new vscode.Range(
          scenario.lineNumber - 1, 0,
          scenario.lineNumber - 1, 0
        );

        featureItem.children.add(scenarioItem);

        // Add example rows as children of scenario
        if (scenario.examples && scenario.examples.length > 0) {
          for (const example of scenario.examples) {
            const exampleId = `${scenarioId}:example:${example.lineNumber}`;
            const exampleItem = this.controller.createTestItem(
              exampleId,
              `Example: ${example.data.trim()}`,
              uri
            );

            exampleItem.range = new vscode.Range(
              example.lineNumber - 1, 0,
              example.lineNumber - 1, 0
            );

            scenarioItem.children.add(exampleItem);
          }
        }
      }

      logger.info(`Added feature: ${featureInfo.name} with ${featureInfo.scenarios.length} scenarios`);

    } catch (error) {
      logger.error('Error parsing feature file:', error);
    }
  }

  private deleteTest(uri: vscode.Uri) {
    const featureId = path.normalize(uri.fsPath);
    const featureItem = this.watchedFiles.get(featureId);

    if (featureItem) {
      this.controller.items.delete(featureId);
      this.watchedFiles.delete(featureId);
      logger.debug(`Deleted feature: ${featureId}`);
    }
  }

  private async executeTests(request: vscode.TestRunRequest, token: vscode.CancellationToken, isDebug: boolean) {
    const run = this.controller.createTestRun(request);

    const testItems = request.include || this.gatherAllTests();
    const itemsToRun = this.filterTestItems(testItems);

    this.resetPendingState(itemsToRun, run);

    await this.executeBatchTests(itemsToRun, run, isDebug, token);

    run.end();
  }

  private gatherAllTests(): vscode.TestItem[] {
    const tests: vscode.TestItem[] = [];

    this.controller.items.forEach(item => {
      tests.push(item);
    });

    return tests;
  }

  private async executeBatchTests(
    testItems: vscode.TestItem[],
    run: vscode.TestRun,
    isDebug: boolean,
    token: vscode.CancellationToken
  ) {
    try {
      for (const item of testItems) {
        if (token.isCancellationRequested) {
          break;
        }
        await this.executeSingleTestItem(item, run, isDebug);
      }
    } catch (error) {
      const errorType = isDebug ? 'Debug' : 'Test execution';
      logger.error(`${errorType} error:`, error);
      for (const item of testItems) {
        run.failed(item, new vscode.TestMessage(`${errorType} failed: ${error}`));
      }
    }
  }

  private async executeSingleTestItem(
    item: vscode.TestItem,
    run: vscode.TestRun,
    isDebug: boolean
  ): Promise<boolean> {
    const isExample = this.isExampleItem(item);
    const isScenario = this.isScenarioItem(item);
    const isFeature = !isScenario && !isExample;

    if (isFeature && item.children.size > 0) {
      run.started(item);
      let allPassed = true;

      const children: vscode.TestItem[] = [];
      item.children.forEach(child => children.push(child));

      for (const child of children) {
        const childPassed = await this.executeSingleTestItem(child, run, isDebug);
        if (!childPassed) {
          allPassed = false;
        }
      }

      if (allPassed) {
        run.passed(item);
      } else {
        run.failed(item, new vscode.TestMessage('One or more scenarios failed.'));
      }
      return allPassed;
    }

    run.started(item);

    const itemUri = item.uri;
    if (!itemUri) {
      run.failed(item, new vscode.TestMessage('Test item has no URI'));
      return false;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(itemUri);
    if (!workspaceFolder) {
      run.failed(item, new vscode.TestMessage('Test item is outside the workspace'));
      return false;
    }

    const descriptors = this.buildFeatureDescriptors(item, workspaceFolder);
    if (!descriptors) {
      run.failed(item, new vscode.TestMessage('Unable to resolve feature path'));
      return false;
    }

    logger.info(`Running ${descriptors.length} descriptor(s) for ${item.label}`);
    const result = await runCucumberTestBatch(descriptors, isDebug);

    if (!result.resultFile) {
      const consoleType = isDebug ? 'debug console' : 'terminal';
      run.failed(item, new vscode.TestMessage(`Test failed. Check ${consoleType} for details.`));
      return false;
    }

    let passed = true;
    try {
      if (isScenario) {
        await markChildrenFromResults(item, run, result.resultFile);
        const featureFailed = await hasFeatureFailures(result.resultFile, itemUri);
        if (featureFailed) {
          const errors = await getTestErrorMessages(result.resultFile, itemUri);
          if (errors.length > 0) {
            run.failed(item, errors);
          } else {
            run.failed(item, new vscode.TestMessage('Scenario failed'));
          }
          passed = false;
        } else {
          run.passed(item);
        }
      } else {
        // Example or standalone feature/scenario without descendants
        const featureItem = this.getFeatureTestItem(item);
        if (featureItem) {
          await markChildrenFromResults(featureItem, run, result.resultFile);
        }

        const featureFailed = await hasFeatureFailures(result.resultFile, itemUri);
        if (featureFailed) {
          const errors = await getTestErrorMessages(result.resultFile, itemUri);
          if (errors.length > 0) {
            run.failed(item, errors);
          } else {
            run.failed(item, new vscode.TestMessage('Test failed'));
          }
          passed = false;
        } else {
          run.passed(item);
        }
      }
    } finally {
      cleanupResultFile(result.resultFile);
    }

    return passed;
  }

  private buildFeatureDescriptors(
    item: vscode.TestItem,
    workspaceFolder: vscode.WorkspaceFolder
  ): FeatureToRun[] | null {
    const itemUri = item.uri;
    if (!itemUri) {
      return null;
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, itemUri.fsPath);

    const descriptor: FeatureToRun = {
      uri: itemUri,
      relativePath
    };

    if (item.children.size === 0) {
      const parts = item.id.split(':scenario:');
      if (parts.length > 1) {
        const afterScenario = parts[1];
        const exampleParts = afterScenario.split(':example:');

        const scenarioLine = parseInt(exampleParts[0], 10);
        if (!Number.isNaN(scenarioLine)) {
          descriptor.lineNumber = scenarioLine;
        }

        if (exampleParts.length > 1) {
          const exampleLine = parseInt(exampleParts[1], 10);
          if (!Number.isNaN(exampleLine)) {
            descriptor.exampleLine = exampleLine;
          }
        }
      }
    }

    return [descriptor];
  }

  private getFeatureTestItem(item: vscode.TestItem): vscode.TestItem | undefined {
    if (item.parent) {
      return item.parent;
    }

    if (!item.uri) {
      return undefined;
    }

    const featureId = path.normalize(item.uri.fsPath);
    return this.controller.items.get(featureId);
  }

  private isScenarioItem(item: vscode.TestItem): boolean {
    return item.id.includes(':scenario:') && !item.id.includes(':example:');
  }

  private isExampleItem(item: vscode.TestItem): boolean {
    return item.id.includes(':example:');
  }

  private filterTestItems(items: readonly vscode.TestItem[]): vscode.TestItem[] {
    const filtered: vscode.TestItem[] = [];
    const featureIdsToRun = new Set<string>();

    for (const item of items) {
      if (item.children.size > 0) {
        featureIdsToRun.add(item.id);
      }
    }

    for (const item of items) {
      if (item.children.size > 0) {
        filtered.push(item);
      } else {
        const parts = item.id.split(':scenario:');
        const featureId = parts[0];

        if (!featureIdsToRun.has(featureId)) {
          filtered.push(item);
        }
      }
    }

    return filtered;
  }

  dispose() {
    this.controller.dispose();
    this.watchedFiles.clear();
  }

  private resetPendingState(items: readonly vscode.TestItem[], run: vscode.TestRun) {
    const queue: vscode.TestItem[] = [];

    for (const item of items) {
      run.started(item);
      if (item.children.size > 0) {
        queue.push(item);
      }
    }

    while (queue.length > 0) {
      const parent = queue.shift();
      if (!parent) continue;

      parent.children.forEach(child => {
        run.enqueued(child);
        if (child.children.size > 0) {
          queue.push(child);
        }
      });
    }
  }
}

function parseFeatureFile(document: vscode.TextDocument): FeatureInfo | null {
  const text = document.getText();
  const lines = text.split('\n');

  let featureName = '';
  let featureLineNumber = 0;
  const scenarios: ScenarioInfo[] = [];
  let currentScenario: ScenarioInfo | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('Feature:')) {
      featureName = line.substring(8).trim();
      featureLineNumber = i + 1;
    } else if (line.startsWith('Scenario:')) {
      const scenarioName = line.substring(9).trim();
      currentScenario = {
        name: scenarioName,
        lineNumber: i + 1,
        examples: []
      };
      scenarios.push(currentScenario);
    } else if (line.startsWith('Scenario Outline:')) {
      const scenarioName = line.substring(17).trim();
      currentScenario = {
        name: `${scenarioName} (Outline)`,
        lineNumber: i + 1,
        examples: []
      };
      scenarios.push(currentScenario);
    } else if (line.startsWith('|') && currentScenario && i > 0) {
      const exampleInfo = findExampleRowInfo(lines, i);
      if (exampleInfo && currentScenario.examples) {
        currentScenario.examples.push({
          lineNumber: i + 1,
          data: line
        });
      }
    }
  }

  if (!featureName) return null;

  return {
    name: featureName,
    scenarios,
    filePath: document.uri.fsPath,
    lineNumber: featureLineNumber
  };
}

/**
 * CodeLens provider for Cucumber feature files - with compact buttons
 */
class CucumberCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];

    if (path.extname(document.uri.fsPath) !== '.feature') {
      return codeLenses;
    }

    const text = document.getText();
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('Feature:')) {
        // Position the button at the very beginning of the line
        const range = new vscode.Range(i, 0, i, 0);
        codeLenses.push(new vscode.CodeLens(range, {
          title: '$(play-circle) ',
          tooltip: 'Click to run the entire feature file',
          command: 'cucumberJavaEasyRunner.runFeatureCodeLens',
          arguments: [document.uri]
        }));
      } else if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
        // Position the button at the very beginning of the line
        const range = new vscode.Range(i, 0, i, 0);
        codeLenses.push(new vscode.CodeLens(range, {
          title: '$(play) ',
          tooltip: 'Click to run this scenario',
          command: 'cucumberJavaEasyRunner.runScenarioCodeLens',
          arguments: [document.uri, i + 1] // 1-indexed line number
        }));
      } else if (line.startsWith('|') && i > 0) {
        // Check if this is an example row (not header)
        const exampleInfo = this.findExampleRowInfo(lines, i);
        if (exampleInfo) {
          const range = new vscode.Range(i, 0, i, 0);
          codeLenses.push(new vscode.CodeLens(range, {
            title: '$(play) ',
            tooltip: 'Click to run this example row',
            command: 'cucumberJavaEasyRunner.runExampleCodeLens',
            arguments: [document.uri, exampleInfo.scenarioLine, i + 1] // scenario line and example line
          }));
        }
      }
    }

    return codeLenses;
  }

  private findExampleRowInfo(lines: string[], currentLine: number): { scenarioLine: number } | null {
    // Go backwards to find Examples heading
    let examplesLine = -1;
    let headerLine = -1;

    for (let i = currentLine; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('Examples:')) {
        examplesLine = i;
        break;
      }
    }

    if (examplesLine === -1) {
      return null;
    }

    // Find the header row (first | line after Examples)
    for (let i = examplesLine + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|')) {
        headerLine = i;
        break;
      }
    }

    // Current line must be after header line to be a data row
    if (headerLine === -1 || currentLine <= headerLine) {
      return null;
    }

    // Find the Scenario Outline
    for (let i = examplesLine; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('Scenario Outline:')) {
        return { scenarioLine: i + 1 }; // 1-indexed
      }
    }

    return null;
  }
}

/**
 * Finds example row info
 */
function findExampleRowInfo(lines: string[], currentLine: number): { scenarioLine: number } | null {
  // Go backwards to find Examples heading
  let examplesLine = -1;
  let headerLine = -1;

  for (let i = currentLine; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('Examples:')) {
      examplesLine = i;
      break;
    }
  }

  if (examplesLine === -1) {
    return null;
  }

  // Find the header row (first | line after Examples)
  for (let i = examplesLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|')) {
      headerLine = i;
      break;
    }
  }

  // Current line must be after header line to be a data row
  if (headerLine === -1 || currentLine <= headerLine) {
    return null;
  }

  // Find the Scenario Outline
  for (let i = examplesLine; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('Scenario Outline:')) {
      return { scenarioLine: i + 1 }; // 1-indexed
    }
  }

  return null;
}

// Global test controller instance
let globalTestController: CucumberTestController | undefined;

export function activate(context: vscode.ExtensionContext) {
  initializeLogger(context);
  logger.info('Cucumber Java Easy Runner activating');

  // Dispose existing controller if it exists
  if (globalTestController) {
    try {
      globalTestController.dispose();
    } catch (error) {
      logger.error('Error disposing previous controller:', error);
    }
  }

  // Create new test controller
  globalTestController = new CucumberTestController(context);
  logger.info('Test controller created');

  // Check if CodeLens should be enabled (default: false since we have Test Explorer)
  const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
  const enableCodeLens = config.get('enableCodeLens', false);

  if (enableCodeLens) {
    // Register CodeLens provider only if enabled
    const codeLensProvider = new CucumberCodeLensProvider();
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
      { pattern: '**/*.feature' },
      codeLensProvider
    );
    context.subscriptions.push(codeLensDisposable);
    logger.info('CodeLens provider registered');
  } else {
    logger.info('CodeLens disabled - use Test Explorer instead');
  }

  // Command to run the entire feature file
  let runFeatureCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runFeature', async (uri: vscode.Uri) => {
    let featureUri = uri;

    // If called from editor instead of explorer
    if (!featureUri && vscode.window.activeTextEditor) {
      featureUri = vscode.window.activeTextEditor.document.uri;
    }

    if (!featureUri) {
      vscode.window.showErrorMessage('Please open or select a feature file.');
      return;
    }

    await runCucumberTest(featureUri);
  });

  // CodeLens command to run the entire feature file
  let runFeatureCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runFeatureCodeLens', async (uri: vscode.Uri) => {
    logger.debug('runFeatureCodeLensCommand called with URI:', uri.toString());
    vscode.window.showInformationMessage('Feature test starting...');
    await runCucumberTest(uri);
  });

  // CodeLens command to run a single scenario
  let runScenarioCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runScenarioCodeLens', async (uri: vscode.Uri, lineNumber: number) => {
    logger.debug('runScenarioCodeLensCommand called with URI:', uri.toString(), 'line:', lineNumber);
    vscode.window.showInformationMessage(`Scenario test starting at line ${lineNumber}...`);
    await runCucumberTest(uri, lineNumber);
  });

  // CodeLens command to run a single example
  let runExampleCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runExampleCodeLens', async (uri: vscode.Uri, scenarioLine: number, exampleLine: number) => {
    logger.debug('runExampleCodeLensCommand called with URI:', uri.toString(), 'scenario line:', scenarioLine, 'example line:', exampleLine);
    vscode.window.showInformationMessage(`Example test starting at line ${exampleLine}...`);
    await runCucumberTest(uri, scenarioLine, exampleLine);
  });

  // Command to run a single scenario
  let runScenarioCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runScenario', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Please open a feature file.');
      return;
    }

    const uri = editor.document.uri;
    if (path.extname(uri.fsPath) !== '.feature') {
      vscode.window.showErrorMessage('This command only works with .feature files.');
      return;
    }

    const currentLine = editor.selection.active.line;
    const scenario = findScenarioAtLine(editor.document, currentLine);

    if (!scenario) {
      vscode.window.showErrorMessage('Please right-click inside a Scenario or Scenario Outline.');
      return;
    }

    await runCucumberTest(uri, scenario.lineNumber);
  });

  // Command to run a single example row
  let runExampleCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runExample', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Please open a feature file.');
      return;
    }

    const uri = editor.document.uri;
    if (path.extname(uri.fsPath) !== '.feature') {
      vscode.window.showErrorMessage('This command only works with .feature files.');
      return;
    }

    const currentLine = editor.selection.active.line;
    logger.debug(`runExampleCommand called, line: ${currentLine}`);

    // First check if the line starts with |
    const lineText = editor.document.lineAt(currentLine).text.trim();
    if (!lineText.startsWith('|')) {
      vscode.window.showErrorMessage('Please right-click on a data row (starting with |) in an Examples table.');
      return;
    }

    const examples = findExampleAtLine(editor.document, currentLine);

    if (!examples) {
      vscode.window.showErrorMessage('Example row not detected. Please right-click on a data row (starting with |, not the header row) in an Examples table.');
      return;
    }

    await runCucumberTest(uri, examples.lineNumber, examples.exampleLineNumber);
  });

  context.subscriptions.push(runFeatureCommand);
  context.subscriptions.push(runFeatureCodeLensCommand);
  context.subscriptions.push(runScenarioCodeLensCommand);
  context.subscriptions.push(runExampleCodeLensCommand);
  context.subscriptions.push(runScenarioCommand);
  context.subscriptions.push(runExampleCommand);
}

function findScenarioAtLine(document: vscode.TextDocument, line: number): ScenarioInfo | null {
  const text = document.getText();
  const lines = text.split('\n');

  // Find the closest scenario heading from the line number backwards
  for (let i = line; i >= 0; i--) {
    const currentLine = lines[i].trim();
    if (currentLine.startsWith('Scenario:') || currentLine.startsWith('Scenario Outline:')) {
      let name = currentLine.substring(currentLine.indexOf(':') + 1).trim();
      return { name, lineNumber: i + 1 }; // 1-indexed line number for Cucumber
    }
  }

  // Find the feature heading (if no scenario was found)
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i].trim();
    if (currentLine.startsWith('Feature:')) {
      return { name: 'feature', lineNumber: 0 }; // 0 means entire feature
    }
  }

  return null;
}

/**
 * Finds the example row at the given line number
 */
function findExampleAtLine(document: vscode.TextDocument, line: number): ScenarioInfo | null {
  try {
    const text = document.getText();
    const lines = text.split('\n');

    // Check the line content for debugging
    const currentLineText = lines[line].trim();
    logger.debug(`Debug: Current line (${line}): "${currentLineText}"`);

    // Check if the line starts with |
    if (!currentLineText.startsWith('|')) {
      logger.debug('Debug: Line does not start with |');
      return null;
    }

    // Find the Examples block
    let examplesLine = -1;
    let scenarioOutlineLine = -1;
    let headerLine = -1;

    // First go backwards to find the Examples heading
    for (let i = line; i >= 0; i--) {
      const lineText = lines[i].trim();
      logger.trace(`Debug: Backward line (${i}): "${lineText}"`);

      if (lineText.startsWith('Examples:')) {
        examplesLine = i;
        logger.debug(`Debug: Examples heading found, line: ${examplesLine}`);
        break;
      }
    }

    if (examplesLine === -1) {
      logger.debug('Debug: Examples heading not found');
      return null;
    }

    // The first line starting with | after the Examples heading is the header row
    for (let i = examplesLine + 1; i < lines.length; i++) {
      const lineText = lines[i].trim();
      if (lineText.startsWith('|')) {
        headerLine = i;
        logger.debug(`Debug: Header row found, line: ${headerLine}`);
        break;
      }
    }

    if (headerLine === -1 || line <= headerLine) {
      logger.debug(`Debug: Valid header row not found or current line (${line}) is before header line (${headerLine})`);
      return null;
    }

    // Go backwards from Examples heading to find the Scenario Outline
    for (let i = examplesLine; i >= 0; i--) {
      const lineText = lines[i].trim();
      if (lineText.startsWith('Scenario Outline:')) {
        scenarioOutlineLine = i + 1; // 1-indexed
        logger.debug(`Debug: Scenario Outline found, line: ${scenarioOutlineLine}`);
        break;
      }
    }

    if (scenarioOutlineLine === -1) {
      logger.debug('Debug: Scenario Outline not found');
      return null;
    }

    // Set the current line directly as the line to run
    // Note: Cucumber's expected format: feature:scenario_line:example_line
    return {
      name: 'example',
      lineNumber: scenarioOutlineLine,
      exampleLineNumber: line + 1 // 1-indexed
    };
  } catch (err: any) {
    logger.error(`Error in findExampleAtLine: ${err.message}`);
    return null;
  }
}


export function deactivate() { } 