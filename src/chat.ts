import { App, Notice, TFile, MarkdownView, ButtonComponent, MarkdownRenderer, requestUrl, RequestUrlParam } from 'obsidian';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Settings } from './settings';
import { logDebug, logError } from './utils';

interface EmbeddingModel {
    embed: (text: string) => Promise<Float32Array>;
}

// Define the view type for the AI Chat
export const AI_CHAT_VIEW_TYPE = 'ai-helper-chat-view';

// Static initialization state to track across instances
let globalInitializationPromise: Promise<void> | null = null;
let isGloballyInitialized = false;

// Export these for use in main.ts
export { globalInitializationPromise, isGloballyInitialized };

// Classes for embedding management
let globalVectorStore: VectorStore | null = null;
export let globalEmbeddingStore: EmbeddingStore | null = null;

// Interface for a chat message
interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Interface for relevant notes and their context
interface NoteWithContent {
    file: TFile;
    content: string;
    relevance: number;
    chunkIndex?: number;
}

// Interface for note chunks with embeddings
interface NoteChunk {
    content: string;
    embedding: Float32Array;
    position: number;
}

// Interface for note embeddings
interface NoteEmbedding {
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
export class AIChatView extends ItemView {
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
    private isInitialized = false;
    private isProcessing = false;

