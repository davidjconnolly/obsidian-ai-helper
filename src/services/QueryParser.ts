import { LLMService } from './LLMService';

export interface SearchFilters {
  type?: string;
  tags?: string[];
  dateRange?: {
    start: Date;
    end: Date;
    useCreatedDate?: boolean;
  };
}

export interface QueryAnalysis {
  // What we need for vector search
  searchTerms: string;
  filters: SearchFilters;

  // What we need for LLM context
  context: {
    timeframe: string;
    people: string;
    actions: string;
    requirements: string;
  };
}

export class QueryParser {
  constructor(private llmService: LLMService) {}

  private convertDateRange(timeUnit: string, amount: number, direction: string, useCreatedDate: boolean): SearchFilters['dateRange'] {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    if (direction === 'past') {
      // Keep end as now, move start back
      switch (timeUnit) {
        case 'month':
          start.setMonth(start.getMonth() - amount);
          break;
        case 'week':
          start.setDate(start.getDate() - (amount * 7));
          break;
        case 'day':
          start.setDate(start.getDate() - amount);
          break;
      }
    } else {
      // Keep start as now, move end forward
      switch (timeUnit) {
        case 'month':
          end.setMonth(end.getMonth() + amount);
          break;
        case 'week':
          end.setDate(end.getDate() + (amount * 7));
          break;
        case 'day':
          end.setDate(end.getDate() + amount);
          break;
      }
    }

    const dateRange = {
      start,
      end,
      useCreatedDate
    };

    console.log('Converted Date Range:', {
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString(),
      useCreatedDate: dateRange.useCreatedDate
    });

    return dateRange;
  }

  async parseQuery(question: string): Promise<QueryAnalysis> {
    console.log('Parsing query:', question);

    const parsePrompt = `
You are a natural language query analyzer for a personal notes search system. Your task is to analyze questions and extract both search filters and semantic context.

Analyze the query to identify:
1. Core concepts and terms to search for
2. Time-related context and filters
3. People or entities involved
4. Actions or activities
5. Any specific requirements or constraints
6. Tags (words prefixed with #)

Format your response as JSON with these fields:
{
  "searchTerms": "primary terms for vector search, including synonyms and related concepts",
  "filters": {
    "dateRange": {
      "timeUnit": "month"|"week"|"day",
      "timeAmount": number,
      "timeDirection": "past"|"future",
      "useCreatedDate": boolean  // true for note creation time, false for content dates
    },
    "tags": ["tag1", "tag2"]  // ONLY include if hashtags (#) are present
  },
  "context": {
    "timeframe": "any temporal context that's important",
    "people": "key people or entities mentioned",
    "actions": "relevant activities or actions",
    "requirements": "specific constraints or requirements"
  }
}

Examples:

Input: "How many times have I spoken with Rick in the past 3 months?"
{
  "searchTerms": "Rick conversation meeting discussion chat communication",
  "filters": {
    "dateRange": {
      "timeUnit": "month",
      "timeAmount": 3,
      "timeDirection": "past",
      "useCreatedDate": true
    }
  },
  "context": {
    "timeframe": "past 3 months",
    "people": "Rick",
    "actions": "spoken, conversations",
    "requirements": "count occurrences"
  }
}

Input: "What #work projects am I working on with the engineering team?"
{
  "searchTerms": "engineering projects development technical collaboration teamwork",
  "filters": {
    "tags": ["work"]
  },
  "context": {
    "timeframe": "current, ongoing",
    "people": "engineering team",
    "actions": "working on, developing",
    "requirements": "list active projects"
  }
}

Current query: "${question}"

Return the JSON object only, no other text.`;

    try {
      // Get LLM analysis
      const response = await this.llmService.getCompletion(parsePrompt);

      // Extract JSON from the response, handling various formats
      let jsonStr = response;

      // Remove markdown code blocks if present
      const codeBlockMatch = response.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      }

      // Clean any remaining non-JSON content
      jsonStr = jsonStr.trim();
      console.log('Cleaned JSON string:', jsonStr);

      const analysis = JSON.parse(jsonStr);
      console.log('Query Analysis:', JSON.stringify(analysis, null, 2));

      // Convert the analysis to our final format
      const filters: SearchFilters = {};

      // Convert date range if present
      if (analysis.filters?.dateRange) {
        const { timeUnit, timeAmount, timeDirection, useCreatedDate } = analysis.filters.dateRange;
        filters.dateRange = this.convertDateRange(timeUnit, timeAmount, timeDirection, useCreatedDate);
      }

      // Copy over any other filters
      if (analysis.filters?.tags) {
        filters.tags = analysis.filters.tags;
      }

      return {
        searchTerms: analysis.searchTerms,
        filters,
        context: analysis.context
      };
    } catch (error) {
      console.log('LLM parsing failed, falling back to basic search:', error);

      // Just use the question as search terms if LLM fails
      return {
        searchTerms: question.toLowerCase(),
        filters: {},
        context: {
          timeframe: '',
          people: '',
          actions: '',
          requirements: ''
        }
      };
    }
  }
}