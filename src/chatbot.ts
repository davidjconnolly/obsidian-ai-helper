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

      group.relevantChunks.push(note.metadata.chunk);
    }

    // Format each file with full content and chunk info
    return Array.from(fileGroups.entries()).map(([path, { metadata, content, relevantChunks }]) => {
      // Sort chunks by index
      const sortedChunks = relevantChunks.sort((a, b) => a.index - b.index);

      return `
Note: ${metadata.title}
Path: ${path}
Type: ${metadata.type || 'Unknown'}
Tags: ${metadata.tags?.join(', ') || 'None'}
Dates: ${metadata.dates?.join(', ') || 'None'}
Relevant Sections: Parts ${sortedChunks.map(c => c.index).join(', ')} of ${sortedChunks[0].total}
Content:
${content}
      `.trim();
    }).join('\n\n');
  }

  async processQuestion(question: string): Promise<{
    relevantNotes: NoteSearchResult[];
    response: Response;
  }> {
    // Parse the question to extract filters and context
    const analysis = await this.queryParser.parseQuery(question);
    console.log('Query Analysis:', analysis);

    // Get relevant notes using filters
    const relevantNotes = await this.vectorStore.searchNotes(analysis.searchTerms, analysis.filters);

    // Format notes for the prompt
    const notesContext = await this.formatNotesForContext(relevantNotes);

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

Important:
1. Base your answer only on the provided notes
2. If the notes don't contain relevant information, say so
3. Be concise but thorough
4. If dates are mentioned in the question, only reference notes from that time period
5. If specific people are mentioned, only reference their interactions
6. Focus on addressing the specific requirements identified in the search context
`;

    const response = await this.llmService.streamCompletion(finalPrompt);
    return { relevantNotes, response };
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
      matchEl.setText(note.matches ? 'Exact Match' : 'Semantically Related');

      // Add metadata section
      const metadataEl = noteEl.createDiv({
        attr: { style: 'margin:4px 0;font-size:0.9em;color:var(--text-muted);' }
      });

      // Show why this note was selected
      let matchReason = '';
      if (note.matches) {
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
        if (!matchReason) {
          console.log('Debug - Note marked as match but no terms found:', {
            searchTerms,
            title: note.metadata.title,
            content: note.content,
            note
          });
          matchReason = 'Marked as exact match but terms not found - please report this bug';
        }
      } else {
        matchReason = 'Content is semantically relevant to query';
      }

      metadataEl.createDiv({
        text: `Relevance: ${matchReason}`,
        attr: { style: 'margin-bottom:2px;' }
      });

      if (note.metadata.type) {
        metadataEl.createDiv({
          text: `Type: ${note.metadata.type}`,
          attr: { style: 'margin-bottom:2px;' }
        });
      }

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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            if (json.choices?.[0]?.delta?.content) {
              streamedText += json.choices[0].delta.content;
              botResponse.setText(streamedText);
              botResponse.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          } catch (error) {
            console.warn('Failed to parse streaming chunk:', line);
          }
        }
      }
    }
  }

  onClose() {
    this.chatbot.abort();
    this.contentEl.empty();
  }
}
