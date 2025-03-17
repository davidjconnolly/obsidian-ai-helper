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

      if (!Array.isArray(embedding) || embedding.length !== 768) {
        throw new Error(`Invalid embedding dimension: ${embedding?.length}`);
      }

      return embedding;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during embedding';
      console.error('Embedding error:', errorMessage);
      throw error;
    }
  }

  async streamCompletion(prompt: string): Promise<Response> {
    const response = await fetch(this.settings.localLLM.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.settings.localLLM.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        stream: true
      }),
      signal: this.controller.signal
    });

    if (!response.ok) {
      throw new Error(`LLM API error (${response.status}): ${response.statusText}`);
    }

    return response;
  }

  async getCompletion(prompt: string): Promise<string> {
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
          stream: false
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

      const jsonResponse = await response.json();
      console.log('Raw LLM Response:', JSON.stringify(jsonResponse, null, 2));

      // Handle different LLM response formats
      let content = '';
      if (jsonResponse.choices?.[0]?.message?.content) {
        // OpenAI format
        content = jsonResponse.choices[0].message.content;
      } else if (jsonResponse.choices?.[0]?.text) {
        // Some local models format
        content = jsonResponse.choices[0].text;
      } else if (jsonResponse.response) {
        // Another common format
        content = jsonResponse.response;
      } else {
        console.error('Unrecognized LLM response structure:', jsonResponse);
        throw new Error('Unrecognized LLM response structure');
      }

      console.log('Extracted content:', content);
      return content.trim();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during LLM completion';
      console.error('LLM completion error:', errorMessage);
      throw error;
    }
  }

  abort() {
    this.controller.abort();
    this.controller = new AbortController();
  }
}