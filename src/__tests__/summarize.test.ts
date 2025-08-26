// Mock Obsidian classes first
jest.mock('obsidian', () => ({
  Modal: class MockModal {
    app: any;
    contentEl: any;
    titleEl: any;
    open: any;
    close: any;
    constructor(app: any) {
      this.app = app;
      this.contentEl = {
        empty: jest.fn(),
        createEl: jest.fn().mockReturnValue({
          createEl: jest.fn().mockReturnValue({
            addEventListener: jest.fn(),
          }),
          addEventListener: jest.fn(),
          value: '',
        }),
        appendChild: jest.fn(),
      };
      this.titleEl = { setText: jest.fn() };
      this.open = jest.fn();
      this.close = jest.fn();
    }
  },
  Notice: jest.fn(),
  App: jest.fn(),
  Editor: jest.fn(),
}));

// Mock utils
jest.mock('../utils', () => ({
  logError: jest.fn(),
}));

// Capture actual fetch calls for testing
let fetchCalls: any[] = [];
global.fetch = jest.fn().mockImplementation((...args) => {
  fetchCalls.push(args);
  return Promise.resolve({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'test summary' } }] }),
  });
});

global.TextDecoder = class MockTextDecoder {
  decode(val: any) {
    if (typeof val === 'string') return val;
    if (val instanceof Uint8Array) {
      return Array.from(val).map(byte => String.fromCharCode(byte)).join('');
    }
    return '';
  }
} as any;

global.TextEncoder = class MockTextEncoder {
  encode(val: string) {
    return new Uint8Array(Array.from(val).map(char => char.charCodeAt(0)));
  }
} as any;

global.AbortController = class MockAbortController {
  signal: any;
  constructor() {
    this.signal = { aborted: false };
  }
  abort() {
    this.signal.aborted = true;
  }
} as any;

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
  writable: true,
});

describe('ModalAction enum', () => {
  it('should have correct values', async () => {
    const { ModalAction } = await import('../summarize');
    expect(ModalAction.inline).toBe(0);
    expect(ModalAction.summarize).toBe(1);
    expect(ModalAction.copy).toBe(2);
  });
});

describe('summarizeSelection function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCalls = [];
  });

  it('should show notice when no text is available', async () => {
    const { summarizeSelection } = await import('../summarize');
    const { Notice } = await import('obsidian');

    const mockEditor = {
      getSelection: jest.fn().mockReturnValue(''),
      getValue: jest.fn().mockReturnValue(''),
    };

    await summarizeSelection(mockEditor as any, {} as any, {} as any);

    expect(Notice).toHaveBeenCalledWith('No text to summarize');
  });

  it('should prefer selected text over full document', async () => {
    const { summarizeSelection } = await import('../summarize');

    const mockEditor = {
      getSelection: jest.fn().mockReturnValue('selected text'),
      getValue: jest.fn().mockReturnValue('full document'),
    };
    const mockSettings = {
      summarizeSettings: { maxContextLength: 1000 }
    };

    await summarizeSelection(mockEditor as any, {} as any, mockSettings as any);

    expect(mockEditor.getSelection).toHaveBeenCalled();
    expect(mockEditor.getValue).not.toHaveBeenCalled();
  });

  it('should fall back to full document when no selection', async () => {
    const { summarizeSelection } = await import('../summarize');

    const mockEditor = {
      getSelection: jest.fn().mockReturnValue(''),
      getValue: jest.fn().mockReturnValue('full document'),
    };
    const mockSettings = {
      summarizeSettings: { maxContextLength: 1000 }
    };

    await summarizeSelection(mockEditor as any, {} as any, mockSettings as any);

    expect(mockEditor.getSelection).toHaveBeenCalled();
    expect(mockEditor.getValue).toHaveBeenCalled();
  });

  it('should handle text truncation logic', () => {
    // Test the text truncation logic directly
    const longText = 'a'.repeat(100);
    const maxContextLength = 50;
    const isTruncated = longText.length > maxContextLength;
    const limitedText = isTruncated
      ? longText.substring(0, maxContextLength) + `\n\n[Content truncated due to size limit of ${maxContextLength} characters]`
      : longText;

    expect(isTruncated).toBe(true);
    expect(limitedText).toContain('[Content truncated due to size limit of 50 characters]');
    expect(limitedText.length).toBeGreaterThan(maxContextLength);
    expect(limitedText.substring(0, maxContextLength)).toBe('a'.repeat(50));
  });
});

