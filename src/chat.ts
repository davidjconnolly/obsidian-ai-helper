import {
  App,
  TFile,
  ButtonComponent,
  MarkdownRenderer,
  ItemView,
  WorkspaceLeaf,
} from "obsidian";
import { Settings } from "./settings";
import { logDebug, logError } from "./utils";
import { VectorStore } from "./chat/vectorStore";
import { EmbeddingStore } from "./chat/embeddingStore";
import { ContextManager } from "./chat/contextManager";
import { LLMConnector } from "./chat/llmConnector";
import {
  globalInitializationPromise,
  isGloballyInitialized,
  globalVectorStore,
  globalEmbeddingStore,
} from "./chat/embeddingStore";
import { processQuery } from "./nlp";

// Define the view type for the AI Chat
export const AI_CHAT_VIEW_TYPE = "ai-helper-chat-view";

// Define welcome message
const WELCOME_MESSAGE =
  "Hello! I'm your AI helper.  Ask me anything about your notes!";

// Interface for a chat message
export interface ChatMessage {
  role: "system" | "user" | "assistant";
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

  private contextHeader: HTMLElement;
  private embeddingStore: EmbeddingStore;
  private vectorStore: VectorStore;
  private contextManager: ContextManager;
  private llmConnector: LLMConnector;
  private isProcessing = false;
  private initializationPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

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
        const startTime = Date.now();
        const timeoutMs = 5000; // 5 seconds timeout

        // Wait for initialization to complete if it's in progress or hasn't started
        while (!isGloballyInitialized) {
          if (Date.now() - startTime > timeoutMs) {
            throw new Error("Initialization timed out after 5 seconds");
          }

          if (globalInitializationPromise) {
            logDebug(
              settings,
              "Waiting for existing initialization to complete",
            );
            await globalInitializationPromise;
          } else {
            logDebug(settings, "Waiting for initialization to start");
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Set up the instances
        if (globalVectorStore && globalEmbeddingStore) {
          logDebug(
            settings,
            "Setting up chat view with initialized embedding system",
          );
          this.vectorStore = globalVectorStore;
          this.embeddingStore = globalEmbeddingStore;
          this.contextManager = new ContextManager(
            this.vectorStore,
            this.settings,
          );
        } else {
          throw new Error("Embedding system not properly initialized");
        }
      } catch (error) {
        logError("Error during initialization", error);
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
    contentEl.addClass("ai-helper-chat-view");

    // Create chat view layout
    this.createChatLayout(contentEl);

    // Initialize empty context notes display
    this.displayContextNotes();

    // Add welcome message if enabled in settings
    if (this.settings.chatSettings.displayWelcomeMessage) {
      this.addAssistantMessage(WELCOME_MESSAGE);
    }
  }

  createChatLayout(container: HTMLElement) {
    // Create main content area
    const mainContent = container.createDiv({ cls: "ai-helper-chat-main" });

    // Create context section for relevant notes
    const contextSection = mainContent.createDiv({
      cls: "ai-helper-context-section",
    });
    this.contextHeader = contextSection.createDiv({
      cls: "ai-helper-context-header",
    });
    this.contextHeader.setText("Relevant notes");
    this.contextContainer = contextSection.createDiv({
      cls: "ai-helper-context-notes",
    });

    // Create messages container
    this.messagesContainer = mainContent.createDiv({
      cls: "ai-helper-chat-messages",
    });

    // Create input area
    this.inputContainer = mainContent.createDiv({
      cls: "ai-helper-chat-input-container",
    });
    this.inputField = this.inputContainer.createEl("textarea", {
      cls: "ai-helper-chat-input",
      attr: { placeholder: "Ask about your notes..." },
    });

    // Add event listeners
    this.inputField.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !this.isProcessing) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Create button container for both Reset and Send buttons
    const buttonContainer = this.inputContainer.createDiv({
      cls: "ai-helper-button-container",
    });

    // Add reset button to the left
    const resetButton = new ButtonComponent(buttonContainer)
      .setButtonText("Reset Chat")
      .onClick(() => this.resetChat());
    resetButton.buttonEl.classList.add("ai-helper-reset-button");

    // Add spacer to push send button to the right
    buttonContainer.createDiv({ cls: "ai-helper-button-spacer" });

    // Add send button to the right
    this.sendButton = new ButtonComponent(buttonContainer)
      .setButtonText("Send")
      .setCta()
      .onClick(() => this.sendMessage());
  }

