import { Plugin, Notice, Modal, Setting, MarkdownView, Menu, Editor, App, PluginSettingTab } from 'obsidian';
import { AIHelperSettings, loadSettings, saveSettings } from './settings';

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

    const modal = new AIHelperModal(this.app, selectedText, this.settings, async (finalSummary: string) => {
      editor.replaceSelection(`${selectedText}\n\n**Summary:**\n\n${finalSummary}`);
    });
    modal.open();
  }

  onunload() {
    console.log('AIHelper plugin unloaded');
  }
}

class AIHelperModal extends Modal {
  text: string;
  onSubmit: (summary: string) => void;
  settings: AIHelperSettings;
  summary: string;
  isStreaming: boolean;
  controller: AbortController;

  constructor(app: App, text: string, settings: AIHelperSettings, onSubmit: (summary: string) => void) {
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
        style: 'width: 100%; height: 50vh; overflow-y: auto; border: 1px solid #ccc; padding: 10px; white-space: pre-wrap;',
        disabled: 'true'
      },
      text: 'Waiting for input...'
    });

    const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });
    const saveButton = buttonContainer.createEl('button', { text: 'Save Summary', cls: 'mod-cta', attr: { disabled: 'true' } });
    saveButton.addEventListener('click', () => {
      this.onSubmit(markdownPreview.value);
      this.close();
    });

    contentEl.appendChild(buttonContainer);

    this.streamSummary(markdownPreview, saveButton);
  }

  async streamSummary(markdownPreview: HTMLTextAreaElement, saveButton: HTMLButtonElement) {
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
              debugger;
              console.warn('Failed to parse streaming chunk:', line);
            }
          }
        }
      }

      markdownPreview.removeAttribute('disabled');
      saveButton.removeAttribute('disabled');
    } catch (error) {
      console.error('Error summarizing text:', error);
      markdownPreview.value = 'Failed to summarize text:\n' + error;
      markdownPreview.setAttribute('disabled', 'true');
      saveButton.setAttribute('disabled', 'true');
    }
  }

  onClose() {
    this.controller.abort();
    const { contentEl } = this;
    contentEl.empty();
  }
}

class AIHelperSettingTab extends PluginSettingTab {
  plugin: AIHelperPlugin;

  constructor(app: App, plugin: AIHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'AIHelper Plugin Settings' });

    // API Selection Section
    containerEl.createEl('h3', { text: 'API Selection' });

    new Setting(containerEl)
      .setName('API Choice')
      .setDesc('Choose which API to use for summarization.')
      .addDropdown(dropdown =>
        dropdown.addOptions({ local: 'Local LLM', openai: 'OpenAI' })
          .setValue(this.plugin.settings.apiChoice)
          .onChange(async (value) => {
            this.plugin.settings.apiChoice = value as 'local' | 'openai';
            await this.plugin.saveSettings();
          })
      );


    // OpenAI Settings Section
    containerEl.createEl('h3', { text: 'OpenAI Settings' });
    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Enter your OpenAI API key if using OpenAI.')
      .addText(text =>
        text.setPlaceholder('sk-...')
          .setValue(this.plugin.settings.openAI.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAI.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('OpenAI Model')
      .setDesc('Enter the model\'s API identifier for OpenAI.')
      .addText(text =>
        text.setPlaceholder('gpt-3.5-turbo')
          .setValue(this.plugin.settings.openAI.model)
          .onChange(async (value) => {
            this.plugin.settings.openAI.model = value;
            await this.plugin.saveSettings();
          })
      );

    // Local LLM Settings Section
    containerEl.createEl('h3', { text: 'Local LLM Settings' });
    new Setting(containerEl)
      .setName('Local LLM API URL')
      .setDesc('Enter the API URL for your local LLM server.')
      .addText(text =>
        text.setPlaceholder('http://127.0.0.1:1234/v1/chat/completions')
          .setValue(this.plugin.settings.localLLM.url)
          .onChange(async (value) => {
            this.plugin.settings.localLLM.url = value;
            await this.plugin.saveSettings();
          })
      );

      new Setting(containerEl)
      .setName('Local LLM Model')
      .setDesc('Enter the model\'s API identifier for your local LLM server.')
      .addText(text =>
        text.setPlaceholder('Identifier')
          .setValue(this.plugin.settings.localLLM.model)
          .onChange(async (value) => {
            this.plugin.settings.localLLM.model = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
