import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { AI_CHAT_VIEW_TYPE, AIChatView, openAIChat } from './chat';
import { DEFAULT_SETTINGS, Settings, SettingsTab } from './settings';
import { summarizeSelection } from './summarize';

export default class AIHelperPlugin extends Plugin {
	settings: Settings;

	async onload() {
		await this.loadSettings();

		// Register the AI Chat view
		this.registerView(
			AI_CHAT_VIEW_TYPE,
			(leaf) => new AIChatView(leaf, this.settings)
		);

		// Add a command to summarize text
		this.addCommand({
			id: 'summarize-text',
			name: 'Summarize selected text or current note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const text = editor.getSelection() || editor.getValue();
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

		// Add a ribbon icon for AI chat
		this.addRibbonIcon('message-square', 'Open AI Chat', (evt: MouseEvent) => {
			openAIChat(this.app);
		});

		// Add settings tab
		this.addSettingTab(new SettingsTab(this.app, this));

		// Register context menu event
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle('Summarize text')
						.setIcon('file-text')
						.onClick(() => {
							const text = editor.getSelection() || editor.getValue();
							summarizeSelection(editor, this.app, this.settings);
						});
				});
			})
		);

		// If the plugin was just activated, open the AI chat view
		// Do this with a small delay to ensure other plugins have time to initialize
		setTimeout(() => {
			if (this.settings.openChatOnStartup) {
				openAIChat(this.app);
			}
		}, 500);
	}

	onunload() {
		// Detach any active views when the plugin is unloaded
		this.app.workspace.detachLeavesOfType(AI_CHAT_VIEW_TYPE);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
