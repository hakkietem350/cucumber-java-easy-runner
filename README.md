# Cucumber Java Easy Runner

![Cucumber Java Easy Runner](https://raw.githubusercontent.com/hakkietem350/Cucumber-Java-Easy-Runner/main/images/logo.png)

A VS Code extension that seamlessly integrates Cucumber feature files with VS Code's Test Explorer. Run your Java Cucumber tests directly from the test panel with a clean, modern interface.

## ✨ Features

- 🧪 **Test Explorer Integration**: All your Cucumber features and scenarios appear in VS Code's Test Explorer panel
- 🎯 **Individual Scenario Execution**: Run specific scenarios without executing the entire feature
- 🔄 **Auto-discovery**: Automatically finds and displays all feature files in your workspace
- 🚫 **Smart Filtering**: Excludes build directories (target, build, out) to prevent duplicate tests
- ⚡ **Fast Refresh**: Instantly refresh test list when new features are added
- 🔧 **Auto-configuration**: Automatically detects glue path, no manual setup required
- 📋 **Optional CodeLens**: Enable traditional play buttons in feature files if preferred

## 🚀 Usage

### 1. Test Explorer (Recommended)

The primary way to run Cucumber tests is through VS Code's Test Explorer:

1. **Open Test Explorer**: Click the test tube icon in the activity bar or press `Ctrl+Shift+T`
2. **View Your Tests**: All feature files and scenarios are automatically discovered and displayed
3. **Run Tests**: Click the play button next to any feature or scenario to run it
4. **Refresh**: Use the refresh button in Test Explorer to discover new tests

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

### 2. CodeLens Play Buttons (Optional)

If you prefer the traditional approach with play buttons in feature files:

1. **Enable CodeLens**: Go to VS Code Settings → Extensions → Cucumber Java Easy Runner
2. **Check "Enable CodeLens"**: This will show play buttons directly in your feature files
3. **Use Play Buttons**: Click the buttons that appear on Feature, Scenario, and Example lines

Example feature file with CodeLens enabled:
```gherkin
$(play-circle) Feature: Shopping Cart

  $(play) Scenario: Adding an item to cart
    Given I am on the product page
    When I click "Add to Cart"
    Then the item should be added to my cart

  $(play) Scenario Outline: User login
    Given I enter "<username>" and "<password>"
    Then I should see "<result>"

    Examples:
      | username | password | result    |
      $(debug-start) | admin    | admin123 | Welcome!  |
      $(debug-start) | user1    | pass123  | Welcome!  |
```

### 3. Context Menu Options

You can also right-click on feature files:

- Right-click on a `.feature` file in the file explorer → "Cucumber: Run Feature"
- Right-click in an open feature file → "Cucumber: Run Feature/Scenario/Example"

## 🎨 Interface Options

### Test Explorer (Default)
- Clean, organized view of all tests
- Integrated with VS Code's testing framework
- Shows test status with clear icons
- No visual clutter in feature files

### CodeLens Buttons (Optional)
- Traditional play buttons in feature files
- Similar to IntelliJ IDEA experience
- Enable via settings if preferred

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
  ]
}
```

**Settings Options:**
- `enableCodeLens` (boolean, default: false): Show play buttons in feature files. When disabled, use Test Explorer for a cleaner interface.
- `autoCompileMaven` (boolean, default: false): If `true`, runs `mvn compile test-compile` before each execution. Leave `false` when you handle builds yourself for faster runs.
- `additionalGluePaths` (string array, default: `[]`): Extra Java package names that contain step definitions (useful for shared modules).
- `excludeBuildDirectories` (string array): Directories ignored during feature discovery. Customize if your build output uses different folder names.
- `objectFactory` (string, optional): Custom Cucumber object factory class (e.g., `cucumber.api.spring.SpringFactory`).

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

## ⚙️ Configuration

**Zero Configuration Required!** The extension works automatically with standard Maven projects:

- ✅ Auto-detects step definition glue path
- ✅ Finds all feature files in your workspace
- ✅ Excludes build directories automatically
- ✅ Integrates with VS Code Test Explorer

If auto-detection fails, you'll be prompted to enter your glue path manually (e.g., `com.example.steps`).

## 🔄 Refreshing Tests

**Automatic**: New feature files are detected automatically
**Manual**: Use the refresh button in Test Explorer or Command Palette → "Refresh Cucumber Tests"

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

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Package
npx vsce package
```

## 🔄 Contributing

Found a bug or have a feature request? Please report it on [GitHub Issues](https://github.com/hakkietem350/Cucumber-Java-Easy-Runner/issues).

## 📄 License

[MIT](LICENSE)

---

**Developer**: Hakki Etem  
**Repository**: [GitHub](https://github.com/hakkietem350/Cucumber-Java-Easy-Runner) 