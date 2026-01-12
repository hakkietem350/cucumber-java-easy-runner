import * as vscode from 'vscode';

export class CucumberStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private testCount: number = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.tooltip = 'Cucumber Java Easy Runner - Test count updates automatically';
    this.updateIdle();
    this.statusBarItem.show();
  }

  public updateTestCount(count: number): void {
    this.testCount = count;
    this.updateIdle();
  }

  public updateIdle(): void {
    this.statusBarItem.text = `$(beaker) Cucumber: ${this.testCount} tests`;
    this.statusBarItem.backgroundColor = undefined;
  }

  public updateRunning(testName?: string): void {
    const text = testName 
      ? `$(sync~spin) Running: ${this.truncate(testName, 30)}`
      : '$(sync~spin) Running tests...';
    this.statusBarItem.text = text;
    this.statusBarItem.backgroundColor = undefined;
  }

  public updatePassed(): void {
    this.statusBarItem.text = `$(check) Cucumber: Passed`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    // Reset to idle after 5 seconds
    setTimeout(() => this.updateIdle(), 5000);
  }

  public updateFailed(failedCount?: number): void {
    const text = failedCount 
      ? `$(x) Cucumber: ${failedCount} failed`
      : '$(x) Cucumber: Failed';
    this.statusBarItem.text = text;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    // Reset to idle after 10 seconds
    setTimeout(() => this.updateIdle(), 10000);
  }

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}

// Singleton instance
let instance: CucumberStatusBar | undefined;

export function getStatusBar(): CucumberStatusBar {
  if (!instance) {
    instance = new CucumberStatusBar();
  }
  return instance;
}

export function disposeStatusBar(): void {
  if (instance) {
    instance.dispose();
    instance = undefined;
  }
}
