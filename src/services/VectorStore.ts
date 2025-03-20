import { App, TFile } from 'obsidian';
import { create, insert, remove, search, save, load, Orama, SearchableType, AnySchema, SearchParams } from '@orama/orama';
import { MetadataExtractor, NoteMetadata } from '../metadata';
import { LLMService } from './LLMService';
import { SearchFilters } from './QueryParser';
import { Notice } from 'obsidian';

export interface NoteSearchResult {
  id: string;
  content: string;
  metadata: Omit<NoteMetadata, 'frontmatter'> & {
    frontmatter: Record<string, unknown>;
    chunk: {
      index: number;
      total: number;
      content: string;
    };
  };
  score: number;
  matches: boolean;  // Whether this result matches the search terms
  isHighestScoring: boolean;  // Whether this is the highest scoring chunk for this file
  bestMatchTerm?: string;  // Which sub-term matched the best
  avgScore?: number;  // Average score across all sub-terms
  termScores?: { term: string; score: number }[];  // Individual scores for each sub-term
}

// Use the same type as NoteMetadata for consistency
type VectorDBDocument = {
  id: string;
  metadata: Omit<NoteMetadata, 'frontmatter'> & {
    frontmatter: string; // Store as JSON string for Orama compatibility
    chunk: {
      index: number;
      total: number;
      content: string;
    };
  };
  vector: number[];
  lastModified: number;
  createdAt: number;
};

const schema: AnySchema = {
  id: 'string' as SearchableType,
  metadata: {
    title: 'string' as SearchableType,
    path: 'string' as SearchableType,
    tags: 'string[]' as SearchableType,
    dates: 'string[]' as SearchableType,
    frontmatter: 'string' as SearchableType,
    links: 'string[]' as SearchableType,
    chunk: {
      index: 'number' as SearchableType,
      total: 'number' as SearchableType,
      content: 'string' as SearchableType
    }
  },
  vector: 'number[]' as SearchableType,
  lastModified: 'number' as SearchableType,
  createdAt: 'number' as SearchableType
};

export class VectorStore {
  private vectorDB!: Orama<typeof schema>;

  constructor(private app: App, private llmService: LLMService) {}

  async initialize() {
    try {
      this.vectorDB = await create({
        schema,
        language: 'english'
      });

      // Try to load existing data
      try {
        const savedData = await this.app.vault.adapter.read('.obsidian-notes-db');
        if (savedData) {
          await load(this.vectorDB, JSON.parse(savedData));
          console.log('Loaded existing vector database');
          return;
        }
      } catch {
        // No existing data, continue with initialization
      }

      console.log('Creating new vector database');
      await this.embedAllNotes();
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      throw error;
    }
  }

