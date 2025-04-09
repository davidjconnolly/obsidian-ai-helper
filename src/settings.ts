import { Plugin, PluginSettingTab, App, Setting } from 'obsidian';
import AIHelperPlugin from './main';

export interface OpenAISettings {
  apiKey: string;
  modelName: string;
  apiUrl?: string;
}

export interface LocalLLMSettings {
  apiUrl: string;
  apiKey?: string;
  modelName: string;
  enabled: boolean;
}

export interface EmbeddingSettings {
  provider: 'openai' | 'local' | 'none';
  openaiModel: string;
  openaiApiUrl?: string;
  localApiUrl?: string;
  localModel?: string;
  chunkSize: number;
  chunkOverlap: number;
  dimensions: number;
}

export interface ChatSettings {
  maxNotesToSearch: number;
  contextWindowSize: number;
  displayWelcomeMessageOnStartup: boolean;
  includeTags: boolean;
  includeTaskItems: boolean;
}

export interface Settings {
  openAISettings: OpenAISettings;
  localLLMSettings: LocalLLMSettings;
  embeddingSettings: EmbeddingSettings;
  chatSettings: ChatSettings;
  openChatOnStartup: boolean;
  debugMode: boolean;
  apiChoice: 'local' | 'openai';
}

export const DEFAULT_SETTINGS: Settings = {
  apiChoice: 'local',
  openAISettings: {
    apiKey: '',
    modelName: 'gpt-3.5-turbo',
    apiUrl: 'https://api.openai.com/v1/chat/completions'
  },
  localLLMSettings: {
    apiUrl: 'http://localhost:1234/v1/chat/completions',
    apiKey: '',
    modelName: 'mistral-7b-instruct',
    enabled: false
  },
  embeddingSettings: {
    provider: 'none',
    openaiModel: 'text-embedding-3-small',
    openaiApiUrl: 'https://api.openai.com/v1/embeddings',
    localApiUrl: 'http://localhost:1234/v1/embeddings',
    localModel: 'all-MiniLM-L6-v2',
    chunkSize: 1000,
    chunkOverlap: 200,
    dimensions: 384
  },
  chatSettings: {
    maxNotesToSearch: 20,
    contextWindowSize: 5,
    displayWelcomeMessageOnStartup: true,
    includeTags: true,
    includeTaskItems: true,
  },
  openChatOnStartup: false,
  debugMode: false
};

export class SettingsTab extends PluginSettingTab {
  plugin: AIHelperPlugin;

  constructor(app: App, plugin: AIHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('AI Provider')
      .setDesc('Choose which LLM provider to use')
      .addDropdown(dropdown =>
        dropdown
          .addOption('openai', 'OpenAI')
          .addOption('local', 'Local LLM (LM Studio)')
          .setValue(this.plugin.settings.localLLMSettings.enabled ? 'local' : 'openai')
          .onChange(async (value) => {
            this.plugin.settings.localLLMSettings.enabled = value === 'local';
            await this.plugin.saveSettings();
          })
      );

    // OpenAI Settings
    containerEl.createEl('h3', { text: 'OpenAI' });

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Enter your OpenAI API key')
      .addText(text =>
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.openAISettings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAISettings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('OpenAI Model')
      .setDesc('The model to use for chat completions')
      .addText(text =>
        text
          .setPlaceholder('gpt-3.5-turbo')
          .setValue(this.plugin.settings.openAISettings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.openAISettings.modelName = value;
            await this.plugin.saveSettings();
          })
      );

    // Local LLM Settings
    containerEl.createEl('h3', { text: 'Local LLM' });

    new Setting(containerEl)
      .setName('LM Studio API URL')
      .setDesc('The URL for your local LLM server (typically LM Studio)')
      .addText(text =>
        text
          .setPlaceholder('http://localhost:1234/v1/chat/completions')
          .setValue(this.plugin.settings.localLLMSettings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.localLLMSettings.apiUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Local LLM Model Name')
      .setDesc('The model name to use with your local LLM')
      .addText(text =>
        text
          .setPlaceholder('mistral-7b-instruct')
          .setValue(this.plugin.settings.localLLMSettings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.localLLMSettings.modelName = value;
            await this.plugin.saveSettings();
          })
      );

    // Embedding Settings
    containerEl.createEl('h3', { text: 'Embedding' });

    new Setting(containerEl)
      .setName('Embedding Provider')
      .setDesc('Choose which embedding provider to use')
      .addDropdown(dropdown => {
        dropdown
          .addOption('none', 'None (Mock Embeddings)')
          .addOption('openai', 'OpenAI')
          .addOption('local', 'Local')
          .setValue(this.plugin.settings.embeddingSettings.provider)
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.provider = value as 'none' | 'openai' | 'local';
            await this.plugin.saveSettings();
            this.display(); // Refresh the settings UI
          });
      });

