import { __awaiter } from "tslib";
import { Notice, Modal } from 'obsidian';
import { LLMService, QueryParser, VectorStore } from './services';
export class NotesChatbot {
    constructor(app, settings) {
        this.app = app;
        this.settings = settings;
        this.llmService = new LLMService(settings);
        this.vectorStore = new VectorStore(app, this.llmService);
        this.queryParser = new QueryParser(this.llmService);
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.vectorStore.initialize();
        });
    }
    processQuestion(question) {
        return __awaiter(this, void 0, void 0, function* () {
            // Parse the question to extract filters
            const filters = yield this.queryParser.parseQuery(question);
            // Get relevant notes using filters
            const relevantNotes = yield this.vectorStore.searchNotes(question, filters);
            // Format notes for the prompt
            const notesContext = this.formatNotesForContext(relevantNotes);
            // Create final prompt and get streaming response
            const finalPrompt = `
Using these notes as context:

${notesContext}

Answer this question: "${question}"

Important:
1. Base your answer only on the provided notes
2. If the notes don't contain relevant information, say so
3. Be concise but thorough
4. If dates are mentioned in the question, only reference notes from that time period
5. If specific people are mentioned, only reference their interactions
`;
            const response = yield this.llmService.streamCompletion(finalPrompt);
            return { relevantNotes, response };
        });
    }
    formatNotesForContext(notes) {
        return notes.map(note => `
Note: ${note.metadata.title}
Path: ${note.id}
Type: ${note.metadata.type}
Tags: ${note.metadata.tags.join(', ')}
People: ${note.metadata.people.join(', ')}
Dates: ${note.metadata.dates.join(', ')}
Content:
${note.content}
    `.trim()).join('\n\n');
    }
    abort() {
        this.llmService.abort();
    }
}
export class ChatbotModal extends Modal {
    constructor(app, chatbot) {
        super(app);
        this.chatbot = chatbot;
    }
    onOpen() {
        // Set up modal title and size
        this.titleEl.setText('Chat with your Notes');
        this.modalEl.style.width = '750px';
        this.modalEl.style.maxWidth = '750px';
        this.modalEl.style.height = '500px';
        this.modalEl.style.minHeight = '300px';
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.height = '100%';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.overflow = 'hidden';
        // Create split view container
        const container = contentEl.createDiv({
            attr: {
                style: 'display:flex;gap:16px;flex:1;width:100%;overflow:hidden;padding:0 0 8px 0;'
            }
        });
        // Chat panel (left side)
        const chatPanel = container.createDiv({
            attr: {
                style: 'flex:2;display:flex;flex-direction:column;min-height:0;overflow:hidden;'
            }
        });
        // Context panel (right side)
        const contextPanel = container.createDiv({
            attr: {
                style: 'flex:1;border-left:1px solid var(--background-modifier-border);padding-left:16px;display:flex;flex-direction:column;min-height:0;overflow:hidden;min-width:250px;'
            }
        });
        // Panel headers
        chatPanel.createEl('h3', {
            text: 'Messages',
            attr: { style: 'margin:0 0 8px 0;flex-shrink:0;' }
        });
        contextPanel.createEl('h3', {
            text: 'Notes in Context',
            attr: { style: 'margin:0 0 8px 0;flex-shrink:0;' }
        });
        // Chat messages container
        const chatContainer = chatPanel.createDiv({
            cls: 'chat-container',
            attr: {
                style: 'flex:1;overflow:auto;user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;min-height:0;'
            }
        });
        // Context notes container
        this.contextNotesEl = contextPanel.createDiv({
            attr: {
                style: 'flex:1;overflow:auto;min-height:0;padding:8px;background:var(--background-secondary);border-radius:4px;'
            }
        });
        // Input container
        const inputContainer = chatPanel.createDiv({
            attr: {
                style: 'width:100%;padding:8px;flex-shrink:0;'
            }
        });
        const inputEl = inputContainer.createEl('input', {
            attr: {
                type: 'text',
                placeholder: 'Type your question here...',
                style: 'width:100%;margin:0;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);'
            }
        });
        // Handle input
        inputEl.addEventListener('keydown', (event) => __awaiter(this, void 0, void 0, function* () {
            if (event.key === 'Enter' && inputEl.value.trim()) {
                const question = inputEl.value.trim();
                inputEl.value = '';
                // Create user message
                const userQuestion = chatContainer.createDiv({
                    cls: 'user-message',
                    attr: {
                        style: 'user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;padding:4px 0;'
                    }
                });
                userQuestion.setText(`You: ${question}`);
                // Create bot response container
                const botResponse = chatContainer.createDiv({
                    cls: 'bot-message',
                    attr: {
                        style: 'user-select:text;-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;white-space:pre-wrap;padding:4px 0;margin-bottom:8px;'
                    }
                });
                try {
                    // Show thinking state
                    botResponse.setText('Finding relevant notes...');
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    // Process question
                    const { relevantNotes, response } = yield this.chatbot.processQuestion(question);
                    // Update context panel
                    this.updateContextPanel(relevantNotes);
                    // Stream response
                    yield this.streamResponse(response, botResponse);
                }
                catch (error) {
                    botResponse.setText('Error: Failed to process question');
                    new Notice('Error processing question');
                    console.error(error);
                }
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }));
    }
    updateContextPanel(notes) {
        this.contextNotesEl.empty();
        notes.forEach(note => {
            const noteEl = this.contextNotesEl.createDiv({
                cls: 'context-note',
                attr: {
                    style: 'margin-bottom:16px;padding:8px;border-radius:4px;background:var(--background-modifier-hover);white-space:pre-wrap;'
                }
            });
            noteEl.createEl('div', {
                text: `📝 ${note.metadata.title}`,
                attr: { style: 'font-weight:bold;margin-bottom:4px;' }
            });
            noteEl.createEl('div', {
                text: `Type: ${note.metadata.type || 'Unknown'}`,
                attr: { style: 'font-size:0.9em;' }
            });
            if (note.metadata.tags.length) {
                noteEl.createEl('div', {
                    text: `Tags: ${note.metadata.tags.join(', ')}`,
                    attr: { style: 'font-size:0.9em;' }
                });
            }
            if (note.metadata.people.length) {
                noteEl.createEl('div', {
                    text: `People: ${note.metadata.people.join(', ')}`,
                    attr: { style: 'font-size:0.9em;' }
                });
            }
            if (note.metadata.dates.length) {
                noteEl.createEl('div', {
                    text: `Dates: ${note.metadata.dates.join(', ')}`,
                    attr: { style: 'font-size:0.9em;' }
                });
            }
        });
    }
    streamResponse(response, botResponse) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            if (!response.body) {
                throw new Error('Response body is null');
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let streamedText = 'Chatbot: ';
            while (true) {
                const { done, value } = yield reader.read();
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.slice(6));
                            if ((_c = (_b = (_a = json.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.delta) === null || _c === void 0 ? void 0 : _c.content) {
                                streamedText += json.choices[0].delta.content;
                                botResponse.setText(streamedText);
                                botResponse.scrollIntoView({ behavior: 'smooth', block: 'end' });
                            }
                        }
                        catch (error) {
                            console.warn('Failed to parse streaming chunk:', line);
                        }
                    }
                }
            }
        });
    }
    onClose() {
        this.chatbot.abort();
        this.contentEl.empty();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2hhdGJvdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNoYXRib3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLE9BQU8sRUFBTyxNQUFNLEVBQUUsS0FBSyxFQUFTLE1BQU0sVUFBVSxDQUFDO0FBRXJELE9BQU8sRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFBb0IsTUFBTSxZQUFZLENBQUM7QUFFcEYsTUFBTSxPQUFPLFlBQVk7SUFLdkIsWUFBb0IsR0FBUSxFQUFVLFFBQTBCO1FBQTVDLFFBQUcsR0FBSCxHQUFHLENBQUs7UUFBVSxhQUFRLEdBQVIsUUFBUSxDQUFrQjtRQUM5RCxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzNDLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxXQUFXLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUN6RCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksV0FBVyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUN0RCxDQUFDO0lBRUssVUFBVTs7WUFDZCxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDdEMsQ0FBQztLQUFBO0lBRUssZUFBZSxDQUFDLFFBQWdCOztZQUlwQyx3Q0FBd0M7WUFDeEMsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUU1RCxtQ0FBbUM7WUFDbkMsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFNUUsOEJBQThCO1lBQzlCLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUUvRCxpREFBaUQ7WUFDakQsTUFBTSxXQUFXLEdBQUc7OztF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LElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLEVBQUU7d0JBQzdCLElBQUk7NEJBQ0YsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7NEJBQ3ZDLElBQUksTUFBQSxNQUFBLE1BQUEsSUFBSSxDQUFDLE9BQU8sMENBQUcsQ0FBQyxDQUFDLDBDQUFFLEtBQUssMENBQUUsT0FBTyxFQUFFO2dDQUNyQyxZQUFZLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDO2dDQUM5QyxXQUFXLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO2dDQUNsQyxXQUFXLENBQUMsY0FBYyxDQUFDLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQzs2QkFDbEU7eUJBQ0Y7d0JBQUMsT0FBTyxLQUFLLEVBQUU7NEJBQ2QsT0FBTyxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsRUFBRSxJQUFJLENBQUMsQ0FBQzt5QkFDeEQ7cUJBQ0Y7aUJBQ0Y7YUFDRjs7S0FDRjtJQUVELE9BQU87UUFDTCxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDekIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBOb3RpY2UsIE1vZGFsLCBURmlsZSB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7IEFJSGVscGVyU2V0dGluZ3MgfSBmcm9tICcuL3NldHRpbmdzJztcbmltcG9ydCB7IExMTVNlcnZpY2UsIFF1ZXJ5UGFyc2VyLCBWZWN0b3JTdG9yZSwgTm90ZVNlYXJjaFJlc3VsdCB9IGZyb20gJy4vc2VydmljZXMnO1xuXG5leHBvcnQgY2xhc3MgTm90ZXNDaGF0Ym90IHtcbiAgcHJpdmF0ZSB2ZWN0b3JTdG9yZTogVmVjdG9yU3RvcmU7XG4gIHByaXZhdGUgbGxtU2VydmljZTogTExNU2VydmljZTtcbiAgcHJpdmF0ZSBxdWVyeVBhcnNlcjogUXVlcnlQYXJzZXI7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSBhcHA6IEFwcCwgcHJpdmF0ZSBzZXR0aW5nczogQUlIZWxwZXJTZXR0aW5ncykge1xuICAgIHRoaXMubGxtU2VydmljZSA9IG5ldyBMTE1TZXJ2aWNlKHNldHRpbmdzKTtcbiAgICB0aGlzLnZlY3RvclN0b3JlID0gbmV3IFZlY3RvclN0b3JlKGFwcCwgdGhpcy5sbG1TZXJ2aWNlKTtcbiAgICB0aGlzLnF1ZXJ5UGFyc2VyID0gbmV3IFF1ZXJ5UGFyc2VyKHRoaXMubGxtU2VydmljZSk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIGF3YWl0IHRoaXMudmVjdG9yU3RvcmUuaW5pdGlhbGl6ZSgpO1xuICB9XG5cbiAgYXN5bmMgcHJvY2Vzc1F1ZXN0aW9uKHF1ZXN0aW9uOiBzdHJpbmcpOiBQcm9taXNlPHtcbiAgICByZWxldmFudE5vdGVzOiBOb3RlU2VhcmNoUmVzdWx0W107XG4gICAgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB9PiB7XG4gICAgLy8gUGFyc2UgdGhlIHF1ZXN0aW9uIHRvIGV4dHJhY3QgZmlsdGVyc1xuICAgIGNvbnN0IGZpbHRlcnMgPSBhd2FpdCB0aGlzLnF1ZXJ5UGFyc2VyLnBhcnNlUXVlcnkocXVlc3Rpb24pO1xuXG4gICAgLy8gR2V0IHJlbGV2YW50IG5vdGVzIHVzaW5nIGZpbHRlcnNcbiAgICBjb25zdCByZWxldmFudE5vdGVzID0gYXdhaXQgdGhpcy52ZWN0b3JTdG9yZS5zZWFyY2hOb3RlcyhxdWVzdGlvbiwgZmlsdGVycyk7XG5cbiAgICAvLyBGb3JtYXQgbm90ZXMgZm9yIHRoZSBwcm9tcHRcbiAgICBjb25zdCBub3Rlc0NvbnRleHQgPSB0aGlzLmZvcm1hdE5vdGVzRm9yQ29udGV4dChyZWxldmFudE5vdGVzKTtcblxuICAgIC8vIENyZWF0ZSBmaW5hbCBwcm9tcHQgYW5kIGdldCBzdHJlYW1pbmcgcmVzcG9uc2VcbiAgICBjb25zdCBmaW5hbFByb21wdCA9IGBcblVzaW5nIHRoZXNlIG5vdGVzIGFzIGNvbnRleHQ6XG5cbiR7bm90ZXNDb250ZXh0fVxuXG5BbnN3ZXIgdGhpcyBxdWVzdGlvbjogXCIke3F1ZXN0aW9ufVwiXG5cbkltcG9ydGFudDpcbjEuIEJhc2UgeW91ciBhbnN3ZXIgb25seSBvbiB0aGUgcHJvdmlkZWQgbm90ZXNcbjIuIElmIHRoZSBub3RlcyBkb24ndCBjb250YWluIHJlbGV2YW50IGluZm9ybWF0aW9uLCBzYXkgc29cbjMuIEJlIGNvbmNpc2UgYnV0IHRob3JvdWdoXG40LiBJZiBkYXRlcyBhcmUgbWVudGlvbmVkIGluIHRoZSBxdWVzdGlvbiwgb25seSByZWZlcmVuY2Ugbm90ZXMgZnJvbSB0aGF0IHRpbWUgcGVyaW9kXG41LiBJZiBzcGVjaWZpYyBwZW9wbGUgYXJlIG1lbnRpb25lZCwgb25seSByZWZlcmVuY2UgdGhlaXIgaW50ZXJhY3Rpb25zXG5gO1xuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmxsbVNlcnZpY2Uuc3RyZWFtQ29tcGxldGlvbihmaW5hbFByb21wdCk7XG4gICAgcmV0dXJuIHsgcmVsZXZhbnROb3RlcywgcmVzcG9uc2UgfTtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0Tm90ZXNGb3JDb250ZXh0KG5vdGVzOiBOb3RlU2VhcmNoUmVzdWx0W10pOiBzdHJpbmcge1xuICAgIHJldHVybiBub3Rlcy5tYXAobm90ZSA9PiBgXG5Ob3RlOiAke25vdGUubWV0YWRhdGEudGl0bGV9XG5QYXRoOiAke25vdGUuaWR9XG5UeXBlOiAke25vdGUubWV0YWRhdGEudHlwZX1cblRhZ3M6ICR7bm90ZS5tZXRhZGF0YS50YWdzLmpvaW4oJywgJyl9XG5QZW9wbGU6ICR7bm90ZS5tZXRhZGF0YS5wZW9wbGUuam9pbignLCAnKX1cbkRhdGVzOiAke25vdGUubWV0YWRhdGEuZGF0ZXMuam9pbignLCAnKX1cbkNvbnRlbnQ6XG4ke25vdGUuY29udGVudH1cbiAgICBgLnRyaW0oKSkuam9pbignXFxuXFxuJyk7XG4gIH1cblxuICBhYm9ydCgpIHtcbiAgICB0aGlzLmxsbVNlcnZpY2UuYWJvcnQoKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgQ2hhdGJvdE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIGNoYXRib3Q6IE5vdGVzQ2hhdGJvdDtcbiAgcHJpdmF0ZSBjb250ZXh0Tm90ZXNFbDogSFRNTEVsZW1lbnQ7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIGNoYXRib3Q6IE5vdGVzQ2hhdGJvdCkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5jaGF0Ym90ID0gY2hhdGJvdDtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICAvLyBTZXQgdXAgbW9kYWwgdGl0bGUgYW5kIHNpemVcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dCgnQ2hhdCB3aXRoIHlvdXIgTm90ZXMnKTtcbiAgICB0aGlzLm1vZGFsRWwuc3R5bGUud2lkdGggPSAnNzUwcHgnO1xuICAgIHRoaXMubW9kYWxFbC5zdHlsZS5tYXhXaWR0aCA9ICc3NTBweCc7XG4gICAgdGhpcy5tb2RhbEVsLnN0eWxlLmhlaWdodCA9ICc1MDBweCc7XG4gICAgdGhpcy5tb2RhbEVsLnN0eWxlLm1pbkhlaWdodCA9ICczMDBweCc7XG5cbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcbiAgICBjb250ZW50RWwuc3R5bGUuaGVpZ2h0ID0gJzEwMCUnO1xuICAgIGNvbnRlbnRFbC5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnO1xuICAgIGNvbnRlbnRFbC5zdHlsZS5mbGV4RGlyZWN0aW9uID0gJ2NvbHVtbic7XG4gICAgY29udGVudEVsLnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG5cbiAgICAvLyBDcmVhdGUgc3BsaXQgdmlldyBjb250YWluZXJcbiAgICBjb25zdCBjb250YWluZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHtcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgc3R5bGU6ICdkaXNwbGF5OmZsZXg7Z2FwOjE2cHg7ZmxleDoxO3dpZHRoOjEwMCU7b3ZlcmZsb3c6aGlkZGVuO3BhZGRpbmc6MCAwIDhweCAwOydcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENoYXQgcGFuZWwgKGxlZnQgc2lkZSlcbiAgICBjb25zdCBjaGF0UGFuZWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgc3R5bGU6ICdmbGV4OjI7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjttaW4taGVpZ2h0OjA7b3ZlcmZsb3c6aGlkZGVuOydcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvbnRleHQgcGFuZWwgKHJpZ2h0IHNpZGUpXG4gICAgY29uc3QgY29udGV4dFBhbmVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBhdHRyOiB7XG4gICAgICAgIHN0eWxlOiAnZmxleDoxO2JvcmRlci1sZWZ0OjFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7cGFkZGluZy1sZWZ0OjE2cHg7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjttaW4taGVpZ2h0OjA7b3ZlcmZsb3c6aGlkZGVuO21pbi13aWR0aDoyNTBweDsnXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBQYW5lbCBoZWFkZXJzXG4gICAgY2hhdFBhbmVsLmNyZWF0ZUVsKCdoMycsIHtcbiAgICAgIHRleHQ6ICdNZXNzYWdlcycsXG4gICAgICBhdHRyOiB7IHN0eWxlOiAnbWFyZ2luOjAgMCA4cHggMDtmbGV4LXNocmluazowOycgfVxuICAgIH0pO1xuXG4gICAgY29udGV4dFBhbmVsLmNyZWF0ZUVsKCdoMycsIHtcbiAgICAgIHRleHQ6ICdOb3RlcyBpbiBDb250ZXh0JyxcbiAgICAgIGF0dHI6IHsgc3R5bGU6ICdtYXJnaW46MCAwIDhweCAwO2ZsZXgtc2hyaW5rOjA7JyB9XG4gICAgfSk7XG5cbiAgICAvLyBDaGF0IG1lc3NhZ2VzIGNvbnRhaW5lclxuICAgIGNvbnN0IGNoYXRDb250YWluZXIgPSBjaGF0UGFuZWwuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogJ2NoYXQtY29udGFpbmVyJyxcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgc3R5bGU6ICdmbGV4OjE7b3ZlcmZsb3c6YXV0bzt1c2VyLXNlbGVjdDp0ZXh0Oy13ZWJraXQtdXNlci1zZWxlY3Q6dGV4dDstbW96LXVzZXItc2VsZWN0OnRleHQ7LW1zLXVzZXItc2VsZWN0OnRleHQ7bWluLWhlaWdodDowOydcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIENvbnRleHQgbm90ZXMgY29udGFpbmVyXG4gICAgdGhpcy5jb250ZXh0Tm90ZXNFbCA9IGNvbnRleHRQYW5lbC5jcmVhdGVEaXYoe1xuICAgICAgYXR0cjoge1xuICAgICAgICBzdHlsZTogJ2ZsZXg6MTtvdmVyZmxvdzphdXRvO21pbi1oZWlnaHQ6MDtwYWRkaW5nOjhweDtiYWNrZ3JvdW5kOnZhcigtLWJhY2tncm91bmQtc2Vjb25kYXJ5KTtib3JkZXItcmFkaXVzOjRweDsnXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBJbnB1dCBjb250YWluZXJcbiAgICBjb25zdCBpbnB1dENvbnRhaW5lciA9IGNoYXRQYW5lbC5jcmVhdGVEaXYoe1xuICAgICAgYXR0cjoge1xuICAgICAgICBzdHlsZTogJ3dpZHRoOjEwMCU7cGFkZGluZzo4cHg7ZmxleC1zaHJpbms6MDsnXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBpbnB1dEVsID0gaW5wdXRDb250YWluZXIuY3JlYXRlRWwoJ2lucHV0Jywge1xuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiAndGV4dCcsXG4gICAgICAgIHBsYWNlaG9sZGVyOiAnVHlwZSB5b3VyIHF1ZXN0aW9uIGhlcmUuLi4nLFxuICAgICAgICBzdHlsZTogJ3dpZHRoOjEwMCU7bWFyZ2luOjA7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo0cHg7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1iYWNrZ3JvdW5kLW1vZGlmaWVyLWJvcmRlcik7J1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGlucHV0XG4gICAgaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgYXN5bmMgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSAnRW50ZXInICYmIGlucHV0RWwudmFsdWUudHJpbSgpKSB7XG4gICAgICAgIGNvbnN0IHF1ZXN0aW9uID0gaW5wdXRFbC52YWx1ZS50cmltKCk7XG4gICAgICAgIGlucHV0RWwudmFsdWUgPSAnJztcblxuICAgICAgICAvLyBDcmVhdGUgdXNlciBtZXNzYWdlXG4gICAgICAgIGNvbnN0IHVzZXJRdWVzdGlvbiA9IGNoYXRDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgICAgICBjbHM6ICd1c2VyLW1lc3NhZ2UnLFxuICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgIHN0eWxlOiAndXNlci1zZWxlY3Q6dGV4dDstd2Via2l0LXVzZXItc2VsZWN0OnRleHQ7LW1vei11c2VyLXNlbGVjdDp0ZXh0Oy1tcy11c2VyLXNlbGVjdDp0ZXh0O3BhZGRpbmc6NHB4IDA7J1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHVzZXJRdWVzdGlvbi5zZXRUZXh0KGBZb3U6ICR7cXVlc3Rpb259YCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGJvdCByZXNwb25zZSBjb250YWluZXJcbiAgICAgICAgY29uc3QgYm90UmVzcG9uc2UgPSBjaGF0Q29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICAgICAgY2xzOiAnYm90LW1lc3NhZ2UnLFxuICAgICAgICAgIGF0dHI6IHtcbiAgICAgICAgICAgIHN0eWxlOiAndXNlci1zZWxlY3Q6dGV4dDstd2Via2l0LXVzZXItc2VsZWN0OnRleHQ7LW1vei11c2VyLXNlbGVjdDp0ZXh0Oy1tcy11c2VyLXNlbGVjdDp0ZXh0O3doaXRlLXNwYWNlOnByZS13cmFwO3BhZGRpbmc6NHB4IDA7bWFyZ2luLWJvdHRvbTo4cHg7J1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBTaG93IHRoaW5raW5nIHN0YXRlXG4gICAgICAgICAgYm90UmVzcG9uc2Uuc2V0VGV4dCgnRmluZGluZyByZWxldmFudCBub3Rlcy4uLicpO1xuICAgICAgICAgIGNoYXRDb250YWluZXIuc2Nyb2xsVG9wID0gY2hhdENvbnRhaW5lci5zY3JvbGxIZWlnaHQ7XG5cbiAgICAgICAgICAvLyBQcm9jZXNzIHF1ZXN0aW9uXG4gICAgICAgICAgY29uc3QgeyByZWxldmFudE5vdGVzLCByZXNwb25zZSB9ID0gYXdhaXQgdGhpcy5jaGF0Ym90LnByb2Nlc3NRdWVzdGlvbihxdWVzdGlvbik7XG5cbiAgICAgICAgICAvLyBVcGRhdGUgY29udGV4dCBwYW5lbFxuICAgICAgICAgIHRoaXMudXBkYXRlQ29udGV4dFBhbmVsKHJlbGV2YW50Tm90ZXMpO1xuXG4gICAgICAgICAgLy8gU3RyZWFtIHJlc3BvbnNlXG4gICAgICAgICAgYXdhaXQgdGhpcy5zdHJlYW1SZXNwb25zZShyZXNwb25zZSwgYm90UmVzcG9uc2UpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGJvdFJlc3BvbnNlLnNldFRleHQoJ0Vycm9yOiBGYWlsZWQgdG8gcHJvY2VzcyBxdWVzdGlvbicpO1xuICAgICAgICAgIG5ldyBOb3RpY2UoJ0Vycm9yIHByb2Nlc3NpbmcgcXVlc3Rpb24nKTtcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNoYXRDb250YWluZXIuc2Nyb2xsVG9wID0gY2hhdENvbnRhaW5lci5zY3JvbGxIZWlnaHQ7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUNvbnRleHRQYW5lbChub3RlczogTm90ZVNlYXJjaFJlc3VsdFtdKSB7XG4gICAgdGhpcy5jb250ZXh0Tm90ZXNFbC5lbXB0eSgpO1xuICAgIG5vdGVzLmZvckVhY2gobm90ZSA9PiB7XG4gICAgICBjb25zdCBub3RlRWwgPSB0aGlzLmNvbnRleHROb3Rlc0VsLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogJ2NvbnRleHQtbm90ZScsXG4gICAgICAgIGF0dHI6IHtcbiAgICAgICAgICBzdHlsZTogJ21hcmdpbi1ib3R0b206MTZweDtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItaG92ZXIpO3doaXRlLXNwYWNlOnByZS13cmFwOydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIG5vdGVFbC5jcmVhdGVFbCgnZGl2Jywge1xuICAgICAgICB0ZXh0OiBg8J+TnSAke25vdGUubWV0YWRhdGEudGl0bGV9YCxcbiAgICAgICAgYXR0cjogeyBzdHlsZTogJ2ZvbnQtd2VpZ2h0OmJvbGQ7bWFyZ2luLWJvdHRvbTo0cHg7JyB9XG4gICAgICB9KTtcblxuICAgICAgbm90ZUVsLmNyZWF0ZUVsKCdkaXYnLCB7XG4gICAgICAgIHRleHQ6IGBUeXBlOiAke25vdGUubWV0YWRhdGEudHlwZSB8fCAnVW5rbm93bid9YCxcbiAgICAgICAgYXR0cjogeyBzdHlsZTogJ2ZvbnQtc2l6ZTowLjllbTsnIH1cbiAgICAgIH0pO1xuXG4gICAgICBpZiAobm90ZS5tZXRhZGF0YS50YWdzLmxlbmd0aCkge1xuICAgICAgICBub3RlRWwuY3JlYXRlRWwoJ2RpdicsIHtcbiAgICAgICAgICB0ZXh0OiBgVGFnczogJHtub3RlLm1ldGFkYXRhLnRhZ3Muam9pbignLCAnKX1gLFxuICAgICAgICAgIGF0dHI6IHsgc3R5bGU6ICdmb250LXNpemU6MC45ZW07JyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAobm90ZS5tZXRhZGF0YS5wZW9wbGUubGVuZ3RoKSB7XG4gICAgICAgIG5vdGVFbC5jcmVhdGVFbCgnZGl2Jywge1xuICAgICAgICAgIHRleHQ6IGBQZW9wbGU6ICR7bm90ZS5tZXRhZGF0YS5wZW9wbGUuam9pbignLCAnKX1gLFxuICAgICAgICAgIGF0dHI6IHsgc3R5bGU6ICdmb250LXNpemU6MC45ZW07JyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAobm90ZS5tZXRhZGF0YS5kYXRlcy5sZW5ndGgpIHtcbiAgICAgICAgbm90ZUVsLmNyZWF0ZUVsKCdkaXYnLCB7XG4gICAgICAgICAgdGV4dDogYERhdGVzOiAke25vdGUubWV0YWRhdGEuZGF0ZXMuam9pbignLCAnKX1gLFxuICAgICAgICAgIGF0dHI6IHsgc3R5bGU6ICdmb250LXNpemU6MC45ZW07JyB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdHJlYW1SZXNwb25zZShyZXNwb25zZTogUmVzcG9uc2UsIGJvdFJlc3BvbnNlOiBIVE1MRWxlbWVudCkge1xuICAgIGlmICghcmVzcG9uc2UuYm9keSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXNwb25zZSBib2R5IGlzIG51bGwnKTtcbiAgICB9XG5cbiAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xuICAgIGNvbnN0IGRlY29kZXIgPSBuZXcgVGV4dERlY29kZXIoKTtcbiAgICBsZXQgc3RyZWFtZWRUZXh0ID0gJ0NoYXRib3Q6ICc7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgIGlmIChkb25lKSBicmVhaztcblxuICAgICAgY29uc3QgY2h1bmsgPSBkZWNvZGVyLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgY2h1bmsuc3BsaXQoJ1xcbicpKSB7XG4gICAgICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ2RhdGE6ICcpKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGpzb24gPSBKU09OLnBhcnNlKGxpbmUuc2xpY2UoNikpO1xuICAgICAgICAgICAgaWYgKGpzb24uY2hvaWNlcz8uWzBdPy5kZWx0YT8uY29udGVudCkge1xuICAgICAgICAgICAgICBzdHJlYW1lZFRleHQgKz0ganNvbi5jaG9pY2VzWzBdLmRlbHRhLmNvbnRlbnQ7XG4gICAgICAgICAgICAgIGJvdFJlc3BvbnNlLnNldFRleHQoc3RyZWFtZWRUZXh0KTtcbiAgICAgICAgICAgICAgYm90UmVzcG9uc2Uuc2Nyb2xsSW50b1ZpZXcoeyBiZWhhdmlvcjogJ3Ntb290aCcsIGJsb2NrOiAnZW5kJyB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gcGFyc2Ugc3RyZWFtaW5nIGNodW5rOicsIGxpbmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jaGF0Ym90LmFib3J0KCk7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxufVxuIl19