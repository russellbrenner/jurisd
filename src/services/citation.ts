/**
 * jurisd - Citation service
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * AGLC4-compliant citation parsing, formatting, validation, and normalisation.
 */

import axios from "axios";
import {
  NEUTRAL_CITATION_PATTERN,
  REPORTED_CITATION_PATTERNS,
  COURT_TO_AUSTLII_PATH,
  REPORTERS,
} from "../constants.js";
import { isCloudflareBotBlock, isCloudflareChallengeHeader } from "./cloudflare.js";
import type { ParagraphBlock } from "./fetcher.js";

export interface ParsedCitation {
  neutralCitation?: string;
  reportedCitations: string[];
  pinpoint?: string;
}

export interface AGLC4FormatInput {
  title: string;
  neutralCitation?: string;
  reportedCitation?: string;
  /** Free-form pinpoint string, e.g. "[20]", "401", "[64] to [66]". */
  pinpoint?: string;
}

/**
 * How a {@link validateCitation} verdict was reached.
 *
 * - `found`: AustLII answered 2xx for the canonical URL.
 * - `not_found`: AustLII answered 404, so the citation is genuinely absent.
 * - `blocked`: AustLII served a Cloudflare challenge (documented `cf-mitigated`
 *   header, or a 403/503 bot-block status). `valid` is false but the citation
 *   was **not** proven absent; callers should try a fallback source.
 * - `unreachable`: a network error, timeout, or other unexpected HTTP status.
 *   Again unverified rather than absent.
 * - `invalid`: not a neutral citation, or an unknown court code. No request
 *   was made.
 */
export type CitationValidationStatus =
  "found" | "not_found" | "blocked" | "unreachable" | "invalid";

export interface CitationValidationResult {
  valid: boolean;
  /** Distinguishes a definitive "not found" from "could not check". */
  status: CitationValidationStatus;
  canonicalCitation?: string;
  austliiUrl?: string;
  message?: string;
}

/**
 * Structured pinpoint reference for AGLC4 citations.
 *
 * Use `formatPinpointRef` to convert to the correct AGLC4 string fragment.
 */
export type Pinpoint =
  | { type: "para"; n: number } // at [20]
  | { type: "page"; n: number } // at 401
  | { type: "paraRange"; from: number; to: number } // at [64] to [66]
  | { type: "pageRange"; from: number; to: number } // at 401 to 407
  | { type: "legis"; ref: string }; // s 5(2)(a)  reg 12  sch 1

/** Convert a structured Pinpoint to the AGLC4 string fragment (without leading "at"). */
export function formatPinpointRef(p: Pinpoint): string {
  switch (p.type) {
    case "para":
      return `[${p.n}]`;
    case "page":
      return String(p.n);
    case "paraRange":
      return `[${p.from}] to [${p.to}]`;
    case "pageRange":
      return `${p.from} to ${p.to}`;
    case "legis":
      return p.ref;
  }
}

/** Input to `formatShortForm`. */
export interface ShortFormInput {
  /** The abbreviated case name chosen at first reference. */
  title: string;
  pinpoint?: Pinpoint;
  /** "short" = plain short form, "ibid" = Ibid, "subsequent" = title (n X). */
  mode: "short" | "ibid" | "subsequent";
  /** Footnote number of the first citation — required for "subsequent" mode. */
  footnoteRef?: number;
}

/**
 * Format an AGLC4-compliant short-form, Ibid, or subsequent reference.
 *
 * AGLC4 rr 1.4.3–1.4.5: Ibid for back-to-back same-source citations;
 * author/case-name (n X) for later subsequent references.
 */
export function formatShortForm(input: ShortFormInput): string {
  const pin = input.pinpoint ? ` ${formatPinpointRef(input.pinpoint)}` : "";
  switch (input.mode) {
    case "ibid":
      return `Ibid${pin}`;
    case "subsequent": {
      const ref = input.footnoteRef !== undefined ? ` (n ${input.footnoteRef})` : "";
      return `${input.title}${ref}${pin}`;
    }
    case "short":
    default:
      return `${input.title}${pin}`;
  }
}

