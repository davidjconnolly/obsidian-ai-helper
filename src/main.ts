import { Editor, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { AI_CHAT_VIEW_TYPE, AIHelperChatView, openAIChat } from './chat';
import { DEFAULT_SETTINGS, Settings, AIHelperSettingTab } from './settings';
import { summarizeSelection } from './summarize';
import { logDebug } from './utils';
import { isGloballyInitialized, globalInitializationPromise, initializeEmbeddingSystem } from './chat/embeddingStore';
import { FileUpdateManager } from './fileUpdateManager';

export default class AIHelperPlugin extends Plugin {
	settings: Settings;
	private indexingCompleteListener: (e: CustomEvent) => void;
	private fileUpdateManager: FileUpdateManager;
	private modifiedFiles: Map<string, number>;

	async onload() {
		await this.loadSettings();
		this.fileUpdateManager = new FileUpdateManager(this.settings, this.app);
		this.modifiedFiles = this.fileUpdateManager.modifiedFiles;
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
				this.fileUpdateManager.rescanVaultFiles();
			}
		});

		// Add a command to manually process pending file updates
		this.addCommand({
			id: 'process-pending-updates',
			name: 'Process pending file updates',
			callback: () => {
				logDebug(this.settings, 'Manually processing pending file updates');
				this.fileUpdateManager.processPendingFileUpdates.flush();
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
					this.fileUpdateManager.reindexFile(file);
				}
			})
		);

		// Register for file deletion events to remove embeddings
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					logDebug(this.settings, `Markdown file deleted: ${file.path}. Removing from index.`);
					this.fileUpdateManager.removeFileFromIndex(file.path);
					this.modifiedFiles.delete(file.path); // Clean up from modified files tracking
				}
			})
		);

		// Also register for file rename events
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					logDebug(this.settings, `Markdown file renamed from ${oldPath} to ${file.path}. Updating index.`);
					this.fileUpdateManager.removeFileFromIndex(oldPath);
					this.fileUpdateManager.reindexFile(file);

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
					this.fileUpdateManager.processPendingFileUpdates();
					logDebug(this.settings, `Debounced update triggered, will process after ${this.settings.fileUpdateFrequency/2} seconds of inactivity`);
				}
			})
		);

		// Set up periodic checking for modified files
		// The interval will be twice the user-defined file update frequency
		const checkInterval = this.fileUpdateManager.getPeriodicCheckInterval();
		logDebug(this.settings, `Setting up periodic check interval: ${checkInterval}ms`);

		this.registerInterval(
			window.setInterval(() => {
				// This ensures any files that weren't updated due to debounce are eventually processed
				logDebug(this.settings, `Periodic check running at ${new Date().toLocaleTimeString()}`);

				// Skip processing during initial indexing
				if (this.fileUpdateManager.isInitialIndexingInProgress()) {
					logDebug(this.settings, 'Initial indexing still in progress, skipping periodic check');
					return;
				}

				if (this.modifiedFiles.size > 0) {
					logDebug(this.settings, `Found ${this.modifiedFiles.size} modified files in queue, processing now`);
					this.fileUpdateManager.processPendingFileUpdates.flush();
				} else {
					logDebug(this.settings, 'No modified files in queue');
				}
			}, checkInterval)
		);

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
				this.fileUpdateManager.processPendingFileUpdates.flush();
			} else {
				logDebug(this.settings, "No files were modified during initialization, nothing to process");
			}
		};
		document.addEventListener('ai-helper-indexing-complete', this.indexingCompleteListener);

		// Wait for workspace layout to be ready
		this.app.workspace.onLayoutReady(() => {
			// If not initialized, start initialization
			if (!isGloballyInitialized && !globalInitializationPromise) {
				initializeEmbeddingSystem(this.settings, this.app);
			}

			// If the plugin was just activated and settings allow, open the AI chat view
			if (this.settings.openChatOnStartup) {
					openAIChat(this.app);
			}
		});
	}

	onunload() {
		// Process any pending file updates before unloading
		this.fileUpdateManager.processPendingFileUpdates.flush();

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
		this.fileUpdateManager.updateDebounceSettings();
	}
}
