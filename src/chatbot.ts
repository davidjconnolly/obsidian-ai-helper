import { App, Notice, Modal, Setting } from 'obsidian';
import { AIHelperSettings } from './settings';
import { create, insert, remove, search, save, load, Orama } from '@orama/orama';
import { format } from 'util';
import { MetadataExtractor, NoteMetadata } from './metadata';

const STRUCTURED_PROMPT_TEMPLATE = `
Interpret the following user query about a personal notes database and respond in JSON format.
IMPORTANT respond with ONLY JSON and absolutely no text before or after the valid JSON.
This response will be fed directly into a JSON parser.:

{
  "action": "identify_themes" | "summarize" | "list" | "general_question",
  "topic": string,
  "filters": {
    "year": number | null,
    "person": string | null,
    "tags": string[] | null,
    "role": string | null,
    "event": string | null,
    "additional_filters": { [key: string]: string | number | null } | null
  },
  "refinedQuery": string
}

User Query: "%s"
`;

const FINAL_PROMPT = `
Using the following notes content:

%s

Answer the user's question:

%s

Action: %s
Topic: %s
Filters: %s

Provide a concise and accurate answer based on the notes provided.
`;

interface NoteEmbedding {
  id: string;
  content: string;
  metadata: NoteMetadata;
  vector: number[];
  metadataVector: number[];
}

export class NotesChatbot {
  app: App;
  settings: AIHelperSettings;
  vectorDB: Orama<any>;
  localLLMEndpoint: string;
  isStreaming: boolean;
  controller: AbortController;

  constructor(app: App, settings: AIHelperSettings) {
    this.app = app;
    this.settings = settings;
    this.isStreaming = true;
    this.controller = new AbortController();
  }

  async initialize() {
    this.vectorDB = create({
      schema: {
        id: 'string',
        content: 'string',
        metadata: {
          title: 'string',
          path: 'string',
          tags: 'string[]',
          people: 'string[]',
          dates: 'string[]',
          type: 'string',
          frontmatter: 'string',
          links: 'string[]',
          tasks: {
            total: 'number',
            completed: 'number',
            open: 'number'
          },
          lastModified: 'number'
        },
        vector: 'vector[768]',
        metadataVector: 'vector[768]',
        lastModified: 'number',
      },
    });

    if (await this.app.vault.adapter.exists('.orama-note-vectors.json')) {
      const savedIndex = await this.app.vault.adapter.read('.orama-note-vectors.json');
      load(this.vectorDB, JSON.parse(savedIndex));
    } else {
      await this.embedAllNotes();
      await this.saveEmbeddings();
    }

    const allDocuments = await search(this.vectorDB, { term: '', properties: ['id'], limit: 10000 });
    console.log("All documents after embedding:", allDocuments);
  }

  async embedAllNotes() {
    console.log('Starting embedAllNotes process...');

    // Test embeddings endpoint before starting
    try {
      await this.getEmbedding('test');
    } catch (error) {
      new Notice('Failed to connect to embeddings server. Please check your local LLM server configuration.');
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    console.log(`Found ${files.length} markdown files to process`);

    const storedEmbeddings = new Map<string, boolean>(
      (await search(this.vectorDB, { term: '', properties: ['id'], limit: 10000 }))
        .hits.map((hit) => [hit.document.id.toString(), true])
    );

    let processed = 0;
    const totalFiles = files.length;
    let progressNotice = new Notice(`Embedding notes: ${processed}/${totalFiles}`, 0);

    for (const file of files) {
      try {
        const lastModified = file.stat.mtime;

        if (storedEmbeddings.has(file.path)) {
          await remove(this.vectorDB, file.path);
        }

        const content = await this.app.vault.cachedRead(file);

        // Skip empty files
        if (!content.trim()) {
          continue;
        }

        const metadata = await MetadataExtractor.extractMetadata(file, content);
        const metadataText = MetadataExtractor.createMetadataEmbedding(metadata);

        let contentVector: number[] | null = null;
        let metadataVector: number[] | null = null;

        try {
          contentVector = await this.getEmbedding(content);
        } catch (error) {
          console.error(`Failed to generate content vector for ${file.path}:`, error);
          continue;
        }

        try {
          metadataVector = await this.getEmbedding(metadataText);
        } catch (error) {
          console.error(`Failed to generate metadata vector for ${file.path}:`, error);
          continue;
        }

        if (!contentVector || !metadataVector) {
          console.error(`Missing vectors for ${file.path}`);
          continue;
        }

        await insert(this.vectorDB, {
          id: file.path,
          content,
          metadata,
          vector: contentVector,
          metadataVector,
          lastModified
        });

        processed++;
        progressNotice.setMessage(`Embedding notes: ${processed}/${totalFiles}`);

        storedEmbeddings.delete(file.path);
      } catch (error) {
        console.error(`Error processing file ${file.path}:`, error);
        new Notice(`Error processing ${file.path}: ${error.message}`);
      }
    }

    progressNotice.hide();
    await this.saveEmbeddings();
    new Notice('Embeddings are up to date!');
  }

  async saveEmbeddings() {
    const dbExport = save(this.vectorDB);
    console.log(`Saving embeddings:`, dbExport);
    const data = JSON.stringify(dbExport);
    await this.app.vault.adapter.write('.orama-note-vectors.json', data);
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(this.settings.localLLM.embeddingsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.settings.localLLM.embeddingModel,
          input: text
        }),
        signal: this.controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Embedding API error response:', errorText);
        throw new Error(`Embedding API error (${response.status}): ${response.statusText}. Please check your local LLM server configuration.`);
      }

