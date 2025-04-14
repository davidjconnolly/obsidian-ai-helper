import { VectorStore, NoteChunk } from '../chat/vectorStore';
import { Settings } from '../settings';
import { App, TFile } from 'obsidian';
import { NoteEmbedding } from '../chat';

// Mock the required dependencies
jest.mock('../settings');
jest.mock('obsidian');
jest.mock('../utils');

describe('VectorStore', () => {
    let vectorStore: VectorStore;
    let mockSettings: Settings;
    let mockApp: App;
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
            extension: 'md',
            stat: {
                mtime: Date.now()
            }
        } as TFile;

        // Setup mock app
        mockApp = {
            vault: {
                getAbstractFileByPath: jest.fn()
            }
        } as unknown as App;

        // Create instance
        vectorStore = new VectorStore(384, mockSettings, mockApp);
    });

    describe('constructor', () => {
        it('should initialize with correct dimensions and settings', () => {
            expect(vectorStore).toBeInstanceOf(VectorStore);
            expect(vectorStore['dimensions']).toBe(384);
            expect(vectorStore['settings']).toBe(mockSettings);
            expect(vectorStore['app']).toBe(mockApp);
        });
    });

    describe('setApp', () => {
        it('should set the app instance', () => {
            const newApp = {} as App;
            vectorStore.setApp(newApp);
            expect(vectorStore['app']).toBe(newApp);
        });
    });

    describe('clear', () => {
        it('should clear all embeddings and index', () => {
            vectorStore['embeddings'].set('test.md', {
                path: 'test.md',
                chunks: [{
                    content: 'test',
                    embedding: new Float32Array(384),
                    position: 0
                }]
            });
            vectorStore['index'].set('test.md', {
                chunks: [{
                    content: 'test',
                    embedding: new Float32Array(384),
                    position: 0
                }],
                maxScore: 0
            });

            vectorStore.clear();

            expect(vectorStore['embeddings'].size).toBe(0);
            expect(vectorStore['index'].size).toBe(0);
        });
    });

    describe('calculateRecencyScore', () => {
        it('should calculate higher scores for recent files', () => {
            const now = Date.now();
            const recentScore = vectorStore['calculateRecencyScore'](now);
            const oldScore = vectorStore['calculateRecencyScore'](now - 30 * 24 * 60 * 60 * 1000); // 30 days ago

            expect(recentScore).toBeGreaterThan(oldScore);
        });
    });

    describe('search', () => {
        it('should return empty array when no embeddings exist', async () => {
            const results = await vectorStore.search(new Float32Array(384), {
                similarity: 0.5,
                limit: 10
            });

            expect(results).toEqual([]);
        });

        it('should find relevant chunks based on similarity', async () => {
            const queryEmbedding = new Float32Array(384).fill(1);
            const noteEmbedding: NoteEmbedding = {
                path: 'test.md',
                chunks: [
                    {
                        content: 'relevant content',
                        embedding: new Float32Array(384).fill(1),
                        position: 0
                    },
                    {
                        content: 'irrelevant content',
                        embedding: new Float32Array(384).fill(0),
                        position: 1
                    }
                ]
            };

            vectorStore['embeddings'].set('test.md', noteEmbedding);
            (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(mockFile);

            const results = await vectorStore.search(queryEmbedding, {
                similarity: 0.5,
                limit: 10
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].path).toBe('test.md');
        });

        it('should respect similarity threshold', async () => {
            const queryEmbedding = new Float32Array(384);
            queryEmbedding[0] = 1; // Set first component to 1, rest are 0

            const noteEmbedding: NoteEmbedding = {
                path: 'test.md',
                chunks: [
                    {
                        content: 'low similarity content',
                        embedding: new Float32Array(384),
                        position: 0
                    }
                ]
            };
            noteEmbedding.chunks[0].embedding[1] = 1; // Set second component to 1, rest are 0

            vectorStore['embeddings'].set('test.md', noteEmbedding);

            const results = await vectorStore.search(queryEmbedding, {
                similarity: 0.5,
                limit: 10
            });

            expect(results).toEqual([]);
        });

        it('should correctly limit results', async () => {
            const queryEmbedding = new Float32Array(384).fill(1);

            // Create multiple embeddings with different scores
            const embedding1: NoteEmbedding = {
                path: 'note1.md',
                chunks: [{
                    content: 'content 1',
                    embedding: new Float32Array(384).fill(0.8),
                    position: 0
                }]
            };

            const embedding2: NoteEmbedding = {
                path: 'note2.md',
                chunks: [{
                    content: 'content 2',
                    embedding: new Float32Array(384).fill(0.7),
                    position: 0
                }]
            };

            const embedding3: NoteEmbedding = {
                path: 'note3.md',
                chunks: [{
                    content: 'content 3',
                    embedding: new Float32Array(384).fill(0.6),
                    position: 0
                }]
            };

            // Add the embeddings
            vectorStore.addEmbedding('note1.md', embedding1);
            vectorStore.addEmbedding('note2.md', embedding2);
            vectorStore.addEmbedding('note3.md', embedding3);

            // Test with a limit of 2
            const results = await vectorStore.search(queryEmbedding, {
                similarity: 0.5,
                limit: 2
            });

            // Should return only 2 results from the 3 added
            expect(results.length).toBe(2);
        });
    });

    describe('calculateCosineSimilarity', () => {
        it('should return 1 for identical vectors', () => {
            const vector = new Float32Array(384).fill(1);
            const similarity = vectorStore['calculateCosineSimilarity'](vector, vector);
            expect(similarity).toBeCloseTo(1, 10);
        });

        it('should return 0 for orthogonal vectors', () => {
            const vector1 = new Float32Array(384).fill(1);
            const vector2 = new Float32Array(384).fill(0);
            const similarity = vectorStore['calculateCosineSimilarity'](vector1, vector2);
            expect(similarity).toBe(0);
        });
    });

    describe('addEmbedding', () => {
        it('should add valid embedding', () => {
            const embedding: NoteEmbedding = {
                path: 'test.md',
                chunks: [
                    {
                        content: 'test',
                        embedding: new Float32Array(384),
                        position: 0
                    }
                ]
            };

            vectorStore.addEmbedding('test.md', embedding);

            expect(vectorStore['embeddings'].get('test.md')).toBe(embedding);
            expect(vectorStore['index'].get('test.md')).toBeDefined();
        });

        it('should skip invalid embedding', () => {
            const embedding: NoteEmbedding = {
                path: 'test.md',
                chunks: [
                    {
                        content: 'test',
                        embedding: new Float32Array(100),
                        position: 0
                    }
                ]
            };

            vectorStore.addEmbedding('test.md', embedding);

            expect(vectorStore['embeddings'].get('test.md')).toBeUndefined();
        });
    });

    describe('removeEmbedding', () => {
        it('should remove embedding and index entry', () => {
            vectorStore['embeddings'].set('test.md', {
                path: 'test.md',
                chunks: [{
                    content: 'test',
                    embedding: new Float32Array(384),
                    position: 0
                }]
            });
            vectorStore['index'].set('test.md', {
                chunks: [{
                    content: 'test',
                    embedding: new Float32Array(384),
                    position: 0
                }],
                maxScore: 0
            });

            vectorStore.removeEmbedding('test.md');

            expect(vectorStore['embeddings'].get('test.md')).toBeUndefined();
            expect(vectorStore['index'].get('test.md')).toBeUndefined();
        });
    });

    describe('getChunk', () => {
        it('should return chunk when it exists', () => {
            const chunk: NoteChunk = {
                content: 'test',
                embedding: new Float32Array(384),
                position: 0
            };
            vectorStore['embeddings'].set('test.md', {
                path: 'test.md',
                chunks: [chunk]
            });

            const result = vectorStore.getChunk('test.md', 0);
            expect(result).toBe(chunk);
        });

        it('should return null for non-existent chunk', () => {
            const result = vectorStore.getChunk('test.md', 0);
            expect(result).toBeNull();
        });
    });

    describe('getAllChunks', () => {
        it('should return all chunks when they exist', () => {
            const chunks: NoteChunk[] = [
                {
                    content: 'test1',
                    embedding: new Float32Array(384),
                    position: 0
                },
                {
                    content: 'test2',
                    embedding: new Float32Array(384),
                    position: 1
                }
            ];
            vectorStore['embeddings'].set('test.md', {
                path: 'test.md',
                chunks
            });

            const result = vectorStore.getAllChunks('test.md');
            expect(result).toEqual(chunks);
        });

        it('should return null for non-existent note', () => {
            const result = vectorStore.getAllChunks('test.md');
            expect(result).toBeNull();
        });
    });
});