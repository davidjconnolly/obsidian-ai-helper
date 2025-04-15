import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
import AIHelperPlugin from './main';

export interface EmbeddingSettings {
  provider: 'openai' | 'local';
  openaiModel: string;
  openaiApiUrl?: string;
  openaiApiKey?: string;
  localApiUrl?: string;
  localModel?: string;
  chunkSize: number;
  chunkOverlap: number;
  dimensions: number;
  updateMode: 'onLoad' | 'onUpdate' | 'none';
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
  similarity: number;
  maxContextLength: number;
  titleMatchBoost: number;
  useAgenticContextRefinement: boolean;
}

export interface SummarizeSettings {
  provider: 'openai' | 'local';
  openaiModel: string;
  openaiApiUrl?: string;
  openaiApiKey?: string;
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
    provider: 'local',
    openaiModel: 'gpt-3.5-turbo',
    openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    openaiApiKey: '',
    localApiUrl: 'http://localhost:1234/v1/chat/completions',
    localModel: 'qwen2-7b-instruct',
    maxTokens: 500,
    temperature: 0.7,
    maxNotesToSearch: 20,
    displayWelcomeMessage: true,
    similarity: 0.5,
    maxContextLength: 4000,
    titleMatchBoost: 0.5,
    useAgenticContextRefinement: true,
  },
  embeddingSettings: {
    provider: 'local',
    openaiModel: 'text-embedding-3-small',
    openaiApiUrl: 'https://api.openai.com/v1/embeddings',
    openaiApiKey: '',
    localApiUrl: 'http://localhost:1234/v1/embeddings',
    localModel: 'text-embedding-all-minilm-l6-v2-embedding',
    chunkSize: 1000,
    chunkOverlap: 200,
    dimensions: 384,
    updateMode: 'none'
  },
  openChatOnStartup: false,
  debugMode: false,
  fileUpdateFrequency: 30, // Default to 30 seconds
  summarizeSettings: {
    provider: 'local',
    openaiModel: 'gpt-3.5-turbo',
    openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    openaiApiKey: '',
    localApiUrl: 'http://localhost:1234/v1/chat/completions',
    localModel: 'qwen2-7b-instruct',
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

    // Chat Settings
    new Setting(containerEl).setName('Chat').setHeading();

    new Setting(containerEl)
      .setName('AI Provider')
      .setDesc('Choose the AI provider for chat')
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
        .setName('OpenAI API key')
        .setDesc('Your OpenAI API key')
        .addText(text => text
          .setPlaceholder('Enter your OpenAI API key')
          .setValue(this.plugin.settings.chatSettings.openaiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.chatSettings.openaiApiKey = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI model')
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
        .setName('Local model')
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
      .setName('Max context length')
      .setDesc('Maximum number of characters to include in the context. This will impact the number of notes that can be searched for context.')
      .addText(text => text
        .setPlaceholder('Enter max context length')
        .setValue(this.plugin.settings.chatSettings.maxContextLength.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.maxContextLength = parseInt(value) || DEFAULT_SETTINGS.chatSettings.maxContextLength;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max tokens')
      .setDesc('Maximum number of tokens to generate')
      .addText(text => text
        .setPlaceholder('Enter max tokens')
        .setValue(this.plugin.settings.chatSettings.maxTokens.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.maxTokens = parseInt(value) || DEFAULT_SETTINGS.chatSettings.maxTokens;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Temperature for response generation')
      .addText(text => text
        .setPlaceholder('Enter temperature')
        .setValue(this.plugin.settings.chatSettings.temperature.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.temperature = parseFloat(value) || DEFAULT_SETTINGS.chatSettings.temperature;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max notes to search')
      .setDesc('Maximum number of notes to search for context')
      .addText(text => text
        .setPlaceholder('Enter max notes')
        .setValue(this.plugin.settings.chatSettings.maxNotesToSearch.toString())
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.maxNotesToSearch = parseInt(value) || DEFAULT_SETTINGS.chatSettings.maxNotesToSearch;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Similarity threshold')
      .setDesc('Threshold for semantic search similarity (0.0 to 1.0). Lower values return more results but may be less relevant.')
      .addText(text => text
        .setPlaceholder('Enter similarity threshold')
        .setValue(this.plugin.settings.chatSettings.similarity.toString())
        .onChange(async (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            this.plugin.settings.chatSettings.similarity = parsed || DEFAULT_SETTINGS.chatSettings.similarity;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Title match boost')
      .setDesc('Boost for title matches')
      .addText(text => text
        .setPlaceholder('Enter title match boost (0.0 to 1.0)')
        .setValue(this.plugin.settings.chatSettings.titleMatchBoost.toString())
        .onChange(async (value) => {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
            this.plugin.settings.chatSettings.titleMatchBoost = parsed || DEFAULT_SETTINGS.chatSettings.titleMatchBoost;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Display welcome message')
      .setDesc('Show a welcome message when opening the chat or after reset')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.chatSettings.displayWelcomeMessage)
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.displayWelcomeMessage = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Use agentic context refinement')
      .setDesc('Enable AI to intelligently search for more information when needed. This helps provide more complete answers by letting the AI perform follow-up searches automatically. (Recommended for best results)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.chatSettings.useAgenticContextRefinement)
        .onChange(async (value) => {
          this.plugin.settings.chatSettings.useAgenticContextRefinement = value;
          await this.plugin.saveSettings();
        }));

    // Embedding Settings
    new Setting(containerEl).setName('Embeddings').setHeading();

    new Setting(containerEl)
      .setName('AI Provider')
      .setDesc('Choose the AI provider for embeddings')
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
        .setName('OpenAI API key')
        .setDesc('Your OpenAI API key')
        .addText(text => text
          .setPlaceholder('Enter your OpenAI API key')
          .setValue(this.plugin.settings.embeddingSettings.openaiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.openaiApiKey = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI model')
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
        .setName('Local model')
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
      .setName('Chunk size')
      .setDesc('Size of text chunks for embedding')
      .addText(text => text
        .setPlaceholder('Enter chunk size')
        .setValue(this.plugin.settings.embeddingSettings.chunkSize.toString())
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.chunkSize = parseInt(value) || DEFAULT_SETTINGS.embeddingSettings.chunkSize;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Chunk overlap')
      .setDesc('Overlap between text chunks')
      .addText(text => text
        .setPlaceholder('Enter chunk overlap')
        .setValue(this.plugin.settings.embeddingSettings.chunkOverlap.toString())
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.chunkOverlap = parseInt(value) || DEFAULT_SETTINGS.embeddingSettings.chunkOverlap;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Dimensions')
      .setDesc('Number of dimensions for embeddings')
      .addText(text => text
        .setPlaceholder('Enter dimensions')
        .setValue(this.plugin.settings.embeddingSettings.dimensions.toString())
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.dimensions = parseInt(value) || DEFAULT_SETTINGS.embeddingSettings.dimensions;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Embedding index update mode')
      .setDesc('When should the embedding index be updated? *Requires application restart to take effect*')
      .addDropdown(dropdown => dropdown
        .addOption('onLoad', 'On Load')
        .addOption('onUpdate', 'On Update')
        .addOption('none', 'Manual Only')
        .setValue(this.plugin.settings.embeddingSettings.updateMode)
        .onChange(async (value) => {
          this.plugin.settings.embeddingSettings.updateMode = value as 'onLoad' | 'onUpdate' | 'none';
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('Sync Now')
        .setCta()
        .onClick(() => {
          this.plugin.rescanVaultFiles();
        }));

    new Setting(containerEl)
      .setName('File update frequency')
      .setDesc('Time in seconds before reindexing modified files')
      .addText(text => text
        .setPlaceholder('Enter update frequency')
        .setValue(this.plugin.settings.fileUpdateFrequency.toString())
        .onChange(async (value) => {
          this.plugin.settings.fileUpdateFrequency = parseInt(value) || DEFAULT_SETTINGS.fileUpdateFrequency;
          await this.plugin.saveSettings();
        }));

    // Summarize Settings
    new Setting(containerEl).setName('Summarize').setHeading();

    new Setting(containerEl)
      .setName('AI Provider')
      .setDesc('Choose the AI provider for summarization')
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
        .setName('OpenAI API key')
        .setDesc('Your OpenAI API key')
        .addText(text => text
          .setPlaceholder('Enter your OpenAI API key')
          .setValue(this.plugin.settings.summarizeSettings.openaiApiKey || '')
          .onChange(async (value) => {
            this.plugin.settings.summarizeSettings.openaiApiKey = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('OpenAI model')
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
        .setName('Local model')
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
      .setName('Max tokens')
      .setDesc('Maximum number of tokens to generate')
      .addText(text => text
        .setPlaceholder('Enter max tokens')
        .setValue(this.plugin.settings.summarizeSettings.maxTokens.toString())
        .onChange(async (value) => {
          this.plugin.settings.summarizeSettings.maxTokens = parseInt(value) || DEFAULT_SETTINGS.summarizeSettings.maxTokens;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Temperature for response generation')
      .addText(text => text
        .setPlaceholder('Enter temperature')
        .setValue(this.plugin.settings.summarizeSettings.temperature.toString())
        .onChange(async (value) => {
          this.plugin.settings.summarizeSettings.temperature = parseFloat(value) || DEFAULT_SETTINGS.summarizeSettings.temperature;
          await this.plugin.saveSettings();
        }));

    // General Settings
    new Setting(containerEl).setName('General').setHeading();

    new Setting(containerEl)
      .setName('Open  chat on startup')
      .setDesc('Automatically open chat when Obsidian starts')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.openChatOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.openChatOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Enable debug logging')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));
  }
}
