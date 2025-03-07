import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
import AIHelperPlugin from './main';

export interface AIHelperSettings {
  apiChoice: 'local' | 'openai';
  localLLM: {
    url: string;
    model: string;
  };
  openAI: {
    apiKey: string;
    model: string;
  };
}

const DEFAULT_SETTINGS: AIHelperSettings = {
  apiChoice: 'local',
  localLLM: {
    url: 'http://127.0.0.1:1234/v1/chat/completions',
    model: '',
  },
  openAI: {
    apiKey: '',
    model: 'gpt-3.5-turbo',
  },
};

export async function loadSettings(plugin: Plugin): Promise<AIHelperSettings> {
  return Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
}

export async function saveSettings(plugin: Plugin, settings: AIHelperSettings): Promise<void> {
  await plugin.saveData(settings);
}

export class AIHelperSettingTab extends PluginSettingTab {
  plugin: AIHelperPlugin;

  constructor(app: App, plugin: AIHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Summary API')
      .setDesc('Choose which API to use for summarization.')
      .addDropdown(dropdown =>
        dropdown.addOptions({ local: 'Local LLM', openai: 'OpenAI' })
          .setValue(this.plugin.settings.apiChoice)
          .onChange(async (value) => {
            this.plugin.settings.apiChoice = value as 'local' | 'openai';
            await this.plugin.saveSettings();
          })
      );


    // OpenAI Settings Section
    new Setting(containerEl).setName('OpenAI').setHeading();
    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Enter your OpenAI API key if using OpenAI.')
      .addText(text =>
        text.setPlaceholder('sk-...')
          .setValue(this.plugin.settings.openAI.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAI.apiKey = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('OpenAI Model')
      .setDesc('Enter the model\'s API identifier for OpenAI.')
      .addText(text =>
        text.setPlaceholder('gpt-3.5-turbo')
          .setValue(this.plugin.settings.openAI.model)
          .onChange(async (value) => {
            this.plugin.settings.openAI.model = value;
            await this.plugin.saveSettings();
          })
      );

    // Local LLM Settings Section
    new Setting(containerEl).setName('Local LLM').setHeading();
    new Setting(containerEl)
      .setName('Local LLM API URL')
      .setDesc('Enter the API URL for your local LLM server.')
      .addText(text =>
        text.setPlaceholder('http://127.0.0.1:1234/v1/chat/completions')
          .setValue(this.plugin.settings.localLLM.url)
          .onChange(async (value) => {
            this.plugin.settings.localLLM.url = value;
            await this.plugin.saveSettings();
          })
      );
      new Setting(containerEl)
      .setName('Local LLM Model')
      .setDesc('Enter the model\'s API identifier for your local LLM server.')
      .addText(text =>
        text.setPlaceholder('Identifier')
          .setValue(this.plugin.settings.localLLM.model)
          .onChange(async (value) => {
            this.plugin.settings.localLLM.model = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
