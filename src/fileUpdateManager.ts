import { Settings } from "./settings";
import { logDebug, logError } from "./utils";
import { globalEmbeddingStore, isGloballyInitialized, globalInitializationPromise } from "./chat/embeddingStore";
import { TFile, App } from "obsidian";
import { Notice } from "obsidian";

// Custom debounce implementation with flush method
function createDebounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number,
	immediate = false
): { (...args: Parameters<T>): void; flush: () => void } {
	let timeoutId: number | null = null;
	let lastArgs: Parameters<T> | null = null;

	function later() {
		timeoutId = null;
		if (!immediate && lastArgs) {
			func(...lastArgs);
			lastArgs = null;
		}
	}

	const debounced = function(...args: Parameters<T>) {
		lastArgs = args;
		const callNow = immediate && !timeoutId;

		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
			timeoutId = null;
		}

		timeoutId = window.setTimeout(later, wait);

		if (callNow) {
			func(...args);
			lastArgs = null;
		}
	};

	debounced.flush = function() {
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
			timeoutId = null;

			if (lastArgs) {
				func(...lastArgs);
				lastArgs = null;
			}
		}
	};

	return debounced;
}

export class FileUpdateManager {
	private settings: Settings;
	private app: App;
	public modifiedFiles: Map<string, number> = new Map();
	public processPendingFileUpdates: { (...args: any[]): void; flush: () => void; };

	constructor(settings: Settings, app: App) {
		this.settings = settings;
		this.app = app;
		this.processPendingFileUpdates = createDebounce(
			this.processPendingUpdates.bind(this),
			this.settings.fileUpdateFrequency * 1000
		);
	}

