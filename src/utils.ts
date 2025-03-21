import { AIHelperSettings } from './settings';

/**
 * Utility function for debug logging that only outputs when debug mode is enabled
 * @param settings Plugin settings to check debug mode status
 * @param message The message to log
 * @param data Optional data to include with the log
 */
export function debugLog(settings: AIHelperSettings, message: string, data?: any) {
  if (settings.debugMode) {
    console.debug(message, data);
  }
}