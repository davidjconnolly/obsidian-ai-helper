import { App, Modal, Notice, TFile, parseFrontMatterTags } from 'obsidian';
import { AIHelperSettings } from './settings';
import { debugLog } from './utils';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface NoteInfo {
  file: TFile;
  content: string;
  created: number;
  modified: number;
  path: string;
  tags: string[];
  tasks: string[];
}

export async function openChatModal(app: App, settings: AIHelperSettings) {
  const modal = new ChatModal(app, settings);
  modal.open();
}

class ChatModal extends Modal {
  settings: AIHelperSettings;
  messages: ChatMessage[] = [];
  allNotes: NoteInfo[] = [];
  messagesContainer: HTMLElement;
  inputField: HTMLTextAreaElement;
  sendButton: HTMLButtonElement;
  isProcessing: boolean = false;
  controller: AbortController;
  private MAX_QUERY_LENGTH = 500;

  constructor(app: App, settings: AIHelperSettings) {
    super(app);
    this.settings = settings;
    this.controller = new AbortController();

    // Add initial system message
    this.messages.push({
      role: 'system',
      content: 'You are a helpful assistant that answers questions about the user\'s notes. You can search through notes, find connections, summarize content, and extract information like tasks, dates, and people mentioned. Be concise, accurate, and helpful.'
    });
  }

