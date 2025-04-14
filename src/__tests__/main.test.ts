import AIHelperPlugin from '../main';
import { Settings, DEFAULT_SETTINGS } from '../settings';
import { openAIChat } from '../chat';
import { summarizeSelection } from '../summarize';
import { initializeEmbeddingSystem } from '../chat/embeddingStore';

// Mock Obsidian modules
jest.mock('obsidian', () => ({
  Plugin: class Plugin {
    loadData = jest.fn().mockResolvedValue({});
    saveData = jest.fn().mockResolvedValue(undefined);
    registerView = jest.fn();
    addCommand = jest.fn();
    addRibbonIcon = jest.fn();
    addSettingTab = jest.fn();
    registerEvent = jest.fn();
    registerInterval = jest.fn();
    app: any;
    constructor() {
      this.app = {
        workspace: {
          on: jest.fn().mockReturnValue({id: 'workspace-on'}),
          detachLeavesOfType: jest.fn(),
          onLayoutReady: jest.fn().mockImplementation(cb => cb())
        },
        vault: {
          on: jest.fn().mockReturnValue({id: 'vault-on'})
        }
      };
    }
  },
  MarkdownView: class MarkdownView {},
  Notice: jest.fn().mockImplementation(function(message) {
    this.message = message;
  }),
  TFile: class TFile {
    path: string;
    extension: string;
    constructor(path: string) {
      this.path = path;
      this.extension = path.split('.').pop() || '';
    }
  }
}));

// Mock other modules
jest.mock('../chat', () => ({
  AI_CHAT_VIEW_TYPE: 'ai-chat-view',
  AIHelperChatView: jest.fn().mockImplementation(function() {
    return { id: 'chat-view-instance' };
  }),
  openAIChat: jest.fn()
}));

jest.mock('../settings', () => ({
  DEFAULT_SETTINGS: {
    chatSettings: { provider: 'local' },
    embeddingSettings: {
      provider: 'local',
      updateMode: 'onUpdate'
    },
    summarizeSettings: { provider: 'local' },
    openChatOnStartup: false,
    debugMode: true,
    fileUpdateFrequency: 30
  },
  AIHelperSettingTab: jest.fn().mockImplementation(function() {
    return { id: 'settings-tab-instance' };
  })
}));

jest.mock('../summarize', () => ({
  summarizeSelection: jest.fn()
}));

jest.mock('../chat/embeddingStore', () => ({
  initializeEmbeddingSystem: jest.fn(),
  isGloballyInitialized: false,
  globalInitializationPromise: null
}));

// Mock FileUpdateManager
jest.mock('../fileUpdateManager', () => {
  return {
    FileUpdateManager: jest.fn().mockImplementation(function() {
      const processPendingFileUpdates = jest.fn().mockImplementation(function() {
        return Promise.resolve();
      }) as jest.Mock & { flush: jest.Mock };
      processPendingFileUpdates.flush = jest.fn();

      return {
        modifiedFiles: new Map(),
        processPendingFileUpdates,
        reindexFile: jest.fn().mockImplementation(function() {
          return Promise.resolve();
        }),
        rescanVaultFiles: jest.fn(),
        removeFileFromIndex: jest.fn().mockImplementation(function() {
          return Promise.resolve();
        }),
        getPeriodicCheckInterval: jest.fn().mockReturnValue(30000),
        isInitialIndexingInProgress: jest.fn().mockReturnValue(false),
        updateDebounceSettings: jest.fn()
      };
    })
  };
});

