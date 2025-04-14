import { LLMConnector } from '../chat/llmConnector';
import { Settings } from '../settings';
import { ChatMessage } from '../chat';

// Mock fetch API
global.fetch = jest.fn();

// Create test fixtures
const mockSettings = {
  chatSettings: {
    provider: 'openai',
    openaiApiKey: 'test-api-key',
    openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    openaiModel: 'gpt-3.5-turbo',
    localApiUrl: 'http://localhost:1234/v1/chat/completions',
    localModel: 'local-model',
    temperature: 0.7,
    maxTokens: 500,
    maxNotesToSearch: 20,
    displayWelcomeMessage: true,
    similarity: 0.5,
    maxContextLength: 4000,
    titleMatchBoost: 0.5
  },
  debugMode: true
} as Settings;

// Mock response data
const mockResponseData = {
  choices: [
    {
      message: {
        content: 'This is a test response'
      }
    }
  ]
};

// Mock response
const mockResponse = {
  ok: true,
  json: jest.fn().mockResolvedValue(mockResponseData)
};

// Setup function to create a clean test environment
function setupLLMTest(settings = mockSettings) {
  // Reset mocks
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

  const connector = new LLMConnector(settings);

  return {
    connector,
    settings
  };
}

describe('LLMConnector', () => {
  describe('constructor', () => {
    it('should initialize with settings', () => {
      const { connector } = setupLLMTest();
      expect(connector).toBeDefined();
      // Test private property access
      expect((connector as any).settings).toBe(mockSettings);
    });
  });

  describe('generateResponse', () => {
    it('should call OpenAI API with correct parameters', async () => {
      const { connector } = setupLLMTest();

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      await connector.generateResponse(messages);

      // Verify API was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          }),
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: messages,
            temperature: 0.7,
            max_tokens: 500,
            stream: false
          })
        })
      );
    });

    it('should call local API with correct parameters', async () => {
      const localSettings = {
        ...mockSettings,
        chatSettings: {
          ...mockSettings.chatSettings,
          provider: 'local'
        }
      } as Settings;

      const { connector } = setupLLMTest(localSettings);

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      await connector.generateResponse(messages);

      // Verify API was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:1234/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            model: 'local-model',
            messages: messages,
            temperature: 0.7,
            max_tokens: 500,
            stream: false
          })
        })
      );
    });

    it('should return parsed response correctly', async () => {
      const { connector } = setupLLMTest();

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      const result = await connector.generateResponse(messages);

      expect(result).toEqual({
        role: 'assistant',
        content: 'This is a test response'
      });
    });

    it('should throw error if API endpoint is not configured', async () => {
      const incompleteSettings = {
        ...mockSettings,
        chatSettings: {
          ...mockSettings.chatSettings,
          openaiApiUrl: undefined
        }
      } as Settings;

      const { connector } = setupLLMTest(incompleteSettings);

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      await expect(connector.generateResponse(messages))
        .rejects.toThrow('API endpoint is not configured');
    });

    it('should throw error if OpenAI API key is missing', async () => {
      const incompleteSettings = {
        ...mockSettings,
        chatSettings: {
          ...mockSettings.chatSettings,
          openaiApiKey: undefined
        }
      } as Settings;

      const { connector } = setupLLMTest(incompleteSettings);

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      await expect(connector.generateResponse(messages))
        .rejects.toThrow('OpenAI API key is missing');
    });

    it('should throw error if response is not ok', async () => {
      const { connector } = setupLLMTest();

      // Mock a failed response
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401
      });

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      await expect(connector.generateResponse(messages))
        .rejects.toThrow('HTTP error! Status: 401');
    });

    it('should throw error if response format is invalid', async () => {
      const { connector } = setupLLMTest();

      // Mock invalid response format
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ invalid: 'response' })
      });

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      await expect(connector.generateResponse(messages))
        .rejects.toThrow('Invalid response format from API');
    });

    it('should handle abort signal', async () => {
      const { connector } = setupLLMTest();

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      // Create abort controller
      const controller = new AbortController();
      const signal = controller.signal;

      // Create a proper AbortError instance that matches what we expect
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      // Mock fetch to reject with the properly formed error
      (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.reject(abortError));

      // Call the method with signal for abort support
      const promise = connector.generateResponse(messages, signal);

      // Verify the AbortError is properly propagated
      await expect(promise).rejects.toThrow('The operation was aborted');
    });

    it('should pass abort signal to fetch', async () => {
      const { connector } = setupLLMTest();

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      // Create abort controller
      const controller = new AbortController();
      const signal = controller.signal;

      // Call API with signal
      await connector.generateResponse(messages, signal);

      // Verify signal was passed to fetch
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: signal
        })
      );
    });

    it('should properly propagate non-abort errors', async () => {
      const { connector } = setupLLMTest();

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      // Mock a network error
      const networkError = new Error('Network connection lost');
      (global.fetch as jest.Mock).mockRejectedValueOnce(networkError);

      // Verify the error is properly propagated
      await expect(connector.generateResponse(messages))
        .rejects.toThrow('Network connection lost');
    });

    it('should handle empty message arrays', async () => {
      const { connector } = setupLLMTest();

      // Call with empty messages array
      await connector.generateResponse([]);

      // Verify API was still called with empty array
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"messages":[]')
        })
      );
    });

    it('should handle messages with special characters', async () => {
      const { connector } = setupLLMTest();

      const messagesWithSpecialChars: ChatMessage[] = [
        { role: 'user', content: 'Test message with special chars: äöü!@#$%^&*()_+\n\t"<>' }
      ];

      await connector.generateResponse(messagesWithSpecialChars);

      // Verify message was properly encoded
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('special chars: äöü!@#$%^&*()_+\\n\\t')
        })
      );
    });

    it('should handle alternative response formats', async () => {
      const { connector } = setupLLMTest();

      // Set up a different response format sometimes seen from different providers
      const alternateResponseData = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Alternate format response'
            }
          }
        ]
      };

      // Mock the response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(alternateResponseData)
      });

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Test message' }
      ];

      const result = await connector.generateResponse(messages);

      expect(result).toEqual({
        role: 'assistant',
        content: 'Alternate format response'
      });
    });
  });
});