  displayContextNotes() {
    this.contextContainer.empty();

    // Update header with note count
    if (this.relevantNotes.length === 0) {
      this.contextHeader.setText("Relevant notes");

      const emptyState = this.contextContainer.createDiv({
        cls: "ai-helper-context-empty",
      });

      // Add search icon
      const iconContainer = emptyState.createDiv({
        cls: "ai-helper-context-empty-icon",
      });
      iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

      // Add message
      const messageContainer = emptyState.createDiv({
        cls: "ai-helper-context-empty-message",
      });
      messageContainer.setText("Ask a question to search your notes");

      // Add suggestion
      const suggestionContainer = emptyState.createDiv({
        cls: "ai-helper-context-empty-suggestion",
      });
      suggestionContainer.setText(
        "Relevant notes will appear here as context for our conversation",
      );

      return;
    }

    // Update header with note count
    this.contextHeader.setText(`Relevant notes (${this.relevantNotes.length})`);

    // Sort notes by relevance
    const sortedNotes = [...this.relevantNotes].sort(
      (a, b) => b.relevance - a.relevance,
    );

    for (const note of sortedNotes) {
      const noteElement = this.contextContainer.createDiv({
        cls: "ai-helper-context-note",
      });

      // Add note title
      const titleEl = noteElement.createDiv({
        cls: "ai-helper-context-note-title",
      });
      titleEl.setText(note.file.basename);

      // Add metadata section (path and last updated)
      const metadataEl = noteElement.createDiv({
        cls: "ai-helper-context-note-metadata",
      });

      // Add note path
      const pathEl = metadataEl.createDiv({
        cls: "ai-helper-context-note-path",
      });
      pathEl.setText(note.file.path);

      // Add similarity score
      const similarityEl = metadataEl.createDiv({
        cls: "ai-helper-context-note-similarity",
      });
      similarityEl.setText(`Relevance: ${(note.relevance * 100).toFixed(1)}%`);

      // Add last updated time
      const lastUpdatedEl = metadataEl.createDiv({
        cls: "ai-helper-context-note-updated",
      });
      const lastUpdated = note.file.stat?.mtime
        ? new Date(note.file.stat.mtime)
        : new Date();
      const timeAgo = this.getTimeAgoString(lastUpdated);
      lastUpdatedEl.setText(`Last updated: ${timeAgo}`);

      // Add note content preview
      const contentEl = noteElement.createDiv({
        cls: "ai-helper-context-note-content",
      });
      contentEl.setText(
        note.content.substring(0, 200) +
          (note.content.length > 200 ? "..." : ""),
      );

      // Make the note clickable to open it
      noteElement.addEventListener("click", () => {
        this.app.workspace.getLeaf().openFile(note.file);
      });
    }
  }

  // Helper function to format time ago
  private getTimeAgoString(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return "just now";
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
    const messageEl = this.messagesContainer.createDiv({
      cls: "ai-helper-chat-message ai-helper-chat-message-user",
    });
    messageEl.setText(message);
    this.messages.push({ role: "user", content: message });
    this.messagesContainer.scrollTo({
      top: this.messagesContainer.scrollHeight,
      behavior: "smooth",
    });
  }

  addAssistantMessage(message: string) {
    const messageEl = this.messagesContainer.createDiv({
      cls: "ai-helper-chat-message ai-helper-chat-message-assistant",
    });
    const contentDiv = messageEl.createDiv();
    MarkdownRenderer.renderMarkdown(message, contentDiv, "", this);
    this.messages.push({ role: "assistant", content: message });
    this.messagesContainer.scrollTo({
      top: this.messagesContainer.scrollHeight,
      behavior: "smooth",
    });
    this.inputField.focus();
  }

