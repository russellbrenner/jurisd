export interface SearchResult {
  title: string;
  citation?: string;
  neutralCitation?: string;
  url: string;
  source: "austlii";
  summary?: string;
  jurisdiction?: string;
  year?: string;
  type: "case" | "legislation";
}

export interface SearchOptions {
  jurisdiction?: "cth" | "vic" | "federal" | "other";
  limit?: number;
  type: "case" | "legislation";
}

export async function searchAustLii(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  // TODO: Implement AustLII search parser
  void query;
  void options;
  return [];
}
