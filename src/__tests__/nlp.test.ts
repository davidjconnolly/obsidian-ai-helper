import { processQuery, normalizeWord, STOPWORDS, PRESERVED_WORDS } from '../nlp';
import { Settings } from '../settings'; // Import only the Settings type, not the DEFAULT_SETTINGS

// Create a minimal settings mock for testing
const TEST_SETTINGS: Settings = {
  debugMode: true,
  chatSettings: {
    provider: 'local',
    openaiModel: 'gpt-3.5-turbo',
    maxTokens: 500,
    temperature: 0.7,
    maxNotesToSearch: 20,
    displayWelcomeMessage: true,
    similarity: 0.5,
    maxContextLength: 4000,
    titleMatchBoost: 0.5,
    localModel: 'qwen2-7b-instruct',
    localApiUrl: 'http://localhost:1234/v1/chat/completions',
    openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    openaiApiKey: '',
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
  openChatOnStartup: false,
  fileUpdateFrequency: 30
};

describe('NLP Utilities', () => {
  describe('normalizeWord', () => {
    it('should convert words to lowercase', () => {
      expect(normalizeWord('CAT')).toBe('cat');
      expect(normalizeWord('Dog')).toBe('dog');
      expect(normalizeWord('JavaScript')).toBe('javascript');
    });

    it('should handle already lowercase words', () => {
      expect(normalizeWord('cat')).toBe('cat');
      expect(normalizeWord('dog')).toBe('dog');
    });
  });

  describe('processQuery', () => {
    it('should handle basic queries', () => {
      const result = processQuery('search for documents about JavaScript', TEST_SETTINGS);
      expect(result.tokens).toContain('search');
      expect(result.tokens).toContain('documents');
      expect(result.tokens).toContain('javascript');
      // Should not contain stopwords
      expect(result.tokens).not.toContain('for');
      expect(result.tokens).not.toContain('about');
    });

    it('should preserve negations', () => {
      const result = processQuery('documents not containing JavaScript', TEST_SETTINGS);
      expect(result.tokens).toContain('documents');
      expect(result.tokens).toContain('not');
      expect(result.tokens).toContain('containing');
      expect(result.tokens).toContain('javascript');
    });

    it('should handle quoted phrases', () => {
      const result = processQuery('search for "artificial intelligence" examples', TEST_SETTINGS);
      expect(result.tokens).toContain('search');
      expect(result.tokens).toContain('artificial intelligence');
      expect(result.tokens).toContain('examples');
      expect(result.phrases).toContain('artificial intelligence');
    });

    it('should only normalize words', () => {
      const result = processQuery('Running Documents Searching Processed', TEST_SETTINGS);
      expect(result.tokens).toContain('running');
      expect(result.tokens).toContain('documents');
      expect(result.tokens).toContain('searching');
      expect(result.tokens).toContain('processed');
    });

    it('should not expand terms in simplified implementation', () => {
      const result = processQuery('find help with this problem', TEST_SETTINGS);
      // Only the normalized words should be in expandedTokens
      expect(result.expandedTokens).toEqual(result.tokens);
      // Check that expandedTokens doesn't contain additional synonyms
      expect(result.expandedTokens).toContain('find');
      expect(result.expandedTokens).toContain('help');
      expect(result.expandedTokens).toContain('problem');
      expect(result.expandedTokens.length).toBe(3); // only the 3 normalized words, no expansion
    });

    it('should correctly process queries with various words', () => {
      const result = processQuery('discussing research writing and understanding analyses', TEST_SETTINGS);
      expect(result.tokens).toContain('discussing');
      expect(result.tokens).toContain('research');
      expect(result.tokens).toContain('writing');
      expect(result.tokens).not.toContain('and'); // stopword
      expect(result.tokens).toContain('understanding');
      expect(result.tokens).toContain('analyses');
    });

    it('should maintain case for phrases', () => {
      const result = processQuery('looking for "React Native" examples', TEST_SETTINGS);
      expect(result.tokens).toContain('looking');
      expect(result.tokens).toContain('React Native'); // Preserves case in quoted phrases
      expect(result.tokens).toContain('examples');
    });

    it('should handle multiple phrases', () => {
      const result = processQuery('"machine learning" vs "deep learning" applications', TEST_SETTINGS);
      expect(result.tokens).toContain('machine learning');
      expect(result.tokens).toContain('deep learning');
      expect(result.tokens).toContain('applications');
      expect(result.tokens).not.toContain('vs'); // stopword
      expect(result.phrases).toContain('machine learning');
      expect(result.phrases).toContain('deep learning');
    });
  });
});