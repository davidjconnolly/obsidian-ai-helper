// NLP utilities for query processing
import { logDebug } from './utils';
import { Settings } from './settings';

/**
 * List of common English stopwords
 */
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he',
  'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were',
  'will', 'with', 'am', 'been', 'being', 'do', 'does', 'did', 'doing', 'i',
  'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'would',
  'should', 'could', 'ought', 'im', 'youre', 'hes', 'shes', 'its', 'were',
  'theyre', 'ive', 'youve', 'weve', 'theyve', 'id', 'youd', 'hed', 'shed',
  'wed', 'theyd', 'ill', 'youll', 'hell', 'shell', 'well', 'theyll', 'isnt',
  'arent', 'wasnt', 'werent', 'hasnt', 'havent', 'hadnt', 'doesnt', 'dont',
  'didnt', 'wont', 'wouldnt', 'shouldnt', 'couldnt', 'cant', 'cannot', 'couldnt',
  'mustnt', 'lets', 'thats', 'whos', 'whats', 'heres', 'theres', 'whens',
  'wheres', 'whys', 'hows', 'because', 'why', 'how', 'when', 'where', 'then',
  'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 's', 't', 'can', 'just', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain',
  'about', 'above', 'after', 'again', 'against', 'below', 'between', 'but',
  'during', 'into', 'once', 'or', 'out', 'over', 'through', 'under', 'until',
  'up', 'while', 'vs', 'versus'
]);

/**
 * Special words to preserve in queries despite being stopwords
 * Primarily negations and important qualifiers
 */
export const PRESERVED_WORDS = new Set([
  'not', 'no', 'never', 'without', 'except', 'but', 'however', 'although',
  'despite', 'though', 'unless', 'unlike', 'won\'t', 'don\'t', 'can\'t',
  'cannot', 'couldn\'t', 'shouldn\'t', 'wouldn\'t', 'isn\'t', 'aren\'t',
  'wasn\'t', 'weren\'t', 'hasn\'t', 'haven\'t', 'hadn\'t', 'doesn\'t',
  'didn\'t', 'none', 'neither', 'nor'
]);

/**
 * Basic function to normalize a word
 * @param word Word to normalize
 * @returns Normalized word
 */
export function normalizeWord(word: string): string {
  return word.toLowerCase();
}

/**
 * Process user query for better vector search
 * @param query The raw user query
 * @param settings Plugin settings
 * @returns Processed query object with tokens
 */
export function processQuery(query: string, settings: Settings): {
  original: string;
  processed: string;
  tokens: string[];
  expandedTokens: string[];
  phrases: string[];
} {
  const original = query.trim();

  // Extract phrases with their original case
  const phrases: string[] = [];
  let text = original;

  // Extract phrases and replace with placeholders
  text = text.replace(/"([^"]*)"/g, (match, phrase) => {
    phrases.push(phrase);
    return `__PHRASE${phrases.length - 1}__`;
  });

  // Convert to lowercase for tokenization
  let processed = text.toLowerCase();

  // Tokenize
  let tokens = processed
    .replace(/[^\w\s0-9_]/g, '') // Remove punctuation but keep digits for placeholder IDs
    .split(/\s+/)
    .filter(token =>
      token.length >= 2 &&
      (!STOPWORDS.has(token) || PRESERVED_WORDS.has(token)) // Keep important stopwords
    );

  // Apply normalization to tokens (except phrases)
  const normalizedTokens: string[] = [];

  for (const token of tokens) {
    // If token is a phrase placeholder, replace with actual phrase
    if (token.startsWith('__phrase') && /^__phrase\d+__$/.test(token)) {
      const index = parseInt(token.slice(8, -2));
      if (index >= 0 && index < phrases.length) {
        normalizedTokens.push(phrases[index]);
      }
    } else if (PRESERVED_WORDS.has(token)) {
      // Keep preserved words as-is
      normalizedTokens.push(token);
    } else {
      // Normalize other tokens
      normalizedTokens.push(normalizeWord(token));
    }
  }

  // In our simplified approach, we'll just use normalized tokens as the expanded tokens
  // This maintains the API but eliminates the complexity
  const expandedTokens = [...normalizedTokens];

  logDebug(settings, `Query processing: "${original}" → tokens: ${JSON.stringify(normalizedTokens)}`);

  return {
    original,
    processed: normalizedTokens.join(' '),
    tokens: normalizedTokens,
    expandedTokens: expandedTokens,
    phrases
  };
}