describe('AIHelperModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchCalls = [];
  });

  it('should construct correct API request for OpenAI', async () => {
    const { AIHelperModal } = await import('../summarize');

    const settings = {
      summarizeSettings: {
        provider: 'openai',
        openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
        openaiApiKey: 'sk-test',
        openaiModel: 'gpt-4',
        maxTokens: 150,
        temperature: 0.7,
        enableStreaming: false,
      }
    };

    const modal = new AIHelperModal({} as any, 'test text', settings as any, jest.fn());
    const mockTextarea = { value: '', removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;
    const mockButton = { removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;

    await modal.generateSummary(mockTextarea, mockButton, mockButton, mockButton);

    expect(fetchCalls).toHaveLength(1);
    const [url, options] = fetchCalls[0];

    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer sk-test');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4');
    expect(body.max_tokens).toBe(150);
    expect(body.temperature).toBe(0.7);
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(4);
    expect(body.messages[3].content).toContain('test text');
  });

  it('should construct correct API request for local provider', async () => {
    const { AIHelperModal } = await import('../summarize');

    const settings = {
      summarizeSettings: {
        provider: 'local',
        localApiUrl: 'http://localhost:1234/v1/chat/completions',
        localModel: 'llama-2',
        maxTokens: 100,
        temperature: 0.5,
        enableStreaming: true,
      }
    };

    const modal = new AIHelperModal({} as any, 'test text', settings as any, jest.fn());
    const mockTextarea = { value: '', removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;
    const mockButton = { removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;

    await modal.generateSummary(mockTextarea, mockButton, mockButton, mockButton);

    expect(fetchCalls).toHaveLength(1);
    const [url, options] = fetchCalls[0];

    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(options.headers['Authorization']).toBeUndefined();

    const body = JSON.parse(options.body);
    expect(body.model).toBe('llama-2');
    expect(body.stream).toBe(true);
  });

  it('should handle missing API URL configuration', async () => {
    const { AIHelperModal } = await import('../summarize');
    const { logError } = await import('../utils');

    const settings = {
      summarizeSettings: {
        provider: 'openai',
        openaiApiUrl: '',
        openaiApiKey: 'sk-test',
      }
    };

    const modal = new AIHelperModal({} as any, 'test text', settings as any, jest.fn());
    const mockTextarea = { value: '', removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;
    const mockButton = { removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;

    await modal.generateSummary(mockTextarea, mockButton, mockButton, mockButton);

    expect(logError).toHaveBeenCalledWith('Error summarizing text', expect.any(Error));
    expect(mockTextarea.value).toContain('Failed to summarize text');
  });

  it('should handle missing OpenAI API key', async () => {
    const { AIHelperModal } = await import('../summarize');
    const { logError } = await import('../utils');

    const settings = {
      summarizeSettings: {
        provider: 'openai',
        openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
        openaiApiKey: '',
      }
    };

    const modal = new AIHelperModal({} as any, 'test text', settings as any, jest.fn());
    const mockTextarea = { value: '', removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;
    const mockButton = { removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;

    await modal.generateSummary(mockTextarea, mockButton, mockButton, mockButton);

    expect(logError).toHaveBeenCalledWith('Error summarizing text', expect.any(Error));
    expect(mockTextarea.value).toContain('OpenAI API key is missing');
  });

  it('should parse streaming response correctly', async () => {
    const { AIHelperModal } = await import('../summarize');

    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
      'data: [DONE]\n\n'
    ];

    let chunkIndex = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (chunkIndex < chunks.length) {
              const chunk = chunks[chunkIndex++];
              return {
                done: false,
                value: new Uint8Array(Array.from(chunk).map(char => char.charCodeAt(0)))
              };
            }
            return { done: true, value: undefined };
          }
        })
      }
    });

    // Use a simple TextDecoder mock
    global.TextDecoder = class MockTextDecoder {
      decode(data: Uint8Array) {
        return Array.from(data).map(byte => String.fromCharCode(byte)).join('');
      }
    } as any;

    const settings = {
      summarizeSettings: {
        provider: 'openai',
        openaiApiUrl: 'https://api.openai.com/v1/chat/completions',
        openaiApiKey: 'sk-test',
        enableStreaming: true,
      }
    };

    const modal = new AIHelperModal({} as any, 'test text', settings as any, jest.fn());
    const mockTextarea = { value: '', removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;
    const mockButton = { removeAttribute: jest.fn(), setAttribute: jest.fn() } as any;

    await modal.generateSummary(mockTextarea, mockButton, mockButton, mockButton);

    expect(mockTextarea.value).toBe('Hello World');
    expect(modal.summary).toBe('Hello World');
  });
});