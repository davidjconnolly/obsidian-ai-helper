# AI Helper

This is an AI Helper plugin for Obsidian that provides two main features:
1. **Text Summarization**: Summarize selected text in your notes
2. **AI Chatbot**: Have conversations with your notes, ask questions, and find information

## Installation Instructions

1. Install the Plugin in your `.obsidian/plugins` folder
2. Navigate to `Settings` -> `Community plugins` -> `AI Helper`
3. Make sure the Plugin is Enabled and click the settings icon ⚙️
4. Select to use either your Local LLM or the Open AI API and fill in the corresponding settings

![settings](img/settings.png)

## Summarization Usage

1. Right click and "Summarize Selected Text"

![right click menu](img/rightclick.png)

2. Make any edits to the text and select one of:
  * **Insert Inline**: Insert the summary inline below the selected text.
  * **Insert Summary**: Add a summary to a section at the top of the document
  * **Copy**: Copy the summary to your clipboard

![modal](img/modal.png)

## AI Chatbot Usage

The AI Chatbot allows you to have natural conversations with your notes, including:

1. **Searching through notes** - Find specific information or topics
2. **Temporal queries** - Ask about notes from specific time periods (past 3 months, last year, etc.)
3. **Contextual follow-ups** - Continue a conversation with follow-up questions
4. **Task extraction** - Find action items and tasks in your notes
5. **Topic analysis** - Discover themes and connections across your notes

### Starting a Chat

Click the chat icon in the ribbon menu or use the command palette to open "AI Chat".

### Example Queries

- "How many times have I chatted with Rick in the past 3 months?"
- "What were the main topics discussed in my meeting notes last week?"
- "Find notes where I mentioned an AI tool for insurance companies"
- "What action items do I have from meetings in the past month?"
- "Which companies did I talk to last year?"

### Settings

The chatbot has several configurable settings:

- **Max Notes to Search**: Control how many notes are searched when looking for relevant context
- **Context Window Size**: Number of most relevant notes to include when answering your questions
- **Display Welcome Message**: Show a welcome message when opening the chat
- **Include Tags**: Use note tags to provide additional context
- **Include Task Items**: Specifically identify and search for task items in notes
