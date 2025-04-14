import { NoteWithContent } from "src/chat";
import { VectorStore, NoteChunk } from "./vectorStore";
import { Settings } from "src/settings";
import { processQuery } from '../nlp';

export class ContextManager {
  private vectorStore: VectorStore;
  private settings: Settings;

  constructor(vectorStore: VectorStore, settings: Settings) {
      this.vectorStore = vectorStore;
      this.settings = settings;
  }

  buildContext(query: string, notes: NoteWithContent[], existingContextLength: number): string {
    let context = '';
    const maxContextLength = this.settings.chatSettings.maxContextLength - existingContextLength;

    // Add relevant notes
    if (notes.length > 0) {
      // Sort notes by relevance
      const sortedNotes = [...notes].sort((a, b) => b.relevance - a.relevance);

      for (const note of sortedNotes) {
        const excerpt = this.extractRelevantExcerpt(note, query);
        const newContext = context + `File: ${note.file.basename}\nPath: ${note.file.path}\nRelevance: ${note.relevance.toFixed(2)}\nContent: ${excerpt}\n\n`;

        // Check if adding this note would exceed the limit
        if (JSON.stringify(newContext).length > maxContextLength) {
          context = newContext.substring(0, maxContextLength);
          break;
        } else {
          context = newContext;
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
        // Process the query using our NLP utilities
        const processedQuery = processQuery(query, this.settings);
        const { tokens, expandedTokens, phrases } = processedQuery;

        // Score chunks based on keyword and phrase matches
        const scoredChunks = allChunks.map(chunk => {
            const lowerContent = chunk.content.toLowerCase();
            let score = 0;

            // Count expanded token matches
            for (const token of expandedTokens) {
                // Skip phrases
                if (token.includes(' ')) continue;

                const regex = new RegExp(`\\b${token}\\b`, 'g');
                const matches = (lowerContent.match(regex) || []).length;
                score += matches * 1.5; // Weight exact matches more heavily

                // Also count partial matches
                if (lowerContent.includes(token)) {
                    score += 1;
                }
            }

            // Count phrase matches with higher weight
            for (const phrase of phrases) {
                const phraseRegex = new RegExp(phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                const phraseMatches = (lowerContent.match(phraseRegex) || []).length;
                score += phraseMatches * 3; // Weight phrase matches even higher
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

      // Process the query using our NLP utilities
      const processedQuery = processQuery(query, this.settings);
      const { tokens, expandedTokens, phrases } = processedQuery;

      // Score paragraphs based on keyword matches
      const scoredParagraphs = paragraphs.map((paragraph, index) => {
          const lowerParagraph = paragraph.toLowerCase();
          let score = 0;

          // Count expanded token matches
          for (const token of expandedTokens) {
              // Skip phrases
              if (token.includes(' ')) continue;

              const regex = new RegExp(`\\b${token}\\b`, 'g');
              const matches = (lowerParagraph.match(regex) || []).length;
              score += matches * 1.5; // Weight exact matches more heavily

              // Also count partial matches
              if (lowerParagraph.includes(token)) {
                  score += 1;
              }
          }

          // Count phrase matches with higher weight
          for (const phrase of phrases) {
              const phraseRegex = new RegExp(phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
              const phraseMatches = (lowerParagraph.match(phraseRegex) || []).length;
              score += phraseMatches * 3; // Weight phrase matches even higher
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