// Broad pinpoint patterns for parseCitation — most specific first
const PINPOINT_PATTERNS: ReadonlyArray<{ re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { re: /\bat\s+\[(\d+)\]\s+to\s+\[(\d+)\]/, extract: (m) => `[${m[1]!}] to [${m[2]!}]` },
  { re: /\bat\s+(\d+)\s+to\s+(\d+)(?!\])/, extract: (m) => `${m[1]!} to ${m[2]!}` },
  { re: /\bat\s+\[(\d+)\]/, extract: (m) => `[${m[1]!}]` },
  { re: /\bat\s+(\d+)(?!\])/, extract: (m) => m[1]! },
  { re: /\bat\s+((?:ss?|reg|regs?|sch)\s+\S[^,;]*)/, extract: (m) => m[1]!.trim() },
];

export function parseCitation(text: string): ParsedCitation | null {
  const neutralMatch = text.match(NEUTRAL_CITATION_PATTERN);
  const reportedCitations: string[] = [];

  for (const pattern of REPORTED_CITATION_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[3] && Object.prototype.hasOwnProperty.call(REPORTERS, match[3])) {
      reportedCitations.push(match[0]);
    } else if (match && match[3] && /^[A-Z]{2,8}$/.test(match[3])) {
      // Accept uppercase-only reporters even if not in REPORTERS table
      reportedCitations.push(match[0]);
    }
  }

  if (!neutralMatch && reportedCitations.length === 0) {
    return null;
  }

  // Try each pinpoint pattern in priority order
  let pinpoint: string | undefined;
  for (const { re, extract } of PINPOINT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      pinpoint = extract(m);
      break;
    }
  }

  return {
    neutralCitation: neutralMatch?.[0],
    reportedCitations,
    pinpoint,
  };
}

export function formatAGLC4(info: AGLC4FormatInput): string {
  let result = info.title.trim();

  if (info.neutralCitation && !containsCitation(result, info.neutralCitation)) {
    result = result ? `${result} ${info.neutralCitation}` : info.neutralCitation;
  }

  if (info.reportedCitation && !containsCitation(result, info.reportedCitation)) {
    const separator = info.neutralCitation ? ", " : " ";
    result = result ? `${result}${separator}${info.reportedCitation}` : info.reportedCitation;
  }

  if (info.pinpoint) {
    result += ` at ${info.pinpoint}`;
  }

  return result;
}

function containsCitation(text: string, citation: string): boolean {
  const normalisedText = normaliseCitation(text).toLowerCase();
  const normalisedCitation = normaliseCitation(citation).toLowerCase();
  return normalisedCitation.length > 0 && normalisedText.includes(normalisedCitation);
}

export function shortFormAGLC4(title: string, pinpoint?: string): string {
  return pinpoint ? `${title} ${pinpoint}` : title;
}

export function isValidNeutralCitation(s: string): boolean {
  return NEUTRAL_CITATION_PATTERN.test(s);
}

export function isValidReportedCitation(s: string): boolean {
  for (const pattern of REPORTED_CITATION_PATTERNS) {
    const match = s.match(pattern);
    if (match && match[3]) {
      // Accept if known reporter OR all-uppercase (standard abbreviation)
      if (
        Object.prototype.hasOwnProperty.call(REPORTERS, match[3]) ||
        /^[A-Z]{2,8}$/.test(match[3])
      ) {
        return true;
      }
    }
  }
  return false;
}

