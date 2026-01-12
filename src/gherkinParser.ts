/**
 * Gherkin Parser - parses .feature files to extract scenarios and examples
 */
import * as vscode from 'vscode';
import { FeatureInfo, ScenarioInfo, RuleInfo } from './models';
import { logger } from './logger';

/**
 * Parser context - maintains state during parsing
 */
class GherkinParserState {
  featureName = '';
  featureLineNumber = 0;
  scenarios: ScenarioInfo[] = []; // Scenarios directly under Feature
  rules: RuleInfo[] = [];
  currentRule: RuleInfo | null = null;
  currentScenario: ScenarioInfo | null = null;
  isScenarioOutline = false;
  inExamplesSection = false;
  examplesHeaderLine = -1;

  reset(): void {
    this.featureName = '';
    this.featureLineNumber = 0;
    this.scenarios = [];
    this.rules = [];
    this.currentRule = null;
    this.currentScenario = null;
    this.isScenarioOutline = false;
    this.inExamplesSection = false;
    this.examplesHeaderLine = -1;
  }

  startRule(name: string, lineNumber: number): void {
    this.currentRule = {
      name,
      lineNumber,
      scenarios: []
    };
    this.rules.push(this.currentRule);
    // Reset current scenario as we are entering a new rule
    this.currentScenario = null;
  }

  startScenario(name: string, lineNumber: number, isOutline: boolean): void {
    this.currentScenario = {
      name: isOutline ? `${name} (Outline)` : name,
      lineNumber,
      examples: []
    };

    if (this.currentRule) {
      this.currentRule.scenarios.push(this.currentScenario);
    } else {
      this.scenarios.push(this.currentScenario);
    }

    this.isScenarioOutline = isOutline;
    this.inExamplesSection = false;
    this.examplesHeaderLine = -1;
  }

  startExamplesSection(): void {
    this.inExamplesSection = true;
    this.examplesHeaderLine = -1;
  }

  addExampleRow(lineNumber: number, data: string): void {
    if (this.currentScenario && this.currentScenario.examples) {
      this.currentScenario.examples.push({ lineNumber, data });
    }
  }
}

/**
 * Line handler interface
 */
interface LineHandler {
  canHandle(line: string): boolean;
  handle(line: string, lineNumber: number, state: GherkinParserState): void;
}

/**
 * Handles Feature: lines
 */
class FeatureLineHandler implements LineHandler {
  canHandle(line: string): boolean {
    return line.startsWith('Feature:');
  }

  handle(line: string, lineNumber: number, state: GherkinParserState): void {
    state.featureName = line.substring(8).trim();
    state.featureLineNumber = lineNumber;
  }
}

/**
 * Handles Rule: lines
 */
class RuleLineHandler implements LineHandler {
  canHandle(line: string): boolean {
    return line.startsWith('Rule:');
  }

  handle(line: string, lineNumber: number, state: GherkinParserState): void {
    const ruleName = line.substring(5).trim();
    state.startRule(ruleName, lineNumber);
  }
}

/**
 * Handles Scenario: lines
 */
class ScenarioLineHandler implements LineHandler {
  canHandle(line: string): boolean {
    return line.startsWith('Scenario:');
  }

  handle(line: string, lineNumber: number, state: GherkinParserState): void {
    const scenarioName = line.substring(9).trim();
    state.startScenario(scenarioName, lineNumber, false);
  }
}

/**
 * Handles Scenario Outline: lines
 */
class ScenarioOutlineLineHandler implements LineHandler {
  canHandle(line: string): boolean {
    return line.startsWith('Scenario Outline:');
  }

  handle(line: string, lineNumber: number, state: GherkinParserState): void {
    const scenarioName = line.substring(17).trim();
    state.startScenario(scenarioName, lineNumber, true);
  }
}

/**
 * Handles Examples: lines
 */
class ExamplesLineHandler implements LineHandler {
  canHandle(line: string): boolean {
    return line.startsWith('Examples:');
  }

  handle(_line: string, _lineNumber: number, state: GherkinParserState): void {
    if (state.isScenarioOutline) {
      state.startExamplesSection();
    }
  }
}

/**
 * Handles table lines (|)
 */
class TableLineHandler implements LineHandler {
  canHandle(line: string): boolean {
    return line.startsWith('|');
  }

