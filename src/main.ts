import { Editor, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { AI_CHAT_VIEW_TYPE, AIHelperChatView, openAIChat } from './chat';
import { DEFAULT_SETTINGS, Settings, AIHelperSettingTab } from './settings';
import { summarizeSelection } from './summarize';
import { logDebug, logError } from './utils';
import { initializeEmbeddingSystem, globalEmbeddingStore, isGloballyInitialized, globalInitializationPromise } from './chat/embeddingStore';

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

export default class AIHelperPlugin extends Plugin {
	settings: Settings;
	private modifiedFiles: Map<string, number> = new Map(); // Track modified files and their timestamps
	private processPendingFileUpdates: ReturnType<typeof createDebounce<() => void>>;
	private indexingCompleteListener: (e: CustomEvent) => void;

	async onload() {
		await this.loadSettings();

		// Create the debounced function for file updates
		this.updateDebounceSettings();

		// Register the AI Chat view
		this.registerView(
			AI_CHAT_VIEW_TYPE,
			(leaf) => new AIHelperChatView(leaf, this.settings)
		);

		// Add a command to summarize text
		this.addCommand({
			id: 'summarize-text',
			name: 'Summarize selected text or current note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				summarizeSelection(editor, this.app, this.settings);
			}
		});

		// Add a command to open the AI chat interface
		this.addCommand({
			id: 'open-ai-chat',
			name: 'Open AI Chat',
			callback: () => {
				openAIChat(this.app);
			}
		});

		// Add a command to rescan vault files
		this.addCommand({
			id: 'rescan-vault-files',
			name: 'Rescan vault for AI indexing',
			callback: () => {
				this.rescanVaultFiles();
			}
		});

		// Add a command to manually process pending file updates
		this.addCommand({
			id: 'process-pending-updates',
			name: 'Process pending file updates',
			callback: () => {
				logDebug(this.settings, 'Manually processing pending file updates');
				this.processPendingFileUpdates.flush();
				new Notice('Processing pending file updates');
			}
		});

		// Add a ribbon icon for AI chat
		this.addRibbonIcon('message-square', 'Open AI Chat', (evt: MouseEvent) => {
			openAIChat(this.app);
		});

		// Add settings tab
		this.addSettingTab(new AIHelperSettingTab(this.app, this));

		// Register context menu event
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle('Summarize text')
						.setIcon('file-text')
						.onClick(() => {
							summarizeSelection(editor, this.app, this.settings);
						});
				});
			})
		);

		// Register for vault changes to ensure we catch all files
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					logDebug(this.settings, `New markdown file created: ${file.path}. Will add to index.`);
					this.reindexFile(file);
				}
			})
		);

		// Register for file deletion events to remove embeddings
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					logDebug(this.settings, `Markdown file deleted: ${file.path}. Removing from index.`);
					this.removeFileFromIndex(file.path);
					this.modifiedFiles.delete(file.path); // Clean up from modified files tracking
				}
			})
		);

		// Also register for file rename events
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					logDebug(this.settings, `Markdown file renamed from ${oldPath} to ${file.path}. Updating index.`);
					this.removeFileFromIndex(oldPath);
					this.reindexFile(file);

					// Update tracking if the file was in the modified list
					if (this.modifiedFiles.has(oldPath)) {
						const timestamp = this.modifiedFiles.get(oldPath);
						this.modifiedFiles.delete(oldPath);
						this.modifiedFiles.set(file.path, timestamp || Date.now());
					}
				}
			})
		);

		// Register for file modification events
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					// Track the modification time
					const now = Date.now();
					logDebug(this.settings, `File modified: ${file.path} at ${new Date(now).toLocaleTimeString()}`);

					// Check if this is a new modification or an update to an existing one
					const wasAlreadyModified = this.modifiedFiles.has(file.path);
					this.modifiedFiles.set(file.path, now);

					if (wasAlreadyModified) {
						logDebug(this.settings, `Updated timestamp for already modified file: ${file.path}`);
					} else {
						logDebug(this.settings, `Added new file to modification queue: ${file.path}`);
					}

					// Trigger the debounced update function
					this.processPendingFileUpdates();
					logDebug(this.settings, `Debounced update triggered, will process after ${this.settings.fileUpdateFrequency/2} seconds of inactivity`);
				}
			})
		);

		// Set up periodic checking for modified files
		// The interval will be twice the user-defined file update frequency
		const checkInterval = this.getPeriodicCheckInterval();
		logDebug(this.settings, `Setting up periodic check interval: ${checkInterval}ms`);

		this.registerInterval(
			window.setInterval(() => {
				// This ensures any files that weren't updated due to debounce are eventually processed
				logDebug(this.settings, `Periodic check running at ${new Date().toLocaleTimeString()}`);

				// Skip processing during initial indexing
				if (this.isInitialIndexingInProgress()) {
					logDebug(this.settings, 'Initial indexing still in progress, skipping periodic check');
					return;
				}

				if (this.modifiedFiles.size > 0) {
					logDebug(this.settings, `Found ${this.modifiedFiles.size} modified files in queue, processing now`);
					this.processPendingFileUpdates.flush();
				} else {
					logDebug(this.settings, 'No modified files in queue');
				}
			}, checkInterval)
		);

		// Wait a bit longer for Obsidian to fully load the vault before starting the embedding process
		// This avoids issues where the vault isn't fully loaded when we try to access files
		setTimeout(() => {
			// Start embedding initialization directly without creating a view
			// This happens asynchronously and won't block the UI
			logDebug(this.settings, "Starting delayed embedding initialization...");
			initializeEmbeddingSystem(this.settings, this.app);
		}, 2000); // 2 second delay

		// Listen for completion of indexing to process any pending updates
		this.indexingCompleteListener = (e: CustomEvent) => {
			logDebug(this.settings, "Received indexing complete event, checking for modified files");

			// Check if this is the first indexing after startup
			const isInitialIndexing = e.detail?.isInitialIndexing === true;

			// For initial indexing, clear all modified files to prevent reindexing what was just indexed
			if (isInitialIndexing) {
				logDebug(this.settings, `This is the initial indexing. Clearing ${this.modifiedFiles.size} modified files to prevent duplicate indexing.`);
				this.modifiedFiles.clear(); // Clear all modified files
			}
			// Only process files if this is not the initial indexing
			else if (this.modifiedFiles.size > 0) {
				logDebug(this.settings, `Processing ${this.modifiedFiles.size} files that were explicitly modified during initialization`);
				// Process only files that are actually in the queue, don't trigger a full reindex
				this.processPendingFileUpdates.flush();
			} else {
				logDebug(this.settings, "No files were modified during initialization, nothing to process");
			}
		};
		document.addEventListener('ai-helper-indexing-complete', this.indexingCompleteListener);

		// If the plugin was just activated and settings allow, open the AI chat view
		if (this.settings.openChatOnStartup) {
			// Small delay to ensure other plugins have time to initialize
			setTimeout(() => {
				openAIChat(this.app);
			}, 2500);
		}
	}

	onunload() {
		// Process any pending file updates before unloading
		this.processPendingFileUpdates.flush();

		// Clean up event listener
		if (this.indexingCompleteListener) {
			document.removeEventListener('ai-helper-indexing-complete', this.indexingCompleteListener);
		}

		// Detach any active views when the plugin is unloaded
		this.app.workspace.detachLeavesOfType(AI_CHAT_VIEW_TYPE);
	}

	async loadSettings() {
		const savedData = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			chatSettings: {
				...DEFAULT_SETTINGS.chatSettings,
				...(savedData?.chatSettings || {})
			},
			embeddingSettings: {
				...DEFAULT_SETTINGS.embeddingSettings,
				...(savedData?.embeddingSettings || {})
			},
			summarizeSettings: {
				...DEFAULT_SETTINGS.summarizeSettings,
				...(savedData?.summarizeSettings || {})
			},
			openChatOnStartup: savedData?.openChatOnStartup ?? DEFAULT_SETTINGS.openChatOnStartup,
			debugMode: savedData?.debugMode ?? DEFAULT_SETTINGS.debugMode,
			fileUpdateFrequency: savedData?.fileUpdateFrequency ?? DEFAULT_SETTINGS.fileUpdateFrequency
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);

		// Update debounce settings when settings are saved
		this.updateDebounceSettings();
	}

	// Helper method to reindex a file
	private async reindexFile(file: TFile) {
		if (!globalEmbeddingStore) {
			logDebug(this.settings, `Embedding store not yet initialized, queueing ${file.path} for later reindexing`);
			// Queue it for later when embedding store is ready
			this.modifiedFiles.set(file.path, Date.now());
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
	private rescanVaultFiles() {
		new Notice('Rescanning vault files for AI indexing...');

		if (!globalEmbeddingStore) {
			// Initialize the embedding system if not done yet
			initializeEmbeddingSystem(this.settings, this.app);
			new Notice('Embedding system initializing. Please try again in a few seconds.');
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
	private async removeFileFromIndex(filePath: string) {
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
	private updateDebounceSettings() {
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
	private isInitialIndexingInProgress(): boolean {
		return !isGloballyInitialized && globalInitializationPromise !== null;
	}

	// Calculate the check interval based on user settings with sensible defaults
	private getPeriodicCheckInterval(): number {
		// The interval will be twice the user-defined file update frequency
		return Math.max(30000, this.settings.fileUpdateFrequency * 2000); // At least 30 seconds
	}
}