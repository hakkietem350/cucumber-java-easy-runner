/**
 * Model definitions for Cucumber Java Easy Runner
 */

/**
 * Represents an example data row in a Scenario Outline
 */
export interface ExampleRow {
  lineNumber: number;
  data: string;
}

// Alias for backward compatibility
export type ExampleInfo = ExampleRow;

/**
 * Represents a scenario or scenario outline in a feature file
 */
export interface ScenarioDefinition {
  name: string;
  lineNumber: number;
  exampleLineNumber?: number;
  examples?: ExampleRow[];
}

// Alias for backward compatibility
export type ScenarioInfo = ScenarioDefinition;

/**
 * Represents a Rule block in a feature file
 */
export interface RuleBlock {
  name: string;
  lineNumber: number;
  scenarios: ScenarioDefinition[];
}

// Alias for backward compatibility
export type RuleInfo = RuleBlock;

/**
 * Represents a parsed feature file
 */
export interface ParsedFeature {
  name: string;
  scenarios: ScenarioDefinition[];
  rules?: RuleBlock[];
  filePath: string;
  lineNumber: number;
}

// Alias for backward compatibility
export type FeatureInfo = ParsedFeature;