  handle(line: string, lineNumber: number, state: GherkinParserState): void {
    // Only process if we're in a Scenario Outline and inside Examples section
    if (!state.currentScenario || !state.isScenarioOutline || !state.inExamplesSection) {
      return;
    }

    // First | line after Examples: is the header
    if (state.examplesHeaderLine === -1) {
      state.examplesHeaderLine = lineNumber - 1; // Store as 0-indexed
    } else {
      // This is a data row (not the header)
      state.addExampleRow(lineNumber, line);
    }
  }
}

/**
 * Finds example row info
 */
export function findExampleRowInfo(lines: string[], currentLine: number): { scenarioLine: number } | null {
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

/**
 * Parse a feature file and extract feature info
 */
export function parseGherkinDocument(document: vscode.TextDocument): FeatureInfo | null {
  const text = document.getText();
  const lines = text.split('\n');
  const state = new GherkinParserState();

  const handlers: LineHandler[] = [
    new FeatureLineHandler(),
    new RuleLineHandler(),
    new ScenarioOutlineLineHandler(), // Must come before ScenarioLineHandler
    new ScenarioLineHandler(),
    new ExamplesLineHandler(),
    new TableLineHandler()
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1; // 1-indexed

    for (const handler of handlers) {
      if (handler.canHandle(line)) {
        handler.handle(line, lineNumber, state);
        break; // Only one handler per line
      }
    }
  }

  if (!state.featureName) {
    return null;
  }

  return {
    name: state.featureName,
    scenarios: state.scenarios,
    rules: state.rules,
    filePath: document.uri.fsPath,
    lineNumber: state.featureLineNumber
  };
}

/**
 * Finds the scenario at the given line number
 */
export function locateScenarioByLine(document: vscode.TextDocument, line: number): ScenarioInfo | null {
  const text = document.getText();
  const lines = text.split('\n');

  // Find the closest scenario heading from the line number backwards
  for (let i = line; i >= 0; i--) {
    const currentLine = lines[i].trim();
    if (currentLine.startsWith('Scenario:') || currentLine.startsWith('Scenario Outline:')) {
      const name = currentLine.substring(currentLine.indexOf(':') + 1).trim();
      return { name, lineNumber: i + 1 }; // 1-indexed line number for Cucumber
    }

    // Check for Rule
    if (currentLine.startsWith('Rule:')) {
      const name = currentLine.substring(5).trim();
      return { name, lineNumber: i + 1 };
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
export function locateExampleByLine(document: vscode.TextDocument, line: number): ScenarioInfo | null {
  try {
    const text = document.getText();
    const lines = text.split('\n');

    // Check the line content for debugging
    const currentLineText = lines[line].trim();
    logger.debug(`Current line (${line}): "${currentLineText}"`);

    // Check if the line starts with |
    if (!currentLineText.startsWith('|')) {
      logger.debug('Line does not start with |');
      return null;
    }

    // Find the Examples block
    let examplesLine = -1;
    let scenarioOutlineLine = -1;
    let headerLine = -1;

    // First go backwards to find the Examples heading
    for (let i = line; i >= 0; i--) {
      const lineText = lines[i].trim();
      logger.trace(`Backward line (${i}): "${lineText}"`);

      if (lineText.startsWith('Examples:')) {
        examplesLine = i;
        logger.debug(`Examples heading found, line: ${examplesLine}`);
        break;
      }
    }

    if (examplesLine === -1) {
      logger.debug('Examples heading not found');
      return null;
    }

    // The first line starting with | after the Examples heading is the header row
    for (let i = examplesLine + 1; i < lines.length; i++) {
      const lineText = lines[i].trim();
      if (lineText.startsWith('|')) {
        headerLine = i;
        logger.debug(`Header row found, line: ${headerLine}`);
        break;
      }
    }

    if (headerLine === -1 || line <= headerLine) {
      logger.debug(`Valid header row not found or current line (${line}) is before header line (${headerLine})`);
      return null;
    }

    // Go backwards from Examples heading to find the Scenario Outline
    for (let i = examplesLine; i >= 0; i--) {
      const lineText = lines[i].trim();
      if (lineText.startsWith('Scenario Outline:')) {
        scenarioOutlineLine = i + 1; // 1-indexed
        logger.debug(`Scenario Outline found, line: ${scenarioOutlineLine}`);
        break;
      }
    }

    if (scenarioOutlineLine === -1) {
      logger.debug('Scenario Outline not found');
      return null;
    }

    // Set the current line directly as the line to run
    // Note: Cucumber's expected format: feature:scenario_line:example_line
    return {
      name: 'example',
      lineNumber: scenarioOutlineLine,
      exampleLineNumber: line + 1 // 1-indexed
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Error in findExampleAtLine: ${errorMessage}`);
    return null;
  }
}
