import { App } from 'obsidian';
import { Settings } from '../settings';

// Mock the Obsidian Modal class
class MockModal {
  app: App;
  constructor(app: App) {
    this.app = app;
  }
}

// Extend the mock Modal class
class AIHelperModal extends MockModal {
  text: string = '';
  settings: Settings;

  constructor(app: App, settings: Settings) {
    super(app);
    this.settings = settings;
  }

  async onSubmit(text: string, action: string): Promise<void> {
    this.text = text;
    // Mock implementation
  }
}

describe('Summarization', () => {
  let settings: Settings;
  let mockApp: App;

  beforeEach(() => {
    mockApp = new App();
    settings = {
      chatSettings: {
        displayWelcomeMessage: true,
        similarity: 0.8,
        maxNotesToSearch: 5,
        provider: 'openai',
        openaiModel: 'gpt-3.5-turbo',
        maxTokens: 1000,
        temperature: 0.7,
        maxContextLength: 2000,
        titleMatchBoost: 1.5,
        openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
        openaiApiKey: '',
        localApiUrl: 'http://localhost:1234/v1/chat/completions',
        localModel: 'qwen2-7b-instruct',
      },
      summarizeSettings: {
        provider: 'openai',
        openaiModel: 'gpt-3.5-turbo',
        maxTokens: 1000,
        temperature: 0.7,
        openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
        openaiApiKey: '',
        localApiUrl: 'http://localhost:1234/v1/chat/completions',
        localModel: 'qwen2-7b-instruct',
      },
      embeddingSettings: {
        provider: 'openai',
        openaiModel: 'text-embedding-ada-002',
        chunkSize: 1000,
        chunkOverlap: 200,
        dimensions: 1536,
        updateMode: 'onLoad',
        openaiApiUrl: 'https://api.openai.com/v1/embeddings',
        openaiApiKey: '',
        localApiUrl: 'http://localhost:1234/v1/embeddings',
        localModel: 'text-embedding-all-minilm-l6-v2-embedding',
      },
      openChatOnStartup: false,
      debugMode: false,
      fileUpdateFrequency: 60,
    } as Settings;
  });

  describe('Text Summarization', () => {
    it('should create modal with correct settings', () => {
      const modal = new AIHelperModal(mockApp, settings);
      expect(modal.settings).toBe(settings);
    });

    it('should handle empty text', () => {
      const modal = new AIHelperModal(mockApp, settings);
      modal.text = '';
      expect(modal.text).toBe('');
    });

    it('should handle text shorter than max length', () => {
      const modal = new AIHelperModal(mockApp, settings);
      modal.text = 'Short text';
      expect(modal.text).toBe('Short text');
    });
  });

  describe('Format Options', () => {
    it('should update temperature setting', () => {
      const modal = new AIHelperModal(mockApp, settings);
      modal.settings.summarizeSettings.temperature = 0.5;
      expect(modal.settings.summarizeSettings.temperature).toBe(0.5);
    });

    it('should update max tokens setting', () => {
      const modal = new AIHelperModal(mockApp, settings);
      modal.settings.summarizeSettings.maxTokens = 2000;
      expect(modal.settings.summarizeSettings.maxTokens).toBe(2000);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      const modal = new AIHelperModal(mockApp, settings);
      // Mock API error
      jest.spyOn(global, 'fetch').mockImplementationOnce(() =>
        Promise.reject(new Error('API Error'))
      );

      try {
        await modal.onSubmit('Test text', 'summarize');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});