	private async processPendingUpdates() {
		const now = Date.now();
		const filesToUpdate: string[] = [];

		logDebug(this.settings, `Checking for files to update at ${new Date().toLocaleTimeString()}`);
		logDebug(this.settings, `Current modified files queue: ${this.modifiedFiles.size} files`);

		// Check if this is directly after initialization to prevent duplicate indexing
		if (this.modifiedFiles.size > 0) {
			// Find files that were modified more than the configured update frequency ago
			const updateDelayMs = this.settings.fileUpdateFrequency * 1000; // Convert to milliseconds

			this.modifiedFiles.forEach((timestamp, path) => {
				const ageMs = now - timestamp;
				const shouldUpdate = true; // Always update modified files

				logDebug(this.settings, `File ${path} modified ${Math.round(ageMs/1000)}s ago, should update: ${shouldUpdate}`);

				if (shouldUpdate) {
					filesToUpdate.push(path);
				}
			});

			// Process files that qualify for update
			if (filesToUpdate.length > 0) {
				logDebug(this.settings, `Processing ${filesToUpdate.length} modified files for reindexing: ${filesToUpdate.join(', ')}`);

				filesToUpdate.forEach(path => {
					// Remove from tracking
					this.modifiedFiles.delete(path);

					// Get the file and reindex
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile && file.extension === 'md') {
						this.reindexFile(file);
					} else {
						logError(`File not found or not a markdown file: ${path}`);
					}
				});
			} else {
				logDebug(this.settings, 'No files need updating at this time');
			}
		} else {
			logDebug(this.settings, 'No modified files in queue');
		}
	}

	// Helper method to reindex a file
	async reindexFile(file: TFile) {
		if (!globalEmbeddingStore) {
			logDebug(this.settings, `Embedding store not yet initialized, queueing ${file.path} for later reindexing`);
			// Queue it for later when embedding store is ready
			this.modifiedFiles.set(file.path, Date.now());
			return;
		}

		if (this.settings.embeddingSettings.updateMode === 'none') {
			logDebug(this.settings, `Update mode is set to 'none', skipping reindex of ${file.path}`);
			return;
		}

		try {
			logDebug(this.settings, `Starting to reindex file: ${file.path}`);
			const content = await this.app.vault.cachedRead(file);

			// Skip empty or very short files
			if (!content || content.trim().length < 50) {
				logDebug(this.settings, `File ${file.path} is too short to generate meaningful embeddings (${content.length} chars). Skipping.`);
				return;
			}

			// Remove the old embedding first to ensure it's fully updated
			try {
				logDebug(this.settings, `Removing old embedding for ${file.path} before reindexing`);
				globalEmbeddingStore.removeNote(file.path);
			} catch (e) {
				logDebug(this.settings, `No existing embedding found for ${file.path}, creating new one`);
			}

			// Add the new embedding
			await globalEmbeddingStore.addNote(file, content);

			// Save the updated embeddings to disk
			await globalEmbeddingStore.saveToFile();

			logDebug(this.settings, `Successfully reindexed file: ${file.path}`);

			// Show a notification if debug mode is enabled
			if (this.settings.debugMode) {
				new Notice(`Reindexed: ${file.path}`, 2000);
			}
		} catch (error) {
			logError(`Error reindexing file ${file.path}`, error);
		}
	}

	// Helper method to rescan all vault files
	rescanVaultFiles() {
		new Notice('Rescanning vault files for AI indexing...');

		if (!globalEmbeddingStore) {
			// // Initialize the embedding system if not done yet
			logDebug(this.settings, 'Embedding system initializing. Please try again in a few seconds.');
			return;
		}

		// Get all markdown files
		const files = this.app.vault.getMarkdownFiles();
		logDebug(this.settings, `Found ${files.length} markdown files to index`);

		if (files.length === 0) {
			new Notice('No markdown files found in your vault.');
			return;
		}

		// Create a custom notification for progress tracking
		const progressNotice = new Notice('', 0);
		const progressElement = progressNotice.noticeEl.createDiv();
		progressElement.setText(`Indexing files: 0/${files.length}`);

		// Process files in batches to avoid UI blocking
		let processedCount = 0;
		const processFiles = (batch: TFile[], startIndex: number) => {
			Promise.all(batch.map(async (file) => {
				try {
					const content = await this.app.vault.cachedRead(file);

					// Skip empty or very short files
					if (!content || content.trim().length < 50) {
						logDebug(this.settings, `File ${file.path} is too short to generate meaningful embeddings (${content.length} chars). Skipping.`);
						processedCount++;
						return;
					}

					await globalEmbeddingStore?.addNote(file, content);
					processedCount++;
				} catch (error) {
					logError(`Error indexing file ${file.path}`, error);
					processedCount++; // Still count as processed even if it fails
				}
			})).then(() => {
				// Update notice with current progress
				progressElement.setText(`Indexing files: ${processedCount}/${files.length}`);

				// Process next batch
				const nextStartIndex = startIndex + batch.length;
				if (nextStartIndex < files.length) {
					const nextBatch = files.slice(nextStartIndex, nextStartIndex + 10);
					setTimeout(() => processFiles(nextBatch, nextStartIndex), 50);
				} else {
					// Show completion notification
					progressNotice.hide(); // Hide the progress notification
					new Notice(`Completed indexing ${processedCount} files for AI search`, 3000);
				}
			});
		};

		// Start processing files in batches of 10
		const firstBatch = files.slice(0, 10);
		processFiles(firstBatch, 0);
	}

	// Helper method to remove a file from the index
	async removeFileFromIndex(filePath: string) {
		if (!globalEmbeddingStore) {
			logDebug(this.settings, "Embedding store not yet initialized, skipping removal");
			return;
		}

		try {
			globalEmbeddingStore.removeNote(filePath);
			logDebug(this.settings, `Successfully removed ${filePath} from index`);
		} catch (error) {
			logError(`Error removing file ${filePath} from index`, error);
		}
	}

	// Helper method to update debounce settings when file update frequency changes
	updateDebounceSettings() {
		// Recreate the debounced function with the new timing
		const oldFunction = this.processPendingFileUpdates;

		// Create new debounced function with updated settings
		this.processPendingFileUpdates = createDebounce(() => {
			const now = Date.now();
			const filesToUpdate: string[] = [];

			logDebug(this.settings, `Checking for files to update at ${new Date().toLocaleTimeString()}`);
			logDebug(this.settings, `Current modified files queue: ${this.modifiedFiles.size} files`);

			// Check if this is directly after initialization to prevent duplicate indexing
			if (this.modifiedFiles.size > 0) {
				// Find files that were modified more than the configured update frequency ago
				const updateDelayMs = this.settings.fileUpdateFrequency * 1000; // Convert to milliseconds

				this.modifiedFiles.forEach((timestamp, path) => {
					const ageMs = now - timestamp;
					const shouldUpdate = true; // Always update modified files

					logDebug(this.settings, `File ${path} modified ${Math.round(ageMs/1000)}s ago, should update: ${shouldUpdate}`);

					if (shouldUpdate) {
						filesToUpdate.push(path);
					}
				});

				// Process files that qualify for update
				if (filesToUpdate.length > 0) {
					logDebug(this.settings, `Processing ${filesToUpdate.length} modified files for reindexing: ${filesToUpdate.join(', ')}`);

					filesToUpdate.forEach(path => {
						// Remove from tracking
						this.modifiedFiles.delete(path);

						// Get the file and reindex
						const file = this.app.vault.getAbstractFileByPath(path);
						if (file instanceof TFile && file.extension === 'md') {
							this.reindexFile(file);
						} else {
							logError(`File not found or not a markdown file: ${path}`);
						}
					});
				} else {
					logDebug(this.settings, 'No files need updating at this time');
				}
			} else {
				logDebug(this.settings, 'No modified files in queue');
			}
		}, this.settings.fileUpdateFrequency * 1000 / 2, false); // Wait for half the update frequency

		// Process any pending items with the old function
		oldFunction?.flush();
	}

	// Helper method to check if initial indexing is still in progress
	isInitialIndexingInProgress(): boolean {
		return !isGloballyInitialized && globalInitializationPromise !== null;
	}

	// Calculate the check interval based on user settings with sensible defaults
	getPeriodicCheckInterval(): number {
		// The interval will be twice the user-defined file update frequency
		return Math.max(30000, this.settings.fileUpdateFrequency * 2000); // At least 30 seconds
	}
}
