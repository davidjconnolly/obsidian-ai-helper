import { App, TFile, ButtonComponent, MarkdownRenderer, ItemView, WorkspaceLeaf } from 'obsidian';
import { Settings } from './settings';
import { logDebug, logError } from './utils';
import { VectorStore } from './chat/vectorStore';
import { EmbeddingStore } from './chat/embeddingStore';
import { ContextManager } from './chat/contextManager';
import { LLMConnector } from './chat/llmConnector';
import { globalInitializationPromise, isGloballyInitialized, globalVectorStore, globalEmbeddingStore } from './chat/embeddingStore';

// Define the view type for the AI Chat
export const AI_CHAT_VIEW_TYPE = 'ai-helper-chat-view';

// Interface for a chat message
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Interface for relevant notes and their context
export interface NoteWithContent {
    file: TFile;
    content: string;
    relevance: number;
    chunkIndex?: number;
}

// Interface for note chunks with embeddings
export interface NoteChunk {
    content: string;
    embedding: Float32Array;
    position: number;
}

// Interface for note embeddings
export interface NoteEmbedding {
    path: string;
    chunks: NoteChunk[];
}

// Open AI Chat sidebar view
export function openAIChat(app: App): void {
    const existingLeaves = app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE);
    if (existingLeaves.length) {
        app.workspace.revealLeaf(existingLeaves[0]);
        return;
    }

    const leaf = app.workspace.getRightLeaf(false);
    if (leaf) {
        leaf.setViewState({
            type: AI_CHAT_VIEW_TYPE,
        });
        app.workspace.revealLeaf(leaf);
    }
}

// Main class for the AI Chat sidebar view
export class AIHelperChatView extends ItemView {
    settings: Settings;
    messages: ChatMessage[] = [];
    contextContainer: HTMLElement;
    messagesContainer: HTMLElement;
    inputContainer: HTMLElement;
    inputField: HTMLTextAreaElement;
    sendButton: ButtonComponent;
    relevantNotes: NoteWithContent[] = [];
    app: App;

    // Vector search components
    private embeddingStore: EmbeddingStore;
    private vectorStore: VectorStore;
    private contextManager: ContextManager;
    private llmConnector: LLMConnector;
    private isProcessing = false;
    private initializationPromise: Promise<void> | null = null;

