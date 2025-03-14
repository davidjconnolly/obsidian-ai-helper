import { Plugin, Menu, Editor } from 'obsidian';
import { AIHelperSettings, AIHelperSettingTab, loadSettings, saveSettings } from './settings';
import { summarizeSelection } from './summarize';
import { NotesChatbot, ChatbotModal } from './chatbot';

export default class AIHelperPlugin extends Plugin {
  settings: AIHelperSettings;
  chatbot: NotesChatbot;

  async onload() {
    this.settings = await loadSettings(this);
    this.addSettingTab(new AIHelperSettingTab(this.app, this));

    this.chatbot = new NotesChatbot(this.app, this.settings);
    this.app.workspace.onLayoutReady(async () => {
      await this.chatbot.initialize();
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
        menu.addItem((item) => {
          item.setTitle('Summarize Selected Text')
            .setIcon('pencil')
            .onClick(() => {
              summarizeSelection(editor, this.app, this.settings);
            });
        });
      })
    );

    // Add command to open the modal
    this.addCommand({
      id: 'open-chatbot-modal',
      name: 'Chat with Notes',
      callback: () => {
        new ChatbotModal(this.app, this.chatbot).open();
      }
    });

  }

  async saveSettings() {
    await saveSettings(this, this.settings);
  }

  onunload() {
    console.log('AIHelper plugin unloaded');
  }
}