  /**
   * Enhanced search method that uses two-phase approach with sub-term analysis
   */
  async searchNotes(query: string, filters?: SearchFilters): Promise<NoteSearchResult[]> {
    console.log('Original Query:', query);
    console.log('Filters:', JSON.stringify(filters, null, 2));

    try {
      // Simple validation - only warn for empty queries
      if (!query?.trim()) {
        console.warn('Empty search query received, results may be limited');
      }

      // PHASE 1: Metadata-based filtering
      const filterFn = this.createFilterFunction(filters);
      const metadataSearchOptions = {
        limit: 1000  // Higher limit for phase 1
      };

      if (Object.keys(filterFn).length > 0) {
        Object.assign(metadataSearchOptions, { where: filterFn });
      }

      console.log('Phase 1 - Metadata filter options:', JSON.stringify(metadataSearchOptions, null, 2));
      const metadataResults = await search(this.vectorDB, metadataSearchOptions as any);
      console.log(`Phase 1 - Found ${metadataResults.hits.length} documents matching metadata filters`);

      // If no metadata results or empty query, return early
      if (metadataResults.hits.length === 0 || !query.trim()) {
        return this.processSearchResults(metadataResults.hits.slice(0, 50), query);
      }

      // PHASE 2: Extract sub-terms and perform vector similarity search
      const subTerms = await this.analyzeQueryForSearchTerms(query);
      console.log('LLM extracted sub-terms:', subTerms);

      // Get embeddings for all sub-terms
      const embeddings: { term: string; embedding: number[] }[] = [];
      for (const term of subTerms) {
        console.log(`Generating embedding for sub-term: "${term}"`);
        const embedding = await this.llmService.getEmbedding(term);
        embeddings.push({ term, embedding });
      }

      // Extract candidate documents from metadata results
      const candidateDocuments = metadataResults.hits.map(hit => {
        const doc = hit.document as unknown as VectorDBDocument;
        return {
          ...doc,
          metadata: {
            ...doc.metadata,
            frontmatter: doc.metadata.frontmatter ? JSON.parse(doc.metadata.frontmatter) : {}
          },
          content: doc.metadata.chunk.content
        };
      });

      // Score documents against each sub-term embedding
      const documentScores = new Map<string, {
        doc: any,
        scores: { term: string; score: number }[],
        bestScore: number,
        avgScore: number,
        bestMatchTerm: string
      }>();

      // For each document
      for (const doc of candidateDocuments) {
        const scores: { term: string; score: number }[] = [];

        // Calculate similarity against each sub-term
        for (const { term, embedding } of embeddings) {
          const score = this.calculateCosineSimilarity(embedding, doc.vector);
          scores.push({ term, score });
        }

        // Find best match and calculate average
        const bestMatch = scores.reduce((best, current) =>
          current.score > best.score ? current : best, scores[0]);
        const bestScore = bestMatch.score;
        const bestMatchTerm = bestMatch.term;
        const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;

        documentScores.set(doc.id, {
          doc,
          scores,
          bestScore,
          avgScore,
          bestMatchTerm
        });
      }

      // Create final results using a combined ranking approach
      const scoredResults: NoteSearchResult[] = Array.from(documentScores.values()).map(({ doc, scores, bestScore, avgScore, bestMatchTerm }) => {
        // Check if document contains any search terms
        const containsSearchTerms = this.contentContainsQuery(doc.content, query);

        return {
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
          score: bestScore, // Primary score from best match
          avgScore: avgScore, // Average score for secondary sorting
          bestMatchTerm: bestMatchTerm, // Which term matched best
          termScores: scores, // All individual scores
          matches: containsSearchTerms,
          isHighestScoring: false // Will be updated later
        };
      });

      // Sort by exact matches first, then by semantic score
      const sortedResults = scoredResults.sort((a, b) => {
        // First prioritize exact matches
        if (a.matches && !b.matches) return -1;
        if (!a.matches && b.matches) return 1;

        // If both have same match status, use semantic scores
        if (Math.abs(a.score - b.score) < 0.05) { // If best scores are close
          return b.avgScore! - a.avgScore!; // Use average score as tiebreaker
        }
        return b.score - a.score;
      });

      // Mark highest scoring chunks for each file
      this.markHighestScoringChunks(sortedResults);

      // Apply different thresholds based on match type
      const exactMatchThreshold = 0.4;  // Lower threshold for exact matches
      const semanticMatchThreshold = 0.6;  // Higher threshold for semantic-only matches

      const filteredResults = sortedResults
        .filter(result => {
          // Keep exact matches with scores above exactMatchThreshold
          if (result.matches) {
            return result.score > exactMatchThreshold;
          }
          // Apply stricter threshold for semantic-only matches
          return result.score > semanticMatchThreshold;
        })
        .slice(0, 50);

      console.log(`Phase 2 - Returning ${filteredResults.length} results after scoring (Exact matches: ${filteredResults.filter(r => r.matches).length})`);
      return filteredResults;
    } catch (error) {
      console.error('Error searching notes:', error);
      throw error;
    }
  }