      const jsonResponse = await response.json();

      // Extract the embedding from the response structure
      let embedding: number[];
      if (jsonResponse.data && Array.isArray(jsonResponse.data) && jsonResponse.data.length > 0) {
        embedding = jsonResponse.data[0].embedding;
      } else if (jsonResponse.embedding) {
        embedding = jsonResponse.embedding;
      } else {
        console.error('Invalid embedding response structure:', jsonResponse);
        throw new Error('Invalid embedding response structure. Please check your local LLM server configuration.');
      }

      if (!Array.isArray(embedding)) {
        console.error('Embedding is not an array:', embedding);
        throw new Error('Embedding response is not an array. Please check your local LLM server configuration.');
      }

      if (embedding.length !== 768) {
        console.error(`Unexpected embedding dimension: ${embedding.length}, expected 768`);
        throw new Error(`Unexpected embedding dimension: ${embedding.length}, expected 768`);
      }

      return embedding;
    } catch (error) {
      console.error('Error getting embedding:', error);
      new Notice(`Embedding Error: ${error.message}`);
      throw error;
    }
  }

  async getRelevantNotesContent(refinedQuery: string): Promise<string> {
    const queryEmbedding = await this.getEmbedding(refinedQuery);

    // Search using both content and metadata vectors
    const contentResults = await search(this.vectorDB, {
      vector: { value: queryEmbedding, property: 'vector' },
      similarity: 1,
      limit: 3,
    });

    const metadataResults = await search(this.vectorDB, {
      vector: { value: queryEmbedding, property: 'metadataVector' },
      similarity: 1,
      limit: 3,
    });

    // Combine and deduplicate results
    const combinedResults = new Map();
    [...contentResults.hits, ...metadataResults.hits].forEach(hit => {
      if (!combinedResults.has(hit.document.id)) {
        combinedResults.set(hit.document.id, hit.document);
      }
    });

    // Format the results with metadata context
    return Array.from(combinedResults.values())
      .map(doc => {
        const metadata = doc.metadata;
        return `
Note: ${metadata.title}
Type: ${metadata.type}
Tags: ${metadata.tags.join(', ')}
People: ${metadata.people.join(', ')}
Dates: ${metadata.dates.join(', ')}
Content:
${doc.content}
        `.trim();
      })
      .join('\n\n');
  }

  async getCompletion(prompt: string): Promise<string> {
    const response = await fetch(this.settings.localLLM.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.localLLM.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        stream: false
      }),
      signal: this.controller.signal
    });

    const jsonResponse = await response.json();
    return jsonResponse.choices[0].message.content.trim();
  }

  async streamCompletion(prompt: string): Promise<Response> {
    const response = await fetch(this.settings.localLLM.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.localLLM.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        stream: true
      }),
      signal: this.controller.signal
    });

    return response;
  }
}

