import { TFile, requestUrl, RequestUrlParam, App } from 'obsidian';
import { Settings } from '../settings';
import { VectorStore } from './vectorStore';
import { NoteEmbedding } from '../chat';
import { logDebug, logError } from '../utils';
import { Notice } from 'obsidian';

interface EmbeddingModel {
  embed: (text: string) => Promise<Float32Array>;
}

interface PersistedEmbeddingStore {
    version: number;
    lastUpdated: number;
    embeddings: {
        [path: string]: {
            path: string;
            chunks: {
                content: string;
                embedding: number[];
                position: number;
            }[];
            lastModified: number;
        };
    };
}

// Static initialization state to track across instances
let globalInitializationPromise: Promise<void> | null = null;
let isGloballyInitialized = false;

// Export these for use in main.ts
export { globalInitializationPromise, isGloballyInitialized };

// Classes for embedding management
export let globalVectorStore: VectorStore | null = null;
export let globalEmbeddingStore: EmbeddingStore | null = null;

export class EmbeddingStore {
  private embeddings: Map<string, NoteEmbedding> = new Map();
  private settings: Settings;
  private vectorStore: VectorStore;
  private embeddingModel: EmbeddingModel;
  private dimensions: number;
  private app: App;

  constructor(settings: Settings, vectorStore: VectorStore, app: App) {
      this.settings = settings;
      this.vectorStore = vectorStore;
      this.dimensions = settings.embeddingSettings.dimensions;
      this.app = app;
  }

  // Add this method to support the tests
  async searchNotes(query: string, maxResults: number) {
    if (!this.vectorStore || this.isVectorStoreEmpty()) {
      return [];
    }

    try {
      const queryEmbedding = await this.generateEmbedding(query);
      const searchResults = await this.vectorStore.search(queryEmbedding, {
        similarity: 0.5, // Default similarity threshold
        limit: maxResults,
        searchTerms: [] // No specific terms to boost
      });
      return searchResults;
    } catch (error) {
      logError('Error searching notes', error);
      return [];
    }
  }

  async initialize() {
      try {
          logDebug(this.settings, 'Initializing EmbeddingStore');
          // Initialize the embedding model based on settings
          const provider = this.settings.embeddingSettings.provider;

          if (provider === 'openai' || provider === 'local') {
              this.embeddingModel = {
                  embed: async (text: string) => {
                      return await this.generateProviderEmbedding(text);
                  }
              };
              logDebug(this.settings, `Using ${provider} embeddings`);
          } else {
              throw new Error('Invalid embedding provider. Must be either "openai" or "local".');
          }
          logDebug(this.settings, 'EmbeddingStore initialized successfully');
      } catch (error) {
          logError('Error initializing EmbeddingStore', error);
          throw error;
      }
  }

  async generateProviderEmbedding(text: string): Promise<Float32Array> {
      try {
          const provider = this.settings.embeddingSettings.provider;
          let apiUrl = provider === 'openai'
              ? (this.settings.embeddingSettings.openaiApiUrl || 'https://api.openai.com/v1/embeddings')
              : this.settings.embeddingSettings.localApiUrl;

          // Ensure API URL is defined
          if (!apiUrl) {
              throw new Error(`${provider} API URL is missing. Please configure it in the settings.`);
          }

          const model = provider === 'openai'
              ? this.settings.embeddingSettings.openaiModel
              : this.settings.embeddingSettings.localModel;

          const headers: Record<string, string> = {
              'Content-Type': 'application/json'
          };

          // Add Authorization header for OpenAI
          if (provider === 'openai') {
              const apiKey = this.settings.embeddingSettings.openaiApiKey;
              headers['Authorization'] = `Bearer ${apiKey}`;
          }

          const requestBody = {
              model: model,
              input: text
          };

          const requestParams: RequestUrlParam = {
              url: apiUrl,
              method: 'POST',
              headers: headers,
              body: JSON.stringify(requestBody)
          };

          const response = await requestUrl(requestParams);
          const responseData = response.json;

          if (responseData.data && responseData.data.length > 0 && responseData.data[0].embedding) {
              const embedding = new Float32Array(responseData.data[0].embedding);

              // Validate dimensionality
              if (embedding.length !== this.dimensions) {
                  logError(`${provider} embedding dimensionality (${embedding.length}) does not match expected dimensionality (${this.dimensions}). This may cause issues with vector search.`);
                  // Update the dimensions setting to match the actual embedding
                  this.dimensions = embedding.length;
                  this.settings.embeddingSettings.dimensions = embedding.length;
              }

              return embedding;
          } else {
              throw new Error(`Invalid response format from ${provider} embeddings API`);
          }
      } catch (error) {
          logError(`Error generating ${this.settings.embeddingSettings.provider} embedding`, error);
          throw error;
      }
  }

