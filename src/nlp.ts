// NLP utilities for query processing
import { logDebug } from './utils';
import { Settings } from './settings';

/**
 * Comprehensive list of English stopwords
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
  'up', 'while'
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
 * Common word prefixes to handle stemming
 */
const PREFIXES = ['re', 'un', 'in', 'im', 'dis', 'pre', 'non', 'anti', 'counter'];

/**
 * Common suffixes to handle stemming
 */
const SUFFIXES = [
  'ing', 'ed', 's', 'es', 'ies', 'ly', 'er', 'est', 'al', 'ial', 'ical',
  'ful', 'able', 'ible', 'ness', 'ity', 'ment', 'ation', 'ition', 'tion'
];

/**
 * Simple stemming function to reduce words to their root form
 * @param word Word to stem
 * @returns Stemmed word
 */
export function stemWord(word: string): string {
  let stemmed = word.toLowerCase();

  // Check if it's a short word
  if (stemmed.length <= 3) return stemmed;

  // Special cases for common words
  if (stemmed.startsWith('process')) {
    return 'process';
  }

  // Special case for 'discussed', 'discussing', etc.
  if (stemmed.startsWith('discuss') ||
      stemmed === 'discussed' ||
      stemmed === 'discussing' ||
      stemmed === 'discussion' ||
      stemmed === 'discussions') {
    return 'discuss';
  }

  // Special cases for common words that might be incorrectly stemmed

  // Words ending with "ss"
  if (stemmed.match(/^(address|express|progress)/)) {
    return stemmed.replace(/e[sd]$|ing$/, '');
  }

  // Irregular plurals
  if (stemmed === 'analyses' || stemmed === 'analysis') return 'analysis';
  if (stemmed === 'theses' || stemmed === 'thesis') return 'thesis';
  if (stemmed === 'crises' || stemmed === 'crisis') return 'crisis';
  if (stemmed === 'business' || stemmed === 'businesses') return 'business';

  // Irregular verbs
  if (stemmed.match(/^(understand|understood|understanding)$/)) return 'understand';
  if (stemmed.match(/^(writ|write|wrote|written|writing)$/)) return 'write';
  if (stemmed.match(/^(think|thought|thinking)$/)) return 'think';
  if (stemmed.match(/^(bring|brought|bringing)$/)) return 'bring';

  // Academic terms
  if (stemmed.match(/^research/)) return 'research';
  if (stemmed.match(/^(stud|study|studied|studying|studies)$/)) return 'study';
  if (stemmed.match(/^(learn|learning|learned)$/)) return 'learn';

  // Handle plurals and common verb forms
  if (stemmed.endsWith('ies') && stemmed.length > 4) {
    return stemmed.slice(0, -3) + 'y';
  } else if (stemmed.endsWith('es') && stemmed.length > 3) {
    return stemmed.slice(0, -2);
  } else if (stemmed.endsWith('s') && !stemmed.endsWith('ss') && stemmed.length > 3) {
    return stemmed.slice(0, -1);
  } else if (stemmed.endsWith('ing') && stemmed.length > 5) {
    // Handle -ing forms, add back 'e' for words like 'baking' -> 'bake'
    const base = stemmed.slice(0, -3);

    // Special cases for words like 'running' -> 'run' (double consonant + ing)
    if (base.length >= 3 &&
        base[base.length-1] === base[base.length-2] &&
        /[bcdfghjklmnpqrstvwxz]/.test(base[base.length-1])) {
      return base.slice(0, -1); // Remove the double consonant
    }

    // Handle words like 'baking' -> 'bake' (consonant + vowel + consonant + ing)
    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(base)) {
      return base + 'e';
    }

    return base;
  } else if (stemmed.endsWith('ed') && stemmed.length > 4) {
    // Handle -ed forms, add back 'e' for words like 'baked' -> 'bake'
    const base = stemmed.slice(0, -2);

    // Special cases for words like 'running' -> 'run' (double consonant + ed)
    if (base.length >= 3 &&
        base[base.length-1] === base[base.length-2] &&
        /[bcdfghjklmnpqrstvwxz]/.test(base[base.length-1])) {
      return base.slice(0, -1); // Remove the double consonant
    }

    // Handle words like 'baked' -> 'bake' (consonant + vowel + consonant + ed)
    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(base)) {
      return base + 'e';
    }

    return base;
  }

  // Remove largest suffix first
  for (const suffix of SUFFIXES.sort((a, b) => b.length - a.length)) {
    if (stemmed.endsWith(suffix) && stemmed.length - suffix.length >= 3) {
      return stemmed.slice(0, -suffix.length);
    }
  }

  return stemmed;
}

