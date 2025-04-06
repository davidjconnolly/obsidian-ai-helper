import { App, Notice, Modal, request, TFile, normalizePath, setIcon, parseYaml, MarkdownView, requestUrl, RequestUrlParam, RequestUrlResponse, SuggestModal, ButtonComponent, MarkdownRenderer, addIcon, Notice as Notice2 } from 'obsidian';
import { getDeduplicatedFileContents, debugLog, extractFrontmatter } from './utils';
import { LocalLLMSettings, OpenAISettings, Settings } from './settings';
import { ItemView, WorkspaceLeaf } from 'obsidian';

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
    score?: number;
    selectionReasons?: { [key: string]: number | string };
}

type EntityType = 'note' | 'tag' | 'task' | 'heading';

interface Entity {
    type: EntityType;
    value: string;
    count?: number;
}

// Open AI Chat sidebar view
export function openAIChat(app: App): void {
    // Check if view already exists
    const existingLeaves = app.workspace.getLeavesOfType(AI_CHAT_VIEW_TYPE);

    if (existingLeaves.length) {
        // Focus existing leaf
        app.workspace.revealLeaf(existingLeaves[0]);
        return;
    }

    // Create a new leaf in the right sidebar
    const leaf = app.workspace.getRightLeaf(false);
    if (leaf) {
        // Create the view in the new leaf
        leaf.setViewState({
            type: AI_CHAT_VIEW_TYPE,
        });

        // Reveal the leaf
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
    textInput: string = '';
    controller: AbortController;
    relevantNotes: NoteWithContent[] = [];
    app: App;
    systemMessage: string = '';

    constructor(leaf: WorkspaceLeaf, settings: Settings) {
        super(leaf);
        this.app = this.leaf.view.app;
        this.settings = settings;
        this.controller = new AbortController();

        // Setup initial system message
        this.systemMessage = `You are an AI assistant that helps users understand and explore their notes.
You have access to their notes and can provide information based on their content.
Be concise, helpful, and accurate in your responses.
If you don't know something, say so rather than making up an answer.`;
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

    async initializeView() {
        // Load relevant notes data
        await this.updateRelevantNotes();

        // Add welcome message
        this.addAssistantMessage("Hello! I'm your AI assistant. How can I help you with your notes today?");
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-helper-chat-view');

        // Create chat view layout
        this.createChatLayout(contentEl as HTMLElement);

        // Initialize the view
        await this.initializeView();
    }

    onClose() {
        this.controller.abort();
        return super.onClose();
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
        const sendButton = new ButtonComponent(buttonContainer)
            .setButtonText('Send')
            .setCta()
            .onClick(() => this.sendMessage());
    }

    displayContextNotes() {
        this.contextContainer.empty();

        if (this.relevantNotes.length === 0) {
            const emptyState = this.contextContainer.createDiv({ cls: 'ai-helper-context-empty' });
            emptyState.setText('No relevant notes found');
            return;
        }

        for (const note of this.relevantNotes) {
            const noteElement = this.contextContainer.createDiv({ cls: 'ai-helper-context-note' });

            // Add note title
            const titleEl = noteElement.createDiv({ cls: 'ai-helper-context-note-title' });
            titleEl.setText(note.file.basename);

            // Add note path
            const pathEl = noteElement.createDiv({ cls: 'ai-helper-context-note-path' });
            pathEl.setText(note.file.path);

            // Add relevance score
            if (note.score !== undefined) {
                const scoreEl = noteElement.createDiv({ cls: 'ai-helper-context-note-score' });
                scoreEl.setText(`Relevance Score: ${note.score}`);
            }

            // Add selection reasons
            if (note.selectionReasons && Object.keys(note.selectionReasons).length > 0) {
                const reasonsContainer = noteElement.createDiv({ cls: 'ai-helper-context-note-reasons' });
                reasonsContainer.createDiv({
                    cls: 'ai-helper-context-note-reasons-header',
                    text: 'Selection Factors:'
                });

                const reasonsList = reasonsContainer.createEl('ul', { cls: 'ai-helper-context-note-reasons-list' });

                for (const [key, value] of Object.entries(note.selectionReasons)) {
                    const listItem = reasonsList.createEl('li');

                    if (typeof value === 'number') {
                        listItem.setText(`${key}: ${value}`);
                    } else {
                        listItem.setText(`${key}: ${value}`);
                    }
                }
            }

            // Make the note clickable to open it
            noteElement.addEventListener('click', (event) => {
                // Don't trigger if clicking on the reasons section
                if ((event.target as HTMLElement).closest('.ai-helper-context-note-reasons')) {
                    return;
                }

                this.app.workspace.getLeaf().openFile(note.file);
            });
        }
    }

    async updateRelevantNotes(query: string = '') {
        try {
            if (query) {
                // Get context based on the query
                this.relevantNotes = await this.getRelevantContext(query);
            } else {
                // Get context based on active note
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    const activeFile = activeView.file;
                    if (activeFile) {
                        const fileContent = await this.app.vault.cachedRead(activeFile);
                        this.relevantNotes = [{
                            file: activeFile,
                            content: fileContent,
                            score: 100,
                            selectionReasons: { 'Current Active Note': 'This is the file you are currently viewing' }
                        }];
                    }
                }
            }

            // Update the context display
            this.displayContextNotes();
        } catch (error) {
            console.error('Error updating relevant notes:', error);
        }
    }

    // The rest of your methods remain mostly the same
    // Just update any references to DOM elements and adjust for the sidebar view

    addUserMessage(message: string) {
        // Create message element
        const messageEl = this.messagesContainer.createDiv({ cls: 'ai-helper-chat-message ai-helper-chat-message-user' });
        messageEl.setText(message);

        // Add to messages array
        this.messages.push({ role: 'user', content: message });

        // Scroll to bottom
        this.messagesContainer.scrollTo({
            top: this.messagesContainer.scrollHeight,
            behavior: 'smooth'
        });
    }

    addAssistantMessage(message: string) {
        // Create message element
        const messageEl = this.messagesContainer.createDiv({ cls: 'ai-helper-chat-message ai-helper-chat-message-assistant' });

        // Add loading class initially
        messageEl.addClass('ai-helper-chat-loading');

        // Create placeholder text
        messageEl.setText('...');

        // Render markdown content
        const contentDiv = messageEl.createDiv();
        MarkdownRenderer.renderMarkdown(message, contentDiv, '', this);

        // Fix paragraph spacing
        contentDiv.querySelectorAll('p').forEach(p => {
            p.style.margin = '0';
            p.style.padding = '0';
        });

        // Remove loading class and placeholder
        messageEl.setText('');
        messageEl.removeClass('ai-helper-chat-loading');
        messageEl.appendChild(contentDiv);

        // Add to messages array
        this.messages.push({ role: 'assistant', content: message });

        // Scroll to bottom
        this.messagesContainer.scrollTo({
            top: this.messagesContainer.scrollHeight,
            behavior: 'smooth'
        });

        // Focus the input field again
        this.inputField.focus();
    }

    async sendMessage() {
        const message = this.inputField.value.trim();
        if (!message) return;

        // Clear input
        this.inputField.value = '';

        // Add user message to chat
        this.addUserMessage(message);

        // Get context based on the query
        await this.updateRelevantNotes(message);

        try {
            // Initialize messages array with system message if not already done
            if (this.messages.length === 0 || this.messages[0].role !== 'system') {
                this.messages.unshift({ role: 'system', content: this.systemMessage });
            }

            // Send message to LLM
            const response = await this.sendToLLM(message);

            // Add assistant response to chat
            this.addAssistantMessage(response.content);

        } catch (error) {
            console.error('Error sending message:', error);
            this.addAssistantMessage('I apologize, but I was unable to process your request. Please try again later.');
        }
    }

    async getRelevantContext(query: string): Promise<NoteWithContent[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        // Log for debugging
        console.log('Getting relevant context for query:', query);

        // Get data for entities in the query
        const entities = await this.extractEntitiesFromQuery(query);
        const files = this.app.vault.getMarkdownFiles();
        const result: NoteWithContent[] = [];

        // Log for debugging
        console.log('Extracted entities:', entities);

        // Get vault statistics - this can be used to enhance entity identification
        const vaultStats = await this.getVaultStatistics();

        // Score each file based on entity matches
        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            let score = 0;
            const selectionReasons: { [key: string]: number | string } = {};

            // Check file name similarity
            const fileNameScore = this.calculateFileNameScore(file.basename, query);
            if (fileNameScore > 0) {
                score += fileNameScore * 5; // Name matches are important
                selectionReasons['Filename Match'] = fileNameScore;
            }

            // Check for content matches based on entities and terms
            if (entities.length > 0) {
                for (const entity of entities) {
                    // Handle different entity types
                    if (entity.type === 'note' && content.toLowerCase().includes(entity.value.toLowerCase())) {
                        const count = this.countOccurrences(content.toLowerCase(), entity.value.toLowerCase());
                        const termScore = Math.min(count * 3, 15); // Cap term score at 15
                        score += termScore;
                        selectionReasons[entity.value] = count;
                    }
                    else if (entity.type === 'tag' && content.includes(`#${entity.value}`)) {
                        score += 10; // Tags are explicit indicators of relevance
                        selectionReasons[`#${entity.value}`] = 'Tag Match';
                    }
                    else if (entity.type === 'heading' && content.includes(`# ${entity.value}`)) {
                        score += 8; // Headings indicate structure and topics
                        selectionReasons[`Heading: ${entity.value}`] = 'Heading Match';
                    }
                }
            }

            // Generic term matching for query terms that might not be identified as entities
            const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 3);
            for (const term of queryTerms) {
                if (content.toLowerCase().includes(term)) {
                    const count = this.countOccurrences(content.toLowerCase(), term);
                    const termScore = Math.min(count, 5);
                    score += termScore;

                    // Only add as a reason if it's significant
                    if (count > 1) {
                        selectionReasons[term] = count;
                    }
                }
            }

            // Check recency (if available)
            const frontmatter = extractFrontmatter(content);
            if (frontmatter && frontmatter.created) {
                try {
                    const created = new Date(frontmatter.created);
                    const now = new Date();
                    const daysSinceCreation = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

                    // Boost newer notes
                    if (daysSinceCreation < 30) {
                        const recencyScore = Math.max(5 - Math.floor(daysSinceCreation / 7), 0);
                        score += recencyScore;
                        if (recencyScore > 0) {
                            selectionReasons['Recent Note'] = `Created ${daysSinceCreation} days ago`;
                        }
                    }
                } catch (e) {
                    // Ignore date parsing errors
                }
            }

            // Add file to results if it has a score
            if (score > 0) {
                result.push({
                    file,
                    content,
                    score,
                    selectionReasons
                });
            }
        }

        // Sort by score descending
        result.sort((a, b) => (b.score || 0) - (a.score || 0));

        // Return top results
        return result.slice(0, 5);
    }

    calculateFileNameScore(fileName: string, query: string): number {
        const lowerFileName = fileName.toLowerCase();
        const lowerQuery = query.toLowerCase();

        // Exact match
        if (lowerFileName === lowerQuery) {
            return 20;
        }

        // Contains full query
        if (lowerFileName.includes(lowerQuery)) {
            return 15;
        }

        // Check for individual terms
        const queryTerms = lowerQuery.split(/\s+/).filter(term => term.length > 2);
        let matchedTerms = 0;

        for (const term of queryTerms) {
            if (lowerFileName.includes(term)) {
                matchedTerms++;
            }
        }

        if (matchedTerms > 0 && queryTerms.length > 0) {
            return (matchedTerms / queryTerms.length) * 10;
        }

        return 0;
    }

    countOccurrences(text: string, term: string): number {
        let count = 0;
        let position = text.indexOf(term);

        while (position !== -1) {
            count++;
            position = text.indexOf(term, position + 1);
        }

        return count;
    }

    async getVaultStatistics() {
        const files = this.app.vault.getMarkdownFiles();
        const stats = {
            totalFiles: files.length,
            commonTags: new Map<string, number>(),
            commonTerms: new Map<string, number>()
        };

        // This could be expanded to collect more detailed statistics
        // For now, we'll keep it simple

        return stats;
    }

    async extractEntitiesFromQuery(query: string): Promise<Entity[]> {
        const entities: Entity[] = [];

        // Basic entity extraction based on pattern matching
        // In a more sophisticated version, this could use NLP or the LLM itself

        // Extract potential note references (quoted strings or explicit mentions)
        const noteMatches = query.match(/"([^"]+)"/g) || [];
        for (const match of noteMatches) {
            const value = match.replace(/"/g, '');
            entities.push({ type: 'note', value });
        }

        // Extract tag references (hashtags)
        const tagMatches = query.match(/#(\w+)/g) || [];
        for (const match of tagMatches) {
            const value = match.substring(1); // Remove the # symbol
            entities.push({ type: 'tag', value });
        }

        // Extract task references
        if (query.toLowerCase().includes('task') || query.toLowerCase().includes('todo')) {
            entities.push({ type: 'task', value: 'task' });
        }

        // If no entities found, extract key terms
        if (entities.length === 0) {
            const terms = query.toLowerCase()
                .split(/\s+/)
                .filter(term => term.length > 3 && !['what', 'when', 'where', 'which', 'find', 'tell', 'about', 'with', 'that', 'have', 'this'].includes(term));

            for (const term of terms) {
                entities.push({ type: 'note', value: term });
            }
        }

        return entities;
    }

    sanitizeRegexPattern(pattern: string): string {
        // Limit pattern length to avoid potential excessive backtracking or resource issues
        pattern = pattern.slice(0, 100);

        // Escape regex special characters to prevent invalid regex or ReDoS
        const specialChars = /[.*+?^${}()|[\]\\]/g;
        return pattern.replace(specialChars, '\\$&');
    }

    async sendToLLM(query: string): Promise<ChatMessage> {
        // Determine which API endpoint to use
        let apiEndpoint = 'https://api.openai.com/v1/chat/completions';
        let apiKey = '';
        let modelName = 'gpt-3.5-turbo';

        // Check if local LLM is enabled
        const isLocalLLMEnabled = this.settings.localLLMSettings?.enabled && this.settings.localLLMSettings?.apiUrl;

        if (isLocalLLMEnabled) {
            // Use Local LLM settings
            apiEndpoint = this.settings.localLLMSettings.apiUrl;
            apiKey = this.settings.localLLMSettings.apiKey || '';
            modelName = this.settings.localLLMSettings.modelName || 'mistral-7b-instruct';
        } else {
            // Use OpenAI settings
            apiEndpoint = this.settings.openAISettings?.apiUrl || 'https://api.openai.com/v1/chat/completions';
            apiKey = this.settings.openAISettings?.apiKey || '';
            modelName = this.settings.openAISettings?.modelName || 'gpt-3.5-turbo';

            // Only check for OpenAI API key if OpenAI is being used
            if (!apiKey) {
                throw new Error('OpenAI API key is missing. Please configure it in the settings.');
            }
        }

        // Prepare context from notes
        let contextText = "";
        if (this.relevantNotes.length > 0) {
            contextText = "Here are some relevant notes that might help with the query:\n\n";

            for (const note of this.relevantNotes) {
                contextText += `File: ${note.file.basename}\n`;
                contextText += `Content: ${note.content.substring(0, 2000)}\n\n`;
            }
        }

        // Create a system message with context
        const contextMessage = {
            role: 'user' as const,
            content: `Here is context from the user's notes:\n${contextText}`
        };

        // Prepare API request
        const apiMessages = [
            { role: 'system' as const, content: this.systemMessage },
            contextMessage,
            ...this.messages.filter(msg => msg.role !== 'system')
        ];

        // Prepare request parameters
        const requestParams: RequestUrlParam = {
            url: apiEndpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: apiMessages,
                temperature: 0.7,
                max_tokens: 2000
            })
        };

        try {
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