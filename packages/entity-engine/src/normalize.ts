/**
 * Term normalisation for entity candidate matching.
 * Deterministic lexical normalisation only — semantic (embedding) similarity
 * is a separate, later signal. Human review always decides merges.
 */

const STOPWORDS = new Set(["a", "an", "the", "of", "for", "and", "&"]);

/** Lowercase, strip punctuation/hyphens, collapse whitespace, drop stopwords. */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[‐‑–—-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(" ");
}

/**
 * Normalised token set with naive singularisation, so
 * "fire doors fitted" and "fire door fitting" share tokens.
 */
export function tokenSet(term: string): Set<string> {
  const tokens = normalizeTerm(term).split(" ").filter(Boolean);
  return new Set(tokens.map(singularize));
}

/** Ordered, singularised tokens joined without spaces — compound detection. */
function collapse(term: string): string {
  return normalizeTerm(term).split(" ").filter(Boolean).map(singularize).join("");
}

function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Similarity 0..1: exact match once compound spacing is collapsed
 * ("fire door set" vs "fire doorset" → 1), otherwise Jaccard of
 * normalised token sets.
 */
export function tokenSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  if (collapse(a) === collapse(b)) return 1;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}
