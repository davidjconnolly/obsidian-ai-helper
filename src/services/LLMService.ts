// LLM Service for handling API interactions
import { AIHelperSettings } from '../settings';

export class LLMService {
  private controller: AbortController;

  constructor(private settings: AIHelperSettings) {
    this.controller = new AbortController();
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(this.settings.localLLM.embeddingsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.settings.localLLM.embeddingModel,
          input: text
        }),
        signal: this.controller.signal
      });

      if (!response.ok) {
        throw new Error(`Embedding API error (${response.status}): ${response.statusText}`);
      }

      const jsonResponse = await response.json();
      let embedding: number[];

      if (jsonResponse.data?.[0]?.embedding) {
        embedding = jsonResponse.data[0].embedding;
      } else if (jsonResponse.embedding) {
        embedding = jsonResponse.embedding;
      } else {
        throw new Error('Invalid embedding response structure');
      }

      if (!Array.isArray(embedding) || embedding.length !== 1024) {
        throw new Error(`Invalid embedding dimension: ${embedding?.length}`);
      }

      return embedding;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during embedding';
      console.error('Embedding error:', errorMessage);
      throw error;
    }
  }

  /**
   * Send a completion request to the LLM API
   * @param prompt The prompt to send to the LLM
   * @param stream Whether to stream the response (true) or get a complete response (false)
   * @returns Response object for streaming or the complete text response
   */
  async sendCompletion(prompt: string, stream: boolean = false): Promise<Response | string> {
    try {
      console.log('Sending request to LLM:', {
        url: this.settings.localLLM.url,
        model: this.settings.localLLM.model,
        prompt: prompt.substring(0, 100) + '...' // Log truncated prompt for debugging
      });

      const response = await fetch(this.settings.localLLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.settings.localLLM.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          stream: stream
        }),
        signal: this.controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('LLM API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`LLM API error (${response.status}): ${response.statusText}\n${errorText}`);
      }

      // For streaming, return the response directly
      if (stream) {
        return response;
      }

      // For non-streaming, parse and return the text content
      const jsonResponse = await response.json();
      if (jsonResponse.choices && jsonResponse.choices.length > 0) {
        return jsonResponse.choices[0].message?.content || '';
      } else {
        throw new Error('Invalid completion response structure');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during completion';
      console.error('Completion error:', errorMessage);
      throw error;
    }
  }

  // Helper methods for backward compatibility
  async streamCompletion(prompt: string): Promise<Response> {
    return this.sendCompletion(prompt, true) as Promise<Response>;
  }

  async getCompletion(prompt: string): Promise<string> {
    return this.sendCompletion(prompt, false) as Promise<string>;
  }

  abort() {
    this.controller.abort();
    // Create a new controller for future requests
    this.controller = new AbortController();
  }
}