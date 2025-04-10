import { TFile } from 'obsidian';
import { Settings } from '../settings';
import { logDebug, logError } from '../utils';
import { EmbeddingModel, NoteChunk, NoteEmbedding } from '../types';
import { VectorStore } from './vectorStore';
import { APIClient } from '../api/apiClient';

export class EmbeddingStore {
  private embeddings: Map<string, NoteEmbedding> = new Map();
  private settings: Settings;
  private vectorStore: VectorStore;
  private embeddingModel: EmbeddingModel;
  private dimensions: number;
  private apiClient: APIClient;

  constructor(settings: Settings, vectorStore: VectorStore) {
    this.settings = settings;
    this.vectorStore = vectorStore;
    this.dimensions = settings.embeddingSettings.dimensions;
    this.apiClient = new APIClient(settings);
  }

  async initialize() {
    try {
      logDebug(this.settings, 'Initializing EmbeddingStore');

      // Initialize the embedding model
      this.embeddingModel = {
        embed: async (text: string) => {
          return await this.apiClient.generateEmbedding(text);
        }
      };

      logDebug(this.settings, 'EmbeddingStore initialized successfully');
    } catch (error) {
      logError('Error initializing EmbeddingStore', error);
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
        logError('Embedding model not initialized');
        throw new Error('Embedding model not initialized');
      }
      const embedding = await this.embeddingModel.embed(text);
      if (!embedding || !(embedding instanceof Float32Array)) {
        logError(`Invalid embedding generated: ${typeof embedding}`);
        throw new Error('Invalid embedding generated');
      }
      return embedding;
    } catch (error) {
      logError('Error generating embedding', error);
      throw error;
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
  private isValidContent(path: string, content: string): boolean {
    if (!content || content.trim().length < 50) {
      logDebug(this.settings, `File ${path} is too short to generate meaningful embeddings (${content.length} chars). Skipping.`);
      return false;
    }
    return true;
  }
}