export function normaliseCitation(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface PinpointResult {
  paragraphNumber: number;
  pinpointString: string; // e.g. "at [2]"
  pageNumber?: number;
  pageString?: string; // e.g. "at 456"
}

export interface PinpointQuery {
  paragraphNumber?: number;
  phrase?: string;
}

/**
 * Finds the pinpoint reference for a paragraph in a judgment.
 * Can search by paragraph number or by a phrase appearing in the text.
 */
export function generatePinpoint(
  paragraphs: ParagraphBlock[],
  query: PinpointQuery,
): PinpointResult | null {
  let para: ParagraphBlock | undefined;

  if (query.paragraphNumber !== undefined) {
    para = paragraphs.find((p) => p.number === query.paragraphNumber);
  } else if (query.phrase) {
    const phraseLower = query.phrase.toLowerCase();
    para = paragraphs.find((p) => p.text.toLowerCase().includes(phraseLower));
  }

  if (!para) return null;

  return {
    paragraphNumber: para.number,
    pinpointString: `at [${para.number}]`,
    pageNumber: para.pageNumber,
    pageString: para.pageNumber !== undefined ? `at ${para.pageNumber}` : undefined,
  };
}

/** Normalise axios-style header values (string | string[] | undefined) to strings. */
function headerRecord(headers: unknown): Record<string, string> | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map(String).join(", ");
  }
  return out;
}

/**
 * Classify an AustLII HEAD response. A Cloudflare challenge is recognised by
 * the documented `cf-mitigated` header or, since a HEAD carries no body to
 * fingerprint, by CF's 403/503 bot-block codes; both are "blocked", never
 * "not found".
 */
function classifyAustliiHead(
  status: number,
  headers: Record<string, string> | undefined,
): Exclude<CitationValidationStatus, "invalid"> {
  if (isCloudflareChallengeHeader(headers) || isCloudflareBotBlock(status)) return "blocked";
  if (status >= 200 && status < 300) return "found";
  if (status === 404) return "not_found";
  return "unreachable";
}

/**
 * Check whether a neutral citation resolves to a document on AustLII.
 *
 * The result's {@link CitationValidationResult.status} says *why* `valid` is
 * false: only `not_found` means AustLII confirmed the citation is absent.
 * `blocked` (Cloudflare challenge) and `unreachable` mean the check could not
 * be completed, so callers with a fallback discovery source (Exa, the direct
 * citation URL) should consult it rather than report the citation as missing.
 */
export async function validateCitation(citation: string): Promise<CitationValidationResult> {
  const normalised = normaliseCitation(citation);
  const match = normalised.match(NEUTRAL_CITATION_PATTERN);
  if (!match) {
    return {
      valid: false,
      status: "invalid",
      message: "Not a recognised neutral citation format",
    };
  }
  const [, year, court, num] = match;
  const path = COURT_TO_AUSTLII_PATH[court!];
  if (!path) {
    return { valid: false, status: "invalid", message: `Unknown court code: ${court}` };
  }
  const url = `https://www.austlii.edu.au/cgi-bin/viewdoc/${path}/${year}/${num}.html`;

  let status: Exclude<CitationValidationStatus, "invalid">;
  try {
    // validateStatus: accept every status so a 403/404/503 is classified here
    // rather than surfacing as a thrown error that loses the headers.
    const response = await axios.head(url, { timeout: 10000, validateStatus: () => true });
    status = classifyAustliiHead(response.status, headerRecord(response.headers));
  } catch (error: unknown) {
    // An HTTP error response that still reached us (e.g. a mocked or
    // interceptor-raised rejection carrying `response`) is classified by its
    // status; anything else (DNS, timeout, reset) is a transport failure.
    const response = (error as { response?: { status?: number; headers?: unknown } }).response;
    status =
      typeof response?.status === "number"
        ? classifyAustliiHead(response.status, headerRecord(response.headers))
        : "unreachable";
  }

  switch (status) {
    case "found":
      return { valid: true, status, canonicalCitation: normalised, austliiUrl: url };
    case "not_found":
      return {
        valid: false,
        status,
        canonicalCitation: normalised,
        message: "Citation not found on AustLII",
        austliiUrl: url,
      };
    case "blocked":
      return {
        valid: false,
        status,
        canonicalCitation: normalised,
        message:
          "AustLII is behind a Cloudflare challenge, so the citation could not be verified " +
          "(it was not proven absent). The canonical URL is deterministic and may still resolve.",
        austliiUrl: url,
      };
    case "unreachable":
      return {
        valid: false,
        status,
        canonicalCitation: normalised,
        message: "AustLII could not be reached, so the citation could not be verified.",
        austliiUrl: url,
      };
  }
}
