import { processQuery, stemWord, expandTerm, STOPWORDS, PRESERVED_WORDS } from '../nlp';
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
  describe('stemWord', () => {
    it('should correctly stem plural nouns', () => {
      expect(stemWord('cats')).toBe('cat');
      expect(stemWord('dogs')).toBe('dog');
      expect(stemWord('horses')).toBe('hors');
      expect(stemWord('cities')).toBe('city');
    });

    it('should correctly stem verbs', () => {
      expect(stemWord('running')).toBe('run');
      expect(stemWord('walked')).toBe('walk');
      expect(stemWord('jumping')).toBe('jump');
      expect(stemWord('baking')).toBe('bake');
    });

    it('should handle short words', () => {
      expect(stemWord('the')).toBe('the');
      expect(stemWord('a')).toBe('a');
      expect(stemWord('to')).toBe('to');
    });

    it('should handle already stemmed words', () => {
      expect(stemWord('run')).toBe('run');
      expect(stemWord('walk')).toBe('walk');
    });

    it('should handle discuss and related forms', () => {
      expect(stemWord('discuss')).toBe('discuss');
      expect(stemWord('discussed')).toBe('discuss');
      expect(stemWord('discussing')).toBe('discuss');
      expect(stemWord('discussion')).toBe('discuss');
      expect(stemWord('discussions')).toBe('discuss');

      // Add a specific test for the use case that was failing
      const expanded = expandTerm('discussed');
      expect(expanded).toContain('discussed');
      expect(expanded).toContain('discuss');
      expect(expanded).toContain('conversation');
      expect(expanded).toContain('dialogue');
    });

    it('should handle words ending with ss', () => {
      expect(stemWord('address')).toBe('address');
      expect(stemWord('addressed')).toBe('address');
      expect(stemWord('addressing')).toBe('address');
      expect(stemWord('express')).toBe('express');
      expect(stemWord('expressed')).toBe('express');
      expect(stemWord('progress')).toBe('progress');
      expect(stemWord('progressed')).toBe('progress');
    });

    it('should handle irregular plurals', () => {
      expect(stemWord('analysis')).toBe('analysis');
      expect(stemWord('analyses')).toBe('analysis');
      expect(stemWord('thesis')).toBe('thesis');
      expect(stemWord('theses')).toBe('thesis');
      expect(stemWord('crisis')).toBe('crisis');
      expect(stemWord('crises')).toBe('crisis');
      expect(stemWord('business')).toBe('business');
      expect(stemWord('businesses')).toBe('business');
    });

    it('should handle irregular verbs', () => {
      expect(stemWord('understand')).toBe('understand');
      expect(stemWord('understood')).toBe('understand');
      expect(stemWord('understanding')).toBe('understand');
      expect(stemWord('write')).toBe('write');
      expect(stemWord('wrote')).toBe('write');
      expect(stemWord('written')).toBe('write');
      expect(stemWord('writing')).toBe('write');
      expect(stemWord('think')).toBe('think');
      expect(stemWord('thought')).toBe('think');
      expect(stemWord('thinking')).toBe('think');
      expect(stemWord('bring')).toBe('bring');
      expect(stemWord('brought')).toBe('bring');
      expect(stemWord('bringing')).toBe('bring');
    });

    it('should handle academic terms', () => {
      expect(stemWord('research')).toBe('research');
      expect(stemWord('researched')).toBe('research');
      expect(stemWord('researching')).toBe('research');
      expect(stemWord('study')).toBe('study');
      expect(stemWord('studied')).toBe('study');
      expect(stemWord('studying')).toBe('study');
      expect(stemWord('studies')).toBe('study');
      expect(stemWord('learn')).toBe('learn');
      expect(stemWord('learned')).toBe('learn');
      expect(stemWord('learning')).toBe('learn');
    });
  });

  describe('expandTerm', () => {
    it('should include the original term', () => {
      const expanded = expandTerm('car');
      expect(expanded).toContain('car');
    });

    it('should include synonyms when available', () => {
      const expanded = expandTerm('car');
      expect(expanded).toContain('vehicle');
      expect(expanded).toContain('automobile');
    });

    it('should include stemmed version', () => {
      const expanded = expandTerm('running');
      expect(expanded).toContain('running');
      expect(expanded).toContain('run');
    });

    it('should expand terms using the new synonyms', () => {
      const discussExpanded = expandTerm('discuss');
      expect(discussExpanded).toContain('conversation');
      expect(discussExpanded).toContain('talk');
      expect(discussExpanded).toContain('dialogue');

      const understandExpanded = expandTerm('understand');
      expect(understandExpanded).toContain('comprehend');
      expect(understandExpanded).toContain('grasp');
      expect(understandExpanded).toContain('realize');

      const writeExpanded = expandTerm('write');
      expect(writeExpanded).toContain('compose');
      expect(writeExpanded).toContain('author');
      expect(writeExpanded).toContain('document');

      const researchExpanded = expandTerm('research');
      expect(researchExpanded).toContain('investigate');
      expect(researchExpanded).toContain('study');
      expect(researchExpanded).toContain('analyze');
    });

    it('should properly expand stemmed terms', () => {
      const discussingExpanded = expandTerm('discussing');
      expect(discussingExpanded).toContain('discussing');
      expect(discussingExpanded).toContain('discuss');
      expect(discussingExpanded).toContain('conversation');
      expect(discussingExpanded).toContain('dialogue');

      const writingExpanded = expandTerm('writing');
      expect(writingExpanded).toContain('writing');
      expect(writingExpanded).toContain('write');
      expect(writingExpanded).toContain('compose');
      expect(writingExpanded).toContain('document');
    });
  });

  describe('processQuery', () => {
    it('should handle basic queries', () => {
      const result = processQuery('search for documents about JavaScript', TEST_SETTINGS);
      expect(result.tokens).toContain('search');
      expect(result.tokens).toContain('document');
      expect(result.tokens).toContain('javascript');
      // Should not contain stopwords
      expect(result.tokens).not.toContain('for');
      expect(result.tokens).not.toContain('about');
    });

    it('should preserve negations', () => {
      const result = processQuery('documents not containing JavaScript', TEST_SETTINGS);
      expect(result.tokens).toContain('document');
      expect(result.tokens).toContain('not');
      expect(result.tokens).toContain('contain');
      expect(result.tokens).toContain('javascript');
    });

    it('should handle quoted phrases', () => {
      const result = processQuery('search for "artificial intelligence" examples', TEST_SETTINGS);
      expect(result.tokens).toContain('search');
      expect(result.tokens).toContain('artificial intelligence');
      expect(result.tokens).toContain('exampl');
      expect(result.phrases).toContain('artificial intelligence');
    });

    it('should stem words', () => {
      const result = processQuery('running documents searching processed', TEST_SETTINGS);
      expect(result.tokens).toContain('run');
      expect(result.tokens).toContain('document');
      expect(result.tokens).toContain('search');
      expect(result.tokens).toContain('process');
    });

    it('should expand terms', () => {
      const result = processQuery('find help with this problem', TEST_SETTINGS);
      expect(result.expandedTokens).toContain('find');
      expect(result.expandedTokens).toContain('locate');
      expect(result.expandedTokens).toContain('discover');
      expect(result.expandedTokens).toContain('help');
      expect(result.expandedTokens).toContain('assist');
      expect(result.expandedTokens).toContain('problem');
      expect(result.expandedTokens).toContain('issue');
    });

    it('should correctly process queries with special case words', () => {
      const result = processQuery('discussing research writing and understanding analyses', TEST_SETTINGS);
      expect(result.tokens).toContain('discuss');
      expect(result.tokens).toContain('research');
      expect(result.tokens).toContain('write');
      expect(result.tokens).toContain('understand');
      expect(result.tokens).toContain('analysis');

      // We don't expect 'discussion' since 'discussing' is stemmed to 'discuss'
      expect(result.expandedTokens).toContain('discuss');
      expect(result.expandedTokens).toContain('conversation');
      expect(result.expandedTokens).toContain('investigate');
      expect(result.expandedTokens).toContain('compose');
      expect(result.expandedTokens).toContain('comprehend');
    });
  });
});