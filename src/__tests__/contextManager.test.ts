import { ContextManager } from '../chat/contextManager';
import { VectorStore, NoteChunk } from '../chat/vectorStore';
import { Settings } from '../settings';
import { TFile } from 'obsidian';

// Mock the required dependencies
jest.mock('../chat/vectorStore');
jest.mock('../settings');

describe('ContextManager', () => {
    let contextManager: ContextManager;
    let mockVectorStore: jest.Mocked<VectorStore>;
    let mockSettings: Settings;
    let mockFile: TFile;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup mock settings
        mockSettings = {
            fileUpdateFrequency: 5,
            debugMode: true,
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
                updateMode: 'onUpdate'
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
                titleMatchBoost: 0.5
            },
            openChatOnStartup: false
        } as Settings;

        // Setup mock file
        mockFile = {
            path: 'test.md',
            basename: 'test',
            extension: 'md'
        } as TFile;

        // Setup mock vector store
        mockVectorStore = {
            getChunk: jest.fn(),
            getAllChunks: jest.fn()
        } as unknown as jest.Mocked<VectorStore>;

        // Create instance
        contextManager = new ContextManager(mockVectorStore, mockSettings);
    });

    describe('buildContext', () => {
        it('should build context from relevant notes', () => {
            const notes = [
                {
                    file: mockFile,
                    content: 'Test content with keyword',
                    relevance: 0.8
                }
            ];

            const context = contextManager.buildContext('keyword', notes, 0);

            expect(context).toContain('File: test');
            expect(context).toContain('Path: test.md');
            expect(context).toContain('Relevance: 0.80');
            expect(context).toContain('Test content with keyword');
        });

        it('should respect max context length', () => {
            const notes = [
                {
                    file: mockFile,
                    content: 'A'.repeat(5000), // Very long content
                    relevance: 0.8
                }
            ];

            const context = contextManager.buildContext('keyword', notes, 0);

            expect(context.length).toBeLessThanOrEqual(mockSettings.chatSettings.maxContextLength);
        });

        it('should handle empty notes array', () => {
            const context = contextManager.buildContext('keyword', [], 0);

            expect(context).toContain("I couldn't find any notes specifically related to your query");
        });
    });

    describe('extractRelevantExcerpt', () => {
        it('should use specific chunk when chunkIndex is provided', () => {
            const note = {
                file: mockFile,
                content: 'Test content',
                relevance: 0.8,
                chunkIndex: 0
            };

            const mockChunk = { content: 'Specific chunk content' };
            mockVectorStore.getChunk.mockReturnValue(mockChunk as NoteChunk);

            const excerpt = contextManager['extractRelevantExcerpt'](note, 'keyword');

            expect(excerpt).toBe('Specific chunk content');
            expect(mockVectorStore.getChunk).toHaveBeenCalledWith('test.md', 0);
        });

        it('should find relevant chunks when no chunkIndex is provided', () => {
            const note = {
                file: mockFile,
                content: 'Test content',
                relevance: 0.8
            };

            const mockChunks = [
                { content: 'Chunk with keyword and more context' },
                { content: 'Another chunk without any relevant info' }
            ];
            mockVectorStore.getAllChunks.mockReturnValue(mockChunks as NoteChunk[]);

            const excerpt = contextManager['extractRelevantExcerpt'](note, 'keyword');

            // The excerpt should only contain the relevant chunk
            expect(excerpt).toBe('Chunk with keyword and more context');
            expect(mockVectorStore.getAllChunks).toHaveBeenCalledWith('test.md');
        });

        it('should fall back to findRelevantSection when no chunks are found', () => {
            const note = {
                file: mockFile,
                content: 'Test content with keyword',
                relevance: 0.8
            };

            mockVectorStore.getAllChunks.mockReturnValue([]);

            const excerpt = contextManager['extractRelevantExcerpt'](note, 'keyword');

            expect(excerpt).toContain('Test content with keyword');
        });
    });

    describe('findRelevantSection', () => {
        it('should return entire content if it is short enough', () => {
            const content = 'Short content';
            const result = contextManager['findRelevantSection'](content, 'keyword');

            expect(result).toBe(content);
        });

        it('should find relevant paragraphs based on keywords', () => {
            const content = `
                First paragraph without keyword

                Second paragraph with keyword

                Third paragraph without keyword

                Fourth paragraph with keyword
            `;

            const result = contextManager['findRelevantSection'](content, 'keyword');

            expect(result).toContain('Second paragraph with keyword');
            expect(result).toContain('Fourth paragraph with keyword');
        });

        it('should include context around relevant paragraphs', () => {
            const content = `
                First paragraph

                Second paragraph with keyword

                Third paragraph

                Fourth paragraph with keyword

                Fifth paragraph
            `;

            const result = contextManager['findRelevantSection'](content, 'keyword');

            expect(result).toContain('First paragraph');
            expect(result).toContain('Second paragraph with keyword');
            expect(result).toContain('Third paragraph');
            expect(result).toContain('Fourth paragraph with keyword');
            expect(result).toContain('Fifth paragraph');
        });
    });
});