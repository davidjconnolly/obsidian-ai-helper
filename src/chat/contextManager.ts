import { NoteWithContent } from "src/chat";
import { VectorStore, NoteChunk } from "./vectorStore";
import { Settings } from "src/settings";
import { processQuery } from "../nlp";
import { ChatMessage } from "../chat";

export class ContextManager {
  private vectorStore: VectorStore;
  private settings: Settings;

  constructor(vectorStore: VectorStore, settings: Settings) {
    this.vectorStore = vectorStore;
    this.settings = settings;
  }

  buildContext(
    query: string,
    notes: NoteWithContent[],
    existingContextLength: number,
  ): string {
    let context = "";
    const maxContextLength =
      this.settings.chatSettings.maxContextLength - existingContextLength;

    // Add relevant notes
    if (notes.length > 0) {
      // Reset includedInContext flag for all notes
      notes.forEach(note => {
        note.includedInContext = false;
      });

      // Sort notes by relevance
      const sortedNotes = [...notes].sort((a, b) => b.relevance - a.relevance);

      for (const note of sortedNotes) {
        const excerpt = this.extractRelevantExcerpt(note, query);
        const newContext =
          context +
          `File: ${note.file.basename}\nPath: ${note.file.path}\nRelevance: ${note.relevance.toFixed(2)}\nContent: ${excerpt}\n\n`;

        // Check if adding this note would exceed the limit
        if (JSON.stringify(newContext).length > maxContextLength) {
          context = newContext.substring(0, maxContextLength);
          // Mark this note as included
          note.includedInContext = true;
          break;
        } else {
          context = newContext;
          // Mark this note as included
          note.includedInContext = true;
        }
      }
    } else {
      context +=
        "\n\nI couldn't find any notes specifically related to your query.";
    }

    return context;
  }

  buildConversationHistory(
    messages: ChatMessage[],
    welcomeMessage: string,
    skipWelcomeMessage: boolean,
  ): string {
    // Filter messages to exclude welcome message if needed
    const filteredHistory = messages.filter(
      (m) =>
        !(
          skipWelcomeMessage &&
          m.role === "assistant" &&
          m.content === welcomeMessage
        ),
    );

    // Create conversation history string, if any filtered messages exist
    return filteredHistory.length > 0
      ? `\nConversation history:\n${filteredHistory.map((m) => `${m.role}: ${m.content}`).join("\n")}`
      : "";
  }

  prepareModelMessages(
    userQuery: string,
    notes: NoteWithContent[],
    messages: ChatMessage[],
    welcomeMessage: string,
  ): ChatMessage[] {
    // Create system message with strong anti-hallucination directive
    const responseSystemPrompt = `You are an AI assistant helping a user with their notes.
Be concise and helpful. ONLY use information from the provided context from the user's notes.
If the context doesn't contain relevant information, acknowledge this honestly.
When citing information, mention which note it came from.
NEVER make up or hallucinate information that isn't in the provided context.
IMPORTANT: Carefully evaluate each note for relevance to the user's query. If a note appears irrelevant
to answering the specific query, do not use it in your response.
If none of the notes are relevant, clearly state that you don't have relevant information.
If you're not sure about something, say so clearly.`;

    // If no relevant notes were found, return a simple fallback message
    if (notes.length === 0) {
      // Get conversation history
      const historyText = this.buildConversationHistory(
        messages.slice(0, -1), // Exclude the last message (current query)
        welcomeMessage,
        this.settings.chatSettings.displayWelcomeMessage,
      );

      const systemMessages: ChatMessage[] = [];

      // Add primary system message
      systemMessages.push({
        role: "system",
        content:
          "You are an AI assistant helping a user with their notes. Try to be helpful using the conversation history for context",
      });

      // Add history as a separate system message if it exists
      if (historyText) {
        systemMessages.push({
          role: "system",
          content: historyText,
        });
      }

      // Return the messages with the user query
      return [...systemMessages, { role: "user", content: userQuery }];
    }

    // Get previous conversation history excluding the last user message
    const conversationHistory = messages.slice(0, -1);

    // Build history text with proper filtering
    const historyText = this.buildConversationHistory(
      conversationHistory,
      welcomeMessage,
      this.settings.chatSettings.displayWelcomeMessage,
    );

    // Prepare messages for the LLM
    const modelMessages: ChatMessage[] = [
      {
        role: "system",
        content: responseSystemPrompt,
      },
    ];

    // Add history as a separate system message if it exists
    if (historyText) {
      modelMessages.push({
        role: "system",
        content: historyText,
      });
    }

    // Add the current query
    modelMessages.push({
      role: "user",
      content: userQuery,
    });

    // Create context from relevant notes
    const context = this.buildContext(
      userQuery,
      notes,
      // Adjust token budget
      JSON.stringify(modelMessages).length + 200,
    );

    // Update the system message to include note context
    modelMessages[0] = {
      role: "system",
      content: `${responseSystemPrompt}\n\nContext from user's notes:\n${context}`,
    };

    return modelMessages;
  }

  private extractRelevantExcerpt(note: NoteWithContent, query: string): string {
    // If we have a chunkIndex in the note metadata, use that specific chunk
    if ("chunkIndex" in note && typeof note.chunkIndex === "number") {
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
      const scoredChunks = allChunks.map((chunk) => {
        const lowerContent = chunk.content.toLowerCase();
        let score = 0;

        // Count expanded token matches
        for (const token of expandedTokens) {
          // Skip phrases
          if (token.includes(" ")) continue;

          const regex = new RegExp(`\\b${token}\\b`, "g");
          const matches = (lowerContent.match(regex) || []).length;
          score += matches * 1.5; // Weight exact matches more heavily

          // Also count partial matches
          if (lowerContent.includes(token)) {
            score += 1;
          }
        }

        // Count phrase matches with higher weight
        for (const phrase of phrases) {
          const phraseRegex = new RegExp(
            phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "g",
          );
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
        return relevantChunks.join("\n\n");
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
        if (token.includes(" ")) continue;

        const regex = new RegExp(`\\b${token}\\b`, "g");
        const matches = (lowerParagraph.match(regex) || []).length;
        score += matches * 1.5; // Weight exact matches more heavily

        // Also count partial matches
        if (lowerParagraph.includes(token)) {
          score += 1;
        }
      }

      // Count phrase matches with higher weight
      for (const phrase of phrases) {
        const phraseRegex = new RegExp(
          phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g",
        );
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
    let result = "";
    for (let i = 0; i < topParagraphs.length; i++) {
      const { paragraph, index } = topParagraphs[i];

      // Add some context before the paragraph if not at the beginning
      if (index > 0 && i === 0) {
        const prevParagraph = paragraphs[index - 1];
        if (prevParagraph) {
          result += prevParagraph + "\n\n";
        }
      }

      result += paragraph + "\n\n";

      // Add some context after the paragraph if not at the end
      if (index < paragraphs.length - 1 && i === topParagraphs.length - 1) {
        const nextParagraph = paragraphs[index + 1];
        if (nextParagraph) {
          result += nextParagraph + "\n\n";
        }
      }
    }

    // If we still don't have enough content, add more context
    if (result.length < 500) {
      result =
        content.substring(0, 1000) + (content.length > 1000 ? "..." : "");
    }

    return result;
  }
}
