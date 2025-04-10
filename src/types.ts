import { TFile } from 'obsidian';

// Embedding related types
export interface EmbeddingModel {
  embed: (text: string) => Promise<Float32Array>;
}

export interface NoteChunk {
  content: string;
  embedding: Float32Array;
  position: number;
}

export interface NoteEmbedding {
  path: string;
  chunks: NoteChunk[];
}

// Chat related types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NoteWithContent {
  file: TFile;
  content: string;
  relevance: number;
  chunkIndex?: number;
}

// API related types
export interface APIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Search result types
export interface SearchResult {
  path: string;
  score: number;
  chunkIndex?: number;
  titleScore?: number;
  recencyScore?: number;
  baseScore: number;
}

// Vector store types
export interface VectorStoreOptions {
  similarity: number;
  limit: number;
  searchTerms?: string[];
  file?: TFile;
}