  // Add a method to create an empty assistant message element for streaming updates
  createStreamingAssistantMessage(): {
    messageEl: HTMLElement;
    contentDiv: HTMLElement;
    updateContent: (content: string) => void;
  } {
    const messageEl = this.messagesContainer.createDiv({
      cls: "ai-helper-chat-message ai-helper-chat-message-assistant",
    });
    const contentDiv = messageEl.createDiv();

    // Add loading indicator
    const loadingIndicator = contentDiv.createDiv({
      cls: "ai-helper-streaming-loading",
    });
    loadingIndicator.innerHTML =
      '<span class="ai-helper-streaming-dot"></span><span class="ai-helper-streaming-dot"></span><span class="ai-helper-streaming-dot"></span>';

    // Track if content has been received
    let hasReceivedContent = false;

    // Create a function to update the content
    const updateContent = (content: string) => {
      try {
        // If this is the first update, clear the loading indicator
        if (!hasReceivedContent) {
          contentDiv.empty();
          hasReceivedContent = true;
        }

        // Create fresh div for rendering
        contentDiv.empty();

        try {
          // Try to render as markdown
          MarkdownRenderer.renderMarkdown(content, contentDiv, "", this);
        } catch (e) {
          console.error("Failed to render markdown:", e);
          // Use text as fallback
          contentDiv.setText(content);
        }

        // Auto-scroll to the latest content
        this.messagesContainer.scrollTo({
          top: this.messagesContainer.scrollHeight,
          behavior: "smooth",
        });
      } catch (e) {
        console.error("Error updating streaming content:", e);
        // Ultimate fallback
        contentDiv.setText(content);
      }
    };

    return { messageEl, contentDiv, updateContent };
  }

  private setProcessingState(processing: boolean) {
    this.isProcessing = processing;
    this.inputField.disabled = processing;
    if (processing) {
      this.sendButton.setButtonText("Processing...");
      this.sendButton.setDisabled(true);
      this.inputField.placeholder =
        "Please wait while I process your message...";
    } else {
      this.sendButton.setButtonText("Send");
      this.sendButton.setDisabled(false);
      this.inputField.placeholder = "Ask about your notes...";
    }
  }

  async sendMessage() {
    const message = this.inputField.value.trim();
    if (!message || this.isProcessing) return;

    // Create abort controller
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Set processing state
    this.setProcessingState(true);

    try {
      // Clear input and add user message
      this.inputField.value = "";
      this.addUserMessage(message);

      // Wait for initialization
      if (this.initializationPromise) {
        await this.initializationPromise;
        this.initializationPromise = null;
      }

      // Check requirements
      if (!this.vectorStore || !this.embeddingStore || !this.contextManager) {
        throw new Error("Embedding system not properly initialized");
      }

      // Find relevant notes
      this.relevantNotes = await this.findRelevantNotes(message);
      this.displayContextNotes();

      // If no relevant notes were found, provide standard response
      if (this.relevantNotes.length === 0) {
        // Create UI element for displaying the response
        const { messageEl, updateContent } =
          this.createStreamingAssistantMessage();

        const noNotesResponse =
          "I apologize, but I couldn't find any relevant notes in your vault that would help me answer your question. Could you please provide more context or rephrase your question?";
        updateContent(noNotesResponse);
        this.messages.push({ role: "assistant", content: noNotesResponse });
        return;
      }

      // Prepare messages
      const modelMessages = await this.prepareModelMessages(message);

      // Store final content
      let finalContent = "";

      if (this.settings.chatSettings.enableStreaming) {
        // Create UI element and get the update function
        const { updateContent } = this.createStreamingAssistantMessage();

        try {
          // Stream response and update UI with each chunk
          const response = await this.llmConnector.streamResponse(
            modelMessages,
            (content) => {
              // Update UI with the latest content
              updateContent(content);
              // Save latest content
              finalContent = content;
            },
            signal,
          );

          // Add to message history
          this.messages.push({
            role: "assistant",
            content: finalContent || response.content,
          });
        } catch (error) {
          console.error("Error during streaming:", error);
          if (error.name !== "AbortError") {
            // If we already have content, keep it
            if (finalContent) {
              this.messages.push({
                role: "assistant",
                content: finalContent,
              });
            } else {
              // Show error message
              this.addAssistantMessage(
                "I apologize, but there was an error processing your request.",
              );
            }
          }
        }
      } else {
        // Non-streaming approach
        // Create a temporary "thinking" message
        const { messageEl, updateContent } =
          this.createStreamingAssistantMessage();

        try {
          // Generate response (this will take some time)
          const response = await this.llmConnector.generateResponse(
            modelMessages,
            signal,
          );

          // Update the temporary message with the actual response
          updateContent(response.content);

          // Add to message history
          this.messages.push({
            role: "assistant",
            content: response.content,
          });
        } catch (error) {
          console.error("Message processing error:", error);
          if (error.name !== "AbortError") {
            // Update the temporary message with an error message
            updateContent(
              "I apologize, but I was unable to process your request.",
            );

            // Add to message history
            this.messages.push({
              role: "assistant",
              content: "I apologize, but I was unable to process your request.",
            });
          } else {
            // If aborted, remove the temporary message
            messageEl.remove();
          }
        }
      }
    } catch (error) {
      // Handle errors
      console.error("Message processing error:", error);
      if (error.name !== "AbortError") {
        this.addAssistantMessage(
          "I apologize, but I was unable to process your request.",
        );
      }
    } finally {
      // Reset state
      this.setProcessingState(false);
      this.abortController = null;
    }
  }