  /**
   * Process search results without vector similarity
   */
  private processSearchResults(hits: any[], query: string): NoteSearchResult[] {
    const documents = hits.map(hit => {
      const doc = hit.document as unknown as VectorDBDocument;
      return {
        id: doc.id,
        content: doc.metadata.chunk.content,
        metadata: {
          ...doc.metadata,
          frontmatter: doc.metadata.frontmatter ? JSON.parse(doc.metadata.frontmatter) : {}
        },
        score: hit.score || 1.0,
        matches: this.contentContainsQuery(doc.metadata.chunk.content, query),
        isHighestScoring: true
      };
    });

    return documents.slice(0, 50); // Limit to top 50 results
  }

  /**
   * Mark the highest scoring chunk for each file
   */
  private markHighestScoringChunks(results: NoteSearchResult[]): void {
    const fileGroups = new Map<string, NoteSearchResult[]>();

    // Group by file path
    for (const result of results) {
      const path = result.metadata.path;
      if (!fileGroups.has(path)) {
        fileGroups.set(path, []);
      }
      fileGroups.get(path)!.push(result);
    }

    // Mark highest scoring for each group
    for (const groupResults of fileGroups.values()) {
      const highestScore = Math.max(...groupResults.map(r => r.score));
      groupResults.forEach(result => {
        result.isHighestScoring = (result.score === highestScore);
      });
    }
  }

