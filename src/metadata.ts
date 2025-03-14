import { TFile } from 'obsidian';

export interface NoteMetadata {
  title: string;
  path: string;
  tags: string[];
  people: string[];
  dates: string[];
  type: string;
  frontmatter: string;
  links: string[];
  tasks: {
    total: number;
    completed: number;
    open: number;
  };
  lastModified: number;
}

export class MetadataExtractor {
  private static readonly TAG_REGEX = /#[\w-]+/g;
  private static readonly LINK_REGEX = /\[\[([^\]]+)\]\]/g;
  private static readonly PERSON_REGEX = /\[\[([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\]\]/g;
  private static readonly DATE_REGEX = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/g;
  private static readonly TASK_REGEX = /- \[([ x])\] /g;

  static extractFrontmatter(content: string): Record<string, any> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (!match) return {};

    const frontmatter = match[1];
    const lines = frontmatter.split('\n');
    const result: Record<string, any> = {};

    for (const line of lines) {
      const [key, ...values] = line.split(':').map(s => s.trim());
      if (key && values.length > 0) {
        result[key] = values.join(':').trim();
      }
    }

    return result;
  }

  static extractTags(content: string): string[] {
    const matches = content.match(this.TAG_REGEX) || [];
    return matches.map(tag => tag.slice(1));
  }

  static extractLinks(content: string): string[] {
    const matches = content.match(this.LINK_REGEX) || [];
    return matches.map(link => link.slice(2, -2));
  }

  static extractPeople(content: string): string[] {
    const matches = content.match(this.PERSON_REGEX) || [];
    return matches.map(person => person.slice(2, -2));
  }

  static extractDates(content: string): string[] {
    return content.match(this.DATE_REGEX) || [];
  }

  static extractTasks(content: string): { total: number; completed: number; open: number } {
    const matches = content.matchAll(this.TASK_REGEX);
    let total = 0;
    let completed = 0;
    let open = 0;

    for (const match of matches) {
      total++;
      if (match[1] === 'x') {
        completed++;
      } else {
        open++;
      }
    }

    return { total, completed, open };
  }

  static determineNoteType(content: string, frontmatter: Record<string, any>): string {
    // Check frontmatter first
    if (frontmatter.type) return frontmatter.type;

    // Check content patterns
    if (content.match(/^# Meeting Notes/)) return 'meeting';
    if (content.match(/^# Project/)) return 'project';
    if (content.match(/^# Daily Note/)) return 'daily';
    if (content.match(/^# Book Notes/)) return 'book';
    if (content.match(/^# Research/)) return 'research';

    return 'general';
  }

  static async extractMetadata(file: TFile, content: string): Promise<NoteMetadata> {
    const frontmatter = this.extractFrontmatter(content);
    const tags = this.extractTags(content);
    const links = this.extractLinks(content);
    const people = this.extractPeople(content);
    const dates = this.extractDates(content);
    const tasks = this.extractTasks(content);
    const type = this.determineNoteType(content, frontmatter);

    return {
      title: file.basename,
      path: file.path,
      tags,
      people,
      dates,
      type,
      frontmatter: JSON.stringify(frontmatter),
      links,
      tasks,
      lastModified: file.stat.mtime
    };
  }

  static createMetadataEmbedding(metadata: NoteMetadata): string {
    // Create a structured text representation of the metadata
    // This will be used to generate embeddings
    return `
Title: ${metadata.title}
Type: ${metadata.type}
Tags: ${metadata.tags.join(', ')}
People: ${metadata.people.join(', ')}
Dates: ${metadata.dates.join(', ')}
Tasks: ${metadata.tasks.completed}/${metadata.tasks.total} completed
Frontmatter: ${JSON.stringify(metadata.frontmatter)}
    `.trim();
  }
}