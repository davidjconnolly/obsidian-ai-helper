import { requestUrl, RequestUrlParam } from 'obsidian';
import { Settings } from "../settings";
import { ChatMessage } from "../chat";
import { logError, logDebug } from "../utils";

export class LLMConnector {
  private settings: Settings;

  constructor(settings: Settings) {
      this.settings = settings;
  }

  async generateResponse(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage> {
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

          // Use fetch instead of requestUrl to support abort signals
          const response = await fetch(apiEndpoint, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(requestBody),
              signal
          });

          if (!response.ok) {
              throw new Error(`HTTP error! Status: ${response.status}`);
          }

          // Parse response
          const responseData = await response.json();

          if (responseData.choices && responseData.choices.length > 0) {
              const messageContent = responseData.choices[0].message.content;
              return { role: 'assistant', content: messageContent };
          } else {
              throw new Error('Invalid response format from API');
          }
      } catch (error) {
          if (error.name === 'AbortError') {
              throw error; // Re-throw abort errors to let caller handle them
          }
          logError('Error in API request', error);
          throw error;
      }
  }

  async streamResponse(
      messages: ChatMessage[],
      updateCallback: (content: string) => void,
      signal?: AbortSignal
  ): Promise<ChatMessage> {
      const provider = this.settings.chatSettings.provider;
      const apiEndpoint = provider === 'local'
          ? this.settings.chatSettings.localApiUrl
          : this.settings.chatSettings.openaiApiUrl;

      if (!apiEndpoint) {
          throw new Error(`API endpoint for ${provider} provider is not set.`);
      }

      const modelName = provider === 'local'
          ? this.settings.chatSettings.localModel
          : this.settings.chatSettings.openaiModel;

      // Check for API key
      let apiKey: string | undefined;
      if (provider === 'openai') {
          apiKey = this.settings.chatSettings.openaiApiKey;
          if (!apiKey) {
              throw new Error('OpenAI API key is missing. Please configure it in the settings.');
          }
      }

      let content = '';
      const decoder = new TextDecoder();
      let lastUpdateLength = 0;
      let hasStartedStreaming = false;

      try {
          // Prepare headers based on provider
          const headers: Record<string, string> = {
              'Content-Type': 'application/json'
          };

          if (provider === 'openai') {
              headers['Authorization'] = `Bearer ${apiKey}`;
          }

          // Prepare request body
          const requestBody = {
              model: modelName,
              messages: messages,
              temperature: this.settings.chatSettings.temperature,
              max_tokens: this.settings.chatSettings.maxTokens,
              stream: true
          };

          // Make the API request
          const response = await fetch(apiEndpoint, {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(requestBody),
              signal
          });

          if (!response.ok) {
              const errorText = await response.text();
              logError(`API request failed with status ${response.status}: ${errorText}`);
              const errorMessage = "I apologize, but I couldn't generate a response. Please check your API key and try again.";
              updateCallback(errorMessage);
              return { role: 'assistant', content: errorMessage };
          }

          if (!response.body) {
              throw new Error("Response body is null");
          }

          const reader = response.body.getReader();

          while (true) {
              const { done, value } = await reader.read();

              if (done) {
                  // Process any remaining content in the decoder
                  const finalChunk = decoder.decode();
                  if (finalChunk.trim()) {
                      try {
                          this.processStreamChunk(finalChunk, (newContent) => {
                              content += newContent;
                          });
                      } catch (e) {
                          logError("Error processing final chunk:", e);
                      }
                  }
                  break;
              }

              try {
                  // Decode the chunk
                  const chunk = decoder.decode(value, { stream: true });

                  // Process the chunk
                  this.processStreamChunk(chunk, (newContent) => {
                      if (newContent) {
                          content += newContent;
                          hasStartedStreaming = true;
                      }
                  });

                  // Only send updates if we have new content, avoid duplicate updates
                  if (content.length > lastUpdateLength) {
                      lastUpdateLength = content.length;
                      updateCallback(content);
                  }
              } catch (e) {
                  logError("Error processing chunk:", e);
              }
          }

          // Check if we've received any content
          if (!hasStartedStreaming || content.trim() === '') {
              const fallbackMessage = "I apologize, but I couldn't generate a response. Please try again with a different prompt.";
              updateCallback(fallbackMessage);
              return { role: 'assistant', content: fallbackMessage };
          }

          return { role: 'assistant', content: content };
      } catch (error) {
          if (error.name === 'AbortError') {
              throw error; // Re-throw abort errors to let caller handle them
          }

          logError("Error in streamResponse:", error);
          const errorMessage = "I apologize, but I couldn't generate a response due to a technical error.";

          // Only update with error message if we haven't started streaming content
          if (!hasStartedStreaming) {
              updateCallback(errorMessage);
          }

          return { role: 'assistant', content: hasStartedStreaming ? content : errorMessage };
      }
  }

  private processStreamChunk(chunk: string, addContent: (content: string) => void): void {
    // Split the chunk by lines
    const lines = chunk.split('\n').filter(line => line.trim() !== '');

    for (const line of lines) {
      // Skip if it's not a data line
      if (!line.startsWith('data:')) continue;

      try {
        // Extract the JSON part
        const jsonStr = line.slice(5).trim();

        // Handle [DONE] marker
        if (jsonStr === '[DONE]') continue;

        // Parse the JSON
        const data = JSON.parse(jsonStr);

        // Extract content
        if (data.choices && data.choices.length > 0) {
          const delta = data.choices[0].delta;
          if (delta && delta.content) {
            addContent(delta.content);
          }
        }
      } catch (e) {
        console.error("Error parsing chunk line:", e, "Line:", line);
      }
    }
  }
}

