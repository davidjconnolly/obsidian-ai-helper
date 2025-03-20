import { Plugin, Menu, Editor, MarkdownView } from 'obsidian';
import { AIHelperSettings, AIHelperSettingTab, loadSettings, saveSettings } from './settings';
import { summarizeSelection } from './summarize';

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
      id: 'open-chatbot-modal',
      name: 'Summarize selected text',
      editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
        if (!checking) {
          summarizeSelection(editor, this.app, this.settings);
        }
        return true;
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
