import * as vscode from 'vscode';

export enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
  Trace = 4,
}

class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel = LogLevel.Info;

  private constructor() {
    this.loadLogLevel();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public reloadLogLevel(): void {
    this.loadLogLevel();
  }

  private loadLogLevel(): void {
    const config = vscode.workspace.getConfiguration('cucumberJavaEasyRunner');
    const levelString = config.get<string>('logLevel', 'info').toLowerCase();

    switch (levelString) {
      case 'error':
        this.currentLevel = LogLevel.Error;
        break;
      case 'warn':
      case 'warning':
        this.currentLevel = LogLevel.Warn;
        break;
      case 'debug':
        this.currentLevel = LogLevel.Debug;
        break;
      case 'trace':
        this.currentLevel = LogLevel.Trace;
        break;
      case 'info':
      default:
        this.currentLevel = LogLevel.Info;
        break;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString().split('T')[1]?.split('.')[0] ?? '';
    const levelName = LogLevel[level];
    const formattedArgs =
      args.length > 0
        ? ' ' +
          args
            .map((arg) => {
              if (typeof arg === 'object' && arg !== null) {
                try {
                  return JSON.stringify(arg, null, 2);
                } catch {
                  return String(arg);
                }
              }
              return String(arg);
            })
            .join(' ')
        : '';

    return `[${timestamp}] [${levelName}] ${message}${formattedArgs}`;
  }

  public error(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.Error)) {
      console.error(this.formatMessage(LogLevel.Error, message, ...args));
    }
  }

  public warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.Warn)) {
      console.warn(this.formatMessage(LogLevel.Warn, message, ...args));
    }
  }

  public info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.Info)) {
      console.log(this.formatMessage(LogLevel.Info, message, ...args));
    }
  }

  public debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.Debug)) {
      console.log(this.formatMessage(LogLevel.Debug, message, ...args));
    }
  }

  public trace(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.Trace)) {
      console.log(this.formatMessage(LogLevel.Trace, message, ...args));
    }
  }
}

export const logger = Logger.getInstance();

export function initializeLogger(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('cucumberJavaEasyRunner.logLevel')) {
        logger.reloadLogLevel();
        logger.info('Log level reloaded from settings');
      }
    })
  );
}

