import { NoteWithContent } from "src/chat";
import { VectorStore, NoteChunk } from "./vectorStore";
import { Settings } from "src/settings";

export class ContextManager {
  private vectorStore: VectorStore;
  private settings: Settings;

  constructor(vectorStore: VectorStore, settings: Settings) {
      this.vectorStore = vectorStore;
      this.settings = settings;
  }

  buildContext(query: string, notes: NoteWithContent[]): string {
    let context = '';

    // Add relevant notes
    if (notes.length > 0) {
      // Sort notes by relevance
      const sortedNotes = [...notes].sort((a, b) => b.relevance - a.relevance);

      for (const note of sortedNotes) {
        const excerpt = this.extractRelevantExcerpt(note, query);
        if ((context + excerpt).length < this.settings.chatSettings.maxContextLength) {
          context += `File: ${note.file.basename}\n`;
          context += `Path: ${note.file.path}\n`;
          context += `Relevance: ${note.relevance.toFixed(2)}\n`;
          context += `Content: ${excerpt}\n\n`;
        } else {
          break;
        }
      }
    } else {
      context += "\n\nI couldn't find any notes specifically related to your query.";
    }

    return context;
  }

  private extractRelevantExcerpt(note: NoteWithContent, query: string): string {
    // If we have a chunkIndex in the note metadata, use that specific chunk
    if ('chunkIndex' in note && typeof note.chunkIndex === 'number') {
        const chunk = this.vectorStore.getChunk(note.file.path, note.chunkIndex);
        if (chunk) {
            return chunk.content;
        }
    }

    // Get all chunks and find relevant ones using the same scoring logic
    const allChunks = this.vectorStore.getAllChunks(note.file.path);
    if (allChunks && allChunks.length > 0) {
        // Extract keywords from query
        const keywords = query.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3);

        // Score chunks based on keyword matches
        const scoredChunks = allChunks.map(chunk => {
            const lowerContent = chunk.content.toLowerCase();
            let score = 0;

            // Count keyword matches
            for (const keyword of keywords) {
                const regex = new RegExp(`\\b${keyword}\\b`, 'g');
                const matches = (lowerContent.match(regex) || []).length;
                score += matches * 2; // Weight exact matches more heavily

                // Also count partial matches
                if (lowerContent.includes(keyword)) {
                    score += 1;
                }
            }

            return { chunk, score };
        });

        // Filter chunks with scores > 0 and sort by relevance
        const relevantChunks = scoredChunks
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ chunk }) => chunk.content);

        if (relevantChunks.length > 0) {
            return relevantChunks.join('\n\n');
        }
    }

    // Fallback to finding relevant sections in the content
    return this.findRelevantSection(note.content, query);
  }

  private findRelevantSection(content: string, query: string): string {
      // Split content into paragraphs
      const paragraphs = content.split(/\n\s*\n/);

      // If content is short enough, return it all
      if (content.length <= 1000) {
          return content;
      }

      // Extract keywords from query
      const keywords = query.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 3); // Filter out short words

      // Score paragraphs based on keyword matches
      const scoredParagraphs = paragraphs.map((paragraph, index) => {
          const lowerParagraph = paragraph.toLowerCase();
          let score = 0;

          // Count keyword matches
          for (const keyword of keywords) {
              const regex = new RegExp(`\\b${keyword}\\b`, 'g');
              const matches = (lowerParagraph.match(regex) || []).length;
              score += matches * 2; // Weight exact matches more heavily

              // Also count partial matches
              if (lowerParagraph.includes(keyword)) {
                  score += 1;
              }
          }

          // Boost score for paragraphs near the beginning (title, introduction)
          if (index < 3) {
              score += 1;
          }

          return { paragraph, score, index };
      });

      // Sort by score and take top paragraphs
      const topParagraphs = scoredParagraphs
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

      // Sort by original index to maintain document flow
      topParagraphs.sort((a, b) => a.index - b.index);

      // Combine paragraphs with context
      let result = '';
      for (let i = 0; i < topParagraphs.length; i++) {
          const { paragraph, index } = topParagraphs[i];

          // Add some context before the paragraph if not at the beginning
          if (index > 0 && i === 0) {
              const prevParagraph = paragraphs[index - 1];
              if (prevParagraph) {
                  result += prevParagraph + '\n\n';
              }
          }

          result += paragraph + '\n\n';

          // Add some context after the paragraph if not at the end
          if (index < paragraphs.length - 1 && i === topParagraphs.length - 1) {
              const nextParagraph = paragraphs[index + 1];
              if (nextParagraph) {
                  result += nextParagraph + '\n\n';
              }
          }
      }

      // If we still don't have enough content, add more context
      if (result.length < 500) {
          result = content.substring(0, 1000) + (content.length > 1000 ? '...' : '');
      }

      return result;
  }
}
