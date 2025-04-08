import { App, Notice, TFile, MarkdownView, ButtonComponent, MarkdownRenderer, requestUrl, RequestUrlParam } from 'obsidian';
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Settings } from './settings';

// Define the view type for the AI Chat
export const AI_CHAT_VIEW_TYPE = 'ai-helper-chat-view';

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

// Example note for context (fallback)
const EXAMPLE_NOTE = {
    title: "Example Note",
    path: "Personal/Example Note.md",
    content: "This is an example note that demonstrates the chat functionality.\n\n" +
            "It contains some sample content about note-taking and organization.\n\n" +
            "- Use markdown for organization\n" +
            "- Keep notes concise and clear\n" +
            "- Regular reviews help maintain knowledge"
};

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
    relevantNotes: NoteWithContent[] = [];
    app: App;

    // Vector search components
    private embeddingStore: EmbeddingStore;
    private vectorStore: VectorStore;
    private contextManager: ContextManager;
    private llmConnector: LLMConnector;
    private isInitialized = false;

    constructor(leaf: WorkspaceLeaf, settings: Settings) {
        super(leaf);
        this.settings = settings;
        this.app = this.leaf.view.app;

        // Initialize components in correct order
        this.vectorStore = new VectorStore(settings.embeddingSettings.dimensions);
        this.embeddingStore = new EmbeddingStore(settings, this.vectorStore);
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

        // Initialize vector search if not already done
        if (!this.isInitialized) {
            await this.initializeVectorSearch();
            this.isInitialized = true;
        }

        // Initialize empty context notes display
        this.displayContextNotes();

        // Add welcome message
        this.addAssistantMessage("Hello! I'm your AI assistant. I can help you explore your notes. Ask me anything about your notes!");
    }

    createChatLayout(container: HTMLElement) {
        // Create main content area
        const mainContent = container.createDiv({ cls: 'ai-helper-chat-main' });

        // Create header
        const headerSection = mainContent.createDiv({ cls: 'ai-helper-chat-header' });
        headerSection.createEl('h3', { text: 'AI Assistant' });

        // Add reset button
        const resetButton = headerSection.createEl('button', {
            cls: 'ai-helper-reset-button',
            text: 'Reset Chat'
        });
        resetButton.addEventListener('click', () => {
            this.resetChat();
        });

        // Create context section for relevant notes
        const contextSection = mainContent.createDiv({ cls: 'ai-helper-context-section' });
        const contextHeader = contextSection.createDiv({ cls: 'ai-helper-context-header' });
        contextHeader.setText('Context Notes');
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
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Create send button
        const buttonContainer = this.inputContainer.createDiv({ cls: 'ai-helper-button-container' });
        new ButtonComponent(buttonContainer)
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

    async sendMessage() {
        const userQuery = this.inputField.value.trim();
        if (!userQuery) return;

        // Clear input
        this.inputField.value = '';

        // Add user message to chat
        this.addUserMessage(userQuery);

        try {
            // Find relevant notes using vector search
            this.relevantNotes = await this.findRelevantNotes(userQuery);

            // Update the context display
            this.displayContextNotes();

            // Generate response using the found notes
            const response = await this.generateResponse(userQuery);

            // Add assistant response to chat
            this.addAssistantMessage(response);
        } catch (error) {
            console.error('Error processing message:', error);
            this.addAssistantMessage('I apologize, but I was unable to process your request. Please try again later.');
        }
    }

    async initializeVectorSearch() {
        try {
            // Initialize the embedding store
            await this.embeddingStore.initialize();

            // Index all markdown files
            const files = this.app.vault.getMarkdownFiles();
            for (const file of files) {
                await this.indexNote(file);
            }

            console.log(`Indexed ${files.length} notes for vector search`);
        } catch (error) {
            console.error('Error initializing vector search:', error);
            new Notice('Error initializing vector search. Some features may not work correctly.');
        }
    }

    async indexNote(file: TFile) {
        try {
            const content = await this.app.vault.cachedRead(file);
            await this.embeddingStore.addNote(file, content);
        } catch (error) {
            console.error(`Error indexing note ${file.path}:`, error);
        }
    }

    async findRelevantNotes(query: string): Promise<NoteWithContent[]> {
        try {
            console.log('Starting search for query:', query);

            // Generate embedding for the query
            const queryEmbedding = await this.embeddingStore.generateEmbedding(query);
            console.log('Generated query embedding');

            // Extract key terms for title matching
            const searchTerms = query
                .toLowerCase()
                .split(/\s+/)
                .filter(term => term.length > 3)
                .map(term => term.replace(/[^\w\s]/g, ''));
            console.log('Search terms:', searchTerms);

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

            console.log('Vector search results:', results.map(r => ({
                path: r.path,
                score: r.score,
                recencyScore: r.recencyScore,
                titleScore: r.titleScore
            })));

            // Process results
            const relevantNotes: NoteWithContent[] = [];
            const processedPaths = new Set<string>();

            for (const result of results) {
                if (processedPaths.has(result.path)) {
                    console.log('Skipping duplicate path:', result.path);
                    continue;
                }
                processedPaths.add(result.path);

                const file = this.app.vault.getAbstractFileByPath(result.path) as TFile;
                if (!file || !(file instanceof TFile)) {
                    console.log('Invalid file at path:', result.path);
                    continue;
                }

                try {
                    const content = await this.app.vault.cachedRead(file);
                    const mtime = file.stat.mtime;
                    const lastModified = new Date(mtime).toLocaleString();

                    console.log('Found relevant note:', {
                        path: file.path,
                        score: result.score,
                        recencyScore: result.recencyScore,
                        titleScore: result.titleScore,
                        lastModified,
                        chunkIndex: result.chunkIndex,
                        contentLength: content.length
                    });

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

            console.log('Final relevant notes count:', relevantNotes.length);
            return relevantNotes;
        } catch (error) {
            console.error('Error finding relevant notes:', error);
            return [];
        }
    }

    async generateResponse(userQuery: string): Promise<string> {
        // Create context from relevant notes
        const context = this.contextManager.buildContext(userQuery, this.relevantNotes, this.messages);

        // If no relevant notes were found, return a clear message
        if (this.relevantNotes.length === 0) {
            return "I apologize, but I couldn't find any relevant notes in your vault that would help me answer your question. Could you please provide more context or rephrase your question?";
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

        // Send to LLM for processing
        const response = await this.llmConnector.generateResponse(messages);
        return response.content;
    }

    // Add a method to reset the chat
    resetChat() {
        // Clear messages
        this.messages = [];
        this.messagesContainer.empty();

        // Clear relevant notes
        this.relevantNotes = [];
        this.displayContextNotes();

        // Add welcome message
        this.addAssistantMessage("Hello! I'm your AI assistant. I can help you explore your notes. Ask me anything about your notes!");
    }
}

// Vector Search Components

class EmbeddingStore {
    private embeddings: Map<string, NoteEmbedding> = new Map();
    private embeddingModel: any;
    private settings: Settings;
    private dimensions: number;
    private vectorStore: VectorStore;

    constructor(settings: Settings, vectorStore: VectorStore) {
        this.settings = settings;
        this.dimensions = settings.embeddingSettings.dimensions;
        this.vectorStore = vectorStore;
    }

    async initialize() {
        try {
            console.log('Initializing EmbeddingStore');
            // Initialize the embedding model based on settings
            const provider = this.settings.embeddingSettings.provider;

            if (provider === 'none') {
                // Use mock embeddings
                this.embeddingModel = {
                    embed: async (text: string) => {
                        // Mock embedding generation with configurable dimensions
                        return new Float32Array(this.dimensions).fill(0).map(() => Math.random());
                    }
                };
                console.log(`Using mock embeddings with ${this.dimensions} dimensions`);
            } else if (provider === 'openai') {
                // Use OpenAI embeddings
                this.embeddingModel = {
                    embed: async (text: string) => {
                        return await this.generateOpenAIEmbedding(text);
                    }
                };
                console.log('Using OpenAI embeddings');
            } else if (provider === 'local') {
                // Use local embeddings
                this.embeddingModel = {
                    embed: async (text: string) => {
                        return await this.generateLocalEmbedding(text);
                    }
                };
                console.log('Using local embeddings');
            }
            console.log('EmbeddingStore initialized successfully');
        } catch (error) {
            console.error('Error initializing EmbeddingStore:', error);
            throw error;
        }
    }

    async generateOpenAIEmbedding(text: string): Promise<Float32Array> {
        try {
            const apiKey = this.settings.openAISettings.apiKey;
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
                    console.warn(`Warning: OpenAI embedding dimensionality (${embedding.length}) does not match expected dimensionality (${this.dimensions}). This may cause issues with vector search.`);
                    // Update the dimensions setting to match the actual embedding
                    this.dimensions = embedding.length;
                    this.settings.embeddingSettings.dimensions = embedding.length;
                }

                return embedding;
            } else {
                throw new Error('Invalid response format from OpenAI embeddings API');
            }
        } catch (error) {
            console.error('Error generating OpenAI embedding:', error);
            // Fallback to mock embeddings with configured dimensions
            return new Float32Array(this.dimensions).fill(0).map(() => Math.random());
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

            // Add API key if provided
            if (this.settings.localLLMSettings.apiKey) {
                headers['Authorization'] = `Bearer ${this.settings.localLLMSettings.apiKey}`;
            }

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
                    console.warn(`Warning: Local embedding dimensionality (${embedding.length}) does not match expected dimensionality (${this.dimensions}). This may cause issues with vector search.`);
                    // Update the dimensions setting to match the actual embedding
                    this.dimensions = embedding.length;
                    this.settings.embeddingSettings.dimensions = embedding.length;
                }

                return embedding;
            } else {
                throw new Error('Invalid response format from local embeddings API');
            }
        } catch (error) {
            console.error('Error generating local embedding:', error);
            // Fallback to mock embeddings with configured dimensions
            return new Float32Array(this.dimensions).fill(0).map(() => Math.random());
        }
    }

    async addNote(file: TFile, content: string) {
        try {
            console.log(`Processing note for embeddings: ${file.path}`);
            const chunks = this.chunkContent(content);
            console.log(`Created ${chunks.length} chunks for ${file.path}`);

            const embeddings = await Promise.all(
                chunks.map(async (chunk, index) => {
                    const embedding = await this.generateEmbedding(chunk.content);
                    console.log(`Generated embedding for chunk ${index + 1}/${chunks.length} of ${file.path}`);
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
            console.log(`Successfully added embeddings for ${file.path}`);
        } catch (error) {
            console.error(`Error adding note ${file.path}:`, error);
            throw error;
        }
    }

    async generateEmbedding(text: string): Promise<Float32Array> {
        try {
            if (!this.embeddingModel) {
                console.error('Embedding model not initialized');
                throw new Error('Embedding model not initialized');
            }
            const embedding = await this.embeddingModel.embed(text);
            if (!embedding || !(embedding instanceof Float32Array)) {
                console.error('Invalid embedding generated:', embedding);
                throw new Error('Invalid embedding generated');
            }
            return embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
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
    }
}

class VectorStore {
    private embeddings: Map<string, NoteEmbedding> = new Map();
    private dimensions: number;
    private index: Map<string, { chunks: NoteChunk[], maxScore: number }> = new Map();

    constructor(dimensions: number) {
        this.dimensions = dimensions;
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
            const file = options.file?.vault.getAbstractFileByPath(path);
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

        console.log('Search results with scores:', sortedResults.map(r => ({
            path: r.path,
            total: r.score.toFixed(3),
            title: r.titleScore?.toFixed(3) || '0',
            recency: r.recencyScore?.toFixed(3) || '0'
        })));

        return sortedResults;
    }

    private calculateCosineSimilarity(a: Float32Array, b: Float32Array): number {
        // Ensure both vectors have the same dimensionality
        if (a.length !== b.length) {
            console.error(`Error: Cannot calculate similarity between vectors of different dimensions (${a.length} vs ${b.length})`);
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
            console.error(`Invalid embedding for path: ${path}`);
            return;
        }

        // Validate all chunks have the correct dimensionality
        const validChunks = embedding.chunks.every(chunk => {
            if (!chunk.embedding || chunk.embedding.length !== this.dimensions) {
                console.warn(`Warning: Invalid chunk embedding in ${path}. Expected ${this.dimensions} dimensions, got ${chunk.embedding?.length || 0}`);
                return false;
            }
            return true;
        });

        if (!validChunks) {
            console.error(`Skipping invalid embedding for path: ${path}`);
            return;
        }

        this.embeddings.set(path, embedding);
        console.log(`Added embedding for ${path} with ${embedding.chunks.length} chunks`);

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
        // Format conversation history
        let context = this.formatConversationHistory(history);

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
        // Determine which API endpoint to use
        let apiEndpoint = 'https://api.openai.com/v1/chat/completions';
        let apiKey = '';
        let modelName = 'gpt-3.5-turbo';
        let isLocalLLM = false;

        // Check if local LLM is enabled
        const isLocalLLMEnabled = this.settings.localLLMSettings?.enabled && this.settings.localLLMSettings?.apiUrl;

        if (isLocalLLMEnabled) {
            // Use Local LLM settings
            apiEndpoint = this.settings.localLLMSettings.apiUrl;
            apiKey = this.settings.localLLMSettings.apiKey || '';
            modelName = this.settings.localLLMSettings.modelName || 'mistral-7b-instruct';
            isLocalLLM = true;
        } else {
            // Use OpenAI settings
            apiEndpoint = this.settings.openAISettings?.apiUrl || 'https://api.openai.com/v1/chat/completions';
            apiKey = this.settings.openAISettings?.apiKey || '';
            modelName = this.settings.openAISettings?.modelName || 'gpt-3.5-turbo';

            // Only check for OpenAI API key if OpenAI is being used
            if (!apiKey) {
                throw new Error('API key is missing. Please configure it in the settings.');
            }
        }

        try {
            // Prepare request parameters
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // Only add Authorization header if API key is provided
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            // Prepare request body based on API type
            let requestBody: any;

            if (isLocalLLM) {
                // Format for LM Studio
                requestBody = {
                    model: modelName,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 2000,
                    stream: false
                };
            } else {
                // Format for OpenAI
                requestBody = {
                    model: modelName,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 2000
                };
            }

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
            console.error('Error in API request:', error);
            throw error;
        }
    }
}