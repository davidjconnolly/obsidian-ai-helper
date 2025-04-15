import { NoteWithContent, ChatMessage } from "src/chat";
import { VectorStore, NoteChunk } from "./vectorStore";
import { Settings } from "src/settings";
import { processQuery } from '../nlp';
import { LLMConnector } from "./llmConnector";
import { TFile, App } from "obsidian";
import { logDebug, logError } from "../utils";
import { EmbeddingStore } from "./embeddingStore";

export class ContextManager {
  protected vectorStore: VectorStore;
  protected settings: Settings;

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

  protected extractRelevantExcerpt(note: NoteWithContent, query: string): string {
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

  protected findRelevantSection(content: string, query: string): string {
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

// New AgenticContextManager that extends ContextManager with agent capabilities
export class AgenticContextManager extends ContextManager {
  private llmConnector: LLMConnector;
  private embeddingStore: EmbeddingStore;
  private app: App;
  // Add conversation memory to track notes across questions
  private conversationNotes: NoteWithContent[] = [];
  private lastQuery: string = '';

  constructor(
    vectorStore: VectorStore,
    embeddingStore: EmbeddingStore,
    settings: Settings,
    llmConnector: LLMConnector,
    app: App
  ) {
    super(vectorStore, settings);
    this.embeddingStore = embeddingStore;
    this.llmConnector = llmConnector;
    this.app = app;
  }

  /**
   * Build context for a query using an agentic approach with RAG refinement
   */
  async buildAgenticContext(
    query: string,
    initialNotes: NoteWithContent[],
    existingContextLength: number,
    signal?: AbortSignal,
    isFollowUpQuestion: boolean = false
  ): Promise<string> {
    // If we have conversation notes and this looks like a follow-up question,
    // decide whether to use existing notes or perform a new search
    if (this.conversationNotes.length > 0 && isFollowUpQuestion) {
      logDebug(this.settings, `Evaluating whether to reuse ${this.conversationNotes.length} notes from previous question`);

      const shouldUseExistingNotes = await this.shouldReuseExistingNotes(query, this.lastQuery);

      if (shouldUseExistingNotes && !signal?.aborted) {
        logDebug(this.settings, "Reusing notes from previous question");

        // Reevaluate existing notes against the new query to filter out ones that are no longer relevant
        const stillRelevantNotes = await this.evaluateNotesRelevance(query, this.conversationNotes, signal);

        // If we still have relevant notes, use them
        if (stillRelevantNotes.length > 0) {
          // Check if we need any additional notes for this specific follow-up
          const needsMoreInfo = await this.needsAdditionalContext(query, stillRelevantNotes);

          if (needsMoreInfo && !signal?.aborted) {
            // Perform a targeted search for the additional information needed
            const additionalNotes = await this.performFollowUpSearch(query);
            // Combine with existing relevant notes, avoiding duplicates
            const combinedNotes = this.combineNoteCollections(stillRelevantNotes, additionalNotes);

            // Update conversation memory with the combined set
            this.conversationNotes = combinedNotes;
            this.lastQuery = query;

            // Build context using the combined notes
            return super.buildContext(query, combinedNotes, existingContextLength);
          }

          // No additional notes needed, use the still-relevant ones
          this.conversationNotes = stillRelevantNotes;
          this.lastQuery = query;
          return super.buildContext(query, stillRelevantNotes, existingContextLength);
        }
      }
    }

    // If we got here, we're either starting fresh or we need completely new context
    // Continue with the normal agentic context building process

    // Step 1: Systematically evaluate the relevance of each note
    const evaluatedNotes = await this.evaluateNotesRelevance(query, initialNotes, signal);

    // If we have no relevant notes after evaluation, try a more comprehensive search
    if (evaluatedNotes.length === 0 && !signal?.aborted) {
      logDebug(this.settings, `No relevant notes found after evaluation, performing expanded search for: "${query}"`);
      const expandedNotes = await this.performExpandedSearch(query);

      // If we still have no notes, return an empty context
      if (expandedNotes.length === 0) {
        return `\n\nI couldn't find any notes specifically related to your query: "${query}".`;
      }

      // Use the expanded search results
      const expandedContext = super.buildContext(query, expandedNotes, existingContextLength);

      // Update conversation memory
      this.conversationNotes = expandedNotes;
      this.lastQuery = query;

      return expandedContext;
    }

    // Build initial context with the truly relevant notes
    let initialContext = super.buildContext(query, evaluatedNotes, existingContextLength);

    // Check if we need more information based on the initial context
    let needsMoreInfoResult;
    try {
      needsMoreInfoResult = await this.evaluateContextCompleteness(
        query,
        initialContext,
        evaluatedNotes
      );
    } catch (error) {
      logError("Error in context completeness evaluation", error);
      // Fallback: continue with just the initial context

      // Update conversation memory with the evaluated notes
      this.conversationNotes = evaluatedNotes;
      this.lastQuery = query;

      return initialContext;
    }

    // If we have enough information or can't search further, return what we have
    if (!needsMoreInfoResult.needsMoreInfo || signal?.aborted) {
      // Update conversation memory with the evaluated notes
      this.conversationNotes = evaluatedNotes;
      this.lastQuery = query;

      return initialContext;
    }

    logDebug(this.settings, `Need more information for query: "${query}". Follow-up searches needed.`);

    // Get follow-up search queries from the LLM
    let additionalContext = "";
    let searchedQueries = new Set<string>();
    let allRelevantNotes = [...evaluatedNotes];

    // Cap the number of follow-up searches to prevent infinite loops
    const maxFollowUpSearches = 2;
    let followUpCount = 0;

    for (const followUpQuery of needsMoreInfoResult.followUpQueries) {
      // Skip if we've already searched this query or reached the limit
      if (searchedQueries.has(followUpQuery) ||
          followUpCount >= maxFollowUpSearches ||
          signal?.aborted) {
        continue;
      }

      followUpCount++;
      searchedQueries.add(followUpQuery);

      logDebug(this.settings, `Performing follow-up search ${followUpCount}: "${followUpQuery}"`);

      try {
        // Perform a new search with the follow-up query
        const followUpNotes = await this.performFollowUpSearch(followUpQuery);

        // Filter these notes for relevance as well
        const relevantFollowUpNotes = await this.evaluateNotesRelevance(followUpQuery, followUpNotes, signal);

        if (relevantFollowUpNotes.length > 0) {
          // Add a header for this follow-up search section
          additionalContext += `\n\n--- Additional information for: "${followUpQuery}" ---\n\n`;

          // Add context from these follow-up notes
          for (const note of relevantFollowUpNotes) {
            const excerpt = this.extractRelevantExcerpt(note, followUpQuery);
            additionalContext += `File: ${note.file.basename}\nPath: ${note.file.path}\nRelevance: ${note.relevance.toFixed(2)}\nContent: ${excerpt}\n\n`;
          }

          // Add these notes to our overall collection of relevant notes
          allRelevantNotes = this.combineNoteCollections(allRelevantNotes, relevantFollowUpNotes);
        }
      } catch (error) {
        logError(`Error in follow-up search "${followUpQuery}"`, error);
      }
    }

    // Combine initial and additional context, respecting the max context length
    const combinedContext = this.combineContexts(
      initialContext,
      additionalContext,
      existingContextLength
    );

    // Update conversation memory with all the notes we've found
    this.conversationNotes = allRelevantNotes;
    this.lastQuery = query;

    return combinedContext;
  }

  /**
   * Determine if we should reuse notes from previous questions or perform a new search
   */
  private async shouldReuseExistingNotes(currentQuery: string, previousQuery: string): Promise<boolean> {
    try {
      logDebug(this.settings, `Evaluating continuity between "${previousQuery}" and "${currentQuery}"`);

      // Create a system prompt for evaluating query continuity
      const systemPrompt = `You are an AI assistant determining if a follow-up question is related enough to the previous question that the same context notes can be reused.

Your job is to determine if the current question is:
1. A direct follow-up to the previous question
2. A clarification of the previous question
3. A question about the same topic as the previous question
4. A completely new question that requires different information

Return a JSON response in this format:
{
  "shouldReuseNotes": true/false,
  "reason": "Brief explanation of your decision"
}

IMPORTANT: Return the raw JSON only, DO NOT include any markdown formatting or code blocks.`;

      // Create a user message with both queries
      const userMessage = `Previous question: "${previousQuery}"
Current question: "${currentQuery}"

Determine if the current question is related to the previous one such that the same reference notes would still be helpful, or if this is a new topic requiring fresh information.`;

      // Send to LLM for evaluation
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ];

      const response = await this.llmConnector.generateResponse(messages);

      try {
        // Clean the response content
        let jsonContent = response.content;

        // Remove markdown code block formatting if present
        const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          jsonContent = codeBlockMatch[1].trim();
        }

        // Additional cleanup for common formatting issues
        jsonContent = jsonContent.replace(/^[`\s]+|[`\s]+$/g, '');

        // Parse the JSON response
        const result = JSON.parse(jsonContent);

        // Log the decision
        logDebug(this.settings, `Continuity decision: ${result.shouldReuseNotes ? "Reuse notes" : "Get new notes"} - ${result.reason}`);

        return result.shouldReuseNotes;
      } catch (error) {
        logError("Error parsing continuity evaluation response", error);

        // If we can't parse the result, check for simple pattern matches
        const shouldReuseMatch = response.content.match(/shouldReuseNotes"?\s*:\s*(true|false)/i);
        if (shouldReuseMatch && shouldReuseMatch[1].toLowerCase() === 'true') {
          return true;
        }

        // Default to false if we can't determine
        return false;
      }
    } catch (error) {
      logError("Error evaluating query continuity", error);
      return false;
    }
  }

  /**
   * Check if we need additional context beyond the reused notes
   */
  private async needsAdditionalContext(query: string, existingNotes: NoteWithContent[]): Promise<boolean> {
    try {
      if (existingNotes.length === 0) {
        return true; // Definitely need more info if we have no notes
      }

      // Create context from existing notes
      const existingContext = super.buildContext(query, existingNotes, 0);

      // Use the existing context completeness evaluation logic
      const completenessResult = await this.evaluateContextCompleteness(query, existingContext, existingNotes);

      return completenessResult.needsMoreInfo;
    } catch (error) {
      logError("Error checking if additional context is needed", error);
      return true; // Default to fetching more info if we encounter an error
    }
  }

  /**
   * Combine two collections of notes, avoiding duplicates based on file paths
   */
  private combineNoteCollections(collection1: NoteWithContent[], collection2: NoteWithContent[]): NoteWithContent[] {
    const combinedNotes: NoteWithContent[] = [...collection1];
    const existingPaths = new Set(collection1.map(note => note.file.path));

    // Only add notes from collection2 that aren't already in collection1
    for (const note of collection2) {
      if (!existingPaths.has(note.file.path)) {
        combinedNotes.push(note);
        existingPaths.add(note.file.path);
      }
    }

    return combinedNotes;
  }

  /**
   * Clear the conversation memory
   * Call this when starting a new conversation
   */
  public clearConversationMemory(): void {
    this.conversationNotes = [];
    this.lastQuery = '';
    logDebug(this.settings, "Cleared conversation memory");
  }

  /**
   * Systematically evaluate the relevance of each note to the query
   * and filter out irrelevant ones
   */
  public async evaluateNotesRelevance(
    query: string,
    notes: NoteWithContent[],
    signal?: AbortSignal
  ): Promise<NoteWithContent[]> {
    if (notes.length === 0) return [];

    try {
      logDebug(this.settings, `Systematically evaluating relevance of ${notes.length} notes for query: "${query}"`);

      // Create a system prompt specifically for note relevance evaluation
      const systemPrompt = `You are an AI assistant evaluating the relevance of notes to a user query.
Carefully examine each note's content and determine if it genuinely contains information that would help answer the specific query.

For each note, you will:
1. Analyze whether the note contains information directly relevant to the query
2. Consider the semantic relationship between the note's content and the query intent
3. Reject notes that only have keyword matches but don't actually contribute useful information
4. Reject notes that are completely unrelated to the query (e.g., personal chats, technical notes for different topics)

STRICT OUTPUT FORMAT: You must return a JSON array containing objects with this exact structure:
[
  {"index": 0, "isRelevant": true, "reason": "Contains information about..."},
  {"index": 1, "isRelevant": false, "reason": "Unrelated to query..."},
  ...
]

IMPORTANT:
1. Return ONLY the raw JSON array
2. DO NOT include any markdown formatting, code blocks, or explanations
3. DO NOT wrap the JSON in backticks or anything else
4. Every note must be evaluated, with its index (starting from 0) included in the response
5. For each note, set "isRelevant" to true only if it genuinely helps answer the query`;

      // Format notes context for LLM consumption
      const notesContext = notes.map((note, index) => {
        return `Note ${index + 1} [index: ${index}]:
Title: ${note.file.basename}
Path: ${note.file.path}
Content excerpt: ${note.content.substring(0, 400)}${note.content.length > 400 ? '...' : ''}`;
      }).join('\n\n');

      // Prepare messages for the LLM
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `User query: "${query}"\n\nNotes to evaluate:\n\n${notesContext}\n\nEvaluate which notes are genuinely relevant to answering this specific query.` }
      ];

      // Send to LLM for evaluation
      const response = await this.llmConnector.generateResponse(messages, signal);

      try {
        // Clean the response content in case it's wrapped in markdown code blocks
        let jsonContent = response.content;

        // Log the raw response for debugging
        logDebug(this.settings, `Raw response from relevance evaluation: ${jsonContent.substring(0, 100)}...`);

        // Attempt to parse the response in multiple ways
        let evaluations = this.attemptJsonParsing(jsonContent);

        if (!evaluations || !Array.isArray(evaluations) || evaluations.length === 0) {
          logDebug(this.settings, "No valid evaluations found, falling back to relevance scores");

          // Fallback to using original relevance scores
          // Keep notes with relevance score above 0.7 or the top 2 notes
          const relevantNotes = notes.filter(note => note.relevance > 0.7);

          if (relevantNotes.length === 0 && notes.length > 0) {
            // If no notes have high relevance, keep the top 2
            const sortedByRelevance = [...notes].sort((a, b) => b.relevance - a.relevance);
            return sortedByRelevance.slice(0, Math.min(2, sortedByRelevance.length));
          }

          return relevantNotes;
        }

        // Filter notes based on relevance
        const relevantIndices = evaluations
          .filter(evaluation => evaluation.isRelevant === true)
          .map(evaluation => evaluation.index);

        const relevantNotes = relevantIndices
          .filter(index => index >= 0 && index < notes.length)
          .map(index => notes[index]);

        logDebug(this.settings, `Filtered notes: ${relevantNotes.length} relevant out of ${notes.length} total`);

        // Log which notes were removed
        const removedNotes = notes.filter((_, i) => !relevantIndices.includes(i));
        if (removedNotes.length > 0) {
          logDebug(this.settings, `Removed irrelevant notes: ${removedNotes.map(n => n.file.basename).join(', ')}`);
        }

        // If all notes were filtered out, keep at least the most relevant one
        if (relevantNotes.length === 0 && notes.length > 0) {
          const highestRelevanceNote = [...notes].sort((a, b) => b.relevance - a.relevance)[0];
          logDebug(this.settings, `All notes were filtered out. Keeping highest relevance note: ${highestRelevanceNote.file.basename}`);
          return [highestRelevanceNote];
        }

        return relevantNotes;
      } catch (error) {
        logError("Error evaluating note relevance", error);

        // Default to returning a conservative subset of notes on error
        if (notes.length > 0) {
          const sortedByRelevance = [...notes].sort((a, b) => b.relevance - a.relevance);
          return sortedByRelevance.slice(0, Math.min(2, sortedByRelevance.length));
        }

        // Default to returning all notes on error
        return notes;
      }
    } catch (error) {
      logError("Error evaluating note relevance", error);

      // Default to returning all notes on error
      return notes;
    }
  }

