import { App, TFile } from 'obsidian';
import { NoteEmbedding } from "../chat";
import { Settings } from "../settings";
import { logDebug, logError } from "../utils";
import { processQuery } from "../nlp";

export interface NoteChunk {
    content: string;
    embedding: Float32Array;
    position: number;
}

export interface SearchOptions {
    similarity: number;
    limit: number;
    searchTerms?: string[];
    phrases?: string[];
    query?: string; // Original query for advanced processing if needed
    file?: TFile;
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

  /**
   * Search the vector store using NLP-enhanced semantic search
   */
  async search(queryEmbedding: Float32Array, options: SearchOptions): Promise<{
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

      // Extract search parameters
      const similarityThreshold = options.similarity;
      const limit = options.limit;
      const searchTerms = options.searchTerms || [];
      const phrases = options.phrases || [];

      // Process the original query if available
      let queryProcessingResult = null;
      if (options.query) {
          queryProcessingResult = processQuery(options.query, this.settings);
          logDebug(this.settings, `Vector search using processed query: ${JSON.stringify({
              tokens: queryProcessingResult.tokens,
              expandedTokens: queryProcessingResult.expandedTokens,
              phrases: queryProcessingResult.phrases
          })}`);
      }

      for (const [path, noteEmbedding] of this.embeddings.entries()) {
          let maxSimilarity = 0;
          let bestChunkIndex = -1;

          // Calculate title relevance score using NLP-processed terms
          const filename = path.split('/').pop()?.toLowerCase() || '';
          let titleScore = 0;

          // Use expanded tokens for better recall if available
          const termsForTitleMatch = queryProcessingResult?.expandedTokens || searchTerms;

          // Calculate title match score
          titleScore = termsForTitleMatch.reduce((score, term) => {
              // Don't try to match phrases in the title score calculation
              if (term.includes(' ')) return score;

              // Exact token match
              if (filename.includes(term.toLowerCase())) {
                  score += this.settings.chatSettings.titleMatchBoost;
              }

              // Match word boundaries for more precise matching
              const wordBoundaryRegex = new RegExp(`\\b${term.toLowerCase()}\\b`);
              if (wordBoundaryRegex.test(filename)) {
                  score += this.settings.chatSettings.titleMatchBoost * 1.2; // Higher score for exact word match
              }

              return score;
          }, 0);

          // Additional boost for exact phrase matches in title
          const phrasesForMatch = queryProcessingResult?.phrases || phrases;
          phrasesForMatch.forEach(phrase => {
              if (filename.includes(phrase.toLowerCase())) {
                  titleScore += this.settings.chatSettings.titleMatchBoost * 1.5; // Higher boost for phrases
              }
          });

          // Calculate recency score if we have access to the file
          const file = this.app?.vault.getAbstractFileByPath(path);
          const recencyScore = file instanceof TFile ? this.calculateRecencyScore(file.stat.mtime) : 0;

          // Add a slight boost if this is the active file
          const isActiveFile = options.file && options.file.path === path;
          const activeFileBoost = isActiveFile ? 0.05 : 0;

          // Track the best matching chunks for this note
          const noteChunks: {
              similarity: number;
              index: number;
              isHeader: boolean;
              phraseMatchScore: number;
              termMatchScore: number;
          }[] = [];

          for (let i = 0; i < noteEmbedding.chunks.length; i++) {
              const chunk = noteEmbedding.chunks[i];
              if (!chunk?.embedding || chunk.embedding.length !== this.dimensions) continue;

              // Calculate vector similarity - the core of semantic search
              const similarity = this.calculateCosineSimilarity(queryEmbedding, chunk.embedding);

              // Check if this chunk starts with a header
              const isHeader = /^#{1,6}\s/.test(chunk.content.trim());
              const headerBoost = isHeader ? 0.05 : 0; // Small boost for header chunks

              // Calculate exact phrase matches
              const phraseMatchScore = this.calculatePhraseMatchScore(chunk.content, phrasesForMatch);

              // Calculate term match score for expanded terms
              const termMatchScore = this.calculateTermMatchScore(chunk.content, termsForTitleMatch);

              // Push chunk with all scores
              noteChunks.push({
                  similarity,
                  index: i,
                  isHeader,
                  phraseMatchScore,
                  termMatchScore
              });

              if (similarity > maxSimilarity) {
                  maxSimilarity = similarity;
                  bestChunkIndex = i;
              }
          }

          // Sort chunks by total relevance (combining semantic and lexical matching)
          noteChunks.sort((a, b) => {
              // Define headerBoost here for use in the sort function
              const headerBoostA = a.isHeader ? 0.05 : 0;
              const headerBoostB = b.isHeader ? 0.05 : 0;

              const totalScoreA = a.similarity + a.phraseMatchScore + a.termMatchScore + headerBoostA;
              const totalScoreB = b.similarity + b.phraseMatchScore + b.termMatchScore + headerBoostB;
              return totalScoreB - totalScoreA;
          });

          // Include all chunks that meet the similarity threshold
          for (const chunk of noteChunks) {
              const baseScore = chunk.similarity;
              const headerBoost = chunk.isHeader ? 0.05 : 0;

              // Combine all signals for the final score
              const combinedScore =
                  baseScore +
                  titleScore +
                  recencyScore +
                  chunk.phraseMatchScore +
                  chunk.termMatchScore +
                  headerBoost +
                  activeFileBoost;

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

  /**
   * Calculate score for exact phrase matches
   * @param content The content to check for phrase matches
   * @param phrases Array of phrases to look for
   * @returns A score based on phrase matches
   */
  private calculatePhraseMatchScore(content: string, phrases: string[]): number {
      if (!phrases || phrases.length === 0) return 0;

      const lowerContent = content.toLowerCase();
      let score = 0;

      phrases.forEach(phrase => {
          const regex = new RegExp(phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          const matches = (lowerContent.match(regex) || []).length;
          if (matches > 0) {
              // Give higher weight to phrase matches than individual term matches
              score += matches * 0.2;
          }
      });

      return score;
  }

  /**
   * Calculate score for term matches (expanded terms from NLP processing)
   * @param content The content to check for term matches
   * @param terms Array of terms to look for
   * @returns A score based on term matches
   */
  private calculateTermMatchScore(content: string, terms: string[]): number {
      if (!terms || terms.length === 0) return 0;

      const lowerContent = content.toLowerCase();
      let score = 0;

      terms.forEach(term => {
          // Skip phrases in term match scoring (they're handled in phraseMatchScore)
          if (term.includes(' ')) return;

          // Word boundary match (exact word)
          const wordBoundaryRegex = new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          const exactMatches = (lowerContent.match(wordBoundaryRegex) || []).length;
          if (exactMatches > 0) {
              score += exactMatches * 0.15; // Higher weight for exact matches
          }

          // Partial match (substring)
          if (lowerContent.includes(term.toLowerCase())) {
              score += 0.05; // Small boost for partial matches
          }
      });

      return score;
  }
}
