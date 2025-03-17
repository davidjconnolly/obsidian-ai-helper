import { __awaiter } from "tslib";
import { Notice, Modal } from 'obsidian';
export var ModalAction;
(function (ModalAction) {
    ModalAction[ModalAction["inline"] = 0] = "inline";
    ModalAction[ModalAction["summarize"] = 1] = "summarize";
    ModalAction[ModalAction["copy"] = 2] = "copy";
})(ModalAction || (ModalAction = {}));
export function summarizeSelection(editor, app, settings) {
    return __awaiter(this, void 0, void 0, function* () {
        const selectedText = editor.getSelection();
        if (!selectedText) {
            new Notice('No text selected');
            return;
        }
        const modal = new AIHelperModal(app, selectedText, settings, (finalSummary, action) => __awaiter(this, void 0, void 0, function* () {
            if (action === ModalAction.inline) {
                editor.replaceSelection(`${selectedText}\n\n**Summary:**\n${finalSummary}\n`);
            }
            else if (action === ModalAction.summarize) {
                const currentContent = editor.getValue();
                const summarySection = `----\n# Summary\n${finalSummary}\n\n----\n\n`;
                editor.setValue(summarySection + currentContent);
                editor.setCursor(editor.offsetToPos(summarySection.length));
            }
            else if (action === ModalAction.copy) {
                navigator.clipboard.writeText(finalSummary).then(() => {
                    new Notice('Summary copied to clipboard');
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                });
            }
            else {
                return;
            }
        }));
        modal.open();
    });
}
class AIHelperModal extends Modal {
    constructor(app, text, settings, onSubmit) {
        super(app);
        this.text = text;
        this.settings = settings;
        this.onSubmit = onSubmit;
        this.summary = '';
        this.isStreaming = true;
        this.controller = new AbortController();
    }
    onOpen() {
        return __awaiter(this, void 0, void 0, function* () {
            this.titleEl.setText('Summarize Text');
            const { contentEl } = this;
            contentEl.empty();
            const markdownPreview = contentEl.createEl('textarea', {
                cls: 'markdown-preview',
                attr: {
                    style: 'width: 100%; height: 50vh; overflow-y: auto; border: 1px solid #ccc; padding: 10px; white-space: pre-wrap; resize: none;',
                    disabled: 'true'
                },
                text: 'Waiting for input...'
            });
            const buttonContainer = contentEl.createEl('div', {
                cls: 'button-container',
                attr: { style: 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;' }
            });
            const inlineButton = buttonContainer.createEl('button', { text: 'Insert Inline', cls: 'mod-cta', attr: { disabled: 'true' } });
            inlineButton.addEventListener('click', () => {
                this.onSubmit(markdownPreview.value, ModalAction.inline);
                this.close();
            });
            const summarizeButton = buttonContainer.createEl('button', { text: 'Insert Summary', cls: 'mod-cta', attr: { disabled: 'true' } });
            summarizeButton.addEventListener('click', () => {
                this.onSubmit(markdownPreview.value, ModalAction.summarize);
                this.close();
            });
            const copyButton = buttonContainer.createEl('button', { text: 'Copy', cls: 'mod-cta', attr: { disabled: 'true' } });
            copyButton.addEventListener('click', () => {
                this.onSubmit(markdownPreview.value, ModalAction.copy);
                this.close();
            });
            contentEl.appendChild(buttonContainer);
            this.streamSummary(markdownPreview, inlineButton, summarizeButton, copyButton);
        });
    }
    streamSummary(markdownPreview, inlineButton, summarizeButton, copyButton) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const apiUrl = this.settings.apiChoice === 'openai' ? this.settings.openAI.url : this.settings.localLLM.url;
                const headers = { 'Content-Type': 'application/json' };
                if (this.settings.apiChoice === 'openai') {
                    headers['Authorization'] = `Bearer ${this.settings.openAI.apiKey}`;
                }
                const response = yield fetch(apiUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: this.settings.apiChoice === 'openai' ? this.settings.openAI.model : this.settings.localLLM.model,
                        messages: [
                            { role: 'system', content: 'You are an expert at summarizing text clearly and concisely.' },
                            { role: 'system', content: 'I will provide short snippets of text, often without context. Summarize them briefly and accurately.' },
                            { role: 'system', content: 'Provide the summary in raw GitHub Markdown format without any additional explanation or formatting.' },
                            { role: 'system', content: 'Use headings sparingly—only when absolutely necessary to clarify lengthy or complex concepts. Avoid headings entirely for short, simple summaries.' },
                            { role: 'user', content: `Summarize the following text:\n\n${this.text}` }
                        ],
                        stream: true
                    }),
                    signal: this.controller.signal
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
                }
                if (!response.body) {
                    throw new Error('Response body is null');
                }
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let streamInitialized = false;
                while (true) {
                    const { done, value } = yield reader.read();
                    if (!streamInitialized) {
                        markdownPreview.value = '';
                        streamInitialized = true;
                    }
                    if (done)
                        break;
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
                                    markdownPreview.value += json.choices[0].delta.content;
                                }
                            }
                            catch (error) {
                                console.warn('Failed to parse streaming chunk:', line);
                            }
                        }
                    }
                }
                markdownPreview.removeAttribute('disabled');
                inlineButton.removeAttribute('disabled');
                summarizeButton.removeAttribute('disabled');
                copyButton.removeAttribute('disabled');
            }
            catch (error) {
                console.error('Error summarizing text:', error);
                markdownPreview.value = 'Failed to summarize text:\n' + error;
                markdownPreview.setAttribute('disabled', 'true');
                inlineButton.setAttribute('disabled', 'true');
                summarizeButton.setAttribute('disabled', 'true');
                copyButton.setAttribute('disabled', 'true');
            }
        });
    }
    onClose() {
        this.controller.abort();
        const { contentEl } = this;
        contentEl.empty();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3VtbWFyaXplLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic3VtbWFyaXplLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSxPQUFPLEVBQWUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLFVBQVUsQ0FBQztBQUd0RCxNQUFNLENBQU4sSUFBWSxXQUlYO0FBSkQsV0FBWSxXQUFXO0lBQ3JCLGlEQUFNLENBQUE7SUFDTix1REFBUyxDQUFBO0lBQ1QsNkNBQUksQ0FBQTtBQUNOLENBQUMsRUFKVyxXQUFXLEtBQVgsV0FBVyxRQUl0QjtBQUVELE1BQU0sVUFBZ0Isa0JBQWtCLENBQUMsTUFBYyxFQUFFLEdBQVEsRUFBRSxRQUEwQjs7UUFDM0YsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDakIsSUFBSSxNQUFNLENBQUMsa0JBQWtCLENBQUMsQ0FBQztZQUMvQixPQUFPO1NBQ1I7UUFFRCxNQUFNLEtBQUssR0FBRyxJQUFJLGFBQWEsQ0FBQyxHQUFHLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxDQUFPLFlBQW9CLEVBQUUsTUFBbUIsRUFBRSxFQUFFO1lBQy9HLElBQUksTUFBTSxLQUFLLFdBQVcsQ0FBQyxNQUFNLEVBQUU7Z0JBQ2pDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLFlBQVkscUJBQXFCLFlBQVksSUFBSSxDQUFDLENBQUM7YUFDL0U7aUJBQU0sSUFBSSxNQUFNLEtBQUssV0FBVyxDQUFDLFNBQVMsRUFBRTtnQkFDM0MsTUFBTSxjQUFjLEdBQUcsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUN6QyxNQUFNLGNBQWMsR0FBRyxvQkFBb0IsWUFBWSxjQUFjLENBQUM7Z0JBQ3RFLE1BQU0sQ0FBQyxRQUFRLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQyxDQUFDO2dCQUNqRCxNQUFNLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMs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QUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUM7aUNBQ3hEOzZCQUNGOzRCQUFDLE9BQU8sS0FBSyxFQUFFO2dDQUNkLE9BQU8sQ0FBQyxJQUFJLENBQUMsa0NBQWtDLEVBQUUsSUFBSSxDQUFDLENBQUM7NkJBQ3hEO3lCQUNGO3FCQUNGO2lCQUNGO2dCQUVELGVBQWUsQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUM7Z0JBQzVDLFlBQVksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUM7Z0JBQ3pDLGVBQWUsQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUM7Z0JBQzVDLFVBQVUsQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUM7YUFDeEM7WUFBQyxPQUFPLEtBQUssRUFBRTtnQkFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHlCQUF5QixFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUNoRCxlQUFlLENBQUMsS0FBSyxHQUFHLDZCQUE2QixHQUFHLEtBQUssQ0FBQztnQkFFOUQsZUFBZSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUM7Z0JBQ2pELFlBQVksQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUM5QyxlQUFlLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDakQsVUFBVSxDQUFDLFlBQVksQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUM7YUFDN0M7UUFDSCxDQUFDO0tBQUE7SUFFRCxPQUFPO1FBQ0wsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUN4QixNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQzNCLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUNwQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIEVkaXRvciwgTm90aWNlLCBNb2RhbCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7IEFJSGVscGVyU2V0dGluZ3MgfSBmcm9tICcuL3NldHRpbmdzJztcblxuZXhwb3J0IGVudW0gTW9kYWxBY3Rpb24ge1xuICBpbmxpbmUsXG4gIHN1bW1hcml6ZSxcbiAgY29weVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc3VtbWFyaXplU2VsZWN0aW9uKGVkaXRvcjogRWRpdG9yLCBhcHA6IEFwcCwgc2V0dGluZ3M6IEFJSGVscGVyU2V0dGluZ3MpIHtcbiAgY29uc3Qgc2VsZWN0ZWRUZXh0ID0gZWRpdG9yLmdldFNlbGVjdGlvbigpO1xuICBpZiAoIXNlbGVjdGVkVGV4dCkge1xuICAgIG5ldyBOb3RpY2UoJ05vIHRleHQgc2VsZWN0ZWQnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBtb2RhbCA9IG5ldyBBSUhlbHBlck1vZGFsKGFwcCwgc2VsZWN0ZWRUZXh0LCBzZXR0aW5ncywgYXN5bmMgKGZpbmFsU3VtbWFyeTogc3RyaW5nLCBhY3Rpb246IE1vZGFsQWN0aW9uKSA9PiB7XG4gICAgaWYgKGFjdGlvbiA9PT0gTW9kYWxBY3Rpb24uaW5saW5lKSB7XG4gICAgICBlZGl0b3IucmVwbGFjZVNlbGVjdGlvbihgJHtzZWxlY3RlZFRleHR9XFxuXFxuKipTdW1tYXJ5OioqXFxuJHtmaW5hbFN1bW1hcnl9XFxuYCk7XG4gICAgfSBlbHNlIGlmIChhY3Rpb24gPT09IE1vZGFsQWN0aW9uLnN1bW1hcml6ZSkge1xuICAgICAgY29uc3QgY3VycmVudENvbnRlbnQgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcbiAgICAgIGNvbnN0IHN1bW1hcnlTZWN0aW9uID0gYC0tLS1cXG4jIFN1bW1hcnlcXG4ke2ZpbmFsU3VtbWFyeX1cXG5cXG4tLS0tXFxuXFxuYDtcbiAgICAgIGVkaXRvci5zZXRWYWx1ZShzdW1tYXJ5U2VjdGlvbiArIGN1cnJlbnRDb250ZW50KTtcbiAgICAgIGVkaXRvci5zZXRDdXJzb3IoZWRpdG9yLm9mZnNldFRvUG9zKHN1bW1hcnlTZWN0aW9uLmxlbmd0aCkpO1xuICAgIH0gZWxzZSBpZiAoYWN0aW9uID09PSBNb2RhbEFjdGlvbi5jb3B5KSB7XG4gICAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChmaW5hbFN1bW1hcnkpLnRoZW4oKCkgPT4ge1xuICAgICAgICBuZXcgTm90aWNlKCdTdW1tYXJ5IGNvcGllZCB0byBjbGlwYm9hcmQnKTtcbiAgICAgIH0pLmNhdGNoKGVyciA9PiB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBjb3B5IHRleHQ6ICcsIGVycik7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfSk7XG4gIG1vZGFsLm9wZW4oKTtcbn1cblxuY2xhc3MgQUlIZWxwZXJNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgdGV4dDogc3RyaW5nO1xuICBvblN1Ym1pdDogKHN1bW1hcnk6IHN0cmluZywgYWN0aW9uOiBNb2RhbEFjdGlvbikgPT4gdm9pZDtcbiAgc2V0dGluZ3M6IEFJSGVscGVyU2V0dGluZ3M7XG4gIHN1bW1hcnk6IHN0cmluZztcbiAgaXNTdHJlYW1pbmc6IGJvb2xlYW47XG4gIGNvbnRyb2xsZXI6IEFib3J0Q29udHJvbGxlcjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgdGV4dDogc3RyaW5nLCBzZXR0aW5nczogQUlIZWxwZXJTZXR0aW5ncywgb25TdWJtaXQ6IChzdW1tYXJ5OiBzdHJpbmcsIGFjdGlvbjogTW9kYWxBY3Rpb24pID0+IHZvaWQpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMudGV4dCA9IHRleHQ7XG4gICAgdGhpcy5zZXR0aW5ncyA9IHNldHRpbmdzO1xuICAgIHRoaXMub25TdWJtaXQgPSBvblN1Ym1pdDtcbiAgICB0aGlzLnN1bW1hcnkgPSAnJztcbiAgICB0aGlzLmlzU3RyZWFtaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoJ1N1bW1hcml6ZSBUZXh0Jyk7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb25zdCBtYXJrZG93blByZXZpZXcgPSBjb250ZW50RWwuY3JlYXRlRWwoJ3RleHRhcmVhJywge1xuICAgICAgY2xzOiAnbWFya2Rvd24tcHJldmlldycsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIHN0eWxlOiAnd2lkdGg6IDEwMCU7IGhlaWdodDogNTB2aDsgb3ZlcmZsb3cteTogYXV0bzsgYm9yZGVyOiAxcHggc29saWQgI2NjYzsgcGFkZGluZzogMTBweDsgd2hpdGUtc3BhY2U6IHByZS13cmFwOyByZXNpemU6IG5vbmU7JyxcbiAgICAgICAgZGlzYWJsZWQ6ICd0cnVlJ1xuICAgICAgfSxcbiAgICAgIHRleHQ6ICdXYWl0aW5nIGZvciBpbnB1dC4uLidcbiAgICB9KTtcblxuICAgIGNvbnN0IGJ1dHRvbkNvbnRhaW5lciA9IGNvbnRlbnRFbC5jcmVhdGVFbCgnZGl2Jywge1xuICAgICAgY2xzOiAnYnV0dG9uLWNvbnRhaW5lcicsXG4gICAgICBhdHRyOiB7IHN0eWxlOiAnZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBmbGV4LWVuZDsgZ2FwOiAxMHB4OyBtYXJnaW4tdG9wOiAxMHB4OycgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgaW5saW5lQnV0dG9uID0gYnV0dG9uQ29udGFpbmVyLmNyZWF0ZUVsKCdidXR0b24nLCB7IHRleHQ6ICdJbnNlcnQgSW5saW5lJywgY2xzOiAnbW9kLWN0YScsIGF0dHI6IHsgZGlzYWJsZWQ6ICd0cnVlJyB9IH0pO1xuICAgIGlubGluZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgIHRoaXMub25TdWJtaXQobWFya2Rvd25QcmV2aWV3LnZhbHVlLCBNb2RhbEFjdGlvbi5pbmxpbmUpO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuXG4gICAgY29uc3Qgc3VtbWFyaXplQnV0dG9uID0gYnV0dG9uQ29udGFpbmVyLmNyZWF0ZUVsKCdidXR0b24nLCB7IHRleHQ6ICdJbnNlcnQgU3VtbWFyeScsIGNsczogJ21vZC1jdGEnLCBhdHRyOiB7IGRpc2FibGVkOiAndHJ1ZScgfSB9KTtcbiAgICBzdW1tYXJpemVCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICB0aGlzLm9uU3VibWl0KG1hcmtkb3duUHJldmlldy52YWx1ZSwgTW9kYWxBY3Rpb24uc3VtbWFyaXplKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvcHlCdXR0b24gPSBidXR0b25Db250YWluZXIuY3JlYXRlRWwoJ2J1dHRvbicsIHsgdGV4dDogJ0NvcHknLCBjbHM6ICdtb2QtY3RhJywgYXR0cjogeyBkaXNhYmxlZDogJ3RydWUnIH0gfSk7XG4gICAgY29weUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgIHRoaXMub25TdWJtaXQobWFya2Rvd25QcmV2aWV3LnZhbHVlLCBNb2RhbEFjdGlvbi5jb3B5KTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcblxuICAgIGNvbnRlbnRFbC5hcHBlbmRDaGlsZChidXR0b25Db250YWluZXIpO1xuXG4gICAgdGhpcy5zdHJlYW1TdW1tYXJ5KG1hcmtkb3duUHJldmlldywgaW5saW5lQnV0dG9uLCBzdW1tYXJpemVCdXR0b24sIGNvcHlCdXR0b24pO1xuICB9XG5cbiAgYXN5bmMgc3RyZWFtU3VtbWFyeShtYXJrZG93blByZXZpZXc6IEhUTUxUZXh0QXJlYUVsZW1lbnQsIGlubGluZUJ1dHRvbjogSFRNTEJ1dHRvbkVsZW1lbnQsIHN1bW1hcml6ZUJ1dHRvbjogSFRNTEJ1dHRvbkVsZW1lbnQsIGNvcHlCdXR0b246IEhUTUxCdXR0b25FbGVtZW50KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFwaVVybCA9IHRoaXMuc2V0dGluZ3MuYXBpQ2hvaWNlID09PSAnb3BlbmFpJyA/IHRoaXMuc2V0dGluZ3Mub3BlbkFJLnVybCA6IHRoaXMuc2V0dGluZ3MubG9jYWxMTE0udXJsO1xuICAgICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9O1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuYXBpQ2hvaWNlID09PSAnb3BlbmFpJykge1xuICAgICAgICBoZWFkZXJzWydBdXRob3JpemF0aW9uJ10gPSBgQmVhcmVyICR7dGhpcy5zZXR0aW5ncy5vcGVuQUkuYXBpS2V5fWA7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYXBpVXJsLCB7XG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgbW9kZWw6IHRoaXMuc2V0dGluZ3MuYXBpQ2hvaWNlID09PSAnb3BlbmFpJyA/IHRoaXMuc2V0dGluZ3Mub3BlbkFJLm1vZGVsIDogdGhpcy5zZXR0aW5ncy5sb2NhbExMTS5tb2RlbCxcbiAgICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgICAgeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogJ1lvdSBhcmUgYW4gZXhwZXJ0IGF0IHN1bW1hcml6aW5nIHRleHQgY2xlYXJseSBhbmQgY29uY2lzZWx5LicgfSxcbiAgICAgICAgICAgIHsgcm9sZTogJ3N5c3RlbScsIGNvbnRlbnQ6ICdJIHdpbGwgcHJvdmlkZSBzaG9ydCBzbmlwcGV0cyBvZiB0ZXh0LCBvZnRlbiB3aXRob3V0IGNvbnRleHQuIFN1bW1hcml6ZSB0aGVtIGJyaWVmbHkgYW5kIGFjY3VyYXRlbHkuJyB9LFxuICAgICAgICAgICAgeyByb2xlOiAnc3lzdGVtJywgY29udGVudDogJ1Byb3ZpZGUgdGhlIHN1bW1hcnkgaW4gcmF3IEdpdEh1YiBNYXJrZG93biBmb3JtYXQgd2l0aG91dCBhbnkgYWRkaXRpb25hbCBleHBsYW5hdGlvbiBvciBmb3JtYXR0aW5nLicgfSxcbiAgICAgICAgICAgIHsgcm9sZTogJ3N5c3RlbScsIGNvbnRlbnQ6ICdVc2UgaGVhZGluZ3Mgc3BhcmluZ2x54oCUb25seSB3aGVuIGFic29sdXRlbHkgbmVjZXNzYXJ5IHRvIGNsYXJpZnkgbGVuZ3RoeSBvciBjb21wbGV4IGNvbmNlcHRzLiBBdm9pZCBoZWFkaW5ncyBlbnRpcmVseSBmb3Igc2hvcnQsIHNpbXBsZSBzdW1tYXJpZXMuJyB9LFxuICAgICAgICAgICAgeyByb2xlOiAndXNlcicsIGNvbnRlbnQ6IGBTdW1tYXJpemUgdGhlIGZvbGxvd2luZyB0ZXh0OlxcblxcbiR7dGhpcy50ZXh0fWAgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgc3RyZWFtOiB0cnVlXG4gICAgICAgIH0pLFxuICAgICAgICBzaWduYWw6IHRoaXMuY29udHJvbGxlci5zaWduYWxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSFRUUCBlcnJvciEgU3RhdHVzOiAke3Jlc3BvbnNlLnN0YXR1c30gLSAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzcG9uc2UuYm9keSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jlc3BvbnNlIGJvZHkgaXMgbnVsbCcpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xuICAgICAgY29uc3QgZGVjb2RlciA9IG5ldyBUZXh0RGVjb2RlcigpO1xuICAgICAgbGV0IHN0cmVhbUluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHsgZG9uZSwgdmFsdWUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgICAgIGlmICghc3RyZWFtSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICBtYXJrZG93blByZXZpZXcudmFsdWUgPSAnJztcbiAgICAgICAgICBzdHJlYW1Jbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRvbmUpIGJyZWFrO1xuXG4gICAgICAgIGNvbnN0IGNodW5rID0gZGVjb2Rlci5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pLnRyaW0oKTtcbiAgICAgICAgY29uc3QgbGluZXMgPSBjaHVuay5zcGxpdCgnXFxuJyk7XG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykge1xuICAgICAgICAgIGlmIChsaW5lLnRyaW0oKSA9PT0gJ2RhdGE6IFtET05FXScpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobGluZS5zdGFydHNXaXRoKCdkYXRhOiAnKSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgY29uc3QganNvbiA9IEpTT04ucGFyc2UobGluZS5zbGljZSg2KSk7XG4gICAgICAgICAgICAgIGlmIChqc29uLmNob2ljZXMgJiYganNvbi5jaG9pY2VzWzBdLmRlbHRhICYmIGpzb24uY2hvaWNlc1swXS5kZWx0YS5jb250ZW50KSB7XG4gICAgICAgICAgICAgICAgbWFya2Rvd25QcmV2aWV3LnZhbHVlICs9IGpzb24uY2hvaWNlc1swXS5kZWx0YS5jb250ZW50O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBwYXJzZSBzdHJlYW1pbmcgY2h1bms6JywgbGluZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIG1hcmtkb3duUHJldmlldy5yZW1vdmVBdHRyaWJ1dGUoJ2Rpc2FibGVkJyk7XG4gICAgICBpbmxpbmVCdXR0b24ucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgICAgc3VtbWFyaXplQnV0dG9uLnJlbW92ZUF0dHJpYnV0ZSgnZGlzYWJsZWQnKTtcbiAgICAgIGNvcHlCdXR0b24ucmVtb3ZlQXR0cmlidXRlKCdkaXNhYmxlZCcpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzdW1tYXJpemluZyB0ZXh0OicsIGVycm9yKTtcbiAgICAgIG1hcmtkb3duUHJldmlldy52YWx1ZSA9ICdGYWlsZWQgdG8gc3VtbWFyaXplIHRleHQ6XFxuJyArIGVycm9yO1xuXG4gICAgICBtYXJrZG93blByZXZpZXcuc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICd0cnVlJyk7XG4gICAgICBpbmxpbmVCdXR0b24uc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICd0cnVlJyk7XG4gICAgICBzdW1tYXJpemVCdXR0b24uc2V0QXR0cmlidXRlKCdkaXNhYmxlZCcsICd0cnVlJyk7XG4gICAgICBjb3B5QnV0dG9uLnNldEF0dHJpYnV0ZSgnZGlzYWJsZWQnLCAndHJ1ZScpO1xuICAgIH1cbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250cm9sbGVyLmFib3J0KCk7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cbiJdfQ==