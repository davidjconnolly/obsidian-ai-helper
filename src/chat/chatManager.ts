import { App, ItemView, WorkspaceLeaf } from 'obsidian';
import { ChatMessage, NoteWithContent } from '../types';
import { Settings } from '../settings';
import { ContextManager } from './contextManager';
import { LLMConnector } from './llmConnector';
import { VectorStore } from '../vector/vectorStore';
import { EmbeddingStore } from '../vector/embeddingStore';

export const VIEW_TYPE_AI_CHAT = "ai-chat-view";

export class ChatManager extends ItemView {
    private messages: ChatMessage[] = [];
    private relevantNotes: NoteWithContent[] = [];
    private isProcessing = false;
    private contextManager: ContextManager;
    private llmConnector: LLMConnector;
    private vectorStore: VectorStore;
    private embeddingStore: EmbeddingStore;
    public app: App;

    constructor(
        leaf: WorkspaceLeaf,
        private settings: Settings
    ) {
        super(leaf);
        this.app = this.leaf.view.app;
        this.vectorStore = new VectorStore(settings.embeddingSettings.dimensions, settings, this.app);
        this.embeddingStore = new EmbeddingStore(settings, this.vectorStore);
        this.contextManager = new ContextManager(this.vectorStore);
        this.llmConnector = new LLMConnector(settings);
    }

    getViewType(): string {
        return VIEW_TYPE_AI_CHAT;
    }

    getDisplayText(): string {
        return "AI Chat";
    }

    async onOpen(): Promise<void> {
        await this.initializeVectorSearch();
        this.render();
    }

    private async initializeVectorSearch(): Promise<void> {
        try {
            await this.embeddingStore.initialize();
        } catch (error) {
            console.error("Failed to initialize vector search:", error);
        }
    }

    private render(): void {
        const container = this.containerEl;
        container.empty();
        container.createEl('h2', { text: 'AI Chat' });

        const chatContainer = container.createDiv('chat-container');
        this.renderMessages(chatContainer);
        this.renderInputArea(container);
        this.renderRelevantNotes(container);
    }

    private renderMessages(container: HTMLElement): void {
        const messagesContainer = container.createDiv('messages-container');
        for (const message of this.messages) {
            const messageEl = messagesContainer.createDiv(`message ${message.role}`);
            messageEl.createDiv('message-content').setText(message.content);
        }
    }

    private renderInputArea(container: HTMLElement): void {
        const inputContainer = container.createDiv('input-container');
        const textarea = inputContainer.createEl('textarea', {
            attr: { placeholder: 'Type your message...' }
        });

        const buttonContainer = inputContainer.createDiv('button-container');
        const sendButton = buttonContainer.createEl('button', { text: 'Send' });
        const resetButton = buttonContainer.createEl('button', { text: 'Reset Chat' });

        sendButton.addEventListener('click', () => this.handleSendMessage(textarea));
        resetButton.addEventListener('click', () => this.resetChat());

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage(textarea);
            }
        });
    }

    private renderRelevantNotes(container: HTMLElement): void {
        const notesContainer = container.createDiv('relevant-notes-container');
        notesContainer.createEl('h3', { text: 'Relevant Notes' });

        for (const note of this.relevantNotes) {
            const noteEl = notesContainer.createDiv('relevant-note');
            noteEl.createDiv('note-title').setText(note.file.basename);
            noteEl.createDiv('note-excerpt').setText(note.content.substring(0, 100) + '...');
            noteEl.createDiv('note-score').setText(`Relevance: ${Math.round(note.relevance * 100)}%`);
        }
    }

    private async handleSendMessage(textarea: HTMLTextAreaElement): Promise<void> {
        if (this.isProcessing || !textarea.value.trim()) return;

        const userMessage = textarea.value.trim();
        textarea.value = '';

        await this.addUserMessage(userMessage);
        await this.generateResponse(userMessage);
    }

    private async addUserMessage(content: string): Promise<void> {
        this.messages.push({
            role: 'user',
            content
        });
        this.render();
    }

    private async addAssistantMessage(content: string): Promise<void> {
        this.messages.push({
            role: 'assistant',
            content
        });
        this.render();
    }

    private async generateResponse(userMessage: string): Promise<void> {
        this.isProcessing = true;
        this.render();

        try {
            const context = this.contextManager.buildContext(userMessage, this.relevantNotes, this.messages);

            if (this.relevantNotes.length === 0) {
                await this.addAssistantMessage("I apologize, but I couldn't find any relevant notes in your vault that would help me answer your question. Could you please provide more context or rephrase your question?");
                return;
            }

            const responseSystemPrompt = `You are an AI assistant helping a user with their notes.
Be concise and helpful. ONLY use information from the provided context from the user's notes.
If the context doesn't contain relevant information, acknowledge this honestly.
When citing information, mention which note it came from.
NEVER make up or hallucinate information that isn't in the provided context.
If you're not sure about something, say so clearly.`;

            const messages: ChatMessage[] = [
                { role: 'system', content: responseSystemPrompt },
                { role: 'user', content: context },
                { role: 'user', content: userMessage }
            ];

            const response = await this.llmConnector.generateResponse(messages);
            await this.addAssistantMessage(response.content);
        } catch (error) {
            console.error("Error generating response:", error);
            await this.addAssistantMessage("I apologize, but I encountered an error while processing your request. Please try again.");
        } finally {
            this.isProcessing = false;
            this.render();
        }
    }

    public resetChat(): void {
        this.messages = [];
        this.relevantNotes = [];
        this.render();
    }
}