/**
 * Internationalization (i18n) support for Cucumber Java Easy Runner
 * Uses JSON locale files for translations
 */
import * as vscode from 'vscode';

// Import locale files
import en from './locales/en.json';
import tr from './locales/tr.json';

// Define supported locales
type LocaleData = typeof en;
const locales: Record<string, LocaleData> = {
  en,
  tr
};

// Get VS Code's display language and select appropriate locale
const language = vscode.env.language;
const localeKey = Object.keys(locales).find(key => language.startsWith(key)) || 'en';
const locale = locales[localeKey];

// Helper to replace {0}, {1}, etc. with parameters
function format(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? ''));
}

// Export messages for easy access
export const messages = {
  // Extension activation
  activating: locale.extension.activating,
  testExplorerCreated: locale.extension.testExplorerCreated,
  inlineButtonsRegistered: locale.extension.inlineButtonsRegistered,
  inlineButtonsDisabled: locale.extension.inlineButtonsDisabled,

  // Error messages
  errorOpenFeatureFile: locale.errors.openFeatureFile,
  errorOpenFile: locale.errors.openFile,
  errorFeatureFilesOnly: locale.errors.featureFilesOnly,
  errorRightClickScenario: locale.errors.rightClickScenario,
  errorRightClickExample: locale.errors.rightClickExample,
  errorExampleNotDetected: locale.errors.exampleNotDetected,
  errorNoWorkspaceFolder: locale.errors.noWorkspaceFolder,
  errorNoWorkspace: locale.errors.noWorkspace,
  errorGluePathNotSpecified: locale.errors.gluePathNotSpecified,
  errorTestItemNoUri: locale.errors.testItemNoUri,
  errorTestFailed: locale.errors.testFailed,
  errorScenarioFailed: locale.errors.scenarioFailed,
  errorDebugFailed: locale.errors.debugFailed,
  errorTestSessionFailed: locale.errors.testSessionFailed,

  // Info messages
  infoFeatureTestStarting: locale.info.featureTestStarting,
  infoFeatureDebugStarting: locale.info.featureDebugStarting,
  infoRefreshingTests: locale.info.refreshingTests,

  // Prompts
  promptGluePath: locale.prompts.gluePath,
  promptGluePathPlaceholder: locale.prompts.gluePathPlaceholder,

  // Test results
  testResultsCheckTerminal: locale.testResults.checkTerminal,
  testResultsCheckDebugConsole: locale.testResults.checkDebugConsole,
  oneOrMoreScenariosFailed: locale.testResults.oneOrMoreFailed,

  // Progress
  progressCompiling: locale.progress.compiling,

  // Tooltips
  tooltipRunFeature: locale.tooltips.runFeature,
  tooltipDebugFeature: locale.tooltips.debugFeature,
  tooltipRunScenario: locale.tooltips.runScenario,
  tooltipDebugScenario: locale.tooltips.debugScenario,
  tooltipRunExample: locale.tooltips.runExample,
  tooltipDebugExample: locale.tooltips.debugExample
};

// Parameterized messages
export const paramMessages = {
  scenarioTestStarting: (line: number) => format(locale.dynamic.scenarioTestStarting, line),
  scenarioDebugStarting: (line: number) => format(locale.dynamic.scenarioDebugStarting, line),
  exampleTestStarting: (line: number) => format(locale.dynamic.exampleTestStarting, line),
  exampleDebugStarting: (line: number) => format(locale.dynamic.exampleDebugStarting, line),
  foundFeatureFiles: (count: number) => format(locale.dynamic.foundFeatureFiles, count),
  runningFeatures: (count: number) => format(locale.dynamic.runningFeatures, count),
  compilingFeatures: (count: number) => format(locale.dynamic.compilingFeatures, count)
};
