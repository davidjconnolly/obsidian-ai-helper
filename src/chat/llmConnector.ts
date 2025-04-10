import { Settings } from '../settings';
import { ChatMessage } from '../types';
import { APIClient } from '../api/apiClient';

export class LLMConnector {
  private settings: Settings;
  private apiClient: APIClient;

  constructor(settings: Settings) {
    this.settings = settings;
    this.apiClient = new APIClient(settings);
  }

  async generateResponse(messages: ChatMessage[]): Promise<ChatMessage> {
    try {
      const response = await this.apiClient.generateChatResponse(messages);
      return { role: 'assistant', content: response };
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  }
}