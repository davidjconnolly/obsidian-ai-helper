import { App, TFile } from 'obsidian';
import { create, insert, remove, search, save, load, Orama, SearchableType, AnySchema } from '@orama/orama';
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
      filters?.tags?.join(' '),
      filters?.type
    ].filter(Boolean).join(' ');

    const queryEmbedding = await this.llmService.getEmbedding(searchText);

    // Build search criteria
    const searchCriteria: any = {
      vector: queryEmbedding,
      limit: 50
    };

    // Add filters if provided
    if (filters) {
      // Create a single where clause combining all filters
      const whereClauses: Record<string, any> = {};

      if (filters.tags?.length) {
        whereClauses['metadata.tags'] = { contains: filters.tags };
      }

      if (filters.dateRange) {
        if (filters.dateRange.useCreatedDate) {
          // Only add date range if we have both start and end dates
          if (filters.dateRange.start && filters.dateRange.end) {
            // Search by note creation date
            const startTime = filters.dateRange.start.getTime();
            const endTime = filters.dateRange.end.getTime();
            console.log('Searching by creation date:', {
              start: new Date(startTime).toISOString(),
              end: new Date(endTime).toISOString()
            });

            // Use a single where clause for the date range
            whereClauses.createdAt = {
              between: [startTime, endTime]
            };
          }
        } else if (filters.dateRange.start) {
          // Search by dates mentioned in the content
          const searchDate = filters.dateRange.start.toISOString().split('T')[0];
          console.log('Searching by content date:', searchDate);
          whereClauses['metadata.dates'] = { contains: [searchDate] };
        }
      }

      // Only add where clause if we have filters
      if (Object.keys(whereClauses).length > 0) {
        searchCriteria.where = whereClauses;
      }
    }

    console.log('Search Criteria:', JSON.stringify(searchCriteria, (key, value) => {
      if (key === 'vector') return '[vector data]';
      return value;
    }, 2));

    const results = await search(this.vectorDB, searchCriteria);
    console.log('Raw Results:', JSON.stringify(results.hits.map(hit => ({
      id: hit.document.id,
      score: hit.score,
      metadata: {
        title: hit.document.metadata.title,
        path: hit.document.metadata.path,
        dates: hit.document.metadata.dates,
        createdAt: new Date(hit.document.createdAt).toISOString(),
        chunk: {
          index: hit.document.metadata.chunk.index,
          total: hit.document.metadata.chunk.total
        }
      }
    })), null, 2));

    if (results.hits.length === 0) {
      return [];
    }

    // Group results by file path to handle chunks
    const fileGroups = new Map<string, {
      highestScoringHit: typeof results.hits[0];
      allHits: typeof results.hits[0][];
    }>();

    for (const hit of results.hits) {
      const filePath = hit.document.metadata.path;
      const group = fileGroups.get(filePath) || { highestScoringHit: hit, allHits: [] };

      // Track highest scoring hit
      if (hit.score > group.highestScoringHit.score) {
        group.highestScoringHit = hit;
      }

      // Keep all hits - we'll filter by content matches later
      group.allHits.push(hit);
      fileGroups.set(filePath, group);
    }

    // Get content and check for matches
    const searchResults = await Promise.all(
      Array.from(fileGroups.values()).map(async ({ highestScoringHit, allHits }) => {
        const doc = highestScoringHit.document as unknown as VectorDBDocument;
        const content = await this.getFileContent(doc.metadata.path);

        // Use the query terms for exact matching
        const searchTerms = query.toLowerCase().split(/\s+/);
        const contentMatches = searchTerms.some(term =>
          content.toLowerCase().includes(term) ||
          doc.metadata.title.toLowerCase().includes(term)
        );

        // If we have a content match, boost the score
        const scoreBoost = contentMatches ? 0.5 : 0;

        // Create results for all chunks, marking the highest scoring one
        return allHits.map(hit => {
          const hitDoc = hit.document as unknown as VectorDBDocument;
          return {
            id: hitDoc.id,
            content: hitDoc.metadata.chunk.content,
            metadata: {
              ...hitDoc.metadata,
              frontmatter: JSON.parse(hitDoc.metadata.frontmatter) as Record<string, unknown>
            },
            score: hit.score + scoreBoost,
            matches: contentMatches,
            isHighestScoring: hit === highestScoringHit
          };
        });
      })
    );

    // Flatten and sort results
    const flatResults = searchResults.flat();

    // Only filter out results if we have some good matches
    const hasGoodMatches = flatResults.some(r => r.matches || r.score > 0.1);
    const filteredResults = hasGoodMatches
      ? flatResults.filter(r => r.matches || r.score > 0.1)
      : flatResults;

    return filteredResults.sort((a, b) => {
      // First sort by matches
      if (a.matches && !b.matches) return -1;
      if (!a.matches && b.matches) return 1;
      // Then by highest scoring status
      if (a.isHighestScoring && !b.isHighestScoring) return -1;
      if (!a.isHighestScoring && b.isHighestScoring) return 1;
      // Finally by score
      return b.score - a.score;
    });
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