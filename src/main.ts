import { Plugin, Menu, Editor, MarkdownView } from 'obsidian';
import { AIHelperSettings, AIHelperSettingTab, loadSettings, saveSettings } from './settings';
import { summarizeSelection } from './summarize';
import { openChatModal } from './chat';
import { debugLog } from './utils';

export default class AIHelperPlugin extends Plugin {
  settings: AIHelperSettings;

  async onload() {
    this.settings = await loadSettings(this);
    this.addSettingTab(new AIHelperSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
        menu.addItem((item) => {
          item.setTitle('Summarize selected text')
            .setIcon('pencil')
            .onClick(() => {
              summarizeSelection(editor, this.app, this.settings);
            });
        });
      })
    );

    this.addCommand({
      id: 'open-summarize-modal',
      name: 'Summarize selected text',
      editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
        if (!checking) {
          summarizeSelection(editor, this.app, this.settings);
        }
        return true;
      }
    });

    // Add new command for chat interface
    this.addCommand({
      id: 'open-chat-modal',
      name: 'Open AI chat',
      callback: () => {
        openChatModal(this.app, this.settings);
      }
    });

    // Add ribbon icon for chat
    this.addRibbonIcon('message-square', 'AI chat', () => {
      openChatModal(this.app, this.settings);
    });
  }

  async saveSettings() {
    await saveSettings(this, this.settings);
  }

  onunload() {
    debugLog(this.settings, 'AIHelper plugin unloaded');
  }
}
