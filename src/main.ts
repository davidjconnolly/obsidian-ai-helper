import { Plugin, Notice, MarkdownView, Menu, Editor, App } from 'obsidian';
import { AIHelperSettings, AIHelperSettingTab, loadSettings, saveSettings } from './settings';
import { summarizeSelection } from './summarize';

enum ModalAction {
  inline,
  summarize,
  copy
}

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

  getEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.editor : null;
  }

  onunload() {
    console.log('AIHelper plugin unloaded');
  }
}
