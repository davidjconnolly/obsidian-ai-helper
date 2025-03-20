import { App, Notice, Modal, TFile } from 'obsidian';
import { AIHelperSettings } from './settings';
import { LLMService, QueryParser, VectorStore, NoteSearchResult } from './services';

export class NotesChatbot {
  private vectorStore: VectorStore;
  private llmService: LLMService;
  private queryParser: QueryParser;

  constructor(private app: App, private settings: AIHelperSettings) {
    this.llmService = new LLMService(settings);
    this.vectorStore = new VectorStore(app, this.llmService);
    this.queryParser = new QueryParser(this.llmService);
  }

  async initialize() {
    await this.vectorStore.initialize();
  }

  private async formatNotesForContext(notes: NoteSearchResult[]): Promise<string> {
    // Group chunks by file for better context
    const fileGroups = new Map<string, {
      metadata: NoteSearchResult['metadata'];
      content: string;
      relevantChunks: Array<{
        index: number;
        total: number;
        content: string;
        bestMatchTerm?: string;  // Which search term matched best
        score: number;           // Similarity score
      }>;
    }>();

    // First pass: gather all chunks and get full content
    for (const note of notes) {
      const filePath = note.metadata.path;
      let group = fileGroups.get(filePath);

      if (!group) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        let content = '';
        if (file instanceof TFile) {
          content = await this.app.vault.read(file);
        }

        group = {
          metadata: note.metadata,
          content: content,
          relevantChunks: []
        };
        fileGroups.set(filePath, group);
      }

      // Include the best match term and score in the chunk info
      group.relevantChunks.push({
        ...note.metadata.chunk,
        bestMatchTerm: note.bestMatchTerm,
        score: note.score
      });
    }

    // Sort all file groups by the highest score they contain
    const sortedGroups = Array.from(fileGroups.entries())
      .map(([path, group]) => {
        const highestScore = Math.max(...group.relevantChunks.map(c => c.score));
        return { path, group, highestScore };
      })
      .sort((a, b) => b.highestScore - a.highestScore);

    // Estimated tokens for base prompt and other elements (approximate)
    const baseTokens = 1000;
    const maxTokens = 16000; // Safe limit for most models, leaving room for response
    let totalEstimatedTokens = baseTokens;
    let formattedNotes: string[] = [];

    // Format each file with full content and chunk info
    for (const { path, group } of sortedGroups) {
      // Sort chunks by index
      const sortedChunks = group.relevantChunks.sort((a, b) => a.index - b.index);

      // Create a section about relevance if we have best match terms
      const relevanceSection = sortedChunks.some(c => c.bestMatchTerm)
        ? `Relevance: ${sortedChunks
            .filter(c => c.bestMatchTerm)
            .map(c => `Part ${c.index} matches "${c.bestMatchTerm}" (score: ${c.score.toFixed(2)})`)
            .join(', ')}`
        : '';

      // Truncate content if it's very large
      let truncatedContent = group.content;
      const contentTokenEstimate = this.estimateTokens(truncatedContent);

      if (contentTokenEstimate > 4000) {
        // If content is too large, only include the relevant chunks
        truncatedContent = sortedChunks
          .map(chunk => chunk.content)
          .join('\n\n');
        console.log(`Truncated long content for ${path} (estimated ${contentTokenEstimate} tokens)`);
      }

      const formattedNote = `
Note: ${group.metadata.title}
Path: ${path}
Tags: ${group.metadata.tags?.join(', ') || 'None'}
Dates: ${group.metadata.dates?.join(', ') || 'None'}
Contains Search Terms: ${sortedChunks.some(c => c.bestMatchTerm && this.contentContainsQuery(group.content, c.bestMatchTerm)) ? 'Yes' : 'No - included based on semantic similarity only'}
Relevant Sections: Parts ${sortedChunks.map(c => c.index).join(', ')} of ${sortedChunks[0].total}
${relevanceSection}
Content:
${truncatedContent}
      `.trim();

      // Estimate tokens for this note
      const noteTokenEstimate = this.estimateTokens(formattedNote);

      // Check if adding this note would exceed our limit
      if (totalEstimatedTokens + noteTokenEstimate > maxTokens) {
        console.warn(`Stopping note inclusion to prevent token overflow. Used ${totalEstimatedTokens}/${maxTokens} tokens.`);
        break;
      }

      formattedNotes.push(formattedNote);
      totalEstimatedTokens += noteTokenEstimate;
    }

