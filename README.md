# AI Helper

This is an AI Helper plugin for Obsidian that provides two main features:
1. **Text Summarization**: Summarize selected text in your notes
2. **AI Chatbot**: Have conversations with your notes, ask questions, and find information

## Installation Instructions

1. Install the Plugin in your `.obsidian/plugins` folder
2. Navigate to `Settings` -> `Community plugins` -> `AI Helper`
3. Make sure the Plugin is Enabled and click the settings icon ⚙️
4. Configure your AI provider settings (see Configuration section below)

## Configuration

### AI Provider Settings

The plugin supports two AI providers:

1. **OpenAI**
   - Requires an OpenAI API key
   - Configure the model (default: gpt-4.1-nano)
   - Set custom API URL if needed

2. **Local LLM**
   - Requires a local API endpoint (default: http://localhost:1234)
   - Configure the local model (default: gemma-3-12b-it)
   - Supports custom API URLs

### Chat Settings

The chatbot has several configurable settings:

- **Max Context Length**: Controls how much text can be included in the context (default: 10000 characters)
- **Max Tokens**: Maximum number of tokens to generate in responses (default: 1000)
- **Temperature**: Controls response randomness (0.0 to 1.0, default: 0.7)
- **Max Notes to Search**: Number of notes to search for context (default: 20)
- **Similarity Threshold**: Semantic search threshold (0.0 to 1.0, default: 0.5)
- **Title Match Boost**: Boosts relevance of notes with matching titles (default: 0.3)
- **Enable Streaming**: Stream responses in real-time (default: true)
- **Max Recency Boost**: Boosts relevance of recent notes (default: 0.3)
- **Recency Boost Window**: Time window for recency boost in days (default: 185)
- **Display Welcome Message**: Show welcome message when opening chat (default: true)

### Embedding Settings

- **Chunk Size**: Size of text chunks for embedding (default: 1000)
- **Chunk Overlap**: Overlap between chunks (default: 200)
- **Update Mode**: When to update embeddings ('onLoad', 'onUpdate', or 'none')

### Summarization Settings

The summarization feature has the following configurable settings:

- **AI Provider**: Choose between OpenAI or Local LLM
- **Model**: The model to use for summarization (default: gemma-3-12b-it for local, gpt-4.1-nano for OpenAI)
- **Max Tokens**: Maximum number of tokens to generate in the summary (default: 1000)
- **Temperature**: Controls summary randomness (0.0 to 1.0, default: 0.7)
- **Max Context Length**: Maximum number of characters to include in the context (default: 10000)
- **API URL**: Custom API endpoint for the chosen provider
- **API Key**: Required for OpenAI provider

## Summarization Usage

1. Right click and "Summarize Selected Text"

2. Make any edits to the text and select one of:
  * **Insert Inline**: Insert the summary inline below the selected text.
  * **Insert Summary**: Add a summary to a section at the top of the document
  * **Copy**: Copy the summary to your clipboard

## AI Chatbot Usage

The AI Chatbot allows you to have natural conversations with your notes, including:

1. **Searching through notes** - Find specific information or topics
2. **Temporal queries** - Ask about notes from specific time periods (past 3 months, last year, etc.)
3. **Contextual follow-ups** - Continue a conversation with follow-up questions
4. **Task extraction** - Find action items and tasks in your notes
5. **Topic analysis** - Discover themes and connections across your notes

### Starting a Chat

1. Click the chat icon in the ribbon menu
2. Or use the command palette to open "AI Chat"
3. The chat interface will open in the right sidebar

### Chat Interface Features

- **Reset Chat**: Clear the conversation history
- **Context Notes**: View which notes are being used for context
- **Streaming Responses**: See responses being generated in real-time
- **Keyboard Shortcuts**: Press Enter to send messages (Shift+Enter for new line)

### Example Queries

- "How many times have I chatted with Rick in the past 3 months?"
- "What were the main topics discussed in my meeting notes last week?"
- "Find notes where I mentioned an AI tool for insurance companies"
- "What action items do I have from meetings in the past month?"
- "Which companies did I talk to last year?"
- "Summarize my notes about project X from the last month"
- "Find all tasks I haven't completed yet"
- "What are the main themes in my journal entries from last week?"

### Tips for Best Results

1. Be specific in your queries to get more relevant results
2. Use temporal references (e.g., "last week", "past month") to narrow down results
3. The chatbot works best with well-structured notes and clear headings
4. For complex queries, break them down into simpler follow-up questions
5. Use the context notes display to understand which notes are being used
6. Adjust similarity threshold if you're getting too many or too few results
7. Consider enabling recency boost if you frequently query recent notes
