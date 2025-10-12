import { describe, it, expect } from "vitest";
import { searchAustLii } from "../services/austlii.js";
import { fetchDocumentText } from "../services/fetcher.js";

/**
 * Real-world non-deterministic test scenarios for AustLII search
 *
 * These tests validate that:
 * 1. Search returns results (content changes over time)
 * 2. Results are properly formatted with required fields
 * 3. Results are filtered correctly (only primary sources)
 * 4. Results are recent (when sorted by date)
 * 5. Document fetching works for returned URLs
 */

describe("Real-world legal search scenarios", () => {
  /**
   * Scenario 1: Negligence and duty of care
   * Common personal injury law search
   */
  it("should find recent cases about negligence and duty of care", async () => {
    const results = await searchAustLii("negligence duty of care", {
      type: "case",
      limit: 5,
    });

    // Should return results
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);

    // All results should be cases
    results.forEach((result) => {
      expect(result.type).toBe("case");
      expect(result.source).toBe("austlii");
      expect(result.title).toBeTruthy();
      expect(result.url).toMatch(/^http/);

      // Should be from case databases only
      expect(result.url).toMatch(/\/cases\//);

      // Should not be journal articles
      expect(result.url).not.toMatch(/\/journals\//);
    });

    // At least one recent result (within last 3 years)
    const currentYear = new Date().getFullYear();
    const recentResults = results.filter(
      (r) => r.year && parseInt(r.year) >= currentYear - 3
    );
    expect(recentResults.length).toBeGreaterThan(0);
  }, 30000);

  /**
   * Scenario 2: Contract law disputes
   * Common commercial law search
   */
  it("should find cases involving contract disputes", async () => {
    const results = await searchAustLii("contract breach damages", {
      type: "case",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    results.forEach((result) => {
      expect(result.type).toBe("case");
      expect(result.url).toMatch(/\/cases\//);
      expect(result.url).not.toMatch(/\/journals\//);

      // Should have proper structure
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("source");
    });
  }, 30000);

  /**
   * Scenario 3: High Court constitutional law
   * Important precedent-setting cases
   */
  it("should find High Court cases on constitutional matters", async () => {
    const results = await searchAustLii("constitutional law separation of powers", {
      type: "case",
      limit: 5,
      jurisdiction: "cth",
    });

    expect(results.length).toBeGreaterThan(0);

    results.forEach((result) => {
      expect(result.type).toBe("case");
      expect(result.url).toMatch(/\/cases\//);

      // Results should have citations when available
      if (result.neutralCitation) {
        expect(result.neutralCitation).toMatch(/\[\d{4}\]/);
      }
    });
  }, 30000);

  /**
   * Scenario 4: Employment law
   * Testing workplace relations cases
   */
  it("should find employment and workplace law cases", async () => {
    const results = await searchAustLii("unfair dismissal", {
      type: "case",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    results.forEach((result) => {
      expect(result.type).toBe("case");
      expect(result.url).toMatch(/\/cases\//);
      expect(result.url).not.toMatch(/\/journals\//);
      expect(result.title).toBeTruthy();
    });
  }, 30000);

  /**
   * Scenario 5: Property and land law
   * Testing property disputes and land rights
   */
  it("should find property and land law cases", async () => {
    const results = await searchAustLii("native title land rights", {
      type: "case",
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    results.forEach((result) => {
      expect(result.type).toBe("case");
      expect(result.url).toMatch(/\/cases\//);
      expect(result.url).not.toMatch(/\/journals\//);
    });

    // Should be able to fetch at least one of the results
    if (results.length > 0 && results[0]) {
      const doc = await fetchDocumentText(results[0].url);

      expect(doc).toBeDefined();
      expect(doc.text).toBeTruthy();
      expect(doc.text.length).toBeGreaterThan(100);
      expect(doc.sourceUrl).toBe(results[0].url);
      expect(doc.contentType).toBeTruthy();
      expect(typeof doc.ocrUsed).toBe("boolean");
    }
  }, 60000); // Longer timeout for fetch
});

describe("Search result quality checks", () => {
  it("should return properly structured results", async () => {
    const results = await searchAustLii("contract breach", {
      type: "case",
      limit: 3,
    });

    expect(results.length).toBeGreaterThan(0);

    results.forEach((result) => {
      // Required fields
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("source");
      expect(result).toHaveProperty("type");

      // Proper types
      expect(typeof result.title).toBe("string");
      expect(typeof result.url).toBe("string");
      expect(result.source).toBe("austlii");

      // URL should be valid
      expect(() => new URL(result.url)).not.toThrow();
    });
  }, 30000);

  it("should filter out journal articles", async () => {
    const results = await searchAustLii("tort law", {
      type: "case",
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);

    // None should be journal articles
    results.forEach((result) => {
      expect(result.url).not.toMatch(/\/journals\//);
    });
  }, 30000);
});
