import { requestUrl, RequestUrlParam } from 'obsidian';
import { Settings } from "src/settings";
import { ChatMessage } from "src/chat";
import { logError, logDebug } from "src/utils";

export class LLMConnector {
  private settings: Settings;

  constructor(settings: Settings) {
      this.settings = settings;
  }

  async generateResponse(messages: ChatMessage[]): Promise<ChatMessage> {
      const provider = this.settings.chatSettings.provider;
      const apiEndpoint = provider === 'local'
          ? this.settings.chatSettings.localApiUrl
          : this.settings.chatSettings.openaiApiUrl;
      const modelName = provider === 'local'
          ? this.settings.chatSettings.localModel
          : this.settings.chatSettings.openaiModel;

      if (!apiEndpoint) {
          throw new Error('API endpoint is not configured. Please check your settings.');
      }

      try {
          // Prepare request parameters
          const headers: Record<string, string> = {
              'Content-Type': 'application/json'
          };

          // Add Authorization header for OpenAI
          if (provider === 'openai') {
              const apiKey = this.settings.chatSettings.openaiApiKey;
              if (!apiKey) {
                  throw new Error('OpenAI API key is missing. Please configure it in the settings.');
              }
              headers['Authorization'] = `Bearer ${apiKey}`;
          }

          // Prepare request body
          const requestBody = {
              model: modelName,
              messages: messages,
              temperature: this.settings.chatSettings.temperature,
              max_tokens: this.settings.chatSettings.maxTokens,
              stream: false
          };

          logDebug(this.settings, `Sending request to ${apiEndpoint} with body: ${JSON.stringify(requestBody)}`);

          const requestParams: RequestUrlParam = {
              url: apiEndpoint,
              method: 'POST',
              headers: headers,
              body: JSON.stringify(requestBody)
          };

          // Send request to API
          const response = await requestUrl(requestParams);

          // Parse response
          const responseData = response.json;

          if (responseData.choices && responseData.choices.length > 0) {
              const messageContent = responseData.choices[0].message.content;
              return { role: 'assistant', content: messageContent };
          } else {
              throw new Error('Invalid response format from API');
          }
      } catch (error) {
          logError('Error in API request', error);
          throw error;
      }
  }
}
