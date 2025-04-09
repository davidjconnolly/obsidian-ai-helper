import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
import AIHelperPlugin from './main';

export interface EmbeddingSettings {
  provider: 'openai' | 'local';
  openaiModel: string;
  openaiApiUrl?: string;
  localApiUrl?: string;
  localModel?: string;
  chunkSize: number;
  chunkOverlap: number;
  dimensions: number;
}

export interface ChatSettings {
  provider: 'openai' | 'local';
  openaiModel: string;
  openaiApiUrl?: string;
  openaiApiKey?: string;
  localApiUrl?: string;
  localModel?: string;
  maxTokens: number;
  temperature: number;
  maxNotesToSearch: number;
  displayWelcomeMessage: boolean;
  includeTags: boolean;
  includeTaskItems: boolean;
}

export interface SummarizeSettings {
  provider: 'openai' | 'local';
  openaiModel: string;
  openaiApiUrl?: string;
  localApiUrl?: string;
  localModel?: string;
  maxTokens: number;
  temperature: number;
}

export interface Settings {
  summarizeSettings: SummarizeSettings;
  chatSettings: ChatSettings;
  embeddingSettings: EmbeddingSettings;
  openChatOnStartup: boolean;
  debugMode: boolean;
  fileUpdateFrequency: number; // Time in seconds before reindexing modified files
}

export const DEFAULT_SETTINGS: Settings = {
  chatSettings: {
    provider: 'openai',
    openaiModel: 'gpt-3.5-turbo',
    openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    openaiApiKey: '',
    localApiUrl: 'http://localhost:1234/v1/chat/completions',
    localModel: 'mistral-7b-instruct',
    maxTokens: 500,
    temperature: 0.7,
    maxNotesToSearch: 20,
    displayWelcomeMessage: true,
    includeTags: true,
    includeTaskItems: true,
  },
  embeddingSettings: {
    provider: 'openai',
    openaiModel: 'text-embedding-3-small',
    openaiApiUrl: 'https://api.openai.com/v1/embeddings',
    localApiUrl: 'http://localhost:1234/v1/embeddings',
    localModel: 'all-MiniLM-L6-v2',
    chunkSize: 1000,
    chunkOverlap: 200,
    dimensions: 384
  },
  openChatOnStartup: false,
  debugMode: true,
  fileUpdateFrequency: 30, // Default to 30 seconds
  summarizeSettings: {
    provider: 'openai',
    openaiModel: 'gpt-3.5-turbo',
    openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    localApiUrl: 'http://localhost:1234/v1/chat/completions',
    localModel: 'mistral-7b-instruct',
    maxTokens: 500,
    temperature: 0.7
  },
};

export class AIHelperSettingTab extends PluginSettingTab {
  plugin: AIHelperPlugin;

