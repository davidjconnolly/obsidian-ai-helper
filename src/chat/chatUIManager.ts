import { App, ButtonComponent, Component, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';
import { Settings } from '../settings';
import { NoteWithContent } from '../types';
import { logDebug, logError } from '../utils';

export class ChatUIManager extends Component {
    private contentEl: HTMLElement;
    private contextContainer: HTMLElement;
    private messagesContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private inputField: HTMLTextAreaElement;
    private sendButton: ButtonComponent;
    private _isProcessing = false;
    private app: App;
    private settings: Settings;

    constructor(contentEl: HTMLElement, app: App, settings: Settings) {
        super();
        this.contentEl = contentEl;
        this.app = app;
        this.settings = settings;
        this.createChatLayout();
    }

    private createChatLayout() {
        // Create main content area
        const mainContent = this.contentEl.createDiv({ cls: 'ai-helper-chat-main' });

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
            .setCta();
    }

    displayContextNotes(relevantNotes: NoteWithContent[]) {
        this.contextContainer.empty();

        if (relevantNotes.length === 0) {
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
        const sortedNotes = [...relevantNotes].sort((a, b) => b.relevance - a.relevance);

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

    addUserMessage(message: string) {
        const messageEl = this.messagesContainer.createDiv({ cls: 'ai-helper-chat-message ai-helper-chat-message-user' });
        messageEl.setText(message);
        this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });
    }

    addAssistantMessage(message: string): HTMLElement {
        const messageEl = this.messagesContainer.createDiv({ cls: 'ai-helper-chat-message ai-helper-chat-message-assistant' });
        const contentDiv = messageEl.createDiv();
        MarkdownRenderer.renderMarkdown(message, contentDiv, '', this);
        this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });
        this.inputField.focus();
        return messageEl;
    }

    setProcessingState(processing: boolean) {
        this._isProcessing = processing;
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

    resetChat() {
        this.messagesContainer.empty();
        this.contextContainer.empty();
        if (this.settings.chatSettings.displayWelcomeMessage) {
            this.addAssistantMessage("Hello! I'm your AI assistant. I can help you explore your notes. Ask me anything about your notes!");
        }
    }

    getInputValue(): string {
        return this.inputField.value.trim();
    }

    clearInput() {
        this.inputField.value = '';
    }

    setSendButtonClickHandler(handler: () => void) {
        this.sendButton.onClick(handler);
    }

    setInputKeydownHandler(handler: (e: KeyboardEvent) => void) {
        this.inputField.addEventListener('keydown', handler);
    }

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

    get isProcessingState(): boolean {
        return this._isProcessing;
    }
}