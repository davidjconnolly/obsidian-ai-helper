import { TFile } from 'obsidian';

export interface NoteMetadata {
  title: string;
  path: string;
  tags: string[];
  dates: string[];
  type: string;
  frontmatter: Record<string, unknown>;
  links: string[];
}

export class MetadataExtractor {
  private static readonly TAG_REGEX = /#[\w-]+/g;
  private static readonly LINK_REGEX = /\[\[([^\]]+)\]\]/g;
  private static readonly DATE_REGEX = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/g;
  private static readonly TASK_REGEX = /- \[([ x])\] /g;

  static extractFrontmatter(content: string): Record<string, unknown> {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    if (!match) return {};

    const frontmatter = match[1];
    const lines = frontmatter.split('\n');
    const result: Record<string, unknown> = {};

    for (const line of lines) {
      const [key, ...values] = line.split(':').map(s => s.trim());
      if (key && values.length > 0) {
        const value = values.join(':').trim();
        // Try to parse arrays and objects
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value.slice(1, -1).split(',').map(s => s.trim());
          }
        } else if (value.toLowerCase() === 'true') {
          result[key] = true;
        } else if (value.toLowerCase() === 'false') {
          result[key] = false;
        } else if (!isNaN(Number(value))) {
          result[key] = Number(value);
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  static extractTags(content: string): string[] {
    const matches = content.match(this.TAG_REGEX) || [];
    return [...new Set(matches.map(tag => tag.slice(1)))];
  }

  static extractLinks(content: string): string[] {
    const matches = content.match(this.LINK_REGEX) || [];
    return [...new Set(matches.map(link => link.slice(2, -2)))];
  }

  static extractDates(content: string): string[] {
    const matches = content.match(this.DATE_REGEX) || [];
    return [...new Set(matches)];
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

  static determineNoteType(content: string, frontmatter: Record<string, unknown>): string {
    // First check frontmatter for explicit type
    if (typeof frontmatter.type === 'string') {
      return frontmatter.type;
    }

    // Then check content patterns
    if (content.includes('- [ ]') || content.includes('- [x]')) {
      return 'task';
    }
    if (content.match(/\d{4}-\d{2}-\d{2}/)) {
      return 'journal';
    }
    if (content.match(/\[\[([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\]\]/)) {
      return 'person';
    }
    if (content.match(/#[\w-]+/)) {
      return 'note';
    }

    return 'unknown';
  }

  static async extractMetadata(file: TFile, content: string): Promise<NoteMetadata> {
    const frontmatter = this.extractFrontmatter(content);
    const tags = this.extractTags(content);
    const links = this.extractLinks(content);
    const dates = this.extractDates(content);
    const type = this.determineNoteType(content, frontmatter);

    return {
      title: file.basename,
      path: file.path,
      tags,
      dates,
      type,
      frontmatter,
      links
    };
  }

  static createMetadataEmbedding(metadata: NoteMetadata): string {
    const parts = [
      `Title: ${metadata.title}`,
      `Type: ${metadata.type}`,
      metadata.tags.length ? `Tags: ${metadata.tags.join(', ')}` : null,
      metadata.dates.length ? `Dates: ${metadata.dates.join(', ')}` : null,
      metadata.links.length ? `Links: ${metadata.links.join(', ')}` : null,
      Object.keys(metadata.frontmatter).length ? `Additional metadata: ${JSON.stringify(metadata.frontmatter)}` : null
    ];

    return parts.filter(Boolean).join('\n');
  }
}