    console.log(`Estimated total tokens for context: ${totalEstimatedTokens}`);

    if (formattedNotes.length < fileGroups.size) {
      const omitted = fileGroups.size - formattedNotes.length;
      formattedNotes.push(`\n[Note: ${omitted} additional notes were omitted to prevent exceeding token limits]`);
    }

    return formattedNotes.join('\n\n');
  }

  // Simple heuristic to estimate tokens in a string
  private estimateTokens(text: string): number {
    // A rough heuristic: ~1.5 tokens per word for English
    return Math.ceil(text.split(/\s+/).length * 1.5);
  }

  // Check if content contains the given query term
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

  async processQuestion(question: string): Promise<{
    relevantNotes: NoteSearchResult[];
    response: Response;
  }> {
    // Parse the question to extract filters and context
    const analysis = await this.queryParser.parseQuery(question);
    console.log('Query Analysis:', analysis);

    // The QueryParser should provide a valid searchTerms, so we can
    // use it directly - it will fall back to the question if needed
    const searchTerms = analysis.searchTerms;
    console.log('Search Terms:', searchTerms);

    // Get relevant notes using filters
    const relevantNotes = await this.vectorStore.searchNotes(searchTerms, analysis.filters);

    // Group notes by best matched term for the prompt
    const termGroups = new Map<string, number>();
    relevantNotes.forEach(note => {
      if (note.bestMatchTerm) {
        const count = termGroups.get(note.bestMatchTerm) || 0;
        termGroups.set(note.bestMatchTerm, count + 1);
      }
    });

    // Create a summary of which search terms yielded results
    const termSummary = Array.from(termGroups.entries())
      .map(([term, count]) => `- "${term}": ${count} matching notes`)
      .join('\n');

    // Format notes for the prompt
    const notesContext = await this.formatNotesForContext(relevantNotes);

    // Check if content was truncated (by looking for the omitted notes message)
    const contentTruncated = notesContext.includes('additional notes were omitted');

    // Add information about analysis status to the prompt
    let analysisInfo = analysis.searchTerms === question
      ? "Note: I had difficulty analyzing your question and used the full question as search terms."
      : "";

    // If content was truncated, add a warning
    if (contentTruncated) {
      analysisInfo += analysisInfo ? "\n\n" : "";
      analysisInfo += "Warning: Your query matched many notes. Some results were omitted to fit within model limits. Consider refining your search to be more specific.";
      new Notice("Your query returned too many notes. Some results were omitted. Try being more specific.");
    }

    // Create final prompt and get streaming response
    const finalPrompt = `
Using these notes as context:

${notesContext}

Question: "${question}"
Search Context:
- Timeframe: ${analysis.context.timeframe || 'not specified'}
- People: ${analysis.context.people || 'none mentioned'}
- Actions: ${analysis.context.actions || 'not specified'}
- Requirements: ${analysis.context.requirements || 'not specified'}
${analysisInfo}

Search Strategy:
I searched your notes with multiple related concepts and found matches for:
${termSummary || '- No specific term matches found'}

Important Guidelines:
1. VERIFY KEY TERMS: First, verify that key entities or terms from the question (like specific names, places, or concepts) are actually present in the provided notes. If they are not present, clearly state this.
2. BE PRECISE: When counting occurrences or analyzing specific elements, only count actual mentions in the text, not implied or semantically similar concepts.
3. DISREGARD IRRELEVANT NOTES: Some retrieved notes may be semantically related but not directly relevant. If a note doesn't contain the key terms from the question, acknowledge this and focus on the truly relevant notes.
4. BASE YOUR ANSWER ONLY on the provided notes, not on general knowledge.
5. If the notes don't contain relevant information, say so clearly.
6. Be concise but thorough.
7. If dates are mentioned in the question, only reference notes from that time period.

Your answer:
`;

    console.log('Sending request to LLM with relevant notes');

    // Get streaming response
    const response = await this.llmService.streamCompletion(finalPrompt);

    return {
      relevantNotes,
      response
    };
  }

  abort() {
    this.llmService.abort();
  }
}