export class ChatbotModal extends Modal {
  chatbot: NotesChatbot;

  constructor(app: App, chatbot: NotesChatbot) {
    super(app);
    this.chatbot = chatbot;
  }

  onOpen() {
    this.titleEl.setText('Chat with your Notes');
    const { contentEl } = this;
    contentEl.empty();

    const chatContainer = contentEl.createDiv({
      cls: 'chat-container',
      attr: {
        style: 'max-height:400px;overflow:auto;user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;'
      }
    });

    // Create a container for the input
    const inputContainer = contentEl.createDiv({
      attr: {
        style: 'width:100%;padding:8px;'
      }
    });

    const inputEl = inputContainer.createEl('input', {
      attr: {
        type: 'text',
        placeholder: 'Type your question here...',
        style: 'width:100%;margin:0;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);'
      }
    });

    inputEl.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' && inputEl.value.trim() !== '') {
        const question = inputEl.value.trim();
        inputEl.value = '';

        const userQuestion = chatContainer.createDiv({
          cls: 'user-message',
          attr: { style: 'user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;' }
        });
        userQuestion.setText(`You: ${question}`);
        chatContainer.createDiv({ cls: 'message-separator' });
        chatContainer.scrollTop = chatContainer.scrollHeight;

        const botResponse = chatContainer.createDiv({
          cls: 'bot-message',
          attr: { style: 'user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;' }
        });
        chatContainer.scrollTop = chatContainer.scrollHeight;

        try {
          const structuredPrompt = format(STRUCTURED_PROMPT_TEMPLATE, question);
          botResponse.setText('Formulating the search...');
          chatContainer.scrollTop = chatContainer.scrollHeight;
          const structuredResponse = await this.chatbot.getCompletion(structuredPrompt);
          const interpreted = JSON.parse(structuredResponse);

          botResponse.setText('Finding relevant notes...');
          chatContainer.scrollTop = chatContainer.scrollHeight;
          const refinedQuery = interpreted.refinedQuery;
          const relevantNoteContent = await this.chatbot.getRelevantNotesContent(refinedQuery);

          // Add context section showing which notes are being used
          botResponse.setText('Using the following notes as context:\n\n');
          const contextNotes = relevantNoteContent.split('\n\n').map(note => {
            const titleMatch = note.match(/Note: (.*)/);
            const typeMatch = note.match(/Type: (.*)/);
            const tagsMatch = note.match(/Tags: (.*)/);
            return `📝 ${titleMatch?.[1] || 'Untitled'} (${typeMatch?.[1] || 'Unknown type'})\n   Tags: ${tagsMatch?.[1] || 'No tags'}\n`;
          }).join('\n');
          botResponse.setText(botResponse.getText() + contextNotes + '\nThinking...');
          chatContainer.scrollTop = chatContainer.scrollHeight;

          const finalPrompt = format(FINAL_PROMPT,
            relevantNoteContent,
            question,
            interpreted.action,
            interpreted.topic,
            JSON.stringify(interpreted.filters)
          );

          const response = await this.chatbot.streamCompletion(finalPrompt);

          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error('Response body is null');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let streamInitialized = false;

          let streamedResponse = '';
          const contextSection = botResponse.getText();

          while (true) {
            const { done, value } = await reader.read();
            if (!streamInitialized) {
              streamedResponse = '\n\nChatbot: ';
              streamInitialized = true;
            }
            if (done) break;

            const chunk = decoder.decode(value, { stream: true }).trim();
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.trim() === 'data: [DONE]') {
                continue;
              }
              if (line.startsWith('data: ')) {
                try {
                  const json = JSON.parse(line.slice(6));
                  if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
                    streamedResponse += json.choices[0].delta.content;
                    botResponse.setText(contextSection + streamedResponse);
                    botResponse.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  }
                } catch (error) {
                  console.warn('Failed to parse streaming chunk:', line);
                }
              }
            }
          }
          chatContainer.createDiv({ cls: 'message-separator' });

        } catch (error) {
          botResponse.setText('Chatbot encountered an error.');
          new Notice('Error fetching response from chatbot.');
        }

        setTimeout(() => {
          chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 0);
      }
    });
  }

  onClose() {
    this.chatbot.controller.abort();
    this.contentEl.empty();
  }
}
