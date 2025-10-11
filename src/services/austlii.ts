import axios from "axios";
import * as cheerio from "cheerio";

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

const AUSTLII_SEARCH_BASE = "https://classic.austlii.edu.au/cgi-bin/sinosrch.cgi";

interface SearchParams {
  query: string;
  meta: string;
  mask_path?: string;
}

function buildSearchParams(query: string, options: SearchOptions): SearchParams {
  // Use /austlii meta which searches all Australian databases
  const meta = "/austlii";
  let maskPath: string | undefined;

  return {
    query,
    meta,
    mask_path: maskPath,
  };
}

export async function searchAustLii(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  try {
    const searchParams = buildSearchParams(query, options);
    const limit = options.limit ?? 10;

    const searchUrl = new URL(AUSTLII_SEARCH_BASE);
    searchUrl.searchParams.set("method", "boolean");
    searchUrl.searchParams.set("query", searchParams.query);
    searchUrl.searchParams.set("meta", searchParams.meta);
    searchUrl.searchParams.set("results", String(limit));
    // Sort by date (reverse chronological) to get recent results
    searchUrl.searchParams.set("view", "date");

    const response = await axios.get(searchUrl.toString(), {
      headers: {
        "User-Agent": "auslaw-mcp/0.1.0 (legal research tool)",
      },
      timeout: 15000,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Parse search results - AustLII returns results in an <OL> ordered list
    $("ol li").each((_, element) => {
      const $li = $(element);
      const $link = $li.find("a").first();
      const title = $link.text().trim();
      let url = $link.attr("href") || "";

      // Make URL absolute if relative
      if (url && !url.startsWith("http")) {
        url = `http://classic.austlii.edu.au${url}`;
      }

      if (title && url) {
        // Always skip journal articles - we only want primary sources
        if (url.includes("/journals/")) {
          return; // Skip journal articles
        }

        // For cases, only include actual case databases
        if (options.type === "case" && !url.includes("/cases/")) {
          return; // Skip non-case results
        }

        // For legislation, only include legislation databases
        if (options.type === "legislation" && !url.includes("/legis/")) {
          return; // Skip non-legislation results
        }

        // Try to extract citation from title
        const citationMatch = title.match(/\[(\d{4})\]\s*([A-Z]+)\s*(\d+)/);
        const neutralCitation = citationMatch ? citationMatch[0] : undefined;
        const year = citationMatch ? citationMatch[1] : undefined;

        // Extract jurisdiction from URL
        const jurisdictionMatch = url.match(/\/au\/cases\/(cth|vic|nsw|qld|sa|wa|tas|nt|act)\//i);
        const jurisdiction = jurisdictionMatch?.[1]?.toLowerCase();

        // Extract summary from <small> tag if present
        const $small = $li.find("small");
        const summary = $small.length > 0 ? $small.text().trim() : undefined;

        results.push({
          title,
          citation: undefined,
          neutralCitation,
          url,
          source: "austlii",
          summary,
          jurisdiction,
          year,
          type: options.type,
        });
      }
    });

    return results.slice(0, limit);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`AustLII search failed: ${error.message}`);
    }
    throw error;
  }
}
