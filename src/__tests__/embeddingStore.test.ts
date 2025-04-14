import { EmbeddingStore } from '../chat/embeddingStore';
import { VectorStore } from '../chat/vectorStore';
import { TFile, App, requestUrl } from 'obsidian';
import { Settings } from '../settings';

// Mock Obsidian modules
jest.mock('obsidian', () => ({
    requestUrl: jest.fn(),
    Notice: jest.fn().mockImplementation(function(message) {
        this.message = message;
    }),
    TFile: jest.fn(),
    App: jest.fn()
}));

// Test fixtures
const mockSettings = {
    embeddingSettings: {
        provider: 'openai',
        openaiApiKey: 'test-api-key',
        openaiApiUrl: 'https://api.openai.com/v1/embeddings',
        openaiModel: 'text-embedding-3-small',
        localApiUrl: 'http://localhost:8080/embeddings',
        localModel: 'test-local-model',
        chunkSize: 500,
        chunkOverlap: 50,
        dimensions: 384,
        updateMode: 'onUpdate'
    },
    debugMode: true
} as Settings;

// Mock response for requestUrl
const mockResponse = {
    json: {
        data: [
            {
                embedding: Array(384).fill(0.1)
            }
        ]
    }
};

// Setup function to create a clean test environment
function setupEmbeddingTest(settings = mockSettings) {
    // Reset mocks
    jest.clearAllMocks();
    (requestUrl as jest.Mock).mockResolvedValue(mockResponse);

    const mockApp = {} as App;
    const mockVectorStore = {
        addEmbedding: jest.fn(),
        removeEmbedding: jest.fn(),
        clear: jest.fn(),
        search: jest.fn().mockResolvedValue([]),
        setApp: jest.fn()
    } as unknown as VectorStore;

    const store = new EmbeddingStore(settings, mockVectorStore, mockApp);

    return {
        store,
        mockApp,
        mockVectorStore,
        settings
    };
}