  async addNote(file: TFile, content: string) {
      try {
          logDebug(this.settings, `Processing note for embeddings: ${file.path}`);

          // Handle empty or very short content gracefully
          if (!this.isValidContent(file.path, content)) {
              return;
          }

          const chunks = this.chunkContent(content);
          logDebug(this.settings, `Created ${chunks.length} chunks for ${file.path}`);

          // If no chunks were created, skip this file
          if (chunks.length === 0) {
              logDebug(this.settings, `No chunks created for ${file.path}. Skipping.`);
              return;
          }

          const embeddings = await Promise.all(
              chunks.map(async (chunk, index) => {
                  const embedding = await this.generateEmbedding(chunk.content);
                  logDebug(this.settings, `Generated embedding for chunk ${index + 1}/${chunks.length} of ${file.path}`);
                  return embedding;
              })
          );

          const noteEmbedding: NoteEmbedding = {
              path: file.path,
              chunks: chunks.map((chunk, i) => ({
                  content: chunk.content,
                  embedding: embeddings[i],
                  position: chunk.position
              }))
          };

          // Store in both EmbeddingStore and VectorStore
          this.embeddings.set(file.path, noteEmbedding);
          this.vectorStore.addEmbedding(file.path, noteEmbedding);
          logDebug(this.settings, `Successfully added embeddings for ${file.path}`);
      } catch (error) {
          logError(`Error adding note ${file.path}`, error);
          throw error;
      }
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
      try {
          if (!this.embeddingModel) {
              throw new Error('Embedding model not initialized');
          }

          // Check provider-specific requirements before attempting to generate embeddings
          if (this.settings.embeddingSettings.provider === 'openai' && !this.settings.embeddingSettings.openaiApiKey) {
              throw new Error('OpenAI API key is missing. Please configure it in the settings.');
          } else if (this.settings.embeddingSettings.provider === 'local' && !this.settings.embeddingSettings.localApiUrl) {
              throw new Error('Local API URL is missing. Please configure it in the settings.');
          }

          const embedding = await this.embeddingModel.embed(text);
          if (!embedding || !(embedding instanceof Float32Array)) {
              throw new Error('Invalid embedding generated');
          }
          return embedding;
      } catch (error) {
          logError('Error generating embedding', error);
          // Re-throw the error with a clear message
          throw new Error(`Failed to generate embedding: ${error.message}`);
      }
  }

