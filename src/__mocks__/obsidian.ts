export class App {
  vault = {
    getAbstractFileByPath: jest.fn(),
    cachedRead: jest.fn(),
    read: jest.fn(),
    write: jest.fn(),
  };
  workspace = {
    getActiveFile: jest.fn(),
    getLeavesOfType: jest.fn(),
    getRightLeaf: jest.fn(),
    revealLeaf: jest.fn(),
  };
  metadataCache = {
    getFileCache: jest.fn(),
  };
}

export class TFile {
  path: string;
  basename: string;
  stat: { mtime: number };

  constructor(path: string, basename: string, stat: { mtime: number }) {
    this.path = path;
    this.basename = basename;
    this.stat = stat;
  }
}

export class WorkspaceLeaf {
  view = {
    app: new App(),
  };
  setViewState = jest.fn();
}

export class ButtonComponent {
  setButtonText = jest.fn();
  setCta = jest.fn();
  onClick = jest.fn();
  buttonEl = {
    classList: {
      add: jest.fn(),
    },
    disabled: false,
  };
}

export class MarkdownRenderer {
  static renderMarkdown = jest.fn();
}

export class ItemView {
  constructor(public leaf: WorkspaceLeaf) {}
  contentEl = document.createElement('div');
  getViewType = jest.fn();
  getDisplayText = jest.fn();
  getIcon = jest.fn();
  onOpen = jest.fn();
  onClose = jest.fn();
}