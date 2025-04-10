import { requestUrl, RequestUrlParam } from 'obsidian';
import { Settings } from '../settings';
import { logError } from '../utils';
import { APIResponse } from '../types';

export class APIClient {
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  /**
   * Generate embeddings using the configured provider
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    const provider = this.settings.embeddingSettings.provider;

    if (provider === 'openai') {
      return this.generateOpenAIEmbedding(text);
    } else if (provider === 'local') {
      return this.generateLocalEmbedding(text);
    } else {
      throw new Error('Invalid embedding provider. Must be either "openai" or "local".');
    }
  }

  /**
   * Generate embeddings using OpenAI API
   */
  private async generateOpenAIEmbedding(text: string): Promise<Float32Array> {
    try {
      const apiKey = this.settings.chatSettings.openaiApiKey;
      const apiUrl = this.settings.embeddingSettings.openaiApiUrl || 'https://api.openai.com/v1/embeddings';
      const model = this.settings.embeddingSettings.openaiModel;

      if (!apiKey) {
        throw new Error('OpenAI API key is missing. Please configure it in the settings.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      const requestBody = {
        model: model,
        input: text
      };

      const requestParams: RequestUrlParam = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      };

      const response = await requestUrl(requestParams);
      const responseData = response.json;

      if (responseData.data && responseData.data.length > 0 && responseData.data[0].embedding) {
        return new Float32Array(responseData.data[0].embedding);
      } else {
        throw new Error('Invalid response format from OpenAI embeddings API');
      }
    } catch (error) {
      logError('Error generating OpenAI embedding', error);
      throw error;
    }
  }

  /**
   * Generate embeddings using local API
   */
  private async generateLocalEmbedding(text: string): Promise<Float32Array> {
    try {
      const apiUrl = this.settings.embeddingSettings.localApiUrl;
      const model = this.settings.embeddingSettings.localModel;

      if (!apiUrl) {
        throw new Error('Local embedding API URL is missing. Please configure it in the settings.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      const requestBody = {
        model: model,
        input: text
      };

      const requestParams: RequestUrlParam = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      };

      const response = await requestUrl(requestParams);
      const responseData = response.json;

      if (responseData.data && responseData.data.length > 0 && responseData.data[0].embedding) {
        return new Float32Array(responseData.data[0].embedding);
      } else {
        throw new Error('Invalid response format from local embeddings API');
      }
    } catch (error) {
      logError('Error generating local embedding', error);
      throw error;
    }
  }

  /**
   * Generate a chat response using the configured provider
   */
  async generateChatResponse(messages: any[]): Promise<string> {
    const provider = this.settings.chatSettings.provider;

    if (provider === 'openai') {
      return this.generateOpenAIChatResponse(messages);
    } else if (provider === 'local') {
      return this.generateLocalChatResponse(messages);
    } else {
      throw new Error('Invalid chat provider. Must be either "openai" or "local".');
    }
  }

  /**
   * Generate a chat response using OpenAI API
   */
  private async generateOpenAIChatResponse(messages: any[]): Promise<string> {
    try {
      const apiKey = this.settings.chatSettings.openaiApiKey;
      const apiUrl = this.settings.chatSettings.openaiApiUrl || 'https://api.openai.com/v1/chat/completions';
      const model = this.settings.chatSettings.openaiModel;

      if (!apiKey) {
        throw new Error('OpenAI API key is missing. Please configure it in the settings.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      const requestBody = {
        model: model,
        messages: messages,
        temperature: this.settings.chatSettings.temperature,
        max_tokens: this.settings.chatSettings.maxTokens,
        stream: false
      };

      const requestParams: RequestUrlParam = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      };

      const response = await requestUrl(requestParams);
      const responseData = response.json as APIResponse;

      if (responseData.choices && responseData.choices.length > 0) {
        return responseData.choices[0].message.content;
      } else {
        throw new Error('Invalid response format from OpenAI chat API');
      }
    } catch (error) {
      logError('Error generating OpenAI chat response', error);
      throw error;
    }
  }

  /**
   * Generate a chat response using local API
   */
  private async generateLocalChatResponse(messages: any[]): Promise<string> {
    try {
      const apiUrl = this.settings.chatSettings.localApiUrl;
      const model = this.settings.chatSettings.localModel;

      if (!apiUrl) {
        throw new Error('Local chat API URL is missing. Please configure it in the settings.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      const requestBody = {
        model: model,
        messages: messages,
        temperature: this.settings.chatSettings.temperature,
        max_tokens: this.settings.chatSettings.maxTokens,
        stream: false
      };

      const requestParams: RequestUrlParam = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      };

      const response = await requestUrl(requestParams);
      const responseData = response.json as APIResponse;

      if (responseData.choices && responseData.choices.length > 0) {
        return responseData.choices[0].message.content;
      } else {
        throw new Error('Invalid response format from local chat API');
      }
    } catch (error) {
      logError('Error generating local chat response', error);
      throw error;
    }
  }

  /**
   * Generate a summary using the configured provider
   */
  async generateSummary(text: string): Promise<string> {
    const provider = this.settings.summarizeSettings.provider;

    if (provider === 'openai') {
      return this.generateOpenAISummary(text);
    } else if (provider === 'local') {
      return this.generateLocalSummary(text);
    } else {
      throw new Error('Invalid summary provider. Must be either "openai" or "local".');
    }
  }

  /**
   * Generate a summary using OpenAI API
   */
  private async generateOpenAISummary(text: string): Promise<string> {
    try {
      const apiKey = this.settings.chatSettings.openaiApiKey;
      const apiUrl = this.settings.summarizeSettings.openaiApiUrl || 'https://api.openai.com/v1/chat/completions';
      const model = this.settings.summarizeSettings.openaiModel;

      if (!apiKey) {
        throw new Error('OpenAI API key is missing. Please configure it in the settings.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };

      const requestBody = {
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that summarizes text concisely.' },
          { role: 'user', content: `Please summarize the following text:\n\n${text}` }
        ],
        temperature: this.settings.summarizeSettings.temperature,
        max_tokens: this.settings.summarizeSettings.maxTokens,
        stream: false
      };

      const requestParams: RequestUrlParam = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      };

      const response = await requestUrl(requestParams);
      const responseData = response.json as APIResponse;

      if (responseData.choices && responseData.choices.length > 0) {
        return responseData.choices[0].message.content;
      } else {
        throw new Error('Invalid response format from OpenAI summary API');
      }
    } catch (error) {
      logError('Error generating OpenAI summary', error);
      throw error;
    }
  }

  /**
   * Generate a summary using local API
   */
  private async generateLocalSummary(text: string): Promise<string> {
    try {
      const apiUrl = this.settings.summarizeSettings.localApiUrl;
      const model = this.settings.summarizeSettings.localModel;

      if (!apiUrl) {
        throw new Error('Local summary API URL is missing. Please configure it in the settings.');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      const requestBody = {
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that summarizes text concisely.' },
          { role: 'user', content: `Please summarize the following text:\n\n${text}` }
        ],
        temperature: this.settings.summarizeSettings.temperature,
        max_tokens: this.settings.summarizeSettings.maxTokens,
        stream: false
      };

      const requestParams: RequestUrlParam = {
        url: apiUrl,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      };

      const response = await requestUrl(requestParams);
      const responseData = response.json as APIResponse;

      if (responseData.choices && responseData.choices.length > 0) {
        return responseData.choices[0].message.content;
      } else {
        throw new Error('Invalid response format from local summary API');
      }
    } catch (error) {
      logError('Error generating local summary', error);
      throw error;
    }
  }
}