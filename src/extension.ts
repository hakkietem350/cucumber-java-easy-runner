// VS Code extension main file
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { spawn } from 'child_process';

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

    // Set up file watcher - exclude build directories
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

    // Set up test run handler
    this.controller.createRunProfile(
      'Run Cucumber Tests',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runTests(request, token),
      true
    );

    // Add refresh button to test controller
    this.controller.refreshHandler = () => {
      console.log('Test controller refresh triggered');
      this.discoverTests();
    };

    // Initial scan of workspace - delay to avoid duplicates
    setTimeout(() => {
      this.discoverTests();
    }, 500);

    // Add refresh command
    const refreshCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.refreshTests', () => {
      console.log('Refreshing Cucumber tests...');
      this.discoverTests();
    });
    context.subscriptions.push(refreshCommand);
  }

  private handleFileEvent(eventType: string, uri: vscode.Uri) {
    // Filter out files from build/target directories
    const filePath = uri.fsPath.toLowerCase();
    const excludedPaths = ['target', 'build', 'out', 'dist', 'node_modules', '.git'];
    
    if (excludedPaths.some(excluded => filePath.includes(`/${excluded}/`) || filePath.includes(`\\${excluded}\\`))) {
      console.log(`Ignoring ${eventType} event for build directory file: ${uri.fsPath}`);
      return;
    }

    console.log(`Handling ${eventType} event for: ${uri.fsPath}`);
    
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
    // Clear all existing tests first
    this.controller.items.replace([]);
    this.watchedFiles.clear();
    
    // Exclude common build/target directories to avoid duplicates
    const featureFiles = await vscode.workspace.findFiles(
      '**/*.feature', 
      '{**/node_modules/**,**/target/**,**/build/**,**/out/**,**/dist/**,**/.git/**}'
    );
    
    console.log(`Found ${featureFiles.length} feature files`);
    
    for (const uri of featureFiles) {
      console.log(`Processing feature file: ${uri.fsPath}`);
      await this.createOrUpdateTest(uri);
    }
  }

  private async createOrUpdateTest(uri: vscode.Uri) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const featureInfo = this.parseFeatureFile(document);
      
      if (!featureInfo) return;

      // Create unique feature ID using normalized file path
      const featureId = path.normalize(uri.fsPath);
      
      // Check if feature already exists
      if (this.watchedFiles.has(featureId)) {
        console.log(`Feature already exists: ${featureId}`);
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

      console.log(`Added feature: ${featureInfo.name} with ${featureInfo.scenarios.length} scenarios`);

    } catch (error) {
      console.error('Error parsing feature file:', error);
    }
  }

  private deleteTest(uri: vscode.Uri) {
    const featureId = path.normalize(uri.fsPath);
    const featureItem = this.watchedFiles.get(featureId);
    
    if (featureItem) {
      this.controller.items.delete(featureId);
      this.watchedFiles.delete(featureId);
      console.log(`Deleted feature: ${featureId}`);
    }
  }

  private parseFeatureFile(document: vscode.TextDocument): FeatureInfo | null {
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
        // Check if this is an example row (not header)
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

  private async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const run = this.controller.createTestRun(request);
    
    const testItems = request.include || this.gatherAllTests();
    
    for (const testItem of testItems) {
      if (token.isCancellationRequested) {
        break;
      }

      await this.runSingleTest(testItem, run);
    }

    run.end();
  }

  private gatherAllTests(): vscode.TestItem[] {
    const tests: vscode.TestItem[] = [];
    
    this.controller.items.forEach(item => {
      tests.push(item);
      item.children.forEach(child => tests.push(child));
    });
    
    return tests;
  }

  private async runSingleTest(testItem: vscode.TestItem, run: vscode.TestRun) {
    run.started(testItem);
    
    try {
      const uri = testItem.uri!;
      
      // Check test type based on ID structure
      if (testItem.id.includes(':example:')) {
        // This is an example row
        const parts = testItem.id.split(':');
        const scenarioLine = parseInt(parts[2]); // scenario line number
        const exampleLine = parseInt(parts[4]); // example line number
        console.log(`Running example at scenario line ${scenarioLine}, example line ${exampleLine} for file ${uri.fsPath}`);
        const exitCode = await runSelectedTestAndWait(uri, scenarioLine, exampleLine, (data) => run.appendOutput(data, undefined, testItem));
        if (exitCode === 0) {
          run.passed(testItem);
        } else {
          run.failed(testItem, new vscode.TestMessage(`Test failed with exit code ${exitCode}`));
        }
      } else if (testItem.id.includes(':scenario:')) {
        // This is a scenario
        const parts = testItem.id.split(':scenario:');
        const lineNumber = parseInt(parts[1]);
        console.log(`Running scenario at line ${lineNumber} for file ${uri.fsPath}`);
        const exitCode = await runSelectedTestAndWait(uri, lineNumber, undefined, (data) => run.appendOutput(data, undefined, testItem));
        if (exitCode === 0) {
          run.passed(testItem);
        } else {
          run.failed(testItem, new vscode.TestMessage(`Test failed with exit code ${exitCode}`));
        }
      } else {
        // This is a feature file
        console.log(`Running entire feature file ${uri.fsPath}`);
        const exitCode = await runSelectedTestAndWait(uri, undefined, undefined, (data) => run.appendOutput(data, undefined, testItem));
        if (exitCode === 0) {
          run.passed(testItem);
        } else {
          run.failed(testItem, new vscode.TestMessage(`Test failed with exit code ${exitCode}`));
        }
      }
      
    } catch (error) {
      console.error('Test execution error:', error);
      run.failed(testItem, new vscode.TestMessage(`Test failed: ${error}`));
    }
  }

  private async executeTest(uri: vscode.Uri, lineNumber?: number, exampleLine?: number) {
    // Use the existing runSelectedTest function
    await runSelectedTest(uri, lineNumber, exampleLine);
  }

  dispose() {
    this.controller.dispose();
    this.watchedFiles.clear();
  }
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
  
  // Dispose existing controller if it exists
  if (globalTestController) {
    try {
      globalTestController.dispose();
    } catch (error) {
      console.log('Error disposing previous controller:', error);
    }
  }
  
  // Create new test controller
  globalTestController = new CucumberTestController(context);
  
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
    console.log('CodeLens provider registered');
  } else {
    console.log('CodeLens disabled - use Test Explorer instead');
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
    
    runSelectedTest(featureUri);
  });

  // CodeLens command to run the entire feature file
  let runFeatureCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runFeatureCodeLens', async (uri: vscode.Uri) => {
    console.log('runFeatureCodeLensCommand called with URI:', uri.toString());
    vscode.window.showInformationMessage('Feature test starting...');
    runSelectedTest(uri);
  });

  // CodeLens command to run a single scenario
  let runScenarioCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runScenarioCodeLens', async (uri: vscode.Uri, lineNumber: number) => {
    console.log('runScenarioCodeLensCommand called with URI:', uri.toString(), 'line:', lineNumber);
    vscode.window.showInformationMessage(`Scenario test starting at line ${lineNumber}...`);
    runSelectedTest(uri, lineNumber);
  });

  // CodeLens command to run a single example
  let runExampleCodeLensCommand = vscode.commands.registerCommand('cucumberJavaEasyRunner.runExampleCodeLens', async (uri: vscode.Uri, scenarioLine: number, exampleLine: number) => {
    console.log('runExampleCodeLensCommand called with URI:', uri.toString(), 'scenario line:', scenarioLine, 'example line:', exampleLine);
    vscode.window.showInformationMessage(`Example test starting at line ${exampleLine}...`);
    runSelectedTest(uri, scenarioLine, exampleLine);
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
    
    runSelectedTest(uri, scenario.lineNumber);
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
    console.log(`runExampleCommand called, line: ${currentLine}`);
    
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
    
    runSelectedTest(uri, examples.lineNumber, examples.exampleLineNumber);
  });

  context.subscriptions.push(runFeatureCommand);
  context.subscriptions.push(runFeatureCodeLensCommand);
  context.subscriptions.push(runScenarioCodeLensCommand);
  context.subscriptions.push(runExampleCodeLensCommand);
  context.subscriptions.push(runScenarioCommand);
  context.subscriptions.push(runExampleCommand);
}

