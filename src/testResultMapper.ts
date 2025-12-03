import * as fs from 'fs';
import * as vscode from 'vscode';
import { logger } from './logger';

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

interface FailedStepInfo {
  name: string;
  errorMessage: string;
  line: number;
}

interface ScenarioResult {
  name: string;
  line: number;
  passed: boolean;
  failedStep?: FailedStepInfo;
}

function normalizePath(filePath: string): string {
  return filePath
    .replace(/^file:\/\//, '')
    .replace(/^file:/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .toLowerCase();
}

function isSameFeaturePath(fullPath: string, relativePath: string): boolean {
  const normalizedFull = normalizePath(fullPath);
  const normalizedRelative = normalizePath(relativePath);

  if (normalizedFull === normalizedRelative) {
    return true;
  }

  if (normalizedFull.endsWith('/' + normalizedRelative)) {
    return true;
  }

  const fullPathParts = normalizedFull.split('/');
  const relativePathParts = normalizedRelative.split('/');

  if (fullPathParts[fullPathParts.length - 1] !== relativePathParts[relativePathParts.length - 1]) {
    return false;
  }

  if (fullPathParts.length >= relativePathParts.length) {
    const fullEnd = fullPathParts.slice(-relativePathParts.length).join('/');
    return fullEnd === normalizedRelative;
  }

  return false;
}

async function parseResultFileForFeature(resultFile: string, featureUri: vscode.Uri): Promise<ScenarioResult[]> {
  const scenarioResults: ScenarioResult[] = [];

  const isValid = await waitForValidJsonFile(resultFile);

  if (!isValid) {
    logger.error('Result file is not valid or was not created:', resultFile);
    return scenarioResults;
  }

  try {
    const fileContent = fs.readFileSync(resultFile, 'utf-8');
    const results = JSON.parse(fileContent);

    if (!Array.isArray(results)) {
      logger.error('Results is not an array');
      return scenarioResults;
    }

    const featureFilePath = featureUri.fsPath;

    logger.debug('Looking for feature:', featureFilePath);
    logger.debug(`Total features in results: ${results.length}`);

    for (const feature of results) {
      const featurePath = feature?.uri || feature?.id || '';

      logger.debug('Comparing with feature path from JSON:', featurePath);

      const isMatch = isSameFeaturePath(featureFilePath, featurePath);
      logger.debug(`Match result: ${isMatch}`);

      if (isMatch && feature && Array.isArray(feature.elements)) {
        logger.debug(`Found matching feature with ${feature.elements.length} elements (scenarios/backgrounds)`);
        for (const scenario of feature.elements) {
          if (scenario.type === 'background') {
            logger.debug('Skipping background element');
            continue;
          }

          const scenarioName = scenario?.name || 'Unnamed scenario';
          const scenarioLine = scenario?.line;

          logger.debug(`Processing scenario: "${scenarioName}" at line ${scenarioLine}`);

          let scenarioPassed = true;
          let failedStep: FailedStepInfo | undefined;

          if (Array.isArray(scenario.before)) {
            for (const hook of scenario.before) {
              if (hook.result && hook.result.status !== 'passed') {
                scenarioPassed = false;
                const hookLocation = hook.match?.location || 'Unknown location';
                const errorMsg = hook.result.error_message || `Hook failed with status: ${hook.result.status}`;

                failedStep = {
                  name: 'Before Hook Failed',
                  errorMessage: `Hook Location: ${hookLocation}\n\n${errorMsg}`,
                  line: scenarioLine || 0
                };

                logger.debug(`Before hook failed at scenario line ${scenarioLine}`);
                break;
              }
            }
          }

          if (!failedStep && Array.isArray(scenario.steps) && scenario.steps.length > 0) {
            for (const step of scenario.steps) {
              const stepStatus = step?.result?.status || 'no result';
              logger.debug(`Step "${step.name}" at line ${step.line}: ${stepStatus}`);

              if (stepStatus === 'passed') {
                continue;
              }

              scenarioPassed = false;

              if (stepStatus === 'skipped') {
                continue;
              }

              const errorMsg = step.result?.error_message || `Step ${stepStatus}`;
              const stepKeyword = step.keyword || '';
              const stepName = step.name || 'Unknown step';

              failedStep = {
                name: `${stepKeyword.trim()} ${stepName}`,
                errorMessage: errorMsg,
                line: step.line || scenarioLine || 0
              };

              logger.debug(`Failed step found at line ${step.line}: ${failedStep.name}`);
              break;
            }

            if (!failedStep) {
              const allStepsSkipped = scenario.steps.every((step: { result?: { status?: string } }) =>
                step?.result?.status === 'skipped'
              );

              if (allStepsSkipped) {
                scenarioPassed = false;
                failedStep = {
                  name: 'Scenario Setup Error',
                  errorMessage: 'All steps were skipped. Check for errors in @Before hooks or step definitions.',
                  line: scenarioLine || 0
                };

                logger.debug(`All steps skipped - setup error at scenario line ${scenarioLine}`);
              }
            }
          } else if (!failedStep && (!scenario.steps || scenario.steps.length === 0)) {
            scenarioPassed = false;
            failedStep = {
              name: 'Empty Scenario',
              errorMessage: 'Scenario has no steps',
              line: scenarioLine || 0
            };

            logger.debug(`Empty scenario at line ${scenarioLine}`);
          }

          if (Array.isArray(scenario.after)) {
            for (const hook of scenario.after) {
              if (hook.result && hook.result.status !== 'passed') {
                scenarioPassed = false;
                if (!failedStep) {
                  const hookLocation = hook.match?.location || 'Unknown location';
                  const errorMsg = hook.result.error_message || `Hook failed with status: ${hook.result.status}`;

                  failedStep = {
                    name: 'After Hook Failed',
                    errorMessage: `Hook Location: ${hookLocation}\n\n${errorMsg}`,
                    line: scenarioLine || 0
                  };

                  logger.debug(`After hook failed at scenario line ${scenarioLine}`);
                }
                break;
              }
            }
          }

          scenarioResults.push({
            name: scenarioName,
            line: scenarioLine,
            passed: scenarioPassed,
            failedStep: failedStep
          });

          logger.debug(`Scenario result: "${scenarioName}" at line ${scenarioLine}: ${scenarioPassed ? 'PASSED' : 'FAILED'}`);
        }

        logger.debug(`Total scenarios found for this feature: ${scenarioResults.length}`);
        break;
      }
    }
  } catch (error) {
    logger.error('Error parsing result file for feature:', error);
  }

  return scenarioResults;
}

export async function markChildrenFromResults(
  featureItem: vscode.TestItem,
  run: vscode.TestRun,
  resultFile: string
): Promise<void> {
  try {
    if (!featureItem.uri) {
      logger.error('Feature item has no URI');
      return;
    }

    const scenarioResults = await parseResultFileForFeature(resultFile, featureItem.uri);
    const scenarioAggregates = new Map<string, { item: vscode.TestItem; passed: boolean; message?: vscode.TestMessage; matched: boolean }>();

    featureItem.children.forEach(child => {
      scenarioAggregates.set(child.id, { item: child, passed: true, matched: false });
    });

    for (const scenarioResult of scenarioResults) {
      let matchedScenario: vscode.TestItem | undefined;
      let matchedExample: vscode.TestItem | undefined;

      featureItem.children.forEach(child => {
        if (matchedScenario) {
          return;
        }
        const childIdParts = child.id.split(':scenario:');
        if (childIdParts.length > 1) {
          const lineNumberPart = childIdParts[1].split(':')[0];
          const childScenarioLine = parseInt(lineNumberPart, 10);

          if (childScenarioLine === scenarioResult.line) {
            matchedScenario = child;
            matchedExample = child;
            return;
          }

          child.children.forEach(exampleChild => {
            if (matchedScenario) {
              return;
            }
            const exampleParts = exampleChild.id.split(':example:');
            if (exampleParts.length > 1) {
              const exampleLine = parseInt(exampleParts[1], 10);
              if (exampleLine === scenarioResult.line) {
                matchedScenario = child;
                matchedExample = exampleChild;
              }
            }
          });
        }
      });

      if (!matchedScenario || !matchedExample) {
        logger.debug(`WARNING: No matching child found for scenario at line ${scenarioResult.line}`);
        continue;
      }

      let message: vscode.TestMessage | undefined;
      if (!scenarioResult.passed) {
        if (scenarioResult.failedStep) {
          message = new vscode.TestMessage(
            `${scenarioResult.failedStep.name}\n\n${scenarioResult.failedStep.errorMessage}`
          );

          if (matchedExample.uri) {
            const isScenarioLevelError =
              scenarioResult.failedStep.name.includes('Hook Failed') ||
              scenarioResult.failedStep.name.includes('Scenario Setup Error') ||
              scenarioResult.failedStep.name.includes('Empty Scenario');

            const targetLine = isScenarioLevelError
              ? (scenarioResult.line || 1) - 1
              : (scenarioResult.failedStep.line || scenarioResult.line || 1) - 1;

            message.location = new vscode.Location(
              matchedExample.uri,
              new vscode.Position(targetLine, 0)
            );
          }
        } else {
          message = new vscode.TestMessage('Scenario failed');
        }
      }

      if (scenarioResult.passed) {
        run.passed(matchedExample);
      } else if (message) {
        run.failed(matchedExample, message);
      }

      const aggregate = scenarioAggregates.get(matchedScenario.id);
      if (aggregate) {
        if (!scenarioResult.passed) {
          aggregate.passed = false;
          aggregate.message = message;
        }
        aggregate.matched = true;
        scenarioAggregates.set(matchedScenario.id, aggregate);
      }
    }

    scenarioAggregates.forEach(({ item, passed, message, matched }) => {
      if (!matched) {
        return;
      }
      if (passed) {
        run.passed(item);
      } else if (message) {
        run.failed(item, message);
      } else {
        run.failed(item, new vscode.TestMessage('Scenario failed'));
      }
    });
  } catch (error) {
    logger.error('Error marking children from results:', error);
  }
}

export async function getTestErrorMessages(resultFile: string, uri?: vscode.Uri): Promise<vscode.TestMessage[]> {
  const messages: vscode.TestMessage[] = [];

  if (!uri) {
    return messages;
  }

  try {
    const scenarioResults = await parseResultFileForFeature(resultFile, uri);

    for (const scenarioResult of scenarioResults) {
      if (!scenarioResult.passed && scenarioResult.failedStep) {
        const isScenarioLevelError =
          scenarioResult.failedStep.name.includes('Hook Failed') ||
          scenarioResult.failedStep.name.includes('Scenario Setup Error') ||
          scenarioResult.failedStep.name.includes('Empty Scenario');

        const message = new vscode.TestMessage(
          `Scenario: ${scenarioResult.name} (line ${scenarioResult.line})\n\n${scenarioResult.failedStep.name}\n\n${scenarioResult.failedStep.errorMessage}`
        );

        if (uri) {
          if (isScenarioLevelError) {
            message.location = new vscode.Location(
              uri,
              new vscode.Position((scenarioResult.line || 1) - 1, 0)
            );
          } else {
            message.location = new vscode.Location(
              uri,
              new vscode.Position((scenarioResult.failedStep.line || scenarioResult.line || 1) - 1, 0)
            );
          }
        }

        messages.push(message);
      }
    }
  } catch (error) {
    logger.error('Error getting test error messages:', error);
  }

  return messages;
}

export async function hasFeatureFailures(resultFile: string, featureUri: vscode.Uri): Promise<boolean> {
  const isValid = await waitForValidJsonFile(resultFile);

  if (!isValid) {
    logger.error('Result file is not valid or was not created:', resultFile);
    return true;
  }

  try {
    const fileContent = fs.readFileSync(resultFile, 'utf-8');
    const results = JSON.parse(fileContent);

    if (!Array.isArray(results)) {
      logger.error('Results is not an array');
      return true;
    }

    const featureFilePath = featureUri.fsPath;
    logger.debug('hasFeatureFailures checking:', featureFilePath);

    for (const feature of results) {
      const featurePath = feature?.uri || feature?.id || '';
      const isMatch = isSameFeaturePath(featureFilePath, featurePath);

      logger.debug(`Comparing with: ${featurePath} -> ${isMatch ? 'MATCH' : 'no match'}`);

      if (isMatch && feature && Array.isArray(feature.elements)) {
        for (const scenario of feature.elements) {
          if (scenario.type === 'background') {
            continue;
          }

          let scenarioPassed = true;

          if (Array.isArray(scenario.before)) {
            for (const hook of scenario.before) {
              if (hook.result && hook.result.status !== 'passed') {
                scenarioPassed = false;
                logger.debug(`Before hook failed in scenario at line ${scenario.line}`);
                break;
              }
            }
          }

          if (scenarioPassed && Array.isArray(scenario.after)) {
            for (const hook of scenario.after) {
              if (hook.result && hook.result.status !== 'passed') {
                scenarioPassed = false;
                logger.debug(`After hook failed in scenario at line ${scenario.line}`);
                break;
              }
            }
          }

          if (scenarioPassed && Array.isArray(scenario.steps) && scenario.steps.length > 0) {
            for (const step of scenario.steps) {
              if (!step?.result || step.result.status !== 'passed') {
                scenarioPassed = false;
                logger.debug(`Step failed: "${step.name}" at line ${step.line} with status ${step.result?.status}`);
                break;
              }
            }
          }

          if (!scenarioPassed) {
            logger.debug('Feature has failures!');
            return true;
          }
        }

        logger.debug('All scenarios passed in this feature');
        return false;
      }
    }

    logger.debug('WARNING: Feature not found in results, assuming passed');
    return false;
  } catch (error) {
    logger.error('Error checking feature failures:', error);
    return true;
  }
}

export function cleanupResultFile(resultFile: string): void {
  if (fs.existsSync(resultFile)) {
    try {
      fs.unlinkSync(resultFile);
    } catch (error) {
      logger.error('Error cleaning up result file:', error);
    }
  }
}