  constructor(app: App, plugin: AIHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'AI Helper Settings' });

    // Chat Settings
    containerEl.createEl('h3', { text: 'Chat Settings' });

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Choose the provider for chat')
      .addDropdown(dropdown => {
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('local', 'Local')
          .setValue(this.plugin.settings.chatSettings.provider)
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.provider = value as 'openai' | 'local';
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.chatSettings.provider === 'openai') {
      new Setting(containerEl)
        .setName('OpenAI API Key')
        .setDesc('Your OpenAI API key')
        .addText(text => text
          .setPlaceholder('Enter your OpenAI API key')
          .setValue(this.plugin.settings.chatSettings.openaiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.openaiApiKey = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI Model')
        .setDesc('The model to use for chat')
        .addText(text => text
          .setPlaceholder('Enter model name')
          .setValue(this.plugin.settings.chatSettings.openaiModel)
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.openaiModel = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI API URL')
        .setDesc('The URL for the OpenAI API')
        .addText(text => text
          .setPlaceholder('Enter API URL')
          .setValue(this.plugin.settings.chatSettings.openaiApiUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.openaiApiUrl = value;
            await this.plugin.saveSettings();
          }));
    } else {
      new Setting(containerEl)
        .setName('Local API URL')
        .setDesc('The URL for the local API')
        .addText(text => text
          .setPlaceholder('Enter API URL')
          .setValue(this.plugin.settings.chatSettings.localApiUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.localApiUrl = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Local Model')
        .setDesc('The model to use for chat')
        .addText(text => text
          .setPlaceholder('Enter model name')
          .setValue(this.plugin.settings.chatSettings.localModel || '')
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.localModel = value;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName('Max Tokens')
      .setDesc('Maximum number of tokens to generate')
      .addText(text => text
        .setPlaceholder('Enter max tokens')
        .setValue(this.plugin.settings.chatSettings.maxTokens.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.maxTokens = parseInt(value) || 500;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Temperature for response generation')
      .addText(text => text
        .setPlaceholder('Enter temperature')
        .setValue(this.plugin.settings.chatSettings.temperature.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.temperature = parseFloat(value) || 0.7;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max Notes to Search')
      .setDesc('Maximum number of notes to search for context')
      .addText(text => text
        .setPlaceholder('Enter max notes')
        .setValue(this.plugin.settings.chatSettings.maxNotesToSearch.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.maxNotesToSearch = parseInt(value) || 20;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Display Welcome Message')
      .setDesc('Show a welcome message when opening the chat or after reset')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.chatSettings.displayWelcomeMessage)
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.displayWelcomeMessage = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include Tags')
      .setDesc('Include tags in note context')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.chatSettings.includeTags)
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.includeTags = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include Task Items')
      .setDesc('Include task items in note context')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.chatSettings.includeTaskItems)
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.includeTaskItems = value;
          await this.plugin.saveSettings();
        }));

    // Embedding Settings
    containerEl.createEl('h3', { text: 'Embedding Settings' });

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Choose the provider for embeddings')
      .addDropdown(dropdown => {
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('local', 'Local')
          .setValue(this.plugin.settings.embeddingSettings.provider)
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.provider = value as 'openai' | 'local';
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.embeddingSettings.provider === 'openai') {
      new Setting(containerEl)
        .setName('OpenAI Model')
        .setDesc('The model to use for embeddings')
        .addText(text => text
          .setPlaceholder('Enter model name')
          .setValue(this.plugin.settings.embeddingSettings.openaiModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.openaiModel = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI API URL')
        .setDesc('The URL for the OpenAI API')
        .addText(text => text
          .setPlaceholder('Enter API URL')
          .setValue(this.plugin.settings.embeddingSettings.openaiApiUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.openaiApiUrl = value;
            await this.plugin.saveSettings();
          }));
    } else {
      new Setting(containerEl)
        .setName('Local API URL')
        .setDesc('The URL for the local API')
        .addText(text => text
          .setPlaceholder('Enter API URL')
          .setValue(this.plugin.settings.embeddingSettings.localApiUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.localApiUrl = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Local Model')
        .setDesc('The model to use for embeddings')
        .addText(text => text
          .setPlaceholder('Enter model name')
          .setValue(this.plugin.settings.embeddingSettings.localModel || '')
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.localModel = value;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName('Chunk Size')
      .setDesc('Size of text chunks for embedding')
      .addText(text => text
        .setPlaceholder('Enter chunk size')
        .setValue(this.plugin.settings.embeddingSettings.chunkSize.toString())
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.chunkSize = parseInt(value) || 1000;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Chunk Overlap')
      .setDesc('Overlap between text chunks')
      .addText(text => text
        .setPlaceholder('Enter chunk overlap')
        .setValue(this.plugin.settings.embeddingSettings.chunkOverlap.toString())
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.chunkOverlap = parseInt(value) || 200;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Dimensions')
      .setDesc('Number of dimensions for embeddings')
      .addText(text => text
        .setPlaceholder('Enter dimensions')
        .setValue(this.plugin.settings.embeddingSettings.dimensions.toString())
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.dimensions = parseInt(value) || 384;
          await this.plugin.saveSettings();
        }));

    // Summarize Settings
    containerEl.createEl('h3', { text: 'Summarize Settings' });

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Choose the provider for summarization')
      .addDropdown(dropdown => {
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('local', 'Local')
          .setValue(this.plugin.settings.summarizeSettings.provider)
          .onChange(async (value) => {
            this.plugin.settings.summarizeSettings.provider = value as 'openai' | 'local';
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.summarizeSettings.provider === 'openai') {
      new Setting(containerEl)
        .setName('OpenAI Model')
        .setDesc('The model to use for summarization')
        .addText(text => text
          .setPlaceholder('Enter model name')
          .setValue(this.plugin.settings.summarizeSettings.openaiModel)
          .onChange(async (value) => {
            this.plugin.settings.summarizeSettings.openaiModel = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI API URL')
        .setDesc('The URL for the OpenAI API')
        .addText(text => text
          .setPlaceholder('Enter API URL')
          .setValue(this.plugin.settings.summarizeSettings.openaiApiUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.summarizeSettings.openaiApiUrl = value;
            await this.plugin.saveSettings();
          }));
    } else {
      new Setting(containerEl)
        .setName('Local API URL')
        .setDesc('The URL for the local API')
        .addText(text => text
          .setPlaceholder('Enter API URL')
          .setValue(this.plugin.settings.summarizeSettings.localApiUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.summarizeSettings.localApiUrl = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Local Model')
        .setDesc('The model to use for summarization')
        .addText(text => text
          .setPlaceholder('Enter model name')
          .setValue(this.plugin.settings.summarizeSettings.localModel || '')
          .onChange(async (value) => {
            this.plugin.settings.summarizeSettings.localModel = value;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName('Max Tokens')
      .setDesc('Maximum number of tokens to generate')
      .addText(text => text
        .setPlaceholder('Enter max tokens')
        .setValue(this.plugin.settings.summarizeSettings.maxTokens.toString())
        .onChange(async (value) => {
          this.plugin.settings.summarizeSettings.maxTokens = parseInt(value) || 500;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Temperature for response generation')
      .addText(text => text
        .setPlaceholder('Enter temperature')
        .setValue(this.plugin.settings.summarizeSettings.temperature.toString())
        .onChange(async (value) => {
          this.plugin.settings.summarizeSettings.temperature = parseFloat(value) || 0.7;
          await this.plugin.saveSettings();
        }));

    // General Settings
    containerEl.createEl('h3', { text: 'General Settings' });

    new Setting(containerEl)
      .setName('Open Chat on Startup')
      .setDesc('Automatically open chat when Obsidian starts')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.openChatOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.openChatOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Debug Mode')
      .setDesc('Enable debug logging')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('File Update Frequency')
      .setDesc('Time in seconds before reindexing modified files')
      .addText(text => text
        .setPlaceholder('Enter update frequency')
        .setValue(this.plugin.settings.fileUpdateFrequency.toString())
        .onChange(async (value) => {
          this.plugin.settings.fileUpdateFrequency = parseInt(value) || 30;
          await this.plugin.saveSettings();
        }));
  }
}