/**
 * Runs the selected feature, scenario, or example row
 */
async function runSelectedTest(uri: vscode.Uri, lineNumber?: number, exampleLine?: number) {
  const terminal = vscode.window.createTerminal('Cucumber Feature');
  
  // Find the project root directory
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Feature file is not inside a workspace.');
    return false;
  }

  // Get the relative path of the feature file in the project
  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  
  // Save the run mode information
  let runMode = 'feature';
  if (lineNumber && lineNumber > 0) {
    runMode = exampleLine ? 'example' : 'scenario';
  }
  
  console.log(`Run mode: ${runMode}`);
  console.log(`Feature: ${relativePath}`);
  console.log(`Scenario line: ${lineNumber || 'entire feature'}`);
  console.log(`Example line: ${exampleLine || 'all scenarios'}`);
  
  try {
    // 1) Try to resolve glue(s) from JUnit Suite runner annotations for this feature
    const gluePathsFromRunner = await findGluePathsForFeature(workspaceFolder.uri.fsPath, relativePath);

    // 2) Fallback to auto-detect single glue path by scanning steps directory
    const fallbackGlue = await findGluePath(workspaceFolder.uri.fsPath);

    const glueToUse: string[] | null = gluePathsFromRunner && gluePathsFromRunner.length > 0
      ? gluePathsFromRunner
      : (fallbackGlue ? [fallbackGlue] : null);

    if (!glueToUse) {
      const userInput = await vscode.window.showInputBox({
        prompt: 'Enter glue path for steps directory (e.g. org.example.steps)',
        placeHolder: 'org.example.steps'
      });
      if (!userInput) {
        vscode.window.showErrorMessage('Glue path not specified, operation cancelled.');
        return false;
      }
      runCucumberTest(workspaceFolder.uri.fsPath, relativePath, [userInput], terminal, lineNumber, exampleLine);
      return;
    }

    let message = '';
    const glueMsg = glueToUse.join(', ');
    if (runMode === 'feature') {
      message = `Running feature file with glue path(s) "${glueMsg}"`;
    } else if (runMode === 'scenario') {
      message = `Running scenario at line ${lineNumber} with glue path(s) "${glueMsg}"`;
    } else if (runMode === 'example') {
      message = `Running example at line ${lineNumber}:${exampleLine} with glue path(s) "${glueMsg}"`;
    }
    vscode.window.showInformationMessage(message);
    runCucumberTest(workspaceFolder.uri.fsPath, relativePath, glueToUse, terminal, lineNumber, exampleLine);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Runs the selected test and waits for the Java process to finish. Streams output via the provided callback.
 */
async function runSelectedTestAndWait(
  uri: vscode.Uri,
  lineNumber?: number,
  exampleLine?: number,
  onOutput?: (chunk: string) => void
): Promise<number> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Feature file is not inside a workspace.');
    return 1;
  }
  const projectRoot = workspaceFolder.uri.fsPath;
  const relativePath = path.relative(projectRoot, uri.fsPath);

  try {
    const gluePathsFromRunner = await findGluePathsForFeature(projectRoot, relativePath);
    const fallbackGlue = await findGluePath(projectRoot);
    const glueToUse: string[] | null = gluePathsFromRunner && gluePathsFromRunner.length > 0
      ? gluePathsFromRunner
      : (fallbackGlue ? [fallbackGlue] : null);

    if (!glueToUse) {
      const userInput = await vscode.window.showInputBox({
        prompt: 'Enter glue path for steps directory (e.g. org.example.steps)',
        placeHolder: 'org.example.steps'
      });
      if (!userInput) {
        vscode.window.showErrorMessage('Glue path not specified, operation cancelled.');
        return 1;
      }
      return await runCucumberTestWithResult(projectRoot, relativePath, [userInput], lineNumber, exampleLine, onOutput);
    } else {
      return await runCucumberTestWithResult(projectRoot, relativePath, glueToUse, lineNumber, exampleLine, onOutput);
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error: ${error.message || 'Unknown error'}`);
    return 1;
  }
}

/**
 * Finds the scenario at the given line number
 */
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
    console.log(`Debug: Current line (${line}): "${currentLineText}"`);
    
    // Check if the line starts with |
    if (!currentLineText.startsWith('|')) {
      console.log('Debug: Line does not start with |');
      return null;
    }
    
    // Find the Examples block
    let examplesLine = -1;
    let scenarioOutlineLine = -1;
    let headerLine = -1;
    
    // First go backwards to find the Examples heading
    for (let i = line; i >= 0; i--) {
      const lineText = lines[i].trim();
      console.log(`Debug: Backward line (${i}): "${lineText}"`);
      
      if (lineText.startsWith('Examples:')) {
        examplesLine = i;
        console.log(`Debug: Examples heading found, line: ${examplesLine}`);
        break;
      }
    }
    
    if (examplesLine === -1) {
      console.log('Debug: Examples heading not found');
      return null;
    }
    
    // The first line starting with | after the Examples heading is the header row
    for (let i = examplesLine + 1; i < lines.length; i++) {
      const lineText = lines[i].trim();
      if (lineText.startsWith('|')) {
        headerLine = i;
        console.log(`Debug: Header row found, line: ${headerLine}`);
        break;
      }
    }
    
    if (headerLine === -1 || line <= headerLine) {
      console.log(`Debug: Valid header row not found or current line (${line}) is before header line (${headerLine})`);
      return null;
    }
    
    // Go backwards from Examples heading to find the Scenario Outline
    for (let i = examplesLine; i >= 0; i--) {
      const lineText = lines[i].trim();
      if (lineText.startsWith('Scenario Outline:')) {
        scenarioOutlineLine = i + 1; // 1-indexed
        console.log(`Debug: Scenario Outline found, line: ${scenarioOutlineLine}`);
        break;
      }
    }
    
    if (scenarioOutlineLine === -1) {
      console.log('Debug: Scenario Outline not found');
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
    console.error(`Error in findExampleAtLine: ${err.message}`);
    return null;
  }
}

/**
 * Finds the steps directories in the project and converts to Java package structure
 */
async function findGluePath(projectRoot: string): Promise<string | null> {
  // In Maven projects, test code is usually in src/test/java
  const testDir = path.join(projectRoot, 'src', 'test', 'java');
  
  if (!fs.existsSync(testDir)) {
    return null;
  }
  
  // Recursively search for steps directories
  const stepsDir = await findStepsDir(testDir);
  
  if (!stepsDir) {
    return null;
  }
  
  // Create the Java package name for the steps directory
  // src/test/java/org/example/steps -> org.example.steps
  const packagePath = path.relative(testDir, stepsDir).replace(/\\/g, '/').replace(/\//g, '.');
  
  return packagePath;
}

/**
 * Parses JUnit Platform Suite runner classes to resolve glue path(s) for a given feature file.
 * Matches by reading @ConfigurationParameter annotations with FEATURES_PROPERTY_NAME and GLUE_PROPERTY_NAME.
 */
async function findGluePathsForFeature(projectRoot: string, relativeFeaturePath: string): Promise<string[]> {
  const testJavaDir = path.join(projectRoot, 'src', 'test', 'java');
  const testResourcesDir = path.join(projectRoot, 'src', 'test', 'resources');

  if (!fs.existsSync(testJavaDir)) return [];

  const javaFiles: string[] = [];

  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        javaFiles.push(full);
      }
    }
  };
  walk(testJavaDir);

  interface RunnerCfg {
    file: string;
    glue: string[];
    featureMatchers: string[]; // relative paths or directories from project root
  }

  const runners: RunnerCfg[] = [];

  const glueRegex = /@ConfigurationParameter\s*\(\s*key\s*=\s*(?:[\w\.]*GLUE_PROPERTY_NAME)\s*,\s*value\s*=\s*("([^"]+)"|'([^']+)')\s*\)/g;
  const featuresRegex = /@ConfigurationParameter\s*\(\s*key\s*=\s*(?:[\w\.]*FEATURES_PROPERTY_NAME)\s*,\s*value\s*=\s*("([^"]+)"|'([^']+)')\s*\)/g;

  const toArray = (val: string): string[] => val.split(',').map(s => s.trim()).filter(Boolean);

  for (const file of javaFiles) {
    let txt: string;
    try {
      txt = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const glueMatches: string[] = [];
    const featureVals: string[] = [];

    let m: RegExpExecArray | null;
    while ((m = glueRegex.exec(txt)) !== null) {
      const v = (m[2] || m[3] || '').trim();
      glueMatches.push(...toArray(v));
    }
    while ((m = featuresRegex.exec(txt)) !== null) {
      const v = (m[2] || m[3] || '').trim();
      featureVals.push(...toArray(v));
    }

    if (featureVals.length === 0 || glueMatches.length === 0) continue;

    const featureMatchers: string[] = [];
    for (const f of featureVals) {
      const noPrefix = f.startsWith('classpath:') ? f.substring('classpath:'.length) : f;
      const normalized = noPrefix.replace(/\\/g, '/');
      const absCandidate = path.join(testResourcesDir, normalized);

      if (absCandidate.endsWith('.feature')) {
        featureMatchers.push(path.relative(projectRoot, absCandidate).replace(/\\/g, '/'));
      } else {
        // treat as directory matcher; ensure trailing slash for startsWith checks
        let relDir = path.relative(projectRoot, absCandidate).replace(/\\/g, '/');
        if (!relDir.endsWith('/')) relDir += '/';
        featureMatchers.push(relDir);
      }
    }

    runners.push({ file, glue: glueMatches, featureMatchers });
  }

  // Choose the most specific runner whose features match this file
  const relPathUnix = relativeFeaturePath.replace(/\\/g, '/');
  let best: { glue: string[]; score: number } | null = null;

  for (const r of runners) {
    for (const matcher of r.featureMatchers) {
      if (matcher.endsWith('.feature')) {
        if (relPathUnix === matcher) {
          const score = matcher.length;
          if (!best || score > best.score) best = { glue: r.glue, score };
        }
      } else {
        // directory prefix match
        if (relPathUnix.startsWith(matcher)) {
          const score = matcher.length;
          if (!best || score > best.score) best = { glue: r.glue, score };
        }
      }
    }
  }

  return best ? Array.from(new Set(best.glue)) : [];
}

/**
 * Recursively searches for the steps directory
 */
async function findStepsDir(dir: string): Promise<string | null> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  // First check if current directory is a steps folder
  if (dir.endsWith('steps') || dir.endsWith('step')) {
    // Check if it contains Java files directly
    const hasJavaFiles = entries.some(entry => !entry.isDirectory() && entry.name.endsWith('.java'));
    
    // Check Java files in subdirectories
    if (!hasJavaFiles) {
      // Recursive inner function to check directories
      const checkSubDirsForJavaFiles = (subDir: string): boolean => {
        const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
        
        // Does this subdirectory have Java files?
        const hasDirectJavaFiles = subEntries.some(entry => !entry.isDirectory() && entry.name.endsWith('.java'));
        if (hasDirectJavaFiles) {
          return true;
        }
        
        // Check deeper subdirectories if they exist
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
      
      // Accept this directory if subdirectories contain Java files
      const hasJavaFilesInSubDirs = entries.some(entry => {
        if (entry.isDirectory()) {
          return checkSubDirsForJavaFiles(path.join(dir, entry.name));
        }
        return false;
      });
      
      if (hasJavaFilesInSubDirs) {
        return dir;
      }
    } else {
      // If Java files exist directly in the directory
      return dir;
    }
  }
  
  // If nothing found, search in subdirectories
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name);
      const result = await findStepsDir(subDir);
      if (result) {
        return result;
      }
    }
  }
  
  return null;
}

/**
 * Runs the Cucumber test
 */
function runCucumberTest(
  projectRoot: string, 
  featurePath: string, 
  gluePaths: string[] | string, 
  terminal: vscode.Terminal,
  lineNumber?: number,
  exampleLineNumber?: number
) {
  // Path to the feature file to run
  let cucumberPath = featurePath.replace(/\\/g, '/');
  
  // If a specific line is specified, add that line
  if (lineNumber && lineNumber > 0) {
    if (exampleLineNumber && exampleLineNumber > 0) {
      // Running an example - use only the example line
      cucumberPath += ':' + exampleLineNumber;
      console.log(`Cucumber path (example): ${cucumberPath}`);
    } else {
      // Running a scenario
      cucumberPath += ':' + lineNumber;
      console.log(`Cucumber path (scenario): ${cucumberPath}`);
    }
  } else {
    console.log(`Cucumber path (feature): ${cucumberPath}`);
  }
  
  // Prepare glue arguments (supports multiple --glue values)
  const glueArray = Array.isArray(gluePaths) ? gluePaths : [gluePaths];
  const glueArgsJava = glueArray
    .flatMap(g => ['"--glue"', `"${g}"`])
    .join(', ');

  // Java code to find the classpath and run cucumber
  const javaCode = `
import io.cucumber.core.cli.Main;

public class CucumberRunner {
  public static void main(String[] args) {
    System.out.println("Cucumber feature: ${cucumberPath}");
    String[] cucumberArgs = new String[] {
      "${cucumberPath}",
      ${glueArgsJava}${glueArgsJava ? ',' : ''}
      "--plugin", "pretty"
    };
    Main.main(cucumberArgs);
  }
}`;

  // Save the temporary Java file
  const tmpDir = path.join(projectRoot, 'target', 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const javaFilePath = path.join(tmpDir, 'CucumberRunner.java');
  fs.writeFileSync(javaFilePath, javaCode);

  // Compile and run the Java file
  terminal.sendText(`cd "${projectRoot}" && javac -cp "target/test-classes:target/classes:$(mvn dependency:build-classpath -q -Dmdep.outputFile=/dev/stdout)" ${javaFilePath} && java -cp "target/test-classes:target/classes:$(mvn dependency:build-classpath -q -Dmdep.outputFile=/dev/stdout):${path.dirname(javaFilePath)}" CucumberRunner`);
  terminal.show();
}

/**
 * Runs the Cucumber test via child_process and returns the exit code.
 */
async function runCucumberTestWithResult(
  projectRoot: string,
  featurePath: string,
  gluePaths: string[],
  lineNumber?: number,
  exampleLineNumber?: number,
  onOutput?: (chunk: string) => void
): Promise<number> {
  // Build cucumber path with optional line specifiers
  let cucumberPath = featurePath.replace(/\\/g, '/');
  if (lineNumber && lineNumber > 0) {
    if (exampleLineNumber && exampleLineNumber > 0) {
      cucumberPath += ':' + exampleLineNumber;
    } else {
      cucumberPath += ':' + lineNumber;
    }
  }

  const tmpDir = path.join(projectRoot, 'target', 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const javaFilePath = path.join(tmpDir, 'CucumberRunner.java');
  const glueArgsJava = (gluePaths || [])
    .flatMap(g => ['"--glue"', `"${g}"`])
    .join(', ');
  const javaCode = `
import io.cucumber.core.cli.Main;

public class CucumberRunner {
  public static void main(String[] args) {
    System.out.println("Cucumber feature: ${cucumberPath}");
    String[] cucumberArgs = new String[] {
      "${cucumberPath}",
      ${glueArgsJava}${glueArgsJava ? ',' : ''}
      "--plugin", "pretty"
    };
    Main.main(cucumberArgs);
  }
}`;
  fs.writeFileSync(javaFilePath, javaCode);

  const cpFile = path.join(tmpDir, 'classpath.txt');

  const execFilePromise = (file: string, args: string[], cwd: string) => new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const child = execFile(file, args, { cwd, env: { ...process.env, MAVEN_OPTS: `${process.env.MAVEN_OPTS || ''}` } }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0 });
    });
  });

  // 1) Build classpath via Maven
  const mvnArgs = ['-q', '-DincludeScope=test', '-DskipTests', 'dependency:build-classpath', `-Dmdep.outputFile=${cpFile}`];
  const mvnRes = await execFilePromise('mvn', mvnArgs, projectRoot);
  if (onOutput) {
    if (mvnRes.stdout) onOutput(mvnRes.stdout);
    if (mvnRes.stderr) onOutput(mvnRes.stderr);
  }
  if (mvnRes.code !== 0) {
    return mvnRes.code;
  }

  // Read deps classpath
  const depsClasspathRaw = fs.existsSync(cpFile) ? fs.readFileSync(cpFile, 'utf8').trim() : '';
  const delimiter = path.delimiter;
  const testClasses = path.join(projectRoot, 'target', 'test-classes');
  const mainClasses = path.join(projectRoot, 'target', 'classes');
  const baseClasspath = [testClasses, mainClasses].join(delimiter);
  const fullClasspath = depsClasspathRaw ? [baseClasspath, depsClasspathRaw].join(delimiter) : baseClasspath;

  // 2) Compile runner
  const javacArgs = ['-cp', fullClasspath, '-d', tmpDir, javaFilePath];
  const javacRes = await execFilePromise('javac', javacArgs, projectRoot);
  if (onOutput) {
    if (javacRes.stdout) onOutput(javacRes.stdout);
    if (javacRes.stderr) onOutput(javacRes.stderr);
  }
  if (javacRes.code !== 0) {
    return javacRes.code;
  }

  // 3) Run tests and stream output
  const runCp = [fullClasspath, tmpDir].join(delimiter);
  const child = spawn('java', ['-cp', runCp, 'CucumberRunner'], { cwd: projectRoot });
  return await new Promise<number>((resolve) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      if (onOutput) onOutput(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (onOutput) onOutput(chunk.toString());
    });
    child.on('close', (code) => {
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

export function deactivate() {} 