    // OpenAI embedding settings
    if (this.plugin.settings.embeddingSettings.provider === 'openai') {
      new Setting(containerEl)
        .setName('OpenAI Embedding Model')
        .setDesc('The model to use for OpenAI embeddings')
        .addText(text => {
          text
            .setPlaceholder('text-embedding-3-small')
            .setValue(this.plugin.settings.embeddingSettings.openaiModel)
            .onChange(async (value) => {
              this.plugin.settings.embeddingSettings.openaiModel = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName('OpenAI Embedding API URL')
        .setDesc('The URL for the OpenAI embeddings API')
        .addText(text => {
          text
            .setPlaceholder('https://api.openai.com/v1/embeddings')
            .setValue(this.plugin.settings.embeddingSettings.openaiApiUrl || '')
            .onChange(async (value) => {
              this.plugin.settings.embeddingSettings.openaiApiUrl = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // Local embedding settings
    if (this.plugin.settings.embeddingSettings.provider === 'local') {
      new Setting(containerEl)
        .setName('Local embedding API URL')
        .setDesc('The URL for the local embeddings API')
        .addText(text => {
          text
            .setPlaceholder('http://localhost:1234/v1/embeddings')
            .setValue(this.plugin.settings.embeddingSettings.localApiUrl || '')
            .onChange(async (value) => {
              this.plugin.settings.embeddingSettings.localApiUrl = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName('Local embedding model')
        .setDesc('The model to use for local embeddings')
        .addText(text => {
          text
            .setPlaceholder('all-MiniLM-L6-v2')
            .setValue(this.plugin.settings.embeddingSettings.localModel || '')
            .onChange(async (value) => {
              this.plugin.settings.embeddingSettings.localModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    // Common embedding settings
    new Setting(containerEl)
      .setName('Embedding dimensions')
      .setDesc('The number of dimensions for embeddings (384 for MiniLM, 1536 for OpenAI text-embedding-3-small, 3072 for OpenAI text-embedding-3-large)')
      .addText(text => {
        text
          .setPlaceholder('384')
          .setValue(this.plugin.settings.embeddingSettings.dimensions.toString())
          .onChange(async (value) => {
            const dimensions = parseInt(value);
            if (!isNaN(dimensions) && dimensions > 0) {
              this.plugin.settings.embeddingSettings.dimensions = dimensions;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName('Chunk size')
      .setDesc('The maximum size of text chunks for embedding')
      .addSlider(slider => {
        slider
          .setLimits(100, 2000, 100)
          .setValue(this.plugin.settings.embeddingSettings.chunkSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.chunkSize = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Chunk overlap')
      .setDesc('The number of characters to overlap between chunks')
      .addSlider(slider => {
        slider
          .setLimits(0, 500, 50)
          .setValue(this.plugin.settings.embeddingSettings.chunkOverlap)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.embeddingSettings.chunkOverlap = value;
            await this.plugin.saveSettings();
          });
      });

    // General Settings
    containerEl.createEl('h3', { text: 'General' });

    new Setting(containerEl)
      .setName('Open chat on startup')
      .setDesc('Automatically open the AI chat when Obsidian starts')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.openChatOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openChatOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Debug Mode')
      .setDesc('Enable debug logging in the console')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