/**
 * Dictionary of common synonyms/related terms for query expansion
 */
const SYNONYMS: Record<string, string[]> = {
  'car': ['vehicle', 'automobile', 'transportation'],
  'house': ['home', 'residence', 'building', 'property'],
  'person': ['individual', 'human', 'people'],
  'important': ['critical', 'essential', 'vital', 'key'],
  'large': ['big', 'huge', 'massive', 'sizeable'],
  'small': ['tiny', 'little', 'miniature', 'compact'],
  'create': ['make', 'build', 'develop', 'produce'],
  'find': ['locate', 'discover', 'search', 'uncover'],
  'help': ['assist', 'aid', 'support', 'guide'],
  'problem': ['issue', 'challenge', 'difficulty', 'obstacle'],
  'solution': ['answer', 'resolution', 'fix', 'remedy'],
  'idea': ['concept', 'thought', 'notion', 'plan'],
  'task': ['job', 'assignment', 'project', 'work'],
  'feature': ['functionality', 'capability', 'aspect', 'element'],
  'change': ['modify', 'alter', 'update', 'adjust'],
  'discuss': ['conversation', 'talk', 'chat', 'dialogue', 'mentioned', 'spoke'],
  'understand': ['comprehend', 'grasp', 'realize', 'know', 'perceive'],
  'write': ['compose', 'author', 'document', 'note', 'record', 'type'],
  'think': ['consider', 'believe', 'ponder', 'contemplate', 'reflect'],
  'research': ['investigate', 'study', 'analyze', 'examine', 'explore'],
  'learn': ['discover', 'understand', 'study', 'grasp', 'master'],
  'address': ['location', 'place', 'handle', 'tackle', 'deal with'],
  'business': ['company', 'organization', 'firm', 'enterprise', 'venture'],
  // Add more synonyms as needed
};

/**
 * Expand a query term with related words
 * @param term The term to expand
 * @returns Array of related terms including the original
 */
export function expandTerm(term: string): string[] {
  const stemmed = stemWord(term.toLowerCase());
  const expanded = new Set<string>([term]); // Use a Set to avoid duplicates

  // Add the stemmed version if different from the original
  if (stemmed !== term.toLowerCase()) {
    expanded.add(stemmed);
  }

  // Add synonyms if available
  if (SYNONYMS[stemmed]) {
    SYNONYMS[stemmed].forEach(synonym => expanded.add(synonym));
  } else if (SYNONYMS[term.toLowerCase()]) {
    SYNONYMS[term.toLowerCase()].forEach(synonym => expanded.add(synonym));
  }

  return Array.from(expanded);
}

/**
 * Process user query for better vector search
 * @param query The raw user query
 * @param settings Plugin settings
 * @returns Processed query object with tokens and expanded terms
 */
export function processQuery(query: string, settings: Settings): {
  original: string;
  processed: string;
  tokens: string[];
  expandedTokens: string[];
  phrases: string[];
} {
  const original = query.trim();
  let processed = original.toLowerCase();
  const phrases: string[] = [];

  // Preserve quoted phrases
  processed = processed.replace(/"([^"]*)"/g, (match, phrase) => {
    phrases.push(phrase);
    return `__PHRASE${phrases.length - 1}__`;
  });

  // Tokenize
  let tokens = processed
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(token =>
      token.length >= 2 &&
      (!STOPWORDS.has(token) || PRESERVED_WORDS.has(token)) // Keep important stopwords
    );

  // Restore phrases
  tokens = tokens.map(token => {
    if (token.startsWith('__PHRASE') && token.endsWith('__')) {
      const index = parseInt(token.slice(8, -2));
      return phrases[index];
    }
    return token;
  });

  // Apply stemming to each token
  const stemmedTokens = tokens.map(token => {
    // Don't stem phrases or preserved words
    if (token.includes(' ') || PRESERVED_WORDS.has(token)) {
      return token;
    }
    return stemWord(token);
  });

  // Expand terms for better recall
  const expandedTokens: string[] = [];
  for (const token of stemmedTokens) {
    // Don't expand phrases
    if (token.includes(' ')) {
      expandedTokens.push(token);
      continue;
    }

    const expanded = expandTerm(token);
    expandedTokens.push(...expanded);
  }

  // Remove duplicates from expanded tokens
  const uniqueExpandedTokens = [...new Set(expandedTokens)];

  logDebug(settings, `Query processing: "${original}" → tokens: ${JSON.stringify(stemmedTokens)} → expanded: ${JSON.stringify(uniqueExpandedTokens)}`);

  return {
    original,
    processed: stemmedTokens.join(' '),
    tokens: stemmedTokens,
    expandedTokens: uniqueExpandedTokens,
    phrases
  };
}