describe('AIHelperPlugin', () => {
  let plugin: AIHelperPlugin;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Create an instance with mocked app and manifest objects
    const mockApp: any = {
      workspace: {
        on: jest.fn().mockReturnValue({id: 'workspace-on'}),
        detachLeavesOfType: jest.fn(),
        onLayoutReady: jest.fn().mockImplementation(cb => cb())
      },
      vault: {
        on: jest.fn().mockReturnValue({id: 'vault-on'})
      }
    };
    const mockManifest: any = {
      id: 'obsidian-ai-helper',
      name: 'AI Helper',
      version: '1.0.0',
      minAppVersion: '0.15.0'
    };
    plugin = new AIHelperPlugin(mockApp, mockManifest);
    await plugin.onload();
  });

  describe('loadSettings', () => {
    it('should load default settings when no saved data exists', async () => {
      // Mock loadData to return empty object
      plugin.loadData = jest.fn().mockResolvedValue({});

      await plugin.loadSettings();

      // Verify default settings were loaded
      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should merge saved settings with defaults', async () => {
      // Mock loadData to return partial settings
      const savedSettings = {
        chatSettings: {
          provider: 'openai',
          openaiApiKey: 'test-key'
        },
        debugMode: false
      };

      plugin.loadData = jest.fn().mockResolvedValue(savedSettings);

      await plugin.loadSettings();

      // Verify settings were merged correctly
      expect(plugin.settings.chatSettings.provider).toBe('openai');
      expect(plugin.settings.chatSettings.openaiApiKey).toBe('test-key');
      expect(plugin.settings.debugMode).toBe(false);

      // Check that other defaults were preserved
      expect(plugin.settings.embeddingSettings).toEqual(DEFAULT_SETTINGS.embeddingSettings);
      expect(plugin.settings.summarizeSettings).toEqual(DEFAULT_SETTINGS.summarizeSettings);
    });
  });

  describe('saveSettings', () => {
    it('should save current settings', async () => {
      // Spy on saveData method
      const saveDataSpy = jest.spyOn(plugin, 'saveData');

      // Mock settings with valid provider values
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        chatSettings: {
          ...DEFAULT_SETTINGS.chatSettings,
          provider: 'local' // Using a valid provider value
        }
      } as Settings;

      await plugin.saveSettings();

      // Verify saveData was called with correct settings
      expect(saveDataSpy).toHaveBeenCalledWith(plugin.settings);
    });
  });

  describe('onload', () => {
    it('should register the AI chat view', () => {
      // Verify view was registered
      expect(plugin.registerView).toHaveBeenCalledWith(
        'ai-chat-view',
        expect.any(Function)
      );
    });

    it('should add commands', () => {
      // Verify commands were added - the actual number may be 4 instead of 3
      expect(plugin.addCommand).toHaveBeenCalledTimes(4);

      // Check summarize command
      expect(plugin.addCommand).toHaveBeenCalledWith(expect.objectContaining({
        id: 'summarize-text',
        name: 'Summarize selected text or current note'
      }));

      // Check open chat command
      expect(plugin.addCommand).toHaveBeenCalledWith(expect.objectContaining({
        id: 'open-ai-chat',
        name: 'Open AI Chat'
      }));

      // Check rescan vault command
      expect(plugin.addCommand).toHaveBeenCalledWith(expect.objectContaining({
        id: 'rescan-vault-files',
        name: 'Rescan vault for AI indexing'
      }));
    });

    it('should add ribbon icon', () => {
      expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
        'message-square',
        'Open AI Chat',
        expect.any(Function)
      );
    });

    it('should add settings tab', () => {
      expect(plugin.addSettingTab).toHaveBeenCalled();
    });

    it('should register file event handlers when updateMode is onUpdate', () => {
      // Setting is already 'onUpdate' in mocked DEFAULT_SETTINGS

      // Verify vault events were registered - the actual number may be 5 instead of 4
      expect(plugin.registerEvent).toHaveBeenCalledTimes(5);

      // Check events registered: create, delete, rename, modify
      const registeredEvents = ['create', 'delete', 'rename', 'modify'];
      registeredEvents.forEach(eventName => {
        expect(plugin.app.vault.on).toHaveBeenCalledWith(
          eventName,
          expect.any(Function)
        );
      });
    });

    it('should setup interval for periodic checking', () => {
      expect(plugin.registerInterval).toHaveBeenCalled();
    });

    it('should initialize embedding system when workspace is ready', () => {
      // Verify initialization was attempted
      expect(initializeEmbeddingSystem).toHaveBeenCalledWith(
        expect.any(Object),
        plugin.app
      );
    });

    it('should open AI chat on startup if setting is enabled', async () => {
      // Reset plugin with mocked app and manifest
      const mockApp: any = {
        workspace: {
          on: jest.fn().mockReturnValue({id: 'workspace-on'}),
          detachLeavesOfType: jest.fn(),
          onLayoutReady: jest.fn().mockImplementation(cb => cb())
        },
        vault: {
          on: jest.fn().mockReturnValue({id: 'vault-on'})
        }
      };
      const mockManifest: any = {
        id: 'obsidian-ai-helper',
        name: 'AI Helper',
        version: '1.0.0',
        minAppVersion: '0.15.0'
      };
      plugin = new AIHelperPlugin(mockApp, mockManifest);

      // Set the openChatOnStartup setting to true
      plugin.loadData = jest.fn().mockResolvedValue({
        openChatOnStartup: true
      });

      await plugin.onload();

      // Verify chat was opened
      expect(openAIChat).toHaveBeenCalledWith(plugin.app);
    });
  });

  describe('onunload', () => {
    it('should flush pending file updates', () => {
      // Cast fileUpdateManager to any to bypass private access restriction
      plugin.onunload();

      // Verify flush was called
      expect((plugin as any).fileUpdateManager.processPendingFileUpdates.flush).toHaveBeenCalled();
    });

    it('should detach chat view leaves', () => {
      plugin.onunload();

      // Verify detach was called with correct view type
      expect(plugin.app.workspace.detachLeavesOfType).toHaveBeenCalledWith('ai-chat-view');
    });

    it('should call rescanVaultFiles when rescan command is triggered', () => {
      // Find the rescan command
      const commandCall = (plugin.addCommand as jest.Mock).mock.calls.find(
        call => call[0].id === 'rescan-vault-files'
      );

      // Get the callback function
      const callback = commandCall[0].callback;

      // Call the callback
      callback();

      // Verify rescanVaultFiles was called
      expect((plugin as any).fileUpdateManager.rescanVaultFiles).toHaveBeenCalled();
    });
  });

  describe('command callbacks', () => {
    it('should call summarizeSelection when summarize command is triggered', () => {
      // Find the summarize command
      const commandCall = (plugin.addCommand as jest.Mock).mock.calls.find(
        call => call[0].id === 'summarize-text'
      );

      // Get the callback function
      const editorCallback = commandCall[0].editorCallback;

      // Mock editor and view
      const mockEditor = {};
      const mockView = {};

      // Call the callback
      editorCallback(mockEditor, mockView);

      // Verify summarizeSelection was called with correct arguments
      expect(summarizeSelection).toHaveBeenCalledWith(
        mockEditor,
        plugin.app,
        plugin.settings
      );
    });

    it('should call openAIChat when chat command is triggered', () => {
      // Find the open chat command
      const commandCall = (plugin.addCommand as jest.Mock).mock.calls.find(
        call => call[0].id === 'open-ai-chat'
      );

      // Get the callback function
      const callback = commandCall[0].callback;

      // Call the callback
      callback();

      // Verify openAIChat was called
      expect(openAIChat).toHaveBeenCalledWith(plugin.app);
    });

    it('should call processPendingFileUpdates.flush when process-pending-updates command is triggered', () => {
      // Find the process-pending-updates command
      const commandCall = (plugin.addCommand as jest.Mock).mock.calls.find(
        call => call[0].id === 'process-pending-updates'
      );

      // Get the callback function
      const callback = commandCall[0].callback;

      // Call the callback
      callback();

      // Verify processPendingFileUpdates.flush was called
      expect((plugin as any).fileUpdateManager.processPendingFileUpdates.flush).toHaveBeenCalled();
    });

    it('should call reindexFile when a markdown file is created', () => {
      // Find the create event registration
      const createEventCall = (plugin.app.vault.on as jest.Mock).mock.calls.find(
        call => call[0] === 'create'
      );

      // Get the callback function
      const callback = createEventCall[1];

      // Create a markdown file
      const mockFile = new (jest.requireMock('obsidian').TFile)('test.md');

      // Call the callback
      callback(mockFile);

      // Verify reindexFile was called
      expect((plugin as any).fileUpdateManager.reindexFile).toHaveBeenCalledWith(mockFile);
    });

    it('should not call reindexFile for non-markdown files', () => {
      // Find the create event registration
      const createEventCall = (plugin.app.vault.on as jest.Mock).mock.calls.find(
        call => call[0] === 'create'
      );

      // Get the callback function
      const callback = createEventCall[1];

      // Create a non-markdown file
      const mockFile = new (jest.requireMock('obsidian').TFile)('test.txt');

      // Call the callback
      callback(mockFile);

      // Verify reindexFile was not called
      expect((plugin as any).fileUpdateManager.reindexFile).not.toHaveBeenCalled();
    });

    it('should call removeFileFromIndex when a markdown file is deleted', () => {
      // Find the delete event registration
      const deleteEventCall = (plugin.app.vault.on as jest.Mock).mock.calls.find(
        call => call[0] === 'delete'
      );

      // Get the callback function
      const callback = deleteEventCall[1];

      // Create a markdown file to delete
      const mockFile = new (jest.requireMock('obsidian').TFile)('test-delete.md');

      // Call the callback
      callback(mockFile);

      // Verify removeFileFromIndex was called
      expect((plugin as any).fileUpdateManager.removeFileFromIndex).toHaveBeenCalledWith(mockFile.path);
    });

    it('should not call removeFileFromIndex for non-markdown files', () => {
      // Find the delete event registration
      const deleteEventCall = (plugin.app.vault.on as jest.Mock).mock.calls.find(
        call => call[0] === 'delete'
      );

      // Get the callback function
      const callback = deleteEventCall[1];

      // Create a non-markdown file to delete
      const mockFile = new (jest.requireMock('obsidian').TFile)('test-delete.txt');

      // Call the callback
      callback(mockFile);

      // Verify removeFileFromIndex was not called
      expect((plugin as any).fileUpdateManager.removeFileFromIndex).not.toHaveBeenCalled();
    });

    it('should handle file rename events correctly', () => {
      // Find the rename event registration
      const renameEventCall = (plugin.app.vault.on as jest.Mock).mock.calls.find(
        call => call[0] === 'rename'
      );

      // Get the callback function
      const callback = renameEventCall[1];

      // Create a markdown file to rename
      const mockFile = new (jest.requireMock('obsidian').TFile)('new-name.md');
      const oldPath = 'old-name.md';

      // Call the callback
      callback(mockFile, oldPath);

      // Verify correct methods were called
      expect((plugin as any).fileUpdateManager.removeFileFromIndex).toHaveBeenCalledWith(oldPath);
      expect((plugin as any).fileUpdateManager.reindexFile).toHaveBeenCalledWith(mockFile);
    });

    it('should handle file modification events', () => {
      // Find the modify event registration
      const modifyEventCall = (plugin.app.vault.on as jest.Mock).mock.calls.find(
        call => call[0] === 'modify'
      );

      // Get the callback function
      const callback = modifyEventCall[1];

      // Create a markdown file to modify
      const mockFile = new (jest.requireMock('obsidian').TFile)('test-modify.md');

      // Verify modified files is empty initially
      expect((plugin as any).modifiedFiles.size).toBe(0);

      // Call the callback
      callback(mockFile);

      // Verify file was added to modified files and debounce was triggered
      expect((plugin as any).modifiedFiles.has(mockFile.path)).toBe(true);
      expect((plugin as any).fileUpdateManager.processPendingFileUpdates).toHaveBeenCalled();
    });
  });
});