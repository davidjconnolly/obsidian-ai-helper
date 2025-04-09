import { App, TFile } from 'obsidian';
import { Settings } from './settings';

/**
 * Utility function for debug logging that only outputs when debug mode is enabled
 * @param settings Plugin settings to check debug mode status
 * @param message The message to log
 * @param data Optional data to include with the log
 */
export function debugLog(settings: Settings, message: string, ...data: any[]): void {
  if (settings.debugMode) {
    console.log(`[AI Helper] ${message}`, ...data);
  }
}

export async function getDeduplicatedFileContents(app: App, file: TFile, skipFrontmatter: boolean = false): Promise<string> {
  try {
    const content = await app.vault.cachedRead(file);

    if (!skipFrontmatter || !content.startsWith('---')) {
      return content;
    }

    // Remove frontmatter
    const endFrontmatter = content.indexOf('---', 3);
    if (endFrontmatter !== -1) {
      return content.substring(endFrontmatter + 3).trim();
    }

    return content;
  } catch (error) {
    console.error(`Error reading file ${file.path}:`, error);
    return '';
  }
}

export function extractFrontmatter(content: string): Record<string, any> | null {
  if (!content.startsWith('---')) {
    return null;
  }

  try {
    const endOfFrontmatter = content.indexOf('---', 3);
    if (endOfFrontmatter === -1) {
      return null;
    }

    const frontmatterText = content.substring(3, endOfFrontmatter).trim();
    const frontmatterLines = frontmatterText.split('\n');
    const result: Record<string, any> = {};

    for (const line of frontmatterLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // Handle quotes around values
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }

      // Handle array values
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          // Simple array parsing - split on commas
          const arrayItems = value.substring(1, value.length - 1)
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0);

          // Remove quotes from array items if they have them
          const cleanedArray = arrayItems.map(item => {
            if ((item.startsWith('"') && item.endsWith('"')) ||
                (item.startsWith("'") && item.endsWith("'"))) {
              return item.substring(1, item.length - 1);
            }
            return item;
          });

          result[key] = cleanedArray;
        } catch (e) {
          // If parsing fails, store as string
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  } catch (error) {
    console.error('Error extracting frontmatter:', error);
    return null;
  }
}