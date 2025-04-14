// Mock DOM elements
document.body.innerHTML = '<div id="app"></div>';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  clear: jest.fn(),
  removeItem: jest.fn(),
  length: 0,
  key: jest.fn(),
};
global.localStorage = localStorageMock;

// Mock fetch
global.fetch = jest.fn();

// Mock AbortController
class MockAbortSignal {
  aborted = false;
  reason: any = undefined;
  onabort: ((this: AbortSignal, ev: Event) => any) | null = null;

  addEventListener = jest.fn();
  removeEventListener = jest.fn();
  dispatchEvent = jest.fn();
  throwIfAborted = jest.fn();
}

class MockAbortController {
  signal = new MockAbortSignal();
  abort = jest.fn();
}

global.AbortController = MockAbortController as any;

export {};