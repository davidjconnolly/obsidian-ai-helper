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
    type: 'string' as SearchableType,
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

  async searchNotes(query: string, filters?: SearchFilters): Promise<NoteSearchResult[]> {
    console.log('Original Query:', query);
    console.log('Filters:', JSON.stringify(filters, null, 2));

    // Get query embedding using search terms and context
    const searchText = [
      query,
      filters?.tags?.join(' ')
    ].filter(Boolean).join(' ');

    try {
      // Generate embedding for search query
      console.log('Generating embedding for:', searchText);
      const queryEmbedding = await this.llmService.getEmbedding(searchText);

      // Create filter function based on provided filters
      const filterFn = this.createFilterFunction(filters);

      // Basic search first to get candidates
      // Create a search query with proper where conditions
      const searchOptions = {
        limit: 20
      };

      // Only add where if we have filters
      if (Object.keys(filterFn).length > 0) {
        Object.assign(searchOptions, { where: filterFn });
      }

      console.log('Search options:', JSON.stringify(searchOptions, null, 2));
      const searchResults = await search(this.vectorDB, searchOptions as any);

      console.log(`Found ${searchResults.hits.length} initial candidates`);

      // Extract documents from search results
      const candidateDocuments = searchResults.hits.map(hit => {
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

      // Compute similarity scores
      const results = this.rankDocumentsByVector(candidateDocuments, queryEmbedding, query);

      // Only return results with scores above threshold
      const threshold = 0.5;
      const filteredResults = results.filter(result => result.score > threshold);

      console.log(`Returning ${filteredResults.length} results after scoring`);
      return filteredResults;
    } catch (error) {
      console.error('Error searching notes:', error);
      throw error;
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

    // Add type filter
    if (filters.type) {
      // Check if we have multiple types (pipe-separated)
      if (filters.type.includes('|')) {
        const types = filters.type.split('|');
        // Use 'in' operator for multiple types
        filterObject['metadata.type'] = {
          in: types
        };
      } else {
        // Single type - use equality
        filterObject['metadata.type'] = {
          eq: filters.type
        };
      }
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
    const normalizedContent = content.toLowerCase();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);

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