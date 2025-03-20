import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
import AIHelperPlugin from './main';

export interface AIHelperSettings {
  apiChoice: 'local' | 'openai';
  localLLM: {
    url: string;
    model: string;
  };
  openAI: {
    url: string;
    apiKey: string;
    model: string;
  };
  chatSettings: {
    maxNotesToSearch: number;
    contextWindowSize: number;
    displayWelcomeMessageOnStartup: boolean;
    includeTags: boolean;
    includeTaskItems: boolean;
  };
}

const DEFAULT_SETTINGS: AIHelperSettings = {
  apiChoice: 'local',
  localLLM: {
    url: 'http://127.0.0.1:1234/v1/chat/completions',
    model: '',
  },
  openAI: {
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-3.5-turbo',
  },
  chatSettings: {
    maxNotesToSearch: 20,
    contextWindowSize: 5,
    displayWelcomeMessageOnStartup: true,
    includeTags: true,
    includeTaskItems: true,
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
      .setName('OpenAI API URL')
      .setDesc('Enter the API URL for your OpenAI server.')
      .addText(text =>
        text.setPlaceholder('https://api.openai.com/v1/chat/completions')
          .setValue(this.plugin.settings.openAI.url)
          .onChange(async (value) => {
            this.plugin.settings.openAI.url = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName('OpenAI API key')
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
      .setName('OpenAI model')
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
      .setName('Local LLM model')
      .setDesc('Enter the model\'s API identifier for your local LLM server.')
      .addText(text =>
        text.setPlaceholder('Identifier')
          .setValue(this.plugin.settings.localLLM.model)
          .onChange(async (value) => {
            this.plugin.settings.localLLM.model = value;
            await this.plugin.saveSettings();
          })
      );

    // Chat Settings Section
    new Setting(containerEl).setName('Chat settings').setHeading();
    new Setting(containerEl)
      .setName('Max notes to search')
      .setDesc('Maximum number of notes to search when looking for context (higher numbers may slow down response time).')
      .addSlider(slider =>
        slider.setLimits(5, 50, 5)
          .setValue(this.plugin.settings.chatSettings.maxNotesToSearch)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.maxNotesToSearch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Context window size')
      .setDesc('Number of most relevant notes to include in context for answering questions.')
      .addSlider(slider =>
        slider.setLimits(1, 10, 1)
          .setValue(this.plugin.settings.chatSettings.contextWindowSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.contextWindowSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Display welcome message')
      .setDesc('Display a welcome message when opening the chat modal.')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.chatSettings.displayWelcomeMessageOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.displayWelcomeMessageOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Include tags')
      .setDesc('Include note tags in context for the AI to better understand categories and topics.')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.chatSettings.includeTags)
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.includeTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Include task items')
      .setDesc('Specifically search for and identify task items (- [ ]) in notes.')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.chatSettings.includeTaskItems)
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.includeTaskItems = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