  /**
   * Use LLM to analyze query and extract meaningful search terms
   */
  async analyzeQueryForSearchTerms(query: string): Promise<string[]> {
    if (!query || !query.trim()) {
      return [query || ''];
    }

    const prompt = `
Analyze this search query and extract the main concepts that should be searched for separately.
Return these in a JSON array format with each concept as a separate string.
Include both the full query and its important sub-components.

QUERY: "${query}"

For example, for the query "How does climate change affect agriculture in coastal regions?" return:
["How does climate change affect agriculture in coastal regions?", "climate change", "agriculture", "coastal regions", "climate change effects on agriculture"]

For "How many times have I spoken to Rick this year?" return:
["How many times have I spoken to Rick this year?", "Rick", "conversations with Rick", "speaking", "communication"]

Your response (JSON array only):
`;

    try {
      const response = await this.llmService.getCompletion(prompt);
      console.log('LLM term extraction response:', response);

      const jsonMatch = response.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        console.warn('Could not extract JSON array from LLM response, using fallback');
        return [query];
      }

      const terms = JSON.parse(jsonMatch[0]) as string[];
      // Ensure we have at least the original query
      if (!terms.includes(query)) {
        terms.unshift(query);
      }
      return terms;
    } catch (error) {
      console.error('Error analyzing query for search terms:', error);
      return [query]; // Fallback to original query
    }
  }

  /**
   * Creates a filter function based on the provided search filters
   */
  private createFilterFunction(filters?: SearchFilters): Record<string, any> {
    if (!filters || Object.keys(filters).length === 0) {
      return {};
    }

    // We need to use a different approach since 'and' is not supported
    // Create a filter object that directly maps to properties
    const filterObject: Record<string, any> = {};

    // Add tag filter
    if (filters.tags && filters.tags.length > 0) {
      filterObject['metadata.tags'] = {
        in: filters.tags
      };
    }

    // Add date range filter
    if (filters.dateRange) {
      const { start, end, useCreatedDate } = filters.dateRange;
      const dateProperty = useCreatedDate ? 'createdAt' : 'lastModified';

      filterObject[dateProperty] = {
        // Use between operator instead of separate gte/lte
        between: [start.getTime(), end.getTime()]
      };
    }

    console.log('Created filter:', JSON.stringify(filterObject, null, 2));
    return filterObject;
  }

  /**
   * Ranks documents by vector similarity to the query
   */
  private rankDocumentsByVector(documents: any[], queryVector: number[], query: string): NoteSearchResult[] {
    // Group documents by file path
    const fileGroups = new Map<string, any[]>();

    for (const doc of documents) {
      const path = doc.metadata.path;
      if (!fileGroups.has(path)) {
        fileGroups.set(path, []);
      }
      fileGroups.get(path)!.push(doc);
    }

    // Calculate scores for each document
    const scoredResults: NoteSearchResult[] = [];

    for (const docs of fileGroups.values()) {
      // Sort chunks by index for the same file
      const sortedDocs = docs.sort((a, b) => a.metadata.chunk.index - b.metadata.chunk.index);

      // Score each document using cosine similarity
      const scoredDocs = sortedDocs.map(doc => {
        // Calculate cosine similarity
        const score = this.calculateCosineSimilarity(queryVector, doc.vector);

        return {
          id: doc.id,
          content: doc.content,
          metadata: doc.metadata,
          score,
          matches: this.contentContainsQuery(doc.content, query),
          isHighestScoring: false // Will be updated later
        };
      });

      // Find highest scoring document for this file
      const highestScore = Math.max(...scoredDocs.map(d => d.score));

      // Mark highest scoring chunk(s) for this file
      scoredDocs.forEach(doc => {
        if (doc.score === highestScore) {
          doc.isHighestScoring = true;
        }
      });

      scoredResults.push(...scoredDocs);
    }

    // Sort all results by score (descending)
    return scoredResults.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate the cosine similarity between two vectors
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error(`Vector dimensions don't match: ${vecA.length} vs ${vecB.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Check if content contains any part of the query
   */
  private contentContainsQuery(content: string, query: string): boolean {
    if (!content || !query) {
      return false;
    }

    const normalizedContent = content.toLowerCase();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);

    // If no valid query terms, return false
    if (queryTerms.length === 0) {
      return false;
    }

    return queryTerms.some(term => normalizedContent.includes(term));
  }

  private async getFileContent(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    throw new Error(`File not found: ${path}`);
  }

  private async embedAllNotes() {
    const files = this.app.vault.getMarkdownFiles();
    const totalFiles = files.length;
    let processedFiles = 0;

    // Show initial progress notice
    const progressNotice = new Notice(`Updating vector database: 0/${totalFiles} files`, 0);

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const metadata = await MetadataExtractor.extractMetadata(file, content);
      const metadataEmbedding = MetadataExtractor.createMetadataEmbedding(metadata);

      // Split content into paragraphs
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());

      // Create chunks of ~3 paragraphs with 1 paragraph overlap
      const chunkSize = 3;
      const chunks: string[] = [];

      for (let i = 0; i < paragraphs.length; i += chunkSize - 1) {
        const chunk = paragraphs.slice(i, i + chunkSize).join('\n\n');
        if (chunk.trim()) {
          chunks.push(chunk);
        }
      }

      // If no chunks (very short note), use whole content as one chunk
      if (chunks.length === 0) {
        chunks.push(content);
      }

      // Create an embedding for each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Combine metadata with chunk
        const combinedText = [
          // Title and metadata for context
          metadataEmbedding,

          // Add chunk position context
          `This is part ${i + 1} of ${chunks.length} from this note.`,

          // The actual chunk content
          chunk
        ].join('\n\n');

        const vector = await this.llmService.getEmbedding(combinedText);

        const doc: VectorDBDocument = {
          // Add chunk number to id to make it unique
          id: `${file.path}#chunk${i + 1}`,
          metadata: {
            ...metadata,
            frontmatter: JSON.stringify(metadata.frontmatter),
            chunk: {
              index: i + 1,
              total: chunks.length,
              content: chunk
            }
          },
          vector,
          lastModified: file.stat.mtime,
          createdAt: file.stat.ctime
        };

        await insert(this.vectorDB, doc);
      }

      // Update progress
      processedFiles++;
      progressNotice.setMessage(`Updating vector database: ${processedFiles}/${totalFiles} files`);
    }

    // Show completion notice
    progressNotice.hide();
    new Notice(`Vector database updated with ${totalFiles} files`);

    await this.saveEmbeddings();
  }

  async saveEmbeddings() {
    const data = await save(this.vectorDB);
    await this.app.vault.adapter.write('.obsidian-notes-db', JSON.stringify(data));
  }
}