  async onOpen() {
    this.titleEl.setText('AI Chat');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-helper-chat-modal');

    // Create messages container
    this.messagesContainer = contentEl.createEl('div', {
      cls: 'ai-helper-chat-messages'
    });

    // Input area
    const inputContainer = contentEl.createEl('div', {
      cls: 'ai-helper-chat-input-container'
    });

    this.inputField = inputContainer.createEl('textarea', {
      cls: 'ai-helper-chat-input',
      attr: {
        placeholder: 'Ask me anything about your notes...'
      }
    });

    this.inputField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    });

    this.sendButton = inputContainer.createEl('button', {
      text: 'Send',
      cls: 'mod-cta'
    });

    this.sendButton.addEventListener('click', () => {
      this.sendMessage();
    });

    // Initial loading of notes data
    new Notice('Loading notes data...');
    await this.loadNotesData();
    new Notice('Notes data loaded');

    // Add welcome message if enabled in settings
    if (this.settings.chatSettings.displayWelcomeMessageOnStartup) {
      this.addAssistantMessage("Hello! I'm your AI assistant. I can help you find information in your notes, answer questions about your content, and identify patterns. What would you like to know?");
    }
  }

  async loadNotesData() {
    this.allNotes = [];
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const cacheMeta = this.app.metadataCache.getFileCache(file);
        const tags = this.settings.chatSettings.includeTags ?
          (cacheMeta?.tags ? cacheMeta.tags.map(t => t.tag) : []) : [];

        // Add frontmatter tags if include tags is enabled
        if (this.settings.chatSettings.includeTags && cacheMeta?.frontmatter && cacheMeta.frontmatter.tags) {
          const frontmatterTags = parseFrontMatterTags(cacheMeta.frontmatter.tags);
          if (frontmatterTags) {
            frontmatterTags.forEach(tag => {
              if (!tags.includes(tag)) {
                tags.push(tag);
              }
            });
          }
        }

        // Extract tasks if enabled
        const tasks: string[] = [];
        if (this.settings.chatSettings.includeTaskItems) {
          const taskRegex = /- \[([ x])\] (.+)$/gm;
          let match;
          while ((match = taskRegex.exec(content)) !== null) {
            tasks.push(match[0]);
          }
        }

        this.allNotes.push({
          file,
          content,
          created: file.stat.ctime,
          modified: file.stat.mtime,
          path: file.path,
          tags,
          tasks
        });
      } catch (error) {
        console.error(`Error loading note ${file.path}`, error);
      }
    }
  }

  addUserMessage(content: string) {
    this.messages.push({ role: 'user', content });
    const messageEl = this.messagesContainer.createEl('div', {
      cls: 'ai-helper-chat-message ai-helper-chat-message-user'
    });
    messageEl.createEl('div', { text: content });
    this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });
  }

  addAssistantMessage(content: string) {
    this.messages.push({ role: 'assistant', content });
    const messageEl = this.messagesContainer.createEl('div', {
      cls: 'ai-helper-chat-message ai-helper-chat-message-assistant'
    });
    messageEl.createEl('div', { text: content });
    this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });
  }

  async sendMessage() {
    if (this.isProcessing) return;

    const userInput = this.inputField.value.trim();
    if (!userInput) return;

    this.addUserMessage(userInput);
    this.inputField.value = '';

    this.isProcessing = true;
    this.sendButton.disabled = true;
    this.inputField.disabled = true;

    // Create loading indicator
    const loadingEl = this.messagesContainer.createEl('div', {
      cls: 'ai-helper-chat-message ai-helper-chat-message-assistant ai-helper-chat-loading'
    });
    loadingEl.createEl('div', { text: 'Thinking...' });
    this.messagesContainer.scrollTo({ top: this.messagesContainer.scrollHeight, behavior: 'smooth' });

    try {
      const relevantContext = await this.getRelevantContext(userInput);
      const response = await this.sendToLLM(userInput, relevantContext);

      // Remove loading indicator
      loadingEl.remove();

      // Add assistant response
      this.addAssistantMessage(response);
    } catch (error) {
      console.error('Error processing message', error);
      loadingEl.remove();

      // Provide more helpful error message based on error type
      let errorMessage = 'Sorry, I encountered an error while processing your request. Please try again.';

      if (error instanceof Error) {
        if (error.message.includes('API key is missing')) {
          errorMessage = 'API key is missing. Please add an API key in the settings.';
        } else if (error.message.includes('HTTP error! Status: 400')) {
          // Add specific LM Studio error handling
          if (error.message.includes('Conversation roles must alternate')) {
            errorMessage = 'The LM Studio API requires specific role formatting. Using only system and user roles now. Please try again.';
          } else if (error.message.includes('jinja template')) {
            errorMessage = 'The LM Studio model has a template issue. This plugin now uses only system and user roles which should be compatible. Please try again, or try a different model in LM Studio.';
          } else if (error.message.includes('assistant')) {
            errorMessage = 'The LM Studio API appears to not support the assistant role. This has been fixed. Please try again.';
          } else {
            errorMessage = 'The AI service rejected the request. This may be due to an invalid model name or format issue. Please check your settings.';
          }
        } else if (error.message.includes('HTTP error! Status: 401') || error.message.includes('HTTP error! Status: 403')) {
          errorMessage = 'Authentication error. Please check your API key in the settings.';
        } else if (error.message.includes('HTTP error! Status: 404')) {
          errorMessage = 'API endpoint not found. Please check the API URL in your settings.';
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network error. Please make sure your local LLM server is running or you have internet connectivity for OpenAI.';
        }
      }

      this.addAssistantMessage(errorMessage);
    } finally {
      this.isProcessing = false;
      this.sendButton.disabled = false;
      this.inputField.disabled = false;
    }
  }

  async getRelevantContext(userQuery: string): Promise<string> {
    if (!userQuery || typeof userQuery !== 'string') {
      return "Invalid query format.";
    }

    // Limit query length to prevent running out of contex
    const sanitizedQuery = userQuery.slice(0, this.MAX_QUERY_LENGTH);

    // Extract entities from query using LLM
    const entityData = await this.extractEntitiesFromQuery(sanitizedQuery);
    debugLog(this.settings, "Extracted entities", entityData);

    // Score notes based on extracted entities
    const scoredNotes: { note: NoteInfo; score: number; mentions: {[key: string]: number} }[] = [];
    const currentTime = Date.now();

    for (const note of this.allNotes) {
      let score = 0;
      const content = note.content.toLowerCase();
      const fileName = note.file.basename.toLowerCase();
      const mentions: {[key: string]: number} = {};

      // Score based on people mentioned
      for (const person of entityData.people) {
        const sanitizedPerson = this.sanitizeRegexPattern(person.toLowerCase());
        if (!sanitizedPerson) continue;

        try {
          const personRegex = new RegExp(`\\b${sanitizedPerson}\\b`, 'gi');
          const matches = content.match(personRegex);
          if (matches && matches.length > 0) {
            score += matches.length * 3; // Higher weight for people
            mentions[person] = matches.length;
          }

          // Additional score for person in filename
          if (fileName.includes(sanitizedPerson)) {
            score += 3;
            if (!mentions[person]) mentions[person] = 0;
            mentions[person]++;
          }
        } catch (e) {
          console.error(`Invalid regex pattern for person: ${person}`, e);
        }
      }

      // Score based on companies mentioned
      for (const company of entityData.companies) {
        const sanitizedCompany = this.sanitizeRegexPattern(company.toLowerCase());
        if (!sanitizedCompany) continue;

        try {
          const companyRegex = new RegExp(`\\b${sanitizedCompany}\\b`, 'gi');
          const matches = content.match(companyRegex);
          if (matches && matches.length > 0) {
            score += matches.length * 2;
            mentions[company] = matches.length;
          }
        } catch (e) {
          console.error(`Invalid regex pattern for company: ${company}`, e);
        }
      }

      // Score based on topics
      for (const topic of entityData.topics) {
        const sanitizedTopic = this.sanitizeRegexPattern(topic.toLowerCase());
        if (!sanitizedTopic) continue;

        try {
          const topicRegex = new RegExp(`\\b${sanitizedTopic}\\b`, 'gi');
          const matches = content.match(topicRegex);
          if (matches && matches.length > 0) {
            score += matches.length;
            mentions[topic] = matches.length;
          }
        } catch (e) {
          console.error(`Invalid regex pattern for topic: ${topic}`, e);
        }
      }

      // Apply time range filtering if present
      if (entityData.timeRange.valid) {
        // Use created date instead of modified date for time-bound searches
        const noteCreationTime = note.created;
        const noteModifiedTime = note.modified;

        // Check if either creation date or modification date is within range
        // Use creation date as the primary filter for time range
        if (noteCreationTime >= entityData.timeRange.start && noteCreationTime <= entityData.timeRange.end) {
          score += 6; // Higher bonus for creation date within range
        } else if (noteModifiedTime >= entityData.timeRange.start && noteModifiedTime <= entityData.timeRange.end) {
          score += 2; // Smaller bonus for modification date within range
        } else {
          // Skip this note entirely - it's outside the time range
          continue; // Skip to the next note
        }
      }

      // Add recency bonus
      const oneWeekAgo = currentTime - 7 * 24 * 60 * 60 * 1000;
      if (note.modified > oneWeekAgo) {
        score += 1;
      }

      // Check tags if enabled
      if (this.settings.chatSettings.includeTags) {
        for (const key of [...entityData.people, ...entityData.companies, ...entityData.topics]) {
          const sanitizedKey = this.sanitizeRegexPattern(key.toLowerCase());
          if (!sanitizedKey) continue;

          const tagMatches = note.tags.filter(tag => tag.toLowerCase().includes(sanitizedKey));
          if (tagMatches.length > 0) {
            score += tagMatches.length * 1.5;
          }
        }
      }

      // Special handling for task queries
      if (entityData.isTaskQuery && note.tasks.length > 0) {
        score += 4;
      }

      if (score > 0) {
        scoredNotes.push({ note, score, mentions });
      }
    }

    debugLog(this.settings, "Query entities", entityData);

    // Sort by score descending
    scoredNotes.sort((a, b) => b.score - a.score);

    debugLog(this.settings, "Top search results",
      scoredNotes.slice(0, 5).map(item => ({
        file: item.note.path,
        score: item.score,
        mentions: item.mentions
      }))
    );

    // Take top results based on contextWindowSize setting
    const topNotes = scoredNotes.slice(0, this.settings.chatSettings.contextWindowSize);

    if (topNotes.length === 0) {
      return "No relevant notes found.";
    }

    let context = "Here are relevant notes from the user's vault:\n\n";

    for (const { note, mentions } of topNotes) {
      context += `FILE: ${note.path}\n`;
      context += `CREATED: ${new Date(note.created).toISOString()}\n`;
      context += `MODIFIED: ${new Date(note.modified).toISOString()}\n`;

      // Add mention counts for important search terms
      const mentionList = Object.entries(mentions)
        .filter(([term, count]) => count > 0)
        .map(([term, count]) => `${term}: ${count} mentions`);

      if (mentionList.length > 0) {
        context += `MENTIONS: ${mentionList.join(', ')}\n`;
      }

      if (this.settings.chatSettings.includeTags && note.tags.length > 0) {
        context += `TAGS: ${note.tags.join(', ')}\n`;
      }

      if (this.settings.chatSettings.includeTaskItems && note.tasks.length > 0) {
        context += "TASKS:\n" + note.tasks.map(task => `- ${task}`).join('\n') + "\n";
      }

      context += `CONTENT:\n${note.content}\n\n`;
    }

    return context;
  }

  private sanitizeRegexPattern(pattern: string): string | null {
    // Validate input: ensure it's a non-null string
    if (!pattern || typeof pattern !== 'string') return null;

    // Limit length to prevent performance issues with very long patterns
    if (pattern.length > 100) pattern = pattern.substring(0, 100);

    try {
      // Test if it's a valid regex pattern by trying to create a regex
      new RegExp(pattern);
      // Escape special regex characters
      return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } catch (e) {
      console.error(`Invalid regex pattern: ${pattern}`, e);
      return null;
    }
  }

  async extractEntitiesFromQuery(query: string): Promise<{
    people: string[];
    companies: string[];
    topics: string[];
    timeRange: {
      valid: boolean;
      start: number;
      end: number;
      description: string;
    };
    isTaskQuery: boolean;
  }> {
    try {
      if (!query || typeof query !== 'string') {
        throw new Error("Invalid query format");
      }

      const apiUrl = this.settings.apiChoice === 'openai' ? this.settings.openAI.url : this.settings.localLLM.url;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const isOpenAI = this.settings.apiChoice === 'openai';

      // Use API configuration
      if (isOpenAI && this.settings.openAI.apiKey) {
        headers['Authorization'] = `Bearer ${this.settings.openAI.apiKey}`;
      }

      // Get model name with fallback
      let modelName = isOpenAI ? this.settings.openAI.model : this.settings.localLLM.model;
      if (!modelName || modelName.trim() === '') {
        modelName = isOpenAI ? 'gpt-3.5-turbo' : 'mistral-7b-instruct';
      }

      // Create extraction prompt
      const now = new Date();
      const promptContent = `
You are an entity extraction assistant. Extract entities from the user's query to help search through notes.
Current date: ${now.toISOString().split('T')[0]}

Extract the following information from this query: "${query}"

1. People: Names of people mentioned
2. Companies/Organizations: Names of companies or organizations
3. Topics: Key topics or subjects that would be relevant for search
4. Time Range: Does the query specify a time range? If so, provide start and end dates
5. Task Query: Is the user looking for tasks, todos, or action items?

Return the information as a valid JSON object with this structure:
{
  "people": ["name1", "name2", ...],
  "companies": ["company1", "company2", ...],
  "topics": ["topic1", "topic2", ...],
  "timeRange": {
    "valid": true/false,
    "start": "YYYY-MM-DD",
    "end": "YYYY-MM-DD",
    "description": "human readable description"
  },
  "isTaskQuery": true/false
}

Only include items that are explicitly or strongly implied in the query.
`;

      // Format messages based on provider
      const messages = [
        { role: 'system', content: 'You are an entity extraction assistant that returns valid JSON only.' },
        { role: 'user', content: promptContent + "\n\nPlease only respond with valid JSON." }
      ];

      // Create request
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelName,
          messages: messages,
          temperature: 0.1, // Low temperature for more deterministic results
          max_tokens: 500
        }),
        signal: this.controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const responseData = await response.json();
      let extractedText = responseData.choices[0].message.content.trim();

      // Safely parse the JSON, handling cases where LLM outputs additional text
      let jsonData = {};
      try {
        // First try direct parsing
        jsonData = JSON.parse(extractedText);
      } catch (e) {
        // If that fails, try to extract JSON object using regex
        const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            jsonData = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            throw new Error("Failed to parse LLM response as JSON");
          }
        } else {
          throw new Error("No valid JSON found in LLM response");
        }
      }

      // Validate the parsed data structure
      if (!jsonData || typeof jsonData !== 'object') {
        throw new Error("Invalid JSON structure from LLM");
      }

      const entityData = jsonData as any;

      // Convert date strings to timestamps
      const result = {
        people: Array.isArray(entityData.people) ? entityData.people : [],
        companies: Array.isArray(entityData.companies) ? entityData.companies : [],
        topics: Array.isArray(entityData.topics) ? entityData.topics : [],
        timeRange: {
          valid: Boolean(entityData.timeRange?.valid),
          start: 0,
          end: 0,
          description: typeof entityData.timeRange?.description === 'string' ? entityData.timeRange.description : ""
        },
        isTaskQuery: Boolean(entityData.isTaskQuery)
      };

      // Process time range if valid
      if (result.timeRange.valid) {
        try {
          if (entityData.timeRange?.start && entityData.timeRange?.end) {
            const startDate = new Date(entityData.timeRange.start);
            const endDate = new Date(entityData.timeRange.end);

            // Validate dates are actual dates
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
              result.timeRange.start = startDate.getTime();
              result.timeRange.end = endDate.getTime();
            } else {
              result.timeRange.valid = false;
            }
          } else {
            result.timeRange.valid = false;
          }
        } catch (error) {
          console.error("Error parsing dates", error);
          result.timeRange.valid = false;
        }
      }

      return result;
    } catch (error) {
      console.error("Error extracting entities", error);
      // Return empty structure if extraction fails
      return {
        people: [],
        companies: [],
        topics: [],
        timeRange: { valid: false, start: 0, end: 0, description: "" },
        isTaskQuery: false
      };
    }
  }

  async sendToLLM(userQuery: string, context: string): Promise<string> {
    try {
      if (!userQuery || typeof userQuery !== 'string') {
        return "Invalid query format. Please try again with a valid question.";
      }

      const apiUrl = this.settings.apiChoice === 'openai' ? this.settings.openAI.url : this.settings.localLLM.url;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const isOpenAI = this.settings.apiChoice === 'openai';

      // Check if we have valid API configuration
      if (isOpenAI) {
        if (!this.settings.openAI.apiKey) {
          throw new Error("OpenAI API key is missing. Please add it in the settings.");
        }
        headers['Authorization'] = `Bearer ${this.settings.openAI.apiKey}`;
      }

      // Get the model name, with a fallback for empty model names
      let modelName = isOpenAI ? this.settings.openAI.model : this.settings.localLLM.model;

      // Set defaults if the model is empty
      if (!modelName || modelName.trim() === '') {
        modelName = isOpenAI ? 'gpt-3.5-turbo' : 'gemma-3-27b-it';
        console.warn(`No model specified for ${this.settings.apiChoice}, using default: ${modelName}`);
      }

      // Format messages differently based on provider
      let apiMessages;

      if (isOpenAI) {
        // OpenAI accepts system, user, and assistant roles
        const systemContextMessage = {
          role: 'system',
          content: `You are a helpful assistant that answers questions about the user's Obsidian notes. Use the following context to help answer their questions. Only reference information that is present in the context or chat history. If you don't know something or it's not in the context, admit that you don't know rather than making up information.\n\nCONTEXT:\n${context}`
        };

        apiMessages = [
          this.messages[0], // Initial system message
          systemContextMessage, // Context-specific system message
          ...this.messages.slice(1) // All user and assistant messages
        ];
      } else {
        // Local LLMs (LM Studio) only support system and user roles
        // Create a conversation that represents our history but only uses system and user roles

        // Start with system instructions
        apiMessages = [
          {
            role: 'system',
            content: `${this.messages[0].content}\n\nContext from notes:\n${context}`
          }
        ];

        // Convert the conversation history into a single user message
        let conversationText = "";

        // Process all messages except the initial system message
        for (let i = 1; i < this.messages.length; i++) {
          const msg = this.messages[i];
          if (msg.role === 'user') {
            conversationText += `User: ${msg.content}\n\n`;
          } else if (msg.role === 'assistant') {
            conversationText += `Assistant: ${msg.content}\n\n`;
          }
        }

        // Add the current query
        conversationText += `User: ${userQuery}\n\nAssistant: `;

        // Add as user message
        apiMessages.push({
          role: 'user',
          content: conversationText
        });
      }

      // Create request body
      const requestBody = {
        model: modelName,
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 1500,
      };

      debugLog(this.settings, "Sending request to API", {
        url: apiUrl,
        model: modelName,
        messageCount: apiMessages.length,
        isOpenAI: isOpenAI,
        messages: apiMessages
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: this.controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unable to read error response");
        console.error("API error response:", errorText);
        throw new Error(`HTTP error! Status: ${response.status}. Details: ${errorText}`);
      }

      const responseData = await response.json();

      if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
        console.error("Unexpected API response format:", responseData);
        throw new Error("Invalid response format from the LLM API");
      }

      return responseData.choices[0].message.content;
    } catch (error) {
      console.error('Error sending to LLM:', error);
      throw error;
    }
  }

  onClose() {
    this.controller.abort();
    const { contentEl } = this;
    contentEl.empty();
  }
}