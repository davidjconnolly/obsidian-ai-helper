import { Settings } from '../settings';

describe('Settings', () => {
  let settings: Settings;

  beforeEach(() => {
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

  describe('Default Values', () => {
    it('should initialize with default chat settings', () => {
      expect(settings.chatSettings.displayWelcomeMessage).toBe(true);
      expect(settings.chatSettings.similarity).toBe(0.8);
      expect(settings.chatSettings.maxNotesToSearch).toBe(5);
    });

    it('should initialize with default summarization settings', () => {
      expect(settings.summarizeSettings.maxTokens).toBe(1000);
      expect(settings.summarizeSettings.temperature).toBe(0.7);
    });
  });

  describe('Settings Updates', () => {
    it('should update chat settings correctly', () => {
      settings.chatSettings.displayWelcomeMessage = false;
      settings.chatSettings.similarity = 0.9;
      settings.chatSettings.maxNotesToSearch = 10;

      expect(settings.chatSettings.displayWelcomeMessage).toBe(false);
      expect(settings.chatSettings.similarity).toBe(0.9);
      expect(settings.chatSettings.maxNotesToSearch).toBe(10);
    });

    it('should update summarization settings correctly', () => {
      settings.summarizeSettings.maxTokens = 2000;
      settings.summarizeSettings.temperature = 0.8;

      expect(settings.summarizeSettings.maxTokens).toBe(2000);
      expect(settings.summarizeSettings.temperature).toBe(0.8);
    });
  });

  describe('Settings Validation', () => {
    it('should allow setting similarity value', () => {
      settings.chatSettings.similarity = 1.5;
      expect(settings.chatSettings.similarity).toBe(1.5);

      settings.chatSettings.similarity = -0.5;
      expect(settings.chatSettings.similarity).toBe(-0.5);
    });

    it('should allow setting maxNotesToSearch value', () => {
      settings.chatSettings.maxNotesToSearch = 0;
      expect(settings.chatSettings.maxNotesToSearch).toBe(0);

      settings.chatSettings.maxNotesToSearch = 100;
      expect(settings.chatSettings.maxNotesToSearch).toBe(100);
    });

    it('should allow setting temperature value', () => {
      settings.summarizeSettings.temperature = 2.0;
      expect(settings.summarizeSettings.temperature).toBe(2.0);

      settings.summarizeSettings.temperature = -0.5;
      expect(settings.summarizeSettings.temperature).toBe(-0.5);
    });
  });
});