  /**
   * Attempt to parse the JSON response in multiple ways
   */
  private attemptJsonParsing(content: string): Array<{ index: number; isRelevant: boolean; reason?: string }> | null {
    try {
      // Clean and extract JSON content
      let jsonContent = content;

      // 1. Try to extract from code blocks
      const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonContent = codeBlockMatch[1].trim();
        logDebug(this.settings, "Extracted JSON from code block");
      }

      // 2. Additional cleanup for common formatting issues
      jsonContent = jsonContent.replace(/^[`\s]+|[`\s]+$/g, ''); // Remove extra backticks or whitespace

      // 3. Handle case where model prepends "json" to the array
      if (jsonContent.startsWith('json')) {
        jsonContent = jsonContent.substring(4).trim();
      }

      // 4. If the content doesn't look like JSON, try to extract array from text
      if (!jsonContent.trim().startsWith('[')) {
        const arrayMatch = jsonContent.match(/\[\s*{[\s\S]*}\s*\]/);
        if (arrayMatch) {
          jsonContent = arrayMatch[0];
          logDebug(this.settings, "Extracted JSON array using regex");
        }
      }

      // 5. Final cleanup for common JSON issues
      jsonContent = jsonContent.replace(/\\n/g, '\\\\n'); // Fix escaped newlines
      jsonContent = jsonContent.replace(/\\"/g, '\\\\"'); // Fix escaped quotes
      jsonContent = jsonContent.replace(/,\s*]/g, ']'); // Fix trailing commas

      // Log the processed content
      logDebug(this.settings, `Processed JSON content: ${jsonContent.substring(0, 100)}...`);

      // 6. Parse using the standard JSON parser
      try {
        const evaluations = JSON.parse(jsonContent);
        if (Array.isArray(evaluations) && evaluations.length > 0) {
          logDebug(this.settings, `Successfully parsed JSON with ${evaluations.length} evaluations`);
          return evaluations;
        }
      } catch (parseError) {
        logError("Standard JSON parse error", parseError);
      }

      // 7. Fall back to regex parsing if JSON.parse fails
      const regexResults = this.parseRelevanceResponseWithRegex(jsonContent);
      if (regexResults.length > 0) {
        return regexResults;
      }

      // If all parsing attempts fail
      return null;
    } catch (error) {
      logError("Error in all JSON parsing attempts", error);
      return null;
    }
  }

  /**
   * Perform a more comprehensive search when initial notes are insufficient
   */
  private async performExpandedSearch(query: string): Promise<NoteWithContent[]> {
    try {
      logDebug(this.settings, `Performing expanded search for query: "${query}"`);

      // Process the query using NLP utilities with expanded parameters
      const processedQuery = processQuery(query, this.settings);

      // Generate embedding for the processed query
      const queryEmbedding = await this.embeddingStore.generateEmbedding(processedQuery.processed);

      // Get the active file if any
      const activeFile = this.app.workspace.getActiveFile();
      const file = activeFile ? activeFile : undefined;

      // Use a lower similarity threshold for expanded search to capture more potential matches
      const expandedSimilarity = Math.max(0.3, this.settings.chatSettings.similarity - 0.2);

      // Find semantically similar content with expanded parameters
      const results = await this.vectorStore.search(queryEmbedding, {
        similarity: expandedSimilarity, // Lower similarity threshold
        limit: this.settings.chatSettings.maxNotesToSearch * 2, // Double the number of notes
        searchTerms: processedQuery.expandedTokens,
        file,
        phrases: processedQuery.phrases,
        query: query
      });

      // Process results
      const relevantNotes: NoteWithContent[] = [];
      const processedPaths = new Set<string>();

      for (const result of results) {
        if (processedPaths.has(result.path)) {
          continue;
        }
        processedPaths.add(result.path);

        const file = this.app.vault.getAbstractFileByPath(result.path) as TFile;
        if (!file || !(file instanceof TFile)) {
          continue;
        }

        try {
          const content = await this.app.vault.cachedRead(file);
          relevantNotes.push({
            file,
            content,
            relevance: result.score,
            chunkIndex: result.chunkIndex
          });
        } catch (error) {
          logError(`Error reading file ${file.path}`, error);
        }
      }

      logDebug(this.settings, `Expanded search found ${relevantNotes.length} potential notes`);
      return relevantNotes;
    } catch (error) {
      logError("Error in expanded search", error);
      return [];
    }
  }

  /**
   * Evaluate if the current context is sufficient to answer the query
   */
  private async evaluateContextCompleteness(
    query: string,
    currentContext: string,
    currentNotes: NoteWithContent[]
  ): Promise<{
    needsMoreInfo: boolean;
    followUpQueries: string[];
    explanation?: string;
  }> {
    try {
      // If we don't have any notes yet, definitely need more info
      if (currentNotes.length === 0) {
        return {
          needsMoreInfo: true,
          followUpQueries: [query], // Just repeat the original query
          explanation: "No relevant notes found in initial search"
        };
      }

      // Create a system prompt to evaluate context completeness
      const systemPrompt = `You are an AI assistant tasked with evaluating whether the provided context from a user's notes contains sufficient information to properly answer their query.

Your job is to:
1. Understand what the user is asking
2. Evaluate if the context includes the necessary information to answer it fully
3. If the context is incomplete, suggest up to 2 follow-up search queries that would help fill in the gaps

Return your response as JSON in the following format:
{
  "needsMoreInfo": true/false,
  "followUpQueries": ["specific follow-up query 1", "specific follow-up query 2"],
  "explanation": "Brief explanation of what's missing or why more info is needed"
}

IMPORTANT: Return the raw JSON only, DO NOT wrap it in a markdown code block or any other formatting. The response should be valid JSON that can be directly parsed.

Make follow-up queries specific, focused, and different from the original query. They should target missing information.
If the context already contains sufficient information, set needsMoreInfo to false and return an empty array for followUpQueries.`;

      // Create user message with the query and context
      const userMessage = `Query: "${query}"

Available context from notes:
${currentContext}

Evaluate if this context contains enough information to answer the query fully. If not, suggest focused follow-up searches.`;

      // Prepare messages for the LLM
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ];

      // Send to LLM for evaluation
      const response = await this.llmConnector.generateResponse(messages);

      try {
        // Clean the response content in case it's wrapped in markdown code blocks
        let jsonContent = response.content;

        // Remove markdown code block formatting if present
        const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          jsonContent = codeBlockMatch[1].trim();
          logDebug(this.settings, "Extracted JSON from code block");
        }

        // Additional cleanup for common formatting issues
        jsonContent = jsonContent.replace(/^[`\s]+|[`\s]+$/g, ''); // Remove extra backticks or whitespace

        // Log the content we're trying to parse
        logDebug(this.settings, `Attempting to parse JSON: ${jsonContent.substring(0, 100)}...`);

        // Parse the JSON response
        let result;
        try {
          result = JSON.parse(jsonContent);
        } catch (parseError) {
          logError("JSON parse error", parseError);
          logError("Failed to parse content", jsonContent);

          // Attempt to extract a JSON-like structure using regex as a fallback
          const needsMoreInfoMatch = jsonContent.match(/"needsMoreInfo"\s*:\s*(true|false)/i);
          const followUpQueriesMatch = jsonContent.match(/"followUpQueries"\s*:\s*\[(.*?)\]/);

          if (needsMoreInfoMatch) {
            const needsMoreInfo = needsMoreInfoMatch[1].toLowerCase() === 'true';
            const followUpQueries: string[] = [];

            if (followUpQueriesMatch && followUpQueriesMatch[1]) {
              // Extract strings from the array
              const queriesStr = followUpQueriesMatch[1];
              const queryMatches = queriesStr.match(/"([^"]+)"/g);

              if (queryMatches) {
                queryMatches.forEach(match => {
                  // Remove the quotes
                  followUpQueries.push(match.substring(1, match.length - 1));
                });
              }
            }

            logDebug(this.settings, `Fallback parsing extracted: needsMoreInfo=${needsMoreInfo}, queries=${followUpQueries.length}`);

            return {
              needsMoreInfo,
              followUpQueries: followUpQueries.slice(0, 2)
            };
          }

          throw parseError; // Re-throw if we couldn't extract anything
        }

        // Validate the response format
        if (typeof result.needsMoreInfo !== 'boolean' || !Array.isArray(result.followUpQueries)) {
          throw new Error("Invalid response format");
        }

        // Limit the number of follow-up queries to 2
        const followUpQueries = result.followUpQueries.slice(0, 2);

        return {
          needsMoreInfo: result.needsMoreInfo,
          followUpQueries: followUpQueries,
          explanation: result.explanation
        };
      } catch (error) {
        logError("Error parsing context evaluation response", error);

        // Default to no more info needed if we can't parse the response
        return {
          needsMoreInfo: false,
          followUpQueries: []
        };
      }
    } catch (error) {
      logError("Error evaluating context completeness", error);

      // Default to no more info needed on error
      return {
        needsMoreInfo: false,
        followUpQueries: []
      };
    }
  }

  /**
   * Perform a follow-up search with a new query
   */
  private async performFollowUpSearch(query: string): Promise<NoteWithContent[]> {
    try {
      // Process the query using NLP utilities
      const processedQuery = processQuery(query, this.settings);

      // Generate embedding for the processed query
      const queryEmbedding = await this.embeddingStore.generateEmbedding(processedQuery.processed);

      // Get the active file if any
      const activeFile = this.app.workspace.getActiveFile();
      const file = activeFile ? activeFile : undefined;

      // Find semantically similar content using expanded tokens
      const results = await this.vectorStore.search(queryEmbedding, {
        similarity: this.settings.chatSettings.similarity,
        limit: Math.min(5, this.settings.chatSettings.maxNotesToSearch), // Use fewer notes for follow-up searches
        searchTerms: processedQuery.expandedTokens,
        file, // Pass the active file for recency context
        phrases: processedQuery.phrases, // Pass preserved phrases for exact matching
        query: query // Pass the original query for additional processing
      });

      // Process results
      const relevantNotes: NoteWithContent[] = [];
      const processedPaths = new Set<string>();

      for (const result of results) {
        if (processedPaths.has(result.path)) {
          continue;
        }
        processedPaths.add(result.path);

        const file = this.app.vault.getAbstractFileByPath(result.path) as TFile;
        if (!file || !(file instanceof TFile)) {
          continue;
        }

        try {
          const content = await this.app.vault.cachedRead(file);

          relevantNotes.push({
            file,
            content,
            relevance: result.score,
            chunkIndex: result.chunkIndex
          });
        } catch (error) {
          logError(`Error reading file ${file.path}`, error);
        }
      }

      return relevantNotes;
    } catch (error) {
      logError("Error in follow-up search", error);
      return [];
    }
  }

  /**
   * Combine initial and additional context, respecting max context length
   */
  private combineContexts(
    initialContext: string,
    additionalContext: string,
    existingContextLength: number
  ): string {
    const maxContextLength = this.settings.chatSettings.maxContextLength - existingContextLength;

    // If initial context already exceeds available space, truncate it
    if (initialContext.length >= maxContextLength) {
      return initialContext.substring(0, maxContextLength);
    }

    // Calculate remaining space for additional context
    const remainingSpace = maxContextLength - initialContext.length;

    // If additional context fits within remaining space, include it all
    if (additionalContext.length <= remainingSpace) {
      return initialContext + additionalContext;
    }

    // Otherwise, truncate additional context to fit
    return initialContext + additionalContext.substring(0, remainingSpace);
  }

  /**
   * Parse the relevance evaluation response using regex as a fallback when JSON.parse fails
   */
  private parseRelevanceResponseWithRegex(content: string): Array<{ index: number; isRelevant: boolean; reason?: string }> {
    try {
      logDebug(this.settings, "Attempting to parse with regex fallback");
      const results: Array<{ index: number; isRelevant: boolean; reason?: string }> = [];

      // Look for patterns like: {"index": 0, "isRelevant": true}
      const indexMatches = content.match(/\"index\"\s*:\s*(\d+)/g);
      const relevanceMatches = content.match(/\"isRelevant\"\s*:\s*(true|false)/g);

      if (indexMatches && relevanceMatches && indexMatches.length === relevanceMatches.length) {
        for (let i = 0; i < indexMatches.length; i++) {
          // Extract the numeric index
          const indexMatch = indexMatches[i].match(/(\d+)/);
          const index = indexMatch ? parseInt(indexMatch[1]) : -1;

          // Extract the boolean relevance
          const relevanceMatch = relevanceMatches[i].match(/(true|false)/);
          const isRelevant = relevanceMatch ? relevanceMatch[1] === 'true' : false;

          if (index >= 0) {
            results.push({ index, isRelevant });
          }
        }
      }

      logDebug(this.settings, `Regex parsing extracted ${results.length} evaluations`);
      return results;
    } catch (error) {
      logError("Error in regex parsing", error);
      return [];
    }
  }
}