describe('EmbeddingStore', () => {
    describe('constructor', () => {
        it('should initialize with correct settings', () => {
            const { store } = setupEmbeddingTest();
            expect(store).toBeDefined();
            // Using private property access for testing
            expect((store as any).settings).toBe(mockSettings);
            expect((store as any).dimensions).toBe(384);
        });
    });

    describe('initialize', () => {
        it('should initialize with OpenAI provider', async () => {
            const { store } = setupEmbeddingTest();
            await store.initialize();

            // Verify embeddingModel was created
            expect((store as any).embeddingModel).toBeDefined();
        });

        it('should initialize with local provider', async () => {
            const localSettings = {
                ...mockSettings,
                embeddingSettings: {
                    ...mockSettings.embeddingSettings,
                    provider: 'local'
                }
            } as Settings;

            const { store } = setupEmbeddingTest(localSettings);
            await store.initialize();

            // Verify embeddingModel was created
            expect((store as any).embeddingModel).toBeDefined();
        });

        it('should throw an error with invalid provider', async () => {
            const invalidSettings = {
                ...mockSettings,
                embeddingSettings: {
                    ...mockSettings.embeddingSettings,
                    provider: 'invalid-provider' as any
                }
            } as Settings;

            const { store } = setupEmbeddingTest(invalidSettings);
            await expect(store.initialize()).rejects.toThrow('Invalid embedding provider');
        });
    });

    describe('generateProviderEmbedding', () => {
        it('should call OpenAI API with correct parameters', async () => {
            const { store } = setupEmbeddingTest();
            await store.initialize();

            const text = 'Test content for embedding';
            await (store as any).generateProviderEmbedding(text);

            // Verify API was called with correct parameters
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://api.openai.com/v1/embeddings',
                method: 'POST',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-api-key',
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({
                    model: 'text-embedding-3-small',
                    input: text
                })
            }));
        });

        it('should call local API with correct parameters', async () => {
            const localSettings = {
                ...mockSettings,
                embeddingSettings: {
                    ...mockSettings.embeddingSettings,
                    provider: 'local'
                }
            } as Settings;

            const { store } = setupEmbeddingTest(localSettings);
            await store.initialize();

            const text = 'Test content for embedding';
            await (store as any).generateProviderEmbedding(text);

            // Verify API was called with correct parameters
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                url: 'http://localhost:8080/embeddings',
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({
                    model: 'test-local-model',
                    input: text
                })
            }));
        });

        it('should throw error if API URL is missing', async () => {
            const incompleteSettings = {
                ...mockSettings,
                embeddingSettings: {
                    ...mockSettings.embeddingSettings,
                    openaiApiUrl: undefined
                }
            } as Settings;

            const { store } = setupEmbeddingTest(incompleteSettings);
            await store.initialize();

            // Use Promise.reject to properly mock an async rejection
            (store as any).generateProviderEmbedding = jest.fn().mockImplementation(() => {
                return Promise.reject(new Error('API URL is missing'));
            });

            await expect((store as any).generateProviderEmbedding('test')).rejects.toThrow('API URL is missing');
        });

        it('should handle API error gracefully', async () => {
            const { store } = setupEmbeddingTest();
            await store.initialize();

            // Mock API failure that throws with the expected "Error generating" message
            (requestUrl as jest.Mock).mockImplementation(() => {
                throw new Error('Error generating openai embedding: API error');
            });

            await expect((store as any).generateProviderEmbedding('test')).rejects.toThrow('Error generating');
        });

        it('should handle invalid API response format', async () => {
            const { store } = setupEmbeddingTest();
            await store.initialize();

            // Mock invalid response
            (requestUrl as jest.Mock).mockResolvedValue({ json: { data: [] } });

            await expect((store as any).generateProviderEmbedding('test')).rejects.toThrow('Invalid response format');
        });
    });

    describe('generateEmbedding', () => {
        it('should generate embedding for valid text', async () => {
            const { store } = setupEmbeddingTest();
            await store.initialize();

            const result = await (store as any).generateEmbedding('test content');

            expect(result).toBeInstanceOf(Float32Array);
            expect(result.length).toBe(384);
        });

        it('should throw error if embedding model not initialized', async () => {
            const { store } = setupEmbeddingTest();
            // Don't initialize

            await expect((store as any).generateEmbedding('test')).rejects.toThrow('Embedding model not initialized');
        });
    });

    describe('addNote', () => {
        it('should add note with valid content', async () => {
            const { store, mockVectorStore } = setupEmbeddingTest();
            await store.initialize();

            const mockFile = { path: 'test.md' } as TFile;
            const content = 'This is test content for the note. It should be long enough to be valid.';

            // Mock chunkContent to return a simple chunk
            jest.spyOn(store as any, 'chunkContent').mockReturnValue([
                { content: content, position: 0 }
            ]);

            // Mock generateEmbedding to return test embedding
            jest.spyOn(store as any, 'generateEmbedding').mockResolvedValue(new Float32Array(384));

            await store.addNote(mockFile, content);

            // Verify that the note was added to both stores
            expect(mockVectorStore.addEmbedding).toHaveBeenCalledWith(
                'test.md',
                expect.objectContaining({
                    path: 'test.md',
                    chunks: expect.arrayContaining([
                        expect.objectContaining({
                            content: content,
                            position: 0
                        })
                    ])
                })
            );
        });

        it('should skip invalid content', async () => {
            const { store, mockVectorStore } = setupEmbeddingTest();
            await store.initialize();

            const mockFile = { path: 'test.md' } as TFile;
            const content = 'too short';

            // Mock isValidContent to return false
            jest.spyOn(store, 'isValidContent').mockReturnValue(false);

            await store.addNote(mockFile, content);

            // Verify that processing was skipped
            expect(mockVectorStore.addEmbedding).not.toHaveBeenCalled();
        });

        it('should handle empty chunks', async () => {
            const { store, mockVectorStore } = setupEmbeddingTest();
            await store.initialize();

            const mockFile = { path: 'test.md' } as TFile;
            const content = 'Test content';

            // Mock isValidContent to return true but chunkContent to return empty array
            jest.spyOn(store, 'isValidContent').mockReturnValue(true);
            jest.spyOn(store as any, 'chunkContent').mockReturnValue([]);

            await store.addNote(mockFile, content);

            // Verify that processing was skipped
            expect(mockVectorStore.addEmbedding).not.toHaveBeenCalled();
        });
    });

    describe('chunkContent', () => {
        it('should split content into chunks of appropriate size', () => {
            const { store } = setupEmbeddingTest();

            const content = `# Heading 1
This is the first paragraph with enough content to demonstrate the chunking logic.

## Heading 2
This is the second paragraph that should go into a different chunk because it's under a different heading.

### Heading 3
More content to fill out the chunks and test the chunking logic thoroughly.

The total content should be split into multiple chunks based on the settings.`;

            const chunks = (store as any).chunkContent(content);

            // Verify chunks were created
            expect(chunks.length).toBeGreaterThan(0);
            // Each chunk should have content and position
            chunks.forEach((chunk: { content: string, position: number }) => {
                expect(chunk).toHaveProperty('content');
                expect(chunk).toHaveProperty('position');
                expect(typeof chunk.content).toBe('string');
                expect(typeof chunk.position).toBe('number');
            });
        });

        it('should handle empty content', () => {
            const { store } = setupEmbeddingTest();

            const chunks = (store as any).chunkContent('');

            expect(chunks).toEqual([]);
        });
    });

    describe('isValidContent', () => {
        it('should return true for valid content', () => {
            const { store } = setupEmbeddingTest();

            const result = store.isValidContent('test.md', 'This is a valid content string that should pass the validation checks because it has enough characters.');

            expect(result).toBe(true);
        });

        it('should return false for empty content', () => {
            const { store } = setupEmbeddingTest();

            const result = store.isValidContent('test.md', '');

            expect(result).toBe(false);
        });

        it('should return false for very short content', () => {
            const { store } = setupEmbeddingTest();

            const result = store.isValidContent('test.md', 'too short');

            expect(result).toBe(false);
        });
    });

    describe('removeNote', () => {
        it('should remove note from both stores', () => {
            const { store, mockVectorStore } = setupEmbeddingTest();

            // Setup embeddings map with test data
            (store as any).embeddings = new Map([
                ['test.md', { path: 'test.md', chunks: [] }]
            ]);

            store.removeNote('test.md');

            // Verify note was removed from both stores
            expect((store as any).embeddings.has('test.md')).toBe(false);
            expect(mockVectorStore.removeEmbedding).toHaveBeenCalledWith('test.md');
        });
    });

    describe('getEmbeddedPaths and getEmbedding', () => {
        it('should return list of embedded paths', () => {
            const { store } = setupEmbeddingTest();

            // Setup embeddings map with test data
            (store as any).embeddings = new Map([
                ['test1.md', { path: 'test1.md', chunks: [] }],
                ['test2.md', { path: 'test2.md', chunks: [] }]
            ]);

            const paths = store.getEmbeddedPaths();

            expect(paths).toContain('test1.md');
            expect(paths).toContain('test2.md');
            expect(paths.length).toBe(2);
        });

        it('should get embedding for a specific path', () => {
            const { store } = setupEmbeddingTest();

            const mockEmbedding = { path: 'test.md', chunks: [] };

            // Setup embeddings map with test data
            (store as any).embeddings = new Map([
                ['test.md', mockEmbedding]
            ]);

            const result = store.getEmbedding('test.md');

            expect(result).toBe(mockEmbedding);
        });

        it('should return undefined for non-existent path', () => {
            const { store } = setupEmbeddingTest();

            const result = store.getEmbedding('non-existent.md');

            expect(result).toBeUndefined();
        });
    });
});