export class ChatbotModal extends Modal {
  private chatbot: NotesChatbot;
  private contextNotesEl: HTMLElement;

  constructor(app: App, chatbot: NotesChatbot) {
    super(app);
    this.chatbot = chatbot;
  }

  onOpen() {
    // Set up modal title and size
    this.titleEl.setText('Chat with your Notes');
    this.modalEl.style.width = '750px';
    this.modalEl.style.maxWidth = '750px';
    this.modalEl.style.height = '500px';
    this.modalEl.style.minHeight = '300px';

    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.height = '100%';
    contentEl.style.display = 'flex';
    contentEl.style.flexDirection = 'column';
    contentEl.style.overflow = 'hidden';

    // Create split view container
    const container = contentEl.createDiv({
      attr: {
        style: 'display:flex;gap:16px;flex:1;width:100%;overflow:hidden;padding:0 0 8px 0;'
      }
    });

    // Chat panel (left side)
    const chatPanel = container.createDiv({
      attr: {
        style: 'flex:2;display:flex;flex-direction:column;min-height:0;overflow:hidden;'
      }
    });

    // Context panel (right side)
    const contextPanel = container.createDiv({
      attr: {
        style: 'flex:1;border-left:1px solid var(--background-modifier-border);padding-left:16px;display:flex;flex-direction:column;min-height:0;overflow:hidden;min-width:250px;'
      }
    });

    // Panel headers
    chatPanel.createEl('h3', {
      text: 'Messages',
      attr: { style: 'margin:0 0 8px 0;flex-shrink:0;' }
    });

    contextPanel.createEl('h3', {
      text: 'Notes in Context',
      attr: { style: 'margin:0 0 8px 0;flex-shrink:0;' }
    });

    // Chat messages container
    const chatContainer = chatPanel.createDiv({
      cls: 'chat-container',
      attr: {
        style: 'flex:1;overflow:auto;user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;min-height:0;'
      }
    });

    // Context notes container
    this.contextNotesEl = contextPanel.createDiv({
      attr: {
        style: 'flex:1;overflow:auto;min-height:0;padding:8px;background:var(--background-secondary);border-radius:4px;'
      }
    });

    // Input container
    const inputContainer = chatPanel.createDiv({
      attr: {
        style: 'width:100%;padding:8px;flex-shrink:0;'
      }
    });

    const inputEl = inputContainer.createEl('input', {
      attr: {
        type: 'text',
        placeholder: 'Type your question here...',
        style: 'width:100%;margin:0;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);'
      }
    });

    // Handle input
    inputEl.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' && inputEl.value.trim()) {
        const question = inputEl.value.trim();
        inputEl.value = '';

        // Create user message
        const userQuestion = chatContainer.createDiv({
          cls: 'user-message',
          attr: {
            style: 'user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;padding:4px 0;'
          }
        });
        userQuestion.setText(`You: ${question}`);

        // Create bot response container
        const botResponse = chatContainer.createDiv({
          cls: 'bot-message',
          attr: {
            style: 'user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;white-space:pre-wrap;padding:4px 0;margin-bottom:8px;'
          }
        });

        try {
          // Show thinking state
          botResponse.setText('Finding relevant notes...');
          chatContainer.scrollTop = chatContainer.scrollHeight;

          // Process question
          const { relevantNotes, response } = await this.chatbot.processQuestion(question);

          // Update context panel with both notes and query
          this.updateContextPanel(relevantNotes, question);

          // If no relevant notes were found, update the response text
          if (relevantNotes.length === 0) {
            botResponse.setText('No relevant notes were found for your query. Try a different question or check if your notes contain the information you\'re looking for.');
            return;
          }

          // Stream response
          await this.streamResponse(response, botResponse);
        } catch (error) {
          botResponse.setText('Error: Failed to process question');
          new Notice('Error processing question');
          console.error(error);
        }

        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    });
  }

  private updateContextPanel(notes: NoteSearchResult[], query: string) {
    this.contextNotesEl.empty();

    if (notes.length === 0) {
      this.contextNotesEl.createDiv({
        text: 'No notes found',
        attr: {
          style: 'padding:8px;color:var(--text-muted);font-style:italic;'
        }
      });
      return;
    }

    // Only show highest scoring chunks in UI
    const highestScoringNotes = notes.filter(note => note.isHighestScoring);

    // Get meaningful search terms (match VectorStore logic)
    const searchTerms = query.toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 2);

    console.log('Debug - Search terms extracted:', {
      original: query,
      terms: searchTerms
    });

    highestScoringNotes.forEach(note => {
      console.log('Debug - Processing note:', {
        title: note.metadata.title,
        matches: note.matches,
        content: note.content.substring(0, 100) + '...' // First 100 chars for brevity
      });

      const noteEl = this.contextNotesEl.createDiv({
        cls: 'context-note',
        attr: {
          style: 'margin-bottom:16px;padding:8px;border-radius:4px;background:var(--background-modifier-hover);white-space:pre-wrap;'
        }
      });

      // Title row with match indicator
      const titleRow = noteEl.createDiv({
        attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;' }
      });

      titleRow.createEl('div', {
        text: `📝 ${note.metadata.title || 'Untitled'}`,
        attr: { style: 'font-weight:bold;' }
      });

      // Show relevance status
      const matchEl = titleRow.createEl('div', {
        attr: {
          style: `font-size:0.8em;padding:2px 6px;border-radius:4px;${
            note.matches
              ? 'background:var(--interactive-success);color:var(--text-on-accent);'
              : 'background:var(--background-modifier-border);color:var(--text-muted);'
          }`
        }
      });

      // Show the best match term if available, otherwise show generic match status
      if (note.bestMatchTerm && note.score) {
        if (note.matches) {
          matchEl.setText(`Exact Match: "${note.bestMatchTerm}" (${note.score.toFixed(2)})`);
        } else {
          matchEl.setText(`Semantic Match: "${note.bestMatchTerm}" (${note.score.toFixed(2)})`);
        }
      } else {
        matchEl.setText(note.matches ? 'Contains Search Terms' : 'Semantically Similar Only');
      }

      // Add a rank indicator if it's an exact match
      if (note.matches) {
        noteEl.style.borderLeft = '3px solid var(--interactive-success)';
      }

      // Add metadata section
      const metadataEl = noteEl.createDiv({
        attr: { style: 'margin:4px 0;font-size:0.9em;color:var(--text-muted);' }
      });

      // Show why this note was selected
      let matchReason = '';

      // Show all term scores if available
      if (note.termScores && note.termScores.length > 0) {
        const topTerms = note.termScores
          .sort((a, b) => b.score - a.score)
          .slice(0, 3); // Show top 3 terms

        matchReason = `Matched terms: ${topTerms.map(t =>
          `"${t.term}" (${t.score.toFixed(2)})`).join(', ')}`;
      }
      // Fallback to old logic if termScores not available
      else if (note.matches) {
        // Find which search terms match in title/content
        const titleMatches = searchTerms.filter(term =>
          note.metadata.title.toLowerCase().includes(term)
        );
        const contentMatches = searchTerms.filter(term =>
          note.content.toLowerCase().includes(term)
        );

        if (titleMatches.length > 0) {
          matchReason = `Title contains: "${titleMatches.join('", "')}"`;
        }
        if (contentMatches.length > 0) {
          matchReason += (matchReason ? ' and content' : 'Content') + ` contains: "${contentMatches.join('", "')}"`;
        }

        // If no matches found but note.matches is true, something's wrong
        if (!matchReason && note.matches) {
          console.log('Debug - Note marked as match but no terms found:', {
            searchTerms,
            title: note.metadata.title,
            content: note.content,
            note
          });
          matchReason = 'Marked as exact match but terms not found - please report this bug';
        } else if (!matchReason) {
          matchReason = 'No exact term matches. Included based on semantic similarity only.';
        }
      } else {
        matchReason = 'Content is semantically relevant to query';
      }

      metadataEl.createDiv({
        text: `Relevance: ${matchReason}`,
        attr: { style: 'margin-bottom:2px;' }
      });

      // Add tags if present
      if (note.metadata.tags?.length) {
        metadataEl.createDiv({
          text: `Tags: ${note.metadata.tags.join(', ')}`,
          attr: { style: 'margin-bottom:2px;' }
        });
      }

      // Add dates if present
      if (note.metadata.dates?.length) {
        metadataEl.createDiv({
          text: `Dates: ${note.metadata.dates.join(', ')}`,
          attr: { style: 'margin-bottom:2px;' }
        });
      }

      // Content preview with fade
      const contentEl = noteEl.createDiv({
        attr: {
          style: 'max-height:150px;overflow:hidden;position:relative;margin-top:8px;'
        }
      });
      contentEl.createDiv({
        text: note.content,
        attr: { style: 'white-space:pre-wrap;' }
      });
      contentEl.createDiv({
        attr: {
          style: 'position:absolute;bottom:0;left:0;right:0;height:50px;background:linear-gradient(transparent, var(--background-modifier-hover));'
        }
      });
    });
  }

  private async streamResponse(response: Response, botResponse: HTMLElement) {
    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamedText = 'Chatbot: ';

    try {
      let errorDetected = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        // Check if the chunk contains an error message about context length
        if (chunk.includes("context length") || chunk.includes("tokens when context")) {
          errorDetected = true;
          const errorMsg = 'Your query returned too many relevant notes, exceeding the model\'s context length limit. Please try a more specific query or reduce the amount of context being searched.';
          botResponse.setText(errorMsg);
          new Notice(errorMsg);
          console.error('Context length exceeded:', chunk);
          break;
        }

        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.choices?.[0]?.delta?.content) {
                streamedText += json.choices[0].delta.content;
                botResponse.setText(streamedText);
                botResponse.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }
              // Check for error in the streaming response
              if (json.error) {
                errorDetected = true;
                const errorMsg = `Error from LLM API: ${json.error.message || 'Unknown error'}`;
                botResponse.setText(errorMsg);
                new Notice(errorMsg);
                console.error('LLM streaming error:', json.error);
                break;
              }
            } catch (error) {
              console.warn('Failed to parse streaming chunk:', line);

              // If this looks like an error message, display it
              if (line.includes("error") || line.includes("Error")) {
                botResponse.setText(`Error processing response: ${line}`);
                errorDetected = true;
                break;
              }
            }
          }
        }

        if (errorDetected) break;
      }
    } catch (error) {
      // Handle any errors that occur during streaming
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during response streaming';
      console.error('Stream processing error:', errorMessage);
      botResponse.setText(`Error: ${errorMessage}`);
      new Notice(`Failed to process response: ${errorMessage}`);
    }
  }

  onClose() {
    this.chatbot.abort();
    this.contentEl.empty();
  }
}
