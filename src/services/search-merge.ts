import type { SearchResult } from "./austlii.js";

/**
 * Deduplicate AustLII case search results, keying on neutral citation
 * (falling back to URL) so repeated hits collapse to a single entry.
 */
export function mergeCaseSearchResults(
  austliiResults: SearchResult[],
  limit?: number,
): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const result of austliiResults) {
    const key = result.neutralCitation ?? result.url;
    if (!seen.has(key)) {
      seen.set(key, result);
    }
  }
  const merged = [...seen.values()];
  return limit ? merged.slice(0, limit) : merged;
}
