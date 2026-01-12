/**
 * Generates package.nls.*.json files from src/locales/*.json
 * Run with: node scripts/generate-nls.js
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'src', 'locales');
const rootDir = path.join(__dirname, '..');

// Mapping from locale JSON structure to package.nls format
function transformLocale(locale) {
  const pkg = locale.package;
  if (!pkg) {
    console.error('No "package" section found in locale file');
    return null;
  }

  return {
    'ext.displayName': pkg.displayName,
    'ext.description': pkg.description,

    'cmd.runFeature': pkg.commands.runFeature,
    'cmd.runScenario': pkg.commands.runScenario,
    'cmd.runExample': pkg.commands.runExample,
    'cmd.debugFeature': pkg.commands.debugFeature,
    'cmd.debugScenario': pkg.commands.debugScenario,
    'cmd.debugExample': pkg.commands.debugExample,
    'cmd.runFeatureCodeLens': pkg.commands.runFeatureCodeLens,
    'cmd.runScenarioCodeLens': pkg.commands.runScenarioCodeLens,
    'cmd.runExampleCodeLens': pkg.commands.runExampleCodeLens,
    'cmd.debugFeatureCodeLens': pkg.commands.debugFeatureCodeLens,
    'cmd.debugScenarioCodeLens': pkg.commands.debugScenarioCodeLens,
    'cmd.debugExampleCodeLens': pkg.commands.debugExampleCodeLens,
    'cmd.refreshTests': pkg.commands.refreshTests,

    'config.title': pkg.config.title,
    'config.enableCodeLens': pkg.config.enableCodeLens,
    'config.autoCompileMaven': pkg.config.autoCompileMaven,
    'config.additionalGluePaths': pkg.config.additionalGluePaths,
    'config.excludeBuildDirectories': pkg.config.excludeBuildDirectories,
    'config.objectFactory': pkg.config.objectFactory,
    'config.logLevel': pkg.config.logLevel
  };
}

// Read all locale files
const localeFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));

for (const file of localeFiles) {
  const lang = path.basename(file, '.json');
  const localePath = path.join(localesDir, file);
  const locale = JSON.parse(fs.readFileSync(localePath, 'utf8'));

  const nlsData = transformLocale(locale);
  if (!nlsData) continue;

  // Output file: package.nls.json for 'en', package.nls.XX.json for others
  const outputFile = lang === 'en' 
    ? 'package.nls.json' 
    : `package.nls.${lang}.json`;
  
  const outputPath = path.join(rootDir, outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(nlsData, null, 2) + '\n');
  
  console.log(`Generated: ${outputFile}`);
}

console.log('Done!');
