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

    // Special handling for common time references
    if (timeUnit === 'year' && amount === 1 && direction === 'current') {
      // "This year" - from January 1st to today
      start = new Date(now.getFullYear(), 0, 1); // January 1st of current year
      end = now;

      console.log('Special case: This year');
    }
    else if (timeUnit === 'month' && amount === 1 && direction === 'current') {
      // "This month" - from the 1st of this month to today
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;

      console.log('Special case: This month');
    }
    else if (timeUnit === 'week' && amount === 1 && direction === 'current') {
      // "This week" - from last Sunday/Monday to today
      const dayOfWeek = now.getDay();
      start = new Date(now);
      start.setDate(now.getDate() - dayOfWeek);
      end = now;

      console.log('Special case: This week');
    }
    else if (direction === 'past') {
      // Keep end as now, move start back
      switch (timeUnit) {
        case 'year':
          start.setFullYear(start.getFullYear() - amount);
          break;
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
    }
    else if (direction === 'future') {
      // Keep start as now, move end forward
      switch (timeUnit) {
        case 'year':
          end.setFullYear(end.getFullYear() + amount);
          break;
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

    // Enhanced prompt with better time frame handling
    const parsePrompt = `
You are analyzing a search query for a personal notes system. Extract search parameters and context to help find relevant notes.

USER QUERY: "${question}"

Analyze this query and provide a structured JSON response with:
1. searchTerms: The main concepts to search for
2. filters: Any specific filtering criteria (tags, date ranges, note types)
3. context: Additional information about the query's intent and requirements

For date ranges, use these special time directions:
- Use "current" for "this year", "this month", "this week" (with timeUnit = "year", "month", or "week" and timeAmount = 1)
- Use "past" for historical periods (e.g., "last 3 months", "past year")
- Use "future" for upcoming periods (e.g., "next week", "coming month")

JSON RESPONSE FORMAT:
{
  "searchTerms": "core search terms",
  "filters": {
    "tags": ["tag1", "tag2"],
    "type": ["note type", "another note type"],
    "dateRange": {
      "timeUnit": "year|month|week|day",
      "timeAmount": number,
      "timeDirection": "current|past|future",
      "useCreatedDate": boolean
    }
  },
  "context": {
    "timeframe": "when this is about",
    "people": "who this is about",
    "actions": "what actions/activities this involves",
    "requirements": "specific needs/constraints"
  }
}

EXAMPLES:
- For "How many times have I spoken to Rick this year?" use:
  - timeUnit: "year", timeAmount: 1, timeDirection: "current"
- For "Show me notes from last 3 months" use:
  - timeUnit: "month", timeAmount: 3, timeDirection: "past"
- For "meetings planned for next week" use:
  - timeUnit: "week", timeAmount: 1, timeDirection: "future"
`;

    try {
      // Get completion from LLM
      const response = await this.llmService.getCompletion(parsePrompt);
      console.log('Raw Parser Response:', response);

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('Could not extract JSON from response');
      }

      const analysisJson = jsonMatch[0];

      try {
        const analysis = JSON.parse(analysisJson) as {
          searchTerms: string;
          filters: {
            tags?: string[];
            type?: string;
            dateRange?: {
              timeUnit: string;
              timeAmount: number;
              timeDirection: string;
              useCreatedDate: boolean;
            };
          };
          context: {
            timeframe: string;
            people: string;
            actions: string;
            requirements: string;
          };
        };

        // Validate and process the analysis
        const result: QueryAnalysis = {
          searchTerms: analysis.searchTerms || question,
          filters: {},
          context: {
            timeframe: analysis.context?.timeframe || '',
            people: analysis.context?.people || '',
            actions: analysis.context?.actions || '',
            requirements: analysis.context?.requirements || ''
          }
        };

        // Process tags
        if (analysis.filters?.tags?.length) {
          result.filters.tags = analysis.filters.tags;
        }

        // Process type
        if (analysis.filters?.type) {
          // Handle both string and array formats for type
          if (typeof analysis.filters.type === 'string') {
            // Single type as string
            result.filters.type = analysis.filters.type;
          } else if (Array.isArray(analysis.filters.type)) {
            // Type array - process all non-empty strings
            const typeArray = analysis.filters.type as string[];
            // Filter out empty strings and join with a common separator
            const validTypes = typeArray.filter(t => typeof t === 'string' && t.trim() !== '');
            if (validTypes.length === 1) {
              result.filters.type = validTypes[0];
            } else if (validTypes.length > 1) {
              // Support multiple types by using a regex pattern in VectorStore
              result.filters.type = validTypes.join('|');
            }
          }
        }

        // Process date range
        if (analysis.filters?.dateRange) {
          const { timeUnit, timeAmount, timeDirection, useCreatedDate } = analysis.filters.dateRange;
          if (timeUnit && timeAmount && timeDirection) {
            result.filters.dateRange = this.convertDateRange(
              timeUnit,
              timeAmount,
              timeDirection,
              useCreatedDate
            );
          }
        }

        return result;
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError);
        // Return a basic analysis if parsing fails
        return {
          searchTerms: question,
          filters: {},
          context: {
            timeframe: '',
            people: '',
            actions: '',
            requirements: ''
          }
        };
      }
    } catch (error) {
      console.error('Error getting query analysis:', error);
      // Return a basic analysis if LLM call fails
      return {
        searchTerms: question,
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