import { Plugin, Notice, Modal, MarkdownView, Menu, Editor, App } from 'obsidian';
import { AIHelperSettings, AIHelperSettingTab, loadSettings, saveSettings } from './settings';

enum ModalAction {
  inline,
  summarize,
  copy
}

export default class AIHelperPlugin extends Plugin {
  settings: AIHelperSettings;

  async onload() {
    this.settings = await loadSettings(this);
    this.addSettingTab(new AIHelperSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
        menu.addItem((item) => {
          item.setTitle('Summarize Selected Text')
            .setIcon('pencil')
            .onClick(() => {
              this.summarizeSelection(editor);
            });
        });
      })
    );
  }

  async saveSettings() {
    await saveSettings(this, this.settings);
  }

  getEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.editor : null;
  }

  async summarizeSelection(editor: Editor) {
    const selectedText = editor.getSelection();
    if (!selectedText) {
      new Notice('No text selected');
      return;
    }

    const modal = new AIHelperModal(this.app, selectedText, this.settings, async (finalSummary: string, action: ModalAction) => {
      if (action === ModalAction.inline) {
        editor.replaceSelection(`${selectedText}\n**Summary:**\n${finalSummary}`);
      } else if (action === ModalAction.summarize) {
        const currentContent = editor.getValue();
        const summarySection = `----\n# Summary\n${finalSummary}\n----\n`;
        editor.setValue(summarySection + currentContent);
      } else if (action === ModalAction.copy) {
        navigator.clipboard.writeText(finalSummary).then(() => {
          new Notice('Summary copied to clipboard');
        }).catch(err => {
          console.error('Failed to copy text: ', err);
        });
      } else {
        return;
      }
    });
    modal.open();
  }

  onunload() {
    console.log('AIHelper plugin unloaded');
  }
}

class AIHelperModal extends Modal {
  text: string;
  onSubmit: (summary: string, action: ModalAction) => void;
  settings: AIHelperSettings;
  summary: string;
  isStreaming: boolean;
  controller: AbortController;

  constructor(app: App, text: string, settings: AIHelperSettings, onSubmit: (summary: string, action: ModalAction) => void) {
    super(app);
    this.text = text;
    this.settings = settings;
    this.onSubmit = onSubmit;
    this.summary = '';
    this.isStreaming = true;
    this.controller = new AbortController();
  }

  async onOpen() {
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
  }

  async streamSummary(markdownPreview: HTMLTextAreaElement, inlineButton: HTMLButtonElement, summarizeButton: HTMLButtonElement, copyButton: HTMLButtonElement) {
    try {
      const apiUrl = this.settings.apiChoice === 'openai' ? 'https://api.openai.com/v1/chat/completions' : this.settings.localLLM.url;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.settings.apiChoice === 'openai') {
        headers['Authorization'] = `Bearer ${this.settings.openAI.apiKey}`;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.settings.apiChoice === 'openai' ? this.settings.openAI.model : this.settings.localLLM.model,
          messages: [
            { role: 'system', content: 'You are an expert at summarizing text clearly and concisely.' },
            { role: 'system', content: 'I will be sending you various snippets of text with little to no context.' },
            { role: 'system', content: 'Summarize these snippets for me and return only the summarized text.' },
            { role: 'system', content: 'The summary must be returned in raw GitHub Markdown format and must not include any additional content.' },
            { role: 'system', content: 'Your response must contain only the summary—no explanations, introductions, or extra formatting.' },
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
        const { done, value } = await reader.read();
        if (!streamInitialized) {
          markdownPreview.value = '';
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
                markdownPreview.value += json.choices[0].delta.content;
              }
            } catch (error) {
              console.warn('Failed to parse streaming chunk:', line);
            }
          }
        }
      }

      markdownPreview.removeAttribute('disabled');
      inlineButton.removeAttribute('disabled');
      summarizeButton.removeAttribute('disabled');
      copyButton.removeAttribute('disabled');
    } catch (error) {
      console.error('Error summarizing text:', error);
      markdownPreview.value = 'Failed to summarize text:\n' + error;

      markdownPreview.setAttribute('disabled', 'true');
      inlineButton.setAttribute('disabled', 'true');
      summarizeButton.setAttribute('disabled', 'true');
      copyButton.setAttribute('disabled', 'true');
    }
  }

  onClose() {
    this.controller.abort();
    const { contentEl } = this;
    contentEl.empty();
  }
}
