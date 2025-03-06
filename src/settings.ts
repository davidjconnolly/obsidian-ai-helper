import { Plugin } from 'obsidian';

export interface AIHelperSettings {
  apiChoice: 'local' | 'openai';
  localLLM: {
    url: string;
    model: string;
  };
  openAI: {
    apiKey: string;
    model: string;
  };
}

const DEFAULT_SETTINGS: AIHelperSettings = {
  apiChoice: 'local',
  localLLM: {
    url: 'http://127.0.0.1:1234/v1/chat/completions',
    model: '',
  },
  openAI: {
    apiKey: '',
    model: 'gpt-3.5-turbo',
  },
};

export async function loadSettings(plugin: Plugin): Promise<AIHelperSettings> {
  return Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
}

export async function saveSettings(plugin: Plugin, settings: AIHelperSettings): Promise<void> {
  await plugin.saveData(settings);
}