  async findRelevantNotes(query: string): Promise<NoteWithContent[]> {
    try {
      logDebug(this.settings, `Starting search for query: ${query}`);

      // Process the query using our NLP utilities
      const processedQuery = processQuery(query, this.settings);
      logDebug(
        this.settings,
        `Processed query: ${JSON.stringify(processedQuery)}`,
      );

      // Generate embedding for the processed query
      const queryEmbedding = await this.embeddingStore.generateEmbedding(
        processedQuery.processed,
      );
      logDebug(this.settings, "Generated query embedding");

      // Get the active file if any
      const activeFile = this.app.workspace.getActiveFile();
      const file = activeFile ? activeFile : undefined;

      // Find semantically similar content using expanded tokens
      const results = await this.vectorStore.search(queryEmbedding, {
        similarity: this.settings.chatSettings.similarity,
        limit: this.settings.chatSettings.maxNotesToSearch,
        searchTerms: processedQuery.expandedTokens,
        file, // Pass the active file for recency context
        phrases: processedQuery.phrases, // Pass preserved phrases for exact matching
        query: query, // Pass the original query for additional processing
      });

      logDebug(
        this.settings,
        `Vector search results: ${JSON.stringify(
          results.map((r) => ({
            path: r.path,
            score: r.score,
            recencyScore: r.recencyScore,
            titleScore: r.titleScore,
          })),
        )}`,
      );

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

          logDebug(
            this.settings,
            `Found relevant note: ${JSON.stringify({
              path: file.path,
              score: result.score,
              recencyScore: result.recencyScore,
              titleScore: result.titleScore,
              lastModified,
              chunkIndex: result.chunkIndex,
              contentLength: content.length,
            })}`,
          );

          relevantNotes.push({
            file,
            content,
            relevance: result.score,
            chunkIndex: result.chunkIndex,
          });
        } catch (error) {
          console.error(`Error reading file ${file.path}:`, error);
        }
      }

      logDebug(
        this.settings,
        `Final relevant notes count: ${relevantNotes.length}`,
      );
      return relevantNotes;
    } catch (error) {
      console.error("Error finding relevant notes:", error);
      return [];
    }
  }

  async prepareModelMessages(userQuery: string): Promise<ChatMessage[]> {
    // Use the ContextManager to prepare model messages
    return this.contextManager.prepareModelMessages(
      userQuery,
      this.relevantNotes,
      this.messages,
      WELCOME_MESSAGE,
    );
  }

  // Add a method to reset the chat
  async resetChat() {
    // If there's an in-progress query, cancel it using AbortController
    if (this.isProcessing && this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clear messages and message history
    this.messages = [];
    this.messagesContainer.empty();

    // Clear relevant notes
    this.relevantNotes = [];
    this.displayContextNotes();

    // Reset input field
    this.inputField.value = "";
    this.inputField.disabled = false;
    this.inputField.placeholder = "Ask about your notes...";

    // Reset send button
    this.sendButton.setButtonText("Send");
    this.sendButton.setDisabled(false);

    // Reset processing state
    this.setProcessingState(false);

    // Add welcome message if enabled in settings
    if (this.settings.chatSettings.displayWelcomeMessage) {
      this.addAssistantMessage(WELCOME_MESSAGE);
    }
  }
}