    constructor(leaf: WorkspaceLeaf, settings: Settings) {
        super(leaf);
        this.settings = settings;
        this.app = this.leaf.view.app;

        // Use global instances if they exist, otherwise create new ones
        this.vectorStore = globalVectorStore || new VectorStore(settings.embeddingSettings.dimensions, settings, this.app);
        this.embeddingStore = globalEmbeddingStore || new EmbeddingStore(settings, this.vectorStore);

        // If we created new instances, store them globally
        if (!globalVectorStore) globalVectorStore = this.vectorStore;
        if (!globalEmbeddingStore) globalEmbeddingStore = this.embeddingStore;

        // Always ensure the app is set on the vector store
        this.vectorStore.setApp(this.app);

        this.contextManager = new ContextManager(this.vectorStore);
        this.llmConnector = new LLMConnector(settings);
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

        // Check if already initialized or initializing
        if (isGloballyInitialized) {
            this.isInitialized = true;
        } else if (!globalInitializationPromise) {
            // Start initialization if it hasn't started yet
            initializeEmbeddingSystem(this.settings, this.app);
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

            // Start initialization if not started already
            if (!isGloballyInitialized && !globalInitializationPromise) {
                initializeEmbeddingSystem(this.settings, this.app);
            }

            // If initialization is in progress, wait for it to complete
            if (globalInitializationPromise && !isGloballyInitialized) {
                const loadingMessage = this.messagesContainer.createDiv({
                    cls: 'ai-helper-chat-message ai-helper-chat-message-assistant ai-helper-chat-loading'
                });
                loadingMessage.setText('Initializing search capabilities...');

                await globalInitializationPromise;
                loadingMessage.remove();
                this.isInitialized = true;
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

    async indexNote(file: TFile) {
        try {
            const content = await this.app.vault.cachedRead(file);
            await this.embeddingStore.addNote(file, content);
        } catch (error) {
            logError(`Error indexing note ${file.path}`, error);
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
                similarity: 0.5,
                limit: this.settings.chatSettings.maxNotesToSearch || 5,
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
        const context = this.contextManager.buildContext(userQuery, this.relevantNotes, this.messages);

        // If embeddings are not initialized yet
        if (!isGloballyInitialized && globalInitializationPromise) {
            return { role: 'assistant', content: "I'm still initializing my search capabilities. I'll be able to search through your notes shortly. Feel free to ask your question again in a moment." };
        }

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
            { role: 'system', content: responseSystemPrompt },
            { role: 'user', content: context },
            { role: 'user', content: userQuery }
        ];

        logDebug(this.settings, '*****************');
        logDebug(this.settings, `Messages: ${JSON.stringify(messages)}`);
        logDebug(this.settings, '*****************');

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

    // This method is kept for backward compatibility
    async initializeVectorSearch() {
        if (isGloballyInitialized) {
            this.isInitialized = true;
            return;
        }

        if (globalInitializationPromise) {
            await globalInitializationPromise;
            this.isInitialized = true;
            return;
        }

        // Start initialization
        await initializeEmbeddingSystem(this.settings, this.app);
        this.isInitialized = true;
    }
}

// Vector Search Components

class EmbeddingStore {
    private embeddings: Map<string, NoteEmbedding> = new Map();
    private settings: Settings;
    private vectorStore: VectorStore;
    private embeddingModel: EmbeddingModel;
    private dimensions: number;

    constructor(settings: Settings, vectorStore: VectorStore) {
        this.settings = settings;
        this.vectorStore = vectorStore;
        this.dimensions = settings.embeddingSettings.dimensions;
    }

    async initialize() {
        try {
            logDebug(this.settings, 'Initializing EmbeddingStore');
            // Initialize the embedding model based on settings
            const provider = this.settings.embeddingSettings.provider;

            if (provider === 'openai') {
                // Use OpenAI embeddings
                this.embeddingModel = {
                    embed: async (text: string) => {
                        return await this.generateOpenAIEmbedding(text);
                    }
                };
                logDebug(this.settings, 'Using OpenAI embeddings');
            } else if (provider === 'local') {
                // Use local embeddings
                this.embeddingModel = {
                    embed: async (text: string) => {
                        return await this.generateLocalEmbedding(text);
                    }
                };
                logDebug(this.settings, 'Using local embeddings');
            } else {
                throw new Error('Invalid embedding provider. Must be either "openai" or "local".');
            }
            logDebug(this.settings, 'EmbeddingStore initialized successfully');
        } catch (error) {
            logError('Error initializing EmbeddingStore', error);
            throw error;
        }
    }

    async generateOpenAIEmbedding(text: string): Promise<Float32Array> {
        try {
            const apiKey = this.settings.chatSettings.openaiApiKey;
            const apiUrl = this.settings.embeddingSettings.openaiApiUrl || 'https://api.openai.com/v1/embeddings';
            const model = this.settings.embeddingSettings.openaiModel;

            if (!apiKey) {
                throw new Error('OpenAI API key is missing. Please configure it in the settings.');
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            };

            const requestBody = {
                model: model,
                input: text
            };

            const requestParams: RequestUrlParam = {
                url: apiUrl,
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            };

            const response = await requestUrl(requestParams);
            const responseData = response.json;

            if (responseData.data && responseData.data.length > 0 && responseData.data[0].embedding) {
                const embedding = new Float32Array(responseData.data[0].embedding);

                // Validate dimensionality
                if (embedding.length !== this.dimensions) {
                    logError(`OpenAI embedding dimensionality (${embedding.length}) does not match expected dimensionality (${this.dimensions}). This may cause issues with vector search.`);
                    // Update the dimensions setting to match the actual embedding
                    this.dimensions = embedding.length;
                    this.settings.embeddingSettings.dimensions = embedding.length;
                }

                return embedding;
            } else {
                throw new Error('Invalid response format from OpenAI embeddings API');
            }
        } catch (error) {
            logError('Error generating OpenAI embedding', error);
            throw error;
        }
    }

    async generateLocalEmbedding(text: string): Promise<Float32Array> {
        try {
            const apiUrl = this.settings.embeddingSettings.localApiUrl;
            const model = this.settings.embeddingSettings.localModel;

            if (!apiUrl) {
                throw new Error('Local embedding API URL is missing. Please configure it in the settings.');
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            const requestBody = {
                model: model,
                input: text
            };

            const requestParams: RequestUrlParam = {
                url: apiUrl,
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            };

            const response = await requestUrl(requestParams);
            const responseData = response.json;

            if (responseData.data && responseData.data.length > 0 && responseData.data[0].embedding) {
                const embedding = new Float32Array(responseData.data[0].embedding);

                // Validate dimensionality
                if (embedding.length !== this.dimensions) {
                    logError(`Local embedding dimensionality (${embedding.length}) does not match expected dimensionality (${this.dimensions}). This may cause issues with vector search.`);
                    // Update the dimensions setting to match the actual embedding
                    this.dimensions = embedding.length;
                    this.settings.embeddingSettings.dimensions = embedding.length;
                }

                return embedding;
            } else {
                throw new Error('Invalid response format from local embeddings API');
            }
        } catch (error) {
            logError('Error generating local embedding', error);
            throw error;
        }
    }

    async addNote(file: TFile, content: string) {
        try {
            logDebug(this.settings, `Processing note for embeddings: ${file.path}`);

            // Handle empty or very short content gracefully
            if (!this.isValidContent(file.path, content)) {
                return;
            }

            const chunks = this.chunkContent(content);
            logDebug(this.settings, `Created ${chunks.length} chunks for ${file.path}`);

            // If no chunks were created, skip this file
            if (chunks.length === 0) {
                logDebug(this.settings, `No chunks created for ${file.path}. Skipping.`);
                return;
            }

            const embeddings = await Promise.all(
                chunks.map(async (chunk, index) => {
                    const embedding = await this.generateEmbedding(chunk.content);
                    logDebug(this.settings, `Generated embedding for chunk ${index + 1}/${chunks.length} of ${file.path}`);
                    return embedding;
                })
            );

            const noteEmbedding: NoteEmbedding = {
                path: file.path,
                chunks: chunks.map((chunk, i) => ({
                    content: chunk.content,
                    embedding: embeddings[i],
                    position: chunk.position
                }))
            };

            // Store in both EmbeddingStore and VectorStore
            this.embeddings.set(file.path, noteEmbedding);
            this.vectorStore.addEmbedding(file.path, noteEmbedding);
            logDebug(this.settings, `Successfully added embeddings for ${file.path}`);
        } catch (error) {
            logError(`Error adding note ${file.path}`, error);
            throw error;
        }
    }

    async generateEmbedding(text: string): Promise<Float32Array> {
        try {
            if (!this.embeddingModel) {
                logError('Embedding model not initialized');
                throw new Error('Embedding model not initialized');
            }
            const embedding = await this.embeddingModel.embed(text);
            if (!embedding || !(embedding instanceof Float32Array)) {
                logError(`Invalid embedding generated: ${typeof embedding}`);
                throw new Error('Invalid embedding generated');
            }
            return embedding;
        } catch (error) {
            logError('Error generating embedding', error);
            throw error;
        }
    }

    private chunkContent(content: string): { content: string; position: number }[] {
        const chunkSize = this.settings.embeddingSettings.chunkSize;
        const chunkOverlap = this.settings.embeddingSettings.chunkOverlap;
        const chunks: { content: string; position: number }[] = [];

        // Split content into sections based on headers
        const sections = content.split(/(?=^#{1,6}\s)/m);
        let position = 0;

        for (const section of sections) {
            if (section.trim().length === 0) continue;

            // Split section into paragraphs
            const paragraphs = section.split(/\n\s*\n/);
            let currentChunk = '';
            let chunkStartPosition = position;
            let lastChunkContent = ''; // Keep track of last chunk for overlap

            for (const paragraph of paragraphs) {
                const trimmedParagraph = paragraph.trim();
                if (trimmedParagraph.length === 0) continue;

                // If this is a header paragraph, always start a new chunk
                const isHeader = /^#{1,6}\s/.test(trimmedParagraph);

                if (isHeader || (currentChunk.length + trimmedParagraph.length > chunkSize && currentChunk.length > 0)) {
                    if (currentChunk.length > 0) {
                        chunks.push({
                            content: currentChunk.trim(),
                            position: chunkStartPosition
                        });
                        lastChunkContent = currentChunk;
                    }

                    // Start new chunk, including overlap from previous chunk if available
                    if (!isHeader && lastChunkContent.length > 0) {
                        // Get the last few sentences or paragraphs up to chunkOverlap characters
                        const overlapText = this.getOverlapText(lastChunkContent, chunkOverlap);
                        currentChunk = overlapText + '\n\n' + trimmedParagraph;
                    } else {
                        currentChunk = trimmedParagraph;
                    }
                    chunkStartPosition = position - (isHeader ? 0 : chunkOverlap);
                } else {
                    // Add to current chunk
                    currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + trimmedParagraph;
                }

                position += trimmedParagraph.length + 2; // +2 for newlines
            }

            // Add the last chunk of the section
            if (currentChunk.length > 0) {
                chunks.push({
                    content: currentChunk.trim(),
                    position: chunkStartPosition
                });
                lastChunkContent = currentChunk;
            }
        }

        // If we have very small chunks at the end, combine them with overlap
        const consolidatedChunks: { content: string; position: number }[] = [];
        let currentConsolidated = '';
        let currentPosition = 0;
        let lastConsolidatedContent = '';

        for (const chunk of chunks) {
            const wouldExceedSize = currentConsolidated.length + chunk.content.length > chunkSize;

            if (!wouldExceedSize) {
                if (currentConsolidated.length > 0) {
                    currentConsolidated += '\n\n';
                }
                currentConsolidated += chunk.content;
                if (currentConsolidated.length === 0) {
                    currentPosition = chunk.position;
                }
            } else {
                if (currentConsolidated.length > 0) {
                    consolidatedChunks.push({
                        content: currentConsolidated,
                        position: currentPosition
                    });
                    lastConsolidatedContent = currentConsolidated;

                    // Start new consolidated chunk with overlap
                    const overlapText = this.getOverlapText(lastConsolidatedContent, chunkOverlap);
                    currentConsolidated = overlapText + '\n\n' + chunk.content;
                    currentPosition = chunk.position - chunkOverlap;
                } else {
                    currentConsolidated = chunk.content;
                    currentPosition = chunk.position;
                }
            }
        }

        if (currentConsolidated.length > 0) {
            consolidatedChunks.push({
                content: currentConsolidated,
                position: currentPosition
            });
        }

        return consolidatedChunks;
    }

    // Helper method to get overlap text
    private getOverlapText(text: string, overlapLength: number): string {
        if (text.length <= overlapLength) return text;

        // Try to break at sentence boundaries first
        const sentences = text.split(/(?<=[.!?])\s+/);
        let overlap = '';

        // Build up overlap text from complete sentences
        for (let i = sentences.length - 1; i >= 0; i--) {
            const potentialOverlap = sentences[i] + (overlap ? ' ' + overlap : '');
            if (potentialOverlap.length > overlapLength) break;
            overlap = potentialOverlap;
        }

        // If we couldn't get enough text from sentence boundaries,
        // fall back to paragraph boundaries
        if (overlap.length < overlapLength * 0.5) {
            const paragraphs = text.split(/\n\s*\n/);
            overlap = '';

            for (let i = paragraphs.length - 1; i >= 0; i--) {
                const potentialOverlap = paragraphs[i] + (overlap ? '\n\n' + overlap : '');
                if (potentialOverlap.length > overlapLength) break;
                overlap = potentialOverlap;
            }
        }

        // If we still don't have enough overlap, just take the last N characters
        if (overlap.length < overlapLength * 0.5) {
            overlap = text.slice(-overlapLength);
        }

        return overlap;
    }

    removeNote(path: string) {
        this.embeddings.delete(path);
        // Also remove from the vector store
        this.vectorStore.removeEmbedding(path);
        logDebug(this.settings, `Removed embeddings for ${path}`);
    }

    // Helper method to validate note content before processing
    private isValidContent(path: string, content: string): boolean {
        if (!content || content.trim().length < 50) {
            logDebug(this.settings, `File ${path} is too short to generate meaningful embeddings (${content.length} chars). Skipping.`);
            return false;
        }
        return true;
    }
}

class VectorStore {
    private embeddings: Map<string, NoteEmbedding> = new Map();
    private dimensions: number;
    private index: Map<string, { chunks: NoteChunk[], maxScore: number }> = new Map();
    private app: App | null = null;
    private settings: Settings;

    constructor(dimensions: number, settings: Settings, app?: App) {
        this.dimensions = dimensions;
        this.settings = settings;
        if (app) this.setApp(app);
    }

    setApp(app: App) {
        this.app = app;
    }

    // Helper method to calculate recency score
    private calculateRecencyScore(mtime: number): number {
        const now = Date.now();
        const daysSinceModified = (now - mtime) / (1000 * 60 * 60 * 24);

        // Exponential decay function that gives:
        // - 0.3 (max recency boost) for files modified today
        // - 0.15 for files modified a week ago
        // - 0.075 for files modified a month ago
        // - Approaching 0 for older files
        return 0.3 * Math.exp(-daysSinceModified / 30);
    }

    async search(queryEmbedding: Float32Array, options: {
        similarity: number;
        limit: number;
        searchTerms?: string[];
        file?: TFile;
    }): Promise<{
        path: string;
        score: number;
        chunkIndex?: number;
        titleScore?: number;
        recencyScore?: number;
    }[]> {
        if (this.embeddings.size === 0) {
            console.warn('No embeddings found in vector store');
            return [];
        }

        const results: {
            path: string;
            score: number;
            chunkIndex?: number;
            titleScore?: number;
            recencyScore?: number;
            baseScore: number;
        }[] = [];

        const similarityThreshold = options.similarity || 0.5;
        const limit = options.limit || 5;
        const searchTerms = options.searchTerms || [];

        for (const [path, noteEmbedding] of this.embeddings.entries()) {
            let maxSimilarity = 0;
            let bestChunkIndex = -1;

            // Calculate title relevance score
            const filename = path.split('/').pop()?.toLowerCase() || '';
            const titleScore = searchTerms.reduce((score, term) => {
                if (filename.includes(term.toLowerCase())) {
                    score += 0.3;
                }
                return score;
            }, 0);

            // Calculate recency score if we have access to the file
            const file = this.app?.vault.getAbstractFileByPath(path);
            const recencyScore = file instanceof TFile ? this.calculateRecencyScore(file.stat.mtime) : 0;

            // Track the best matching chunks for this note
            const noteChunks: { similarity: number; index: number; isHeader: boolean }[] = [];

            for (let i = 0; i < noteEmbedding.chunks.length; i++) {
                const chunk = noteEmbedding.chunks[i];
                if (!chunk?.embedding || chunk.embedding.length !== this.dimensions) continue;

                const similarity = this.calculateCosineSimilarity(queryEmbedding, chunk.embedding);

                // Check if this chunk starts with a header
                const isHeader = /^#{1,6}\s/.test(chunk.content.trim());

                noteChunks.push({ similarity, index: i, isHeader });

                if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                    bestChunkIndex = i;
                }
            }

            // Sort chunks by similarity
            noteChunks.sort((a, b) => b.similarity - a.similarity);

            // Take the top 2 chunks if they exist
            for (let i = 0; i < Math.min(2, noteChunks.length); i++) {
                const chunk = noteChunks[i];
                const baseScore = chunk.similarity;
                const combinedScore = baseScore + titleScore + recencyScore;

                if (combinedScore >= similarityThreshold) {
                    results.push({
                        path,
                        score: combinedScore,
                        baseScore,
                        chunkIndex: chunk.index,
                        titleScore,
                        recencyScore
                    });
                }
            }

            // Always include best chunk if it has a title match or is recent
            if ((titleScore > 0 || recencyScore > 0.15) && maxSimilarity > 0 && !results.some(r => r.path === path)) {
                results.push({
                    path,
                    score: maxSimilarity + titleScore + recencyScore,
                    baseScore: maxSimilarity,
                    chunkIndex: bestChunkIndex,
                    titleScore,
                    recencyScore
                });
            }
        }

        // Sort by combined score and limit results
        const sortedResults = results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ baseScore, ...rest }) => rest); // Remove baseScore from final results

        logDebug(this.settings, `Search results with scores: ${JSON.stringify(sortedResults.map(r => ({
            path: r.path,
            total: r.score.toFixed(3),
            title: r.titleScore?.toFixed(3) || '0',
            recency: r.recencyScore?.toFixed(3) || '0'
        })))}`);

        return sortedResults;
    }

    private calculateCosineSimilarity(a: Float32Array, b: Float32Array): number {
        // Ensure both vectors have the same dimensionality
        if (a.length !== b.length) {
            logError(`Cannot calculate similarity between vectors of different dimensions (${a.length} vs ${b.length})`);
            return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) return 0;

        return dotProduct / (normA * normB);
    }

    addEmbedding(path: string, embedding: NoteEmbedding) {
        // Validate the embedding before adding
        if (!embedding || !embedding.chunks || embedding.chunks.length === 0) {
            logDebug(this.settings, `Skipping embedding for path: ${path} - No chunks available`);
            return;
        }

        // Validate all chunks have the correct dimensionality
        const validChunks = embedding.chunks.every(chunk => {
            if (!chunk.embedding || chunk.embedding.length !== this.dimensions) {
                logError(`Invalid chunk embedding in ${path}. Expected ${this.dimensions} dimensions, got ${chunk.embedding?.length || 0}`);
                return false;
            }
            return true;
        });

        if (!validChunks) {
            logDebug(this.settings, `Skipping invalid embedding for path: ${path} - Dimension mismatch`);
            return;
        }

        this.embeddings.set(path, embedding);
        logDebug(this.settings, `Added embedding for ${path} with ${embedding.chunks.length} chunks`);

        // Initialize index entry
        this.index.set(path, {
            chunks: embedding.chunks,
            maxScore: 0
        });
    }

    removeEmbedding(path: string) {
        this.embeddings.delete(path);
        this.index.delete(path);
    }

    // Get a specific chunk from a note
    getChunk(path: string, chunkIndex: number): NoteChunk | null {
        const noteEmbedding = this.embeddings.get(path);
        if (!noteEmbedding || chunkIndex < 0 || chunkIndex >= noteEmbedding.chunks.length) {
            return null;
        }
        return noteEmbedding.chunks[chunkIndex];
    }
}

class ContextManager {
    private readonly MAX_CONTEXT_LENGTH = 4000; // Adjust based on LLM limits
    private vectorStore: VectorStore;

    constructor(vectorStore: VectorStore) {
        this.vectorStore = vectorStore;
    }

    buildContext(query: string, notes: NoteWithContent[], history: ChatMessage[]): string {
        // Format conversation history, excluding the current message
        // Create a copy of the history without the last message (which is the current query)
        const historyWithoutCurrent = history.slice(0, -1);
        let context = this.formatConversationHistory(historyWithoutCurrent);

        // Add relevant notes
        if (notes.length > 0) {
            context += "\n\nHere is information from your notes that may be relevant to your query:\n\n";

            // Sort notes by relevance
            const sortedNotes = [...notes].sort((a, b) => b.relevance - a.relevance);

            for (const note of sortedNotes) {
                const excerpt = this.extractRelevantExcerpt(note, query);
                if ((context + excerpt).length < this.MAX_CONTEXT_LENGTH) {
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

    private formatConversationHistory(history: ChatMessage[]): string {
        // Only include the last few messages to save context space
        const recentHistory = history.slice(-5);

        let formattedHistory = "Previous conversation:\n";
        for (const message of recentHistory) {
            formattedHistory += `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}\n`;
        }

        return formattedHistory;
    }

    private extractRelevantExcerpt(note: NoteWithContent, query: string): string {
        // If we have a chunkIndex in the note metadata, use that specific chunk
        if ('chunkIndex' in note && typeof note.chunkIndex === 'number') {
            const chunk = this.vectorStore.getChunk(note.file.path, note.chunkIndex);
            if (chunk) {
                return chunk.content;
            }
        }

        // Otherwise, use a more sophisticated approach to find relevant sections
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

class LLMConnector {
    private settings: Settings;

    constructor(settings: Settings) {
        this.settings = settings;
    }

    async generateResponse(messages: ChatMessage[]): Promise<ChatMessage> {
        const provider = this.settings.chatSettings.provider;
        const apiEndpoint = provider === 'local'
            ? this.settings.chatSettings.localApiUrl
            : this.settings.chatSettings.openaiApiUrl;
        const modelName = provider === 'local'
            ? this.settings.chatSettings.localModel
            : this.settings.chatSettings.openaiModel;

        if (!apiEndpoint) {
            throw new Error('API endpoint is not configured. Please check your settings.');
        }

        try {
            // Prepare request parameters
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // Add Authorization header for OpenAI
            if (provider === 'openai') {
                const apiKey = this.settings.chatSettings.openaiApiKey;
                if (!apiKey) {
                    throw new Error('OpenAI API key is missing. Please configure it in the settings.');
                }
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            // Prepare request body
            const requestBody = {
                model: modelName,
                messages: messages,
                temperature: this.settings.chatSettings.temperature,
                max_tokens: this.settings.chatSettings.maxTokens,
                stream: false
            };

            const requestParams: RequestUrlParam = {
                url: apiEndpoint,
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            };

            // Send request to API
            const response = await requestUrl(requestParams);

            // Parse response
            const responseData = response.json;

            if (responseData.choices && responseData.choices.length > 0) {
                const messageContent = responseData.choices[0].message.content;
                return { role: 'assistant', content: messageContent };
            } else {
                throw new Error('Invalid response format from API');
            }
        } catch (error) {
            logError('Error in API request', error);
            throw error;
        }
    }
}

// Function to initialize the embedding system directly without requiring a view
export async function initializeEmbeddingSystem(settings: Settings, app: App): Promise<void> {
    // If already initialized or initializing, don't start again
    if (isGloballyInitialized || globalInitializationPromise) {
        return;
    }

    // Create global instances if they don't exist yet
    if (!globalVectorStore) {
        globalVectorStore = new VectorStore(settings.embeddingSettings.dimensions, settings, app);
    } else {
        // Ensure the app is set on the existing vector store
        globalVectorStore.setApp(app);
    }

    if (!globalEmbeddingStore) {
        globalEmbeddingStore = new EmbeddingStore(settings, globalVectorStore);
    }

    // Start the initialization process asynchronously
    globalInitializationPromise = (async () => {
        try {
            await globalEmbeddingStore.initialize();

            // Index all markdown files
            const files = app.vault.getMarkdownFiles();
            logDebug(settings, `Starting to index ${files.length} notes for vector search`);

            if (files.length === 0) {
                logError("No markdown files found in the vault. This is unexpected.");

                // Add a more detailed log to help diagnose the issue
                try {
                    const allFiles = app.vault.getAllLoadedFiles();
                    logDebug(settings, `Total files in vault: ${allFiles.length}`);
                    if (allFiles.length > 0) {
                        logDebug(settings, `Types of files: ${allFiles.slice(0, 5).map(f => f.constructor.name).join(', ')}...`);
                    }
                } catch (e) {
                    logError("Error inspecting vault files", e);
                }
            }

            // Create a custom notification for progress tracking if debug mode is enabled
            let progressNotice: Notice | null = null;
            let progressElement: HTMLElement | null = null;

            progressNotice = new Notice('', 0);
            progressElement = progressNotice.noticeEl.createDiv();
            progressElement.setText(`Indexing notes: 0/${files.length}`);

            let processedCount = 0;
            for (const file of files) {
                try {
                    logDebug(settings, `Processing file: ${file.path}`);
                    const content = await app.vault.cachedRead(file);
                    await globalEmbeddingStore.addNote(file, content);

                    // Update progress notification
                    processedCount++;
                    if (progressElement) {
                        progressElement.setText(`Indexing notes: ${processedCount}/${files.length}`);
                    }
                } catch (error) {
                    logError(`Error indexing note ${file.path}`, error);
                }
            }

            // Show completion notification
            if (progressNotice) {
                progressNotice.hide(); // Hide the progress notification
                new Notice(`Indexed ${files.length} notes for vector search`, 3000);
            }

            logDebug(settings, `Indexed ${files.length} notes for vector search`);
            isGloballyInitialized = true;

            // Dispatch a custom event that the plugin can listen for
            // to trigger processing of any pending file updates
            logDebug(settings, "Embedding initialization complete");

            // Create custom event with payload indicating this is initial indexing
            const event = new CustomEvent('ai-helper-indexing-complete', {
                detail: { isInitialIndexing: true }
            });
            document.dispatchEvent(event);
            logDebug(settings, "Dispatched event: ai-helper-indexing-complete with isInitialIndexing=true");

        } catch (error) {
            logError('Error initializing vector search', error);
            // Use console error instead of Notice to avoid UI blocking
            logError('Error initializing vector search. Some features may not work correctly.');
        }
    })();

    return globalInitializationPromise;
}