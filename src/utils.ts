import { Settings } from './settings';

/**
 * Utility function for debug logging that only outputs when debug mode is enabled
 * @param settings Plugin settings to check debug mode status
 * @param message The message to log
 */
export function logDebug(settings: Settings, message: string): void {
  if (settings.debugMode) {
    console.log(`plugin:ai-helper: ${message}`);
  }
}

/**
 * Utility function for error logging
 * @param message The message to log
 * @param error Optional error to include with the log
 */
export function logError(message: string, error?: any) {
  console.error(`plugin:ai-helper: ${message}`, error || '');
}
