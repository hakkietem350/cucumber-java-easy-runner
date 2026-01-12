/**
 * Inline Run Buttons - provides run/debug buttons in feature files
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { messages } from './i18n';

/**
 * Provides inline run and debug buttons in Cucumber feature files
 */
export class FeatureFileActionButtons implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
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
          tooltip: messages.tooltipRunFeature,
          command: 'cucumberJavaEasyRunner.runFeatureCodeLens',
          arguments: [document.uri]
        }));
        codeLenses.push(new vscode.CodeLens(range, {
          title: '$(debug-alt) ',
          tooltip: messages.tooltipDebugFeature,
          command: 'cucumberJavaEasyRunner.debugFeatureCodeLens',
          arguments: [document.uri]
        }));
      } else if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
        // Position the button at the very beginning of the line
        const range = new vscode.Range(i, 0, i, 0);
        codeLenses.push(new vscode.CodeLens(range, {
          title: '$(play) ',
          tooltip: messages.tooltipRunScenario,
          command: 'cucumberJavaEasyRunner.runScenarioCodeLens',
          arguments: [document.uri, i + 1] // 1-indexed line number
        }));
        codeLenses.push(new vscode.CodeLens(range, {
          title: '$(debug-alt) ',
          tooltip: messages.tooltipDebugScenario,
          command: 'cucumberJavaEasyRunner.debugScenarioCodeLens',
          arguments: [document.uri, i + 1]
        }));
      } else if (line.startsWith('|') && i > 0) {
        // Check if this is an example row (not header)
        const exampleInfo = this.findExampleRowInfo(lines, i);
        if (exampleInfo) {
          const range = new vscode.Range(i, 0, i, 0);
          codeLenses.push(new vscode.CodeLens(range, {
            title: '$(play) ',
            tooltip: messages.tooltipRunExample,
            command: 'cucumberJavaEasyRunner.runExampleCodeLens',
            arguments: [document.uri, exampleInfo.scenarioLine, i + 1] // scenario line and example line
          }));
          codeLenses.push(new vscode.CodeLens(range, {
            title: '$(debug-alt) ',
            tooltip: messages.tooltipDebugExample,
            command: 'cucumberJavaEasyRunner.debugExampleCodeLens',
            arguments: [document.uri, exampleInfo.scenarioLine, i + 1]
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