  private chunkContent(content: string): { content: string; position: number }[] {
      const chunkSize = this.settings.embeddingSettings.chunkSize;
      const chunkOverlap = this.settings.embeddingSettings.chunkOverlap;
      const chunks: { content: string; position: number }[] = [];

      // Split content into sections based on headers
      const sections = content.split(/(?=^#{1,6}\s)/m);
      let position = 0;

      for (const section of sections) {
          if (section.trim().length === 0) continue;

          // Split section into paragraphs
          const paragraphs = section.split(/\n\s*\n/);
          let currentChunk = '';
          let chunkStartPosition = position;
          let lastChunkContent = ''; // Keep track of last chunk for overlap

          for (const paragraph of paragraphs) {
              const trimmedParagraph = paragraph.trim();
              if (trimmedParagraph.length === 0) continue;

              // If this is a header paragraph, always start a new chunk
              const isHeader = /^#{1,6}\s/.test(trimmedParagraph);

              if (isHeader || (currentChunk.length + trimmedParagraph.length > chunkSize && currentChunk.length > 0)) {
                  if (currentChunk.length > 0) {
                      chunks.push({
                          content: currentChunk.trim(),
                          position: chunkStartPosition
                      });
                      lastChunkContent = currentChunk;
                  }

                  // Start new chunk, including overlap from previous chunk if available
                  if (!isHeader && lastChunkContent.length > 0) {
                      // Get the last few sentences or paragraphs up to chunkOverlap characters
                      const overlapText = this.getOverlapText(lastChunkContent, chunkOverlap);
                      currentChunk = overlapText + '\n\n' + trimmedParagraph;
                  } else {
                      currentChunk = trimmedParagraph;
                  }
                  chunkStartPosition = position - (isHeader ? 0 : chunkOverlap);
              } else {
                  // Add to current chunk
                  currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + trimmedParagraph;
              }

              position += trimmedParagraph.length + 2; // +2 for newlines
          }

          // Add the last chunk of the section
          if (currentChunk.length > 0) {
              chunks.push({
                  content: currentChunk.trim(),
                  position: chunkStartPosition
              });
              lastChunkContent = currentChunk;
          }
      }

      // If we have very small chunks at the end, combine them with overlap
      const consolidatedChunks: { content: string; position: number }[] = [];
      let currentConsolidated = '';
      let currentPosition = 0;
      let lastConsolidatedContent = '';

      for (const chunk of chunks) {
          const wouldExceedSize = currentConsolidated.length + chunk.content.length > chunkSize;

          if (!wouldExceedSize) {
              if (currentConsolidated.length > 0) {
                  currentConsolidated += '\n\n';
              }
              currentConsolidated += chunk.content;
              if (currentConsolidated.length === 0) {
                  currentPosition = chunk.position;
              }
          } else {
              if (currentConsolidated.length > 0) {
                  consolidatedChunks.push({
                      content: currentConsolidated,
                      position: currentPosition
                  });
                  lastConsolidatedContent = currentConsolidated;

                  // Start new consolidated chunk with overlap
                  const overlapText = this.getOverlapText(lastConsolidatedContent, chunkOverlap);
                  currentConsolidated = overlapText + '\n\n' + chunk.content;
                  currentPosition = chunk.position - chunkOverlap;
              } else {
                  currentConsolidated = chunk.content;
                  currentPosition = chunk.position;
              }
          }
      }

      if (currentConsolidated.length > 0) {
          consolidatedChunks.push({
              content: currentConsolidated,
              position: currentPosition
          });
      }

      return consolidatedChunks;
  }

  // Helper method to get overlap text
  private getOverlapText(text: string, overlapLength: number): string {
      if (text.length <= overlapLength) return text;

      // Try to break at sentence boundaries first
      const sentences = text.split(/(?<=[.!?])\s+/);
      let overlap = '';

      // Build up overlap text from complete sentences
      for (let i = sentences.length - 1; i >= 0; i--) {
          const potentialOverlap = sentences[i] + (overlap ? ' ' + overlap : '');
          if (potentialOverlap.length > overlapLength) break;
          overlap = potentialOverlap;
      }

      // If we couldn't get enough text from sentence boundaries,
      // fall back to paragraph boundaries
      if (overlap.length < overlapLength * 0.5) {
          const paragraphs = text.split(/\n\s*\n/);
          overlap = '';

          for (let i = paragraphs.length - 1; i >= 0; i--) {
              const potentialOverlap = paragraphs[i] + (overlap ? '\n\n' + overlap : '');
              if (potentialOverlap.length > overlapLength) break;
              overlap = potentialOverlap;
          }
      }

      // If we still don't have enough overlap, just take the last N characters
      if (overlap.length < overlapLength * 0.5) {
          overlap = text.slice(-overlapLength);
      }

      return overlap;
  }

  removeNote(path: string) {
      this.embeddings.delete(path);
      // Also remove from the vector store
      this.vectorStore.removeEmbedding(path);
      logDebug(this.settings, `Removed embeddings for ${path}`);
  }

  // Helper method to validate note content before processing
  public isValidContent(path: string, content: string): boolean {
      if (!content || content.trim().length < 50) {
          logDebug(this.settings, `File ${path} is too short to generate meaningful embeddings (${content.length} chars). Skipping.`);
          return false;
      }
      return true;
  }

  async saveToFile() {
      try {
          const data: PersistedEmbeddingStore = {
              version: 1,
              lastUpdated: Date.now(),
              embeddings: Object.fromEntries(
                  Array.from(this.embeddings.entries()).map(([path, embedding]) => [
                      path,
                      {
                          ...embedding,
                          chunks: embedding.chunks.map(chunk => ({
                              ...chunk,
                              embedding: Array.from(chunk.embedding)
                          })),
                          lastModified: (this.app.vault.getAbstractFileByPath(path) as TFile)?.stat?.mtime || Date.now()
                      }
                  ])
              )
          };
          await this.app.vault.adapter.write(
              '.obsidian/plugins/obsidian-ai-helper/embeddings.json',
              JSON.stringify(data)
          );
          logDebug(this.settings, 'Successfully saved embeddings to file');
      } catch (error) {
          logError('Error saving embeddings to file', error);
      }
  }

  async loadFromFile() {
      try {
          const filePath = '.obsidian/plugins/obsidian-ai-helper/embeddings.json';

          // Check if file exists first
          const exists = await this.app.vault.adapter.exists(filePath);
          if (!exists) {
              logDebug(this.settings, 'No existing embeddings file found. Starting with empty index.');
              return;
          }

          const data = JSON.parse(
              await this.app.vault.adapter.read(filePath)
          ) as PersistedEmbeddingStore;

          // Clear existing embeddings
          this.embeddings.clear();
          this.vectorStore.clear();

          // Load embeddings
          for (const [path, embedding] of Object.entries(data.embeddings)) {
              const file = this.app.vault.getAbstractFileByPath(path);
              if (file instanceof TFile) {
                  // Check if file has been modified since last save
                  if (file.stat.mtime > embedding.lastModified) {
                      // File changed, needs reindexing
                      const content = await this.app.vault.cachedRead(file);
                      await this.addNote(file, content);
                  } else {
                      // File unchanged, load from cache
                      const noteEmbedding: NoteEmbedding = {
                          path: embedding.path,
                          chunks: embedding.chunks.map(chunk => ({
                              ...chunk,
                              embedding: new Float32Array(chunk.embedding)
                          }))
                      };
                      this.embeddings.set(path, noteEmbedding);
                      this.vectorStore.addEmbedding(path, noteEmbedding);
                  }
              }
          }
          logDebug(this.settings, 'Successfully loaded embeddings from file');
      } catch (error) {
          // Only log as debug since this is expected on first run
          if (error.code === 'ENOENT') {
              logDebug(this.settings, 'No existing embeddings file found. Starting with empty index.');
          } else {
              // For other errors, log as error and reindex
              logError('Error loading embeddings from file', error);
              // If load fails for other reasons, reindex everything
              await this.reindexAll();
          }
      }
  }

  private async reindexAll() {
      const files = this.app.vault.getMarkdownFiles();
      logDebug(this.settings, `Reindexing all ${files.length} files`);

      // Show progress notice for reindexing
      const progressNotice = new Notice('', 0);
      const progressElement = progressNotice.noticeEl.createDiv();
      progressElement.setText('Initializing index...');

      try {
          let processedCount = 0;
          for (const file of files) {
              try {
                  const content = await this.app.vault.cachedRead(file);
                  if (this.isValidContent(file.path, content)) {
                      await this.addNote(file, content);
                  }
                  processedCount++;
                  progressElement.setText(
                      `Indexing files: ${processedCount}/${files.length} (${file.path})`
                  );
              } catch (error) {
                  logError(`Error reindexing file ${file.path}`, error);
              }
          }

          // Save the embeddings after reindexing
          await this.saveToFile();

          // Show completion notice
          new Notice(`Indexing complete: ${processedCount} files processed`, 3000);
      } catch (error) {
          new Notice('Error during reindexing: ' + error, 10000);
          logError('Error during reindexing', error);
          throw error;
      } finally {
          progressNotice.hide();
      }
  }

  getEmbeddedPaths(): string[] {
      return Array.from(this.embeddings.keys());
  }

  getEmbedding(path: string): NoteEmbedding | undefined {
      return this.embeddings.get(path);
  }

  // Helper method to check if vector store is empty
  private isVectorStoreEmpty(): boolean {
    return this.embeddings.size === 0;
  }
}

// Function to initialize the embedding system directly without requiring a view
export async function initializeEmbeddingSystem(settings: Settings, app: App): Promise<void> {
    // If already initialized or initializing, don't start again
    if (isGloballyInitialized || globalInitializationPromise) {
        return;
    }

    // Create global instances if they don't exist yet
    if (!globalVectorStore) {
        globalVectorStore = new VectorStore(settings.embeddingSettings.dimensions, settings, app);
    } else {
        // Ensure the app is set on the existing vector store
        globalVectorStore.setApp(app);
    }

    if (!globalEmbeddingStore) {
        globalEmbeddingStore = new EmbeddingStore(settings, globalVectorStore, app);
    }

    // Start the initialization process asynchronously
    globalInitializationPromise = (async () => {
        try {
            await globalEmbeddingStore.initialize();

            // Load cached embeddings first
            await globalEmbeddingStore.loadFromFile();

            // Only scan for changes if in onLoad or onUpdate mode
            if (['onLoad', 'onUpdate'].includes(settings.embeddingSettings.updateMode)) {
                // Scan for changes and update as needed
                await scanForChanges(app, settings, true);
            }

            isGloballyInitialized = true;

            // Dispatch a custom event that the plugin can listen for
            logDebug(settings, "Embedding initialization complete");
            const event = new CustomEvent('ai-helper-indexing-complete', {
                detail: { isInitialIndexing: true }
            });
            document.dispatchEvent(event);
            logDebug(settings, "Dispatched event: ai-helper-indexing-complete with isInitialIndexing=true");
        } catch (error) {
            // Reset initialization state on error
            isGloballyInitialized = false;
            globalInitializationPromise = null;
            logError('Error initializing vector search', error);
            // Re-throw the error to fail the entire initialization promise
            throw error;
        }
    })();

    return globalInitializationPromise;
}

async function scanForChanges(app: App, settings: Settings, isInitialLoad: boolean = false): Promise<void> {
    // Don't scan if update mode is 'none'
    if (settings.embeddingSettings.updateMode === 'none') return;

    // Don't scan for changes if in 'onLoad' mode and this isn't the initial load
    if (settings.embeddingSettings.updateMode === 'onLoad' && !isInitialLoad) return;

    if (!globalEmbeddingStore) return;

    const files = app.vault.getMarkdownFiles();
    const changedFiles = [];
    const deletedPaths = new Set<string>();

    // First, identify deleted files by comparing cached paths with existing files
    const existingPaths = new Set(files.map(f => f.path));
    for (const cachedPath of globalEmbeddingStore.getEmbeddedPaths()) {
        if (!existingPaths.has(cachedPath)) {
            deletedPaths.add(cachedPath);
        }
    }

    // Then identify modified files
    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        // Skip files that are too small
        if (!globalEmbeddingStore.isValidContent(file.path, content)) {
            continue;
        }
        const cached = globalEmbeddingStore.getEmbedding(file.path);
        if (!cached || file.stat.mtime > (cached as any).lastModified) {
            changedFiles.push(file);
        }
    }

    let totalChanges = changedFiles.length + deletedPaths.size;
    if (totalChanges > 0) {
        // Show progress for handling all changes
        const progressNotice = new Notice('', 0);
        const progressElement = progressNotice.noticeEl.createDiv();
        let processedCount = 0;

        try {
            // Remove deleted files from both memory and persisted store
            for (const deletedPath of deletedPaths) {
                globalEmbeddingStore.removeNote(deletedPath);
                processedCount++;
                progressElement.setText(
                    `Updating index: ${processedCount}/${totalChanges} (Removing deleted files)`
                );
            }

            // Update modified files
            for (const file of changedFiles) {
                progressElement.setText(
                    `Updating index: ${processedCount + 1}/${totalChanges} (Processing ${file.path})`
                );
                const content = await app.vault.cachedRead(file);
                await globalEmbeddingStore.addNote(file, content);
                processedCount++;
            }

            // Save updated embeddings after all changes are processed
            await globalEmbeddingStore.saveToFile();

            // Show summary of changes
            const deletedCount = deletedPaths.size;
            const modifiedCount = changedFiles.length;
            let summaryMessage = [];
            if (modifiedCount > 0) summaryMessage.push(`updated ${modifiedCount} files`);
            if (deletedCount > 0) summaryMessage.push(`removed ${deletedCount} deleted files`);

            new Notice(
                `Index update complete: ${summaryMessage.join(', ')}`,
                3000
            );
        } catch (error) {
            new Notice('Error during index update: ' + error, 10000);
            logError('Error during index update', error);
            throw error;
        } finally {
            progressNotice.hide();
        }
    }
}