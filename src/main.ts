import { Plugin, Menu, Editor } from 'obsidian';
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
          item.setTitle('Summarize Selected Text')
            .setIcon('pencil')
            .onClick(() => {
              summarizeSelection(editor, this.app, this.settings);
            });
        });
      })
    );
  }

  async saveSettings() {
    await saveSettings(this, this.settings);
  }

  onunload() {
    console.log('AIHelper plugin unloaded');
  }
}