    constructor(leaf: WorkspaceLeaf, settings: Settings) {
        super(leaf);
        this.settings = settings;
        this.app = this.leaf.view.app;

        // Initialize with null values - they will be set when initialization completes
        this.vectorStore = null!;
        this.embeddingStore = null!;
        this.contextManager = null!;
        this.llmConnector = new LLMConnector(settings);

        // Set up the initialization promise
        this.initializationPromise = (async () => {
            try {
                // Wait for initialization to complete if it's in progress or hasn't started
                while (!isGloballyInitialized) {
                    if (globalInitializationPromise) {
                        logDebug(settings, 'Waiting for existing initialization to complete');
                        await globalInitializationPromise;
                    } else {
                        logDebug(settings, 'Waiting for initialization to start');
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                // Set up the instances
                if (globalVectorStore && globalEmbeddingStore) {
                    logDebug(settings, 'Setting up chat view with initialized embedding system');
                    this.vectorStore = globalVectorStore;
                    this.embeddingStore = globalEmbeddingStore;
                    this.contextManager = new ContextManager(this.vectorStore, this.settings);
                } else {
                    throw new Error('Embedding system not properly initialized');
                }
            } catch (error) {
                logError('Error during initialization', error);
                throw error;
            }
        })();
    }

    getViewType(): string {
        return AI_CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "AI Chat";
    }

    getIcon(): string {
        return "message-square";
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-helper-chat-view');

        // Create chat view layout
        this.createChatLayout(contentEl);

        // Initialize empty context notes display
        this.displayContextNotes();

        // Add welcome message if enabled in settings
        if (this.settings.chatSettings.displayWelcomeMessage) {
            this.addAssistantMessage("Hello! I'm your AI assistant. I can help you explore your notes. Ask me anything about your notes!");
        }
    }

    createChatLayout(container: HTMLElement) {
        // Create main content area
        const mainContent = container.createDiv({ cls: 'ai-helper-chat-main' });

        // Create header
        const headerSection = mainContent.createDiv({ cls: 'ai-helper-chat-header' });
        headerSection.createEl('h3', { text: 'AI Assistant' });

        // Create context section for relevant notes
        const contextSection = mainContent.createDiv({ cls: 'ai-helper-context-section' });
        const contextHeader = contextSection.createDiv({ cls: 'ai-helper-context-header' });
        contextHeader.setText('Relevant Notes');
        this.contextContainer = contextSection.createDiv({ cls: 'ai-helper-context-notes' });

        // Create messages container
        this.messagesContainer = mainContent.createDiv({ cls: 'ai-helper-chat-messages' });

        // Create input area
        this.inputContainer = mainContent.createDiv({ cls: 'ai-helper-chat-input-container' });
        this.inputField = this.inputContainer.createEl('textarea', {
            cls: 'ai-helper-chat-input',
            attr: { placeholder: 'Ask about your notes...' }
        });

        // Add event listeners
        this.inputField.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey && !this.isProcessing) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Create button container for both Reset and Send buttons
        const buttonContainer = this.inputContainer.createDiv({ cls: 'ai-helper-button-container' });

        // Add reset button to the left
        const resetButton = new ButtonComponent(buttonContainer)
            .setButtonText('Reset Chat')
            .onClick(() => this.resetChat());
        resetButton.buttonEl.classList.add('ai-helper-reset-button');

        // Add spacer to push send button to the right
        buttonContainer.createDiv({ cls: 'ai-helper-button-spacer' });

        // Add send button to the right
        this.sendButton = new ButtonComponent(buttonContainer)
            .setButtonText('Send')
            .setCta()
            .onClick(() => this.sendMessage());
    }

    displayContextNotes() {
        this.contextContainer.empty();

        if (this.relevantNotes.length === 0) {
            const emptyState = this.contextContainer.createDiv({ cls: 'ai-helper-context-empty' });

            // Add search icon
            const iconContainer = emptyState.createDiv({ cls: 'ai-helper-context-empty-icon' });
            iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

            // Add message
            const messageContainer = emptyState.createDiv({ cls: 'ai-helper-context-empty-message' });
            messageContainer.setText('Ask a question to search your notes');

            // Add suggestion
            const suggestionContainer = emptyState.createDiv({ cls: 'ai-helper-context-empty-suggestion' });
            suggestionContainer.setText('Relevant notes will appear here as context for our conversation');

            return;
        }

        // Sort notes by relevance
        const sortedNotes = [...this.relevantNotes].sort((a, b) => b.relevance - a.relevance);

        for (const note of sortedNotes) {
            const noteElement = this.contextContainer.createDiv({ cls: 'ai-helper-context-note' });

            // Add note title
            const titleEl = noteElement.createDiv({ cls: 'ai-helper-context-note-title' });
            titleEl.setText(note.file.basename);

            // Add metadata section (path and last updated)
            const metadataEl = noteElement.createDiv({ cls: 'ai-helper-context-note-metadata' });

            // Add note path
            const pathEl = metadataEl.createDiv({ cls: 'ai-helper-context-note-path' });
            pathEl.setText(note.file.path);

            // Add similarity score
            const similarityEl = metadataEl.createDiv({ cls: 'ai-helper-context-note-similarity' });
            similarityEl.setText(`Relevance: ${(note.relevance * 100).toFixed(1)}%`);

            // Add last updated time
            const lastUpdatedEl = metadataEl.createDiv({ cls: 'ai-helper-context-note-updated' });
            const lastUpdated = new Date(note.file.stat.mtime);
            const timeAgo = this.getTimeAgoString(lastUpdated);
            lastUpdatedEl.setText(`Last updated: ${timeAgo}`);

            // Add note content preview
            const contentEl = noteElement.createDiv({ cls: 'ai-helper-context-note-content' });
            contentEl.setText(note.content.substring(0, 200) + (note.content.length > 200 ? '...' : ''));

            // Make the note clickable to open it
            noteElement.addEventListener('click', () => {
                this.app.workspace.getLeaf().openFile(note.file);
            });
        }
    }

    // Helper function to format time ago
    private getTimeAgoString(date: Date): string {
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffInSeconds < 60) {
            return 'just now';
        }

        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) {
            return `${diffInMinutes}m ago`;
        }

        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) {
            return `${diffInHours}h ago`;
        }

        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 7) {
            return `${diffInDays}d ago`;
        }

        if (diffInDays < 30) {
            const weeks = Math.floor(diffInDays / 7);
            return `${weeks}w ago`;
        }

        if (diffInDays < 365) {
            const months = Math.floor(diffInDays / 30);
            return `${months}mo ago`;
        }

        const years = Math.floor(diffInDays / 365);
        return `${years}y ago`;
    }

    addUserMessage(message: string) {
        const messageEl = this.messagesContainer.createDiv({ cls: 'ai-helper-chat-message ai-helper-chat-message-user' });
        messageEl.setText(message);
        this.messages.push({ role: 'user', content: message });
        this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });
    }

    addAssistantMessage(message: string) {
        const messageEl = this.messagesContainer.createDiv({ cls: 'ai-helper-chat-message ai-helper-chat-message-assistant' });
        const contentDiv = messageEl.createDiv();
        MarkdownRenderer.renderMarkdown(message, contentDiv, '', this);
        this.messages.push({ role: 'assistant', content: message });
        this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });
        this.inputField.focus();
    }

    private setProcessingState(processing: boolean) {
        this.isProcessing = processing;
        this.inputField.disabled = processing;
        if (processing) {
            this.sendButton.setButtonText('Processing...');
            this.sendButton.buttonEl.disabled = true;
            this.inputField.placeholder = 'Please wait while I process your message...';
        } else {
            this.sendButton.setButtonText('Send');
            this.sendButton.buttonEl.disabled = false;
            this.inputField.placeholder = 'Ask about your notes...';
        }
    }

    async sendMessage() {
        const message = this.inputField.value.trim();
        if (!message || this.isProcessing) return;

        // Set processing state
        this.setProcessingState(true);

        try {
            // Clear input field
            this.inputField.value = '';

            // Add user message to chat
            this.addUserMessage(message);

            // Wait for initialization to complete
            if (this.initializationPromise) {
                await this.initializationPromise;
                this.initializationPromise = null; // Clear the promise after first use
            }

            // Ensure we have valid instances before proceeding
            if (!this.vectorStore || !this.embeddingStore || !this.contextManager) {
                throw new Error('Embedding system not properly initialized');
            }

            // Find relevant notes based on the query
            this.relevantNotes = await this.findRelevantNotes(message);
            this.displayContextNotes();

            // Generate response using the found notes
            const response = await this.generateResponse(message);

            // Add assistant response to chat
            this.addAssistantMessage(response.content);
        } catch (error) {
            logError('Error processing message', error);
            this.addAssistantMessage('I apologize, but I was unable to process your request. Please try again later.');
        } finally {
            // Reset processing state
            this.setProcessingState(false);
        }
    }

    async findRelevantNotes(query: string): Promise<NoteWithContent[]> {
        try {
            logDebug(this.settings, `Starting search for query: ${query}`);

            // Generate embedding for the query
            const queryEmbedding = await this.embeddingStore.generateEmbedding(query);
            logDebug(this.settings, 'Generated query embedding');

            // Extract key terms for title matching
            const searchTerms = query
                .toLowerCase()
                .split(/\s+/)
                .filter(term => term.length > 3)
                .map(term => term.replace(/[^\w\s]/g, ''));
            logDebug(this.settings, `Search terms: ${JSON.stringify(searchTerms)}`);

            // Get the active file if any
            const activeFile = this.app.workspace.getActiveFile();
            const file = activeFile ? activeFile : undefined;

            // Find semantically similar content
            const results = await this.vectorStore.search(queryEmbedding, {
                similarity: this.settings.chatSettings.similarity,
                limit: this.settings.chatSettings.maxNotesToSearch,
                searchTerms,
                file // Pass the active file for recency context
            });

            logDebug(this.settings, `Vector search results: ${JSON.stringify(results.map(r => ({
                path: r.path,
                score: r.score,
                recencyScore: r.recencyScore,
                titleScore: r.titleScore
            })))}`);

            // Process results
            const relevantNotes: NoteWithContent[] = [];
            const processedPaths = new Set<string>();

            for (const result of results) {
                if (processedPaths.has(result.path)) {
                    logDebug(this.settings, `Skipping duplicate path: ${result.path}`);
                    continue;
                }
                processedPaths.add(result.path);

                const file = this.app.vault.getAbstractFileByPath(result.path) as TFile;
                if (!file || !(file instanceof TFile)) {
                    logDebug(this.settings, `Invalid file at path: ${result.path}`);
                    continue;
                }

                try {
                    const content = await this.app.vault.cachedRead(file);
                    const mtime = file.stat.mtime;
                    const lastModified = new Date(mtime).toLocaleString();

                    logDebug(this.settings, `Found relevant note: ${JSON.stringify({
                        path: file.path,
                        score: result.score,
                        recencyScore: result.recencyScore,
                        titleScore: result.titleScore,
                        lastModified,
                        chunkIndex: result.chunkIndex,
                        contentLength: content.length
                    })}`);

                    relevantNotes.push({
                        file,
                        content,
                        relevance: result.score,
                        chunkIndex: result.chunkIndex
                    });
                } catch (error) {
                    console.error(`Error reading file ${file.path}:`, error);
                }
            }

            logDebug(this.settings, `Final relevant notes count: ${relevantNotes.length}`);
            return relevantNotes;
        } catch (error) {
            console.error('Error finding relevant notes:', error);
            return [];
        }
    }

    async generateResponse(userQuery: string): Promise<ChatMessage> {
        // Create context from relevant notes
        const context = this.contextManager.buildContext(userQuery, this.relevantNotes);

        logDebug(this.settings, `Context: ${context}`);

        // If no relevant notes were found, return a clear message
        if (this.relevantNotes.length === 0) {
            return { role: 'assistant', content: "I apologize, but I couldn't find any relevant notes in your vault that would help me answer your question. Could you please provide more context or rephrase your question?" };
        }

        // Create system message with strong anti-hallucination directive
        const responseSystemPrompt = `You are an AI assistant helping a user with their notes.
Be concise and helpful. ONLY use information from the provided context from the user's notes.
If the context doesn't contain relevant information, acknowledge this honestly.
When citing information, mention which note it came from.
NEVER make up or hallucinate information that isn't in the provided context.
If you're not sure about something, say so clearly.`;

        // Prepare messages for the LLM
        const messages: ChatMessage[] = [
            { role: 'system', content: `${responseSystemPrompt}\n\nContext from user's notes:\n${context}` },
            { role: 'system', content: `Here is the conversation history:\n${this.messages.slice(0, -1).map(m => `${m.role}: ${m.content}`).join('\n')}` },
            { role: 'user', content: userQuery }
        ];

        logDebug(this.settings, `Messages: ${JSON.stringify(messages)}`);

        // Send to LLM for processing
        const response = await this.llmConnector.generateResponse(messages);
        return response;
    }

    // Add a method to reset the chat
    resetChat() {
        // Clear messages
        this.messages = [];
        this.messagesContainer.empty();

        // Clear relevant notes
        this.relevantNotes = [];
        this.displayContextNotes();

        // Add welcome message if enabled in settings
        if (this.settings.chatSettings.displayWelcomeMessage) {
            this.addAssistantMessage("Hello! I'm your AI assistant. I can help you explore your notes. Ask me anything about your notes!");
        }
    }
}
