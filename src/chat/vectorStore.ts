import { App, TFile } from 'obsidian';
import { NoteEmbedding } from "src/chat";
import { Settings } from "src/settings";
import { logDebug, logError } from "src/utils";

export interface NoteChunk {
    content: string;
    embedding?: Float32Array;
}

export class VectorStore {
  private embeddings: Map<string, NoteEmbedding> = new Map();
  private dimensions: number;
  private index: Map<string, { chunks: NoteChunk[], maxScore: number }> = new Map();
  private app: App | null = null;
  private settings: Settings;

  constructor(dimensions: number, settings: Settings, app?: App) {
      this.dimensions = dimensions;
      this.settings = settings;
      if (app) this.setApp(app);
  }

  setApp(app: App) {
      this.app = app;
  }

  clear() {
      this.embeddings.clear();
      this.index.clear();
      logDebug(this.settings, 'Cleared vector store');
  }

  // Helper method to calculate recency score
  private calculateRecencyScore(mtime: number): number {
      const now = Date.now();
      const daysSinceModified = (now - mtime) / (1000 * 60 * 60 * 24);

      // Exponential decay function that gives:
      // - 0.1 (max recency boost) for files modified today
      // - 0.05 for files modified a week ago
      // - 0.025 for files modified a month ago
      // - Approaching 0 for older files
      return 0.1 * Math.exp(-daysSinceModified / 30);
  }

  async search(queryEmbedding: Float32Array, options: {
      similarity: number;
      limit: number;
      searchTerms?: string[];
      file?: TFile;
  }): Promise<{
      path: string;
      score: number;
      chunkIndex?: number;
      titleScore?: number;
      recencyScore?: number;
  }[]> {
      if (this.embeddings.size === 0) {
          console.warn('No embeddings found in vector store');
          return [];
      }

      const results: {
          path: string;
          score: number;
          chunkIndex?: number;
          titleScore?: number;
          recencyScore?: number;
          baseScore: number;
      }[] = [];

      const similarityThreshold = options.similarity;
      const limit = options.limit;
      const searchTerms = options.searchTerms || [];

      for (const [path, noteEmbedding] of this.embeddings.entries()) {
          let maxSimilarity = 0;
          let bestChunkIndex = -1;

          // Calculate title relevance score
          const filename = path.split('/').pop()?.toLowerCase() || '';
          const titleScore = searchTerms.reduce((score, term) => {
              if (filename.includes(term.toLowerCase())) {
                  score += 0.5;
              }
              return score;
          }, 0);

          // Calculate recency score if we have access to the file
          const file = this.app?.vault.getAbstractFileByPath(path);
          const recencyScore = file instanceof TFile ? this.calculateRecencyScore(file.stat.mtime) : 0;

          // Track the best matching chunks for this note
          const noteChunks: { similarity: number; index: number; isHeader: boolean }[] = [];

          for (let i = 0; i < noteEmbedding.chunks.length; i++) {
              const chunk = noteEmbedding.chunks[i];
              if (!chunk?.embedding || chunk.embedding.length !== this.dimensions) continue;

              const similarity = this.calculateCosineSimilarity(queryEmbedding, chunk.embedding);

              // Check if this chunk starts with a header
              const isHeader = /^#{1,6}\s/.test(chunk.content.trim());

              noteChunks.push({ similarity, index: i, isHeader });

              if (similarity > maxSimilarity) {
                  maxSimilarity = similarity;
                  bestChunkIndex = i;
              }
          }

          // Sort chunks by similarity
          noteChunks.sort((a, b) => b.similarity - a.similarity);

          // Include all chunks that meet the similarity threshold
          for (const chunk of noteChunks) {
              const baseScore = chunk.similarity;
              const combinedScore = baseScore + titleScore + recencyScore;

              if (combinedScore >= similarityThreshold) {
                  results.push({
                      path,
                      score: combinedScore,
                      baseScore,
                      chunkIndex: chunk.index,
                      titleScore,
                      recencyScore
                  });
              }
          }
      }

      // Sort by combined score and limit results
      const sortedResults = results
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(({ baseScore, ...rest }) => rest); // Remove baseScore from final results

      logDebug(this.settings, `Search results with scores: ${JSON.stringify(sortedResults.map(r => ({
          path: r.path,
          total: r.score.toFixed(3),
          title: r.titleScore?.toFixed(3) || '0',
          recency: r.recencyScore?.toFixed(3) || '0'
      })))}`);

      return sortedResults;
  }

  private calculateCosineSimilarity(a: Float32Array, b: Float32Array): number {
      // Ensure both vectors have the same dimensionality
      if (a.length !== b.length) {
          logError(`Cannot calculate similarity between vectors of different dimensions (${a.length} vs ${b.length})`);
          return 0;
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
      }

      normA = Math.sqrt(normA);
      normB = Math.sqrt(normB);

      if (normA === 0 || normB === 0) return 0;

      return dotProduct / (normA * normB);
  }

  addEmbedding(path: string, embedding: NoteEmbedding) {
      // Validate the embedding before adding
      if (!embedding || !embedding.chunks || embedding.chunks.length === 0) {
          logDebug(this.settings, `Skipping embedding for path: ${path} - No chunks available`);
          return;
      }

      // Validate all chunks have the correct dimensionality
      const validChunks = embedding.chunks.every(chunk => {
          if (!chunk.embedding || chunk.embedding.length !== this.dimensions) {
              logError(`Invalid chunk embedding in ${path}. Expected ${this.dimensions} dimensions, got ${chunk.embedding?.length || 0}`);
              return false;
          }
          return true;
      });

      if (!validChunks) {
          logDebug(this.settings, `Skipping invalid embedding for path: ${path} - Dimension mismatch`);
          return;
      }

      this.embeddings.set(path, embedding);
      logDebug(this.settings, `Added embedding for ${path} with ${embedding.chunks.length} chunks`);

      // Initialize index entry
      this.index.set(path, {
          chunks: embedding.chunks,
          maxScore: 0
      });
  }

  removeEmbedding(path: string) {
      this.embeddings.delete(path);
      this.index.delete(path);
  }

  // Get a specific chunk from a note
  getChunk(path: string, chunkIndex: number): NoteChunk | null {
      const noteEmbedding = this.embeddings.get(path);
      if (!noteEmbedding || chunkIndex < 0 || chunkIndex >= noteEmbedding.chunks.length) {
          return null;
      }
      return noteEmbedding.chunks[chunkIndex];
  }

  // Get all chunks for a note
  getAllChunks(path: string): NoteChunk[] | null {
      const noteEmbedding = this.embeddings.get(path);
      if (!noteEmbedding) {
          return null;
      }
      return noteEmbedding.chunks;
  }
}
