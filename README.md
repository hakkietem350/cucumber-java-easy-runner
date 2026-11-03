# Cucumber Java Easy Runner

![Cucumber Java Easy Runner](https://raw.githubusercontent.com/hakkietem350/Cucumber-Java-Easy-Runner/main/images/logo.png)

A VS Code extension that seamlessly integrates Cucumber feature files with VS Code's Test Explorer. Run and debug your Java Cucumber tests directly from the test panel with a clean, modern interface.

## ✨ Features

- 🧪 **Test Explorer Integration**: All your Cucumber features and scenarios appear in VS Code's Test Explorer panel
- 🎯 **Individual Scenario Execution**: Run specific scenarios without executing the entire feature
- 📊 **Status Bar**: Real-time test count and execution status in the status bar
- 🔄 **Auto-discovery**: Automatically finds and displays all feature files in your workspace
- 🚫 **Smart Filtering**: Excludes build directories (target, build, out) to prevent duplicate tests
- ⚡ **Fast Startup**: Maven classpath is resolved once and cached until `pom.xml` changes; runs for the same project are queued, never stacked
- 🔧 **Auto-configuration**: Automatically detects glue path, no manual setup required
- 📋 **Optional CodeLens**: Enable traditional play buttons in feature files if preferred
- 🌍 **Internationalization**: Available in English and Turkish

## 🚀 Usage

### 1. Test Explorer (Recommended)

The primary way to run Cucumber tests is through VS Code's Test Explorer:

1. **Open Test Explorer**: Click the test tube icon in the activity bar or press `Ctrl+Shift+T`
2. **View Your Tests**: All feature files and scenarios are automatically discovered and displayed
3. **Run Tests**: Click the play button next to any feature or scenario to run it
4. **Debug Tests**: Click the debug icon to debug with breakpoints
5. **Refresh**: Use the refresh button in Test Explorer to discover new tests

```
🧪 Test Explorer
├─ 📁 Cucumber Java Tests
   ├─ 📄 Login Feature
   │  ├─ ✅ Successful login
   │  ├─ ✅ Failed login with wrong password
   │  └─ ✅ Password reset flow
   ├─ 📄 Shopping Cart Feature
   │  ├─ ✅ Add item to cart
   │  ├─ ✅ Remove item from cart
   │  └─ ✅ Checkout process
   └─ 📄 User Registration Feature
      ├─ ✅ Valid registration
      └─ ❌ Invalid email format
```

### 2. Status Bar

The extension displays a status bar item at the bottom of VS Code showing:

- **Test count**: `🧪 Cucumber: 42 tests` - Total number of discovered tests
- **Running**: `🔄 Running: Scenario name...` - Currently executing test
- **Passed**: `✅ Cucumber: Passed` - All tests passed (green background)
- **Failed**: `❌ Cucumber: Failed` - One or more tests failed (red background)

The test count updates automatically when feature files are added, modified, or deleted.

### 3. Debug Support

Debug your Cucumber tests with full breakpoint support:

1. **Set Breakpoints**: Add breakpoints in your Java step definition files
2. **Start Debug**: Click the debug icon in Test Explorer or use "Debug" from context menu
3. **Inspect Variables**: Use VS Code's debug panel to inspect variables and step through code

Debug runs share the same classpath cache as normal runs, so a second debug session starts without any Maven overhead. When the [Language Support for Java](https://marketplace.visualstudio.com/items?itemName=redhat.java) extension is installed, it already compiles your sources to `target/classes` / `target/test-classes` on save — so `autoCompileMaven` is normally **not** needed for debugging (breakpoints always match the JDT-compiled classes).

Available debug commands:
- `Cucumber: Debug Feature` - Debug entire feature file
- `Cucumber: Debug Scenario` - Debug specific scenario
- `Cucumber: Debug Example` - Debug specific example row in Scenario Outline

### 4. CodeLens Play Buttons (Optional)

If you prefer the traditional approach with play buttons in feature files:

1. **Enable CodeLens**: Go to VS Code Settings → Extensions → Cucumber Java Easy Runner
2. **Check "Enable CodeLens"**: This will show play buttons directly in your feature files
3. **Use Play Buttons**: Click the buttons that appear on Feature, Scenario, and Example lines

Example feature file with CodeLens enabled:
```gherkin
▶ Run Feature  🐛 Debug Feature
Feature: Shopping Cart

  ▶ Run Scenario  🐛 Debug Scenario
  Scenario: Adding an item to cart
    Given I am on the product page
    When I click "Add to Cart"
    Then the item should be added to my cart

  ▶ Run Scenario  🐛 Debug Scenario
  Scenario Outline: User login
    Given I enter "<username>" and "<password>"
    Then I should see "<result>"

    Examples:
      | username | password | result    |
      ▶ 🐛 | admin    | admin123 | Welcome!  |
      ▶ 🐛 | user1    | pass123  | Welcome!  |
```

### 5. Context Menu Options

You can also right-click on feature files:

- Right-click on a `.feature` file in the file explorer → "Cucumber: Run Feature"
- Right-click in an open feature file → "Cucumber: Run/Debug Feature/Scenario/Example"

## 🎨 Interface Options

### Test Explorer (Default)
- Clean, organized view of all tests
- Integrated with VS Code's testing framework
- Shows test status with clear icons
- No visual clutter in feature files
- Supports both Run and Debug

### CodeLens Buttons (Optional)
- Traditional play buttons in feature files
- Similar to IntelliJ IDEA experience
- Enable via settings if preferred
- Includes both Run and Debug buttons

## ⚙️ Settings

Configure the extension behavior in VS Code Settings:

```json
{
  "cucumberJavaEasyRunner.enableCodeLens": false,
  "cucumberJavaEasyRunner.autoCompileMaven": false,
  "cucumberJavaEasyRunner.additionalGluePaths": [],
  "cucumberJavaEasyRunner.excludeBuildDirectories": [
    "target",
    "build",
    "out",
    "dist",
    "node_modules",
    ".git"
  ],
  "cucumberJavaEasyRunner.objectFactory": "",
  "cucumberJavaEasyRunner.logLevel": "info",
  "cucumberJavaEasyRunner.vmArgs": ""
}
```

**Settings Options:**
- `enableCodeLens` (boolean, default: false): Show play buttons in feature files. When disabled, use Test Explorer for a cleaner interface.
- `autoCompileMaven` (boolean, default: false): If `true`, runs `mvn test-compile` before executing tests — combined with dependency resolution into a **single Maven invocation** to keep startup fast. Leave `false` when the Java extension's automatic build (or your own `mvn` runs) keeps `target/` up to date.
- `additionalGluePaths` (string array, default: `[]`): Extra Java package names that contain step definitions (useful for shared modules).
- `excludeBuildDirectories` (string array): Directories ignored during feature discovery. Customize if your build output uses different folder names.
- `objectFactory` (string, optional): Custom Cucumber object factory class (e.g., `cucumber.api.spring.SpringFactory`).
- `logLevel` (string, default: "info"): Controls the verbosity of extension logs in the Output panel. Options: `error`, `warn`, `info`, `debug`, `trace`.
- `vmArgs` (string, default: `""`): Additional JVM arguments passed to the Cucumber runner process (e.g., `-DisLogOn=true`).

## 🏃 How Tests Execute

For each run (and debug) the extension:

1. **Resolves the test classpath** via `mvn dependency:build-classpath`. The result is cached and reused until `pom.xml` changes — subsequent runs skip Maven entirely. Failed resolutions are never cached, so one broken Maven run cannot poison later runs.
2. **Optionally compiles** (`mvn test-compile`) only when `autoCompileMaven` is enabled; in that case compilation is merged into the same Maven call.
3. **Queues concurrent runs**: clicking Run while a previous run is still resolving or executing will queue the new run instead of starting a second Maven/Java process in parallel.
4. **Launches `io.cucumber.core.cli.Main`** with the resolved classpath and reports results from the Cucumber JSON output into Test Explorer.

Maven invocations have a 15-minute timeout and test executions a 10-minute timeout, so a hung process can never block your workspace forever. If `io.cucumber:cucumber-core` is missing from the classpath, the extension fails fast with a clear message instead of an opaque Java error.

## 📦 Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions view (`Ctrl+Shift+X`)
3. Search for "Cucumber Java Easy Runner"
4. Click Install

### Manual Installation
1. Download the `.vsix` file from [Releases](https://github.com/hakkietem350/Cucumber-Java-Easy-Runner/releases)
2. Open Extensions view → "..." menu → "Install from VSIX"
3. Select the downloaded file

## 🔧 Requirements

- **Java**: JDK 8 or higher
- **Maven**: 3.6 or higher
- **Project Structure**: Standard Maven layout
- **Dependencies**: Cucumber-JVM in your pom.xml
- **For Debugging**: [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension

## ⚙️ Configuration

**Zero Configuration Required!** The extension works automatically with standard Maven projects:

- ✅ Auto-detects step definition glue path
- ✅ Finds all feature files in your workspace
- ✅ Excludes build directories automatically
- ✅ Integrates with VS Code Test Explorer
- ✅ Supports generated-sources (Swagger, etc.)

If auto-detection fails, you'll be prompted to enter your glue path manually (e.g., `com.example.steps`).

## 🔄 Refreshing Tests

**Automatic**: New feature files are detected automatically, test count in status bar updates in real-time
**Manual**: Use the refresh button in Test Explorer or Command Palette → "Refresh Cucumber Tests"

## 🌍 Internationalization

The extension is available in:
- 🇬🇧 English (default)
- 🇹🇷 Turkish (Türkçe)

The language is automatically selected based on your VS Code display language setting.

## ❓ Troubleshooting

**Tests not showing in Test Explorer:**
- Make sure you have `.feature` files in your workspace
- Check that files aren't in excluded directories (target, build, out)
- Use the refresh button in Test Explorer

**CodeLens buttons not showing:**
- Enable CodeLens in extension settings
- Make sure you're viewing a `.feature` file

**Glue path errors:**
- Extension will prompt you to enter the path manually
- Use Java package format: `com.example.steps`

**Test execution issues:**
- Verify Maven project structure
- Check Cucumber dependencies in pom.xml
- Ensure Java and Maven are properly installed

**Tests start slowly or don't start:**
- The first run after a `pom.xml` change resolves the Maven classpath — this is a one-time cost; later runs reuse the cache. Check the "Cucumber Java Runner" Output panel to see which phase is slow.
- If you see *"io.cucumber:cucumber-core was not found on the Maven classpath"*, Cucumber is missing from `pom.xml` (test scope) or dependencies are not downloaded — run `mvn dependency:resolve`.
- Maven runs are killed after 15 minutes if they hang (e.g., unreachable repository). Test the same `mvn` command in a terminal to find the root cause.
- If Maven is not found, set `maven.executable.path` in VS Code settings — the extension respects it (and also probes Homebrew and the Pleiades Java pack locations automatically).
- Make sure the Java extension's build has completed (no red squiggles in step definitions) before running.

**Debug not working:**
- Make sure you have the [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension installed
- Check that breakpoints are set in `.java` files, not `.feature` files

**Generated sources not found:**
- The extension automatically includes `target/generated-sources/*` in classpath
- Run `mvn compile` to generate sources before running tests

## 🛠️ Development

```bash
# Install dependencies
npm install

# Generate localization files
npm run generate-nls

# Compile
npm run compile

# Package
npx vsce package --no-dependencies
```

## 🔄 Contributing

Found a bug or have a feature request? Please report it on [GitHub Issues](https://github.com/hakkietem350/Cucumber-Java-Easy-Runner/issues).

## 📄 License

[MIT](LICENSE)

---

**Developer**: Hakki Etem  
**Repository**: [GitHub](https://github.com/hakkietem350/Cucumber-Java-Easy-Runner)
