/**
 * jurisd - Citation service
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * AGLC4-compliant citation parsing, formatting, validation, and normalisation.
 */
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
 * - `found`: the citation was confirmed to exist by the source named in
 *   {@link CitationValidationResult.verifiedBy}. {@link validateCitation}
 *   itself only ever sets `verifiedBy: "austlii"` (AustLII answered 2xx for
 *   the canonical URL); a caller that confirms a blocked check through a
 *   fallback such as Exa sets `verifiedBy: "exa"` and reports AustLII's own
 *   state separately in `sources`.
 * - `not_found`: AustLII answered 404, so the citation is genuinely absent.
 * - `blocked`: AustLII served a Cloudflare challenge (documented `cf-mitigated`
 *   header, or a 403/503 bot-block status). `valid` is false but the citation
 *   was **not** proven absent; callers should try a fallback source.
 * - `unreachable`: no usable answer: a network error or timeout, or any HTTP
 *   status other than 2xx, 404, 403 or 503 (for example 500, 405 or 429).
 *   Again unverified rather than absent; `httpStatus` carries the status when
 *   a response was received.
 * - `invalid`: not a neutral citation, or an unknown court code. No request
 *   was made.
 */
export type CitationValidationStatus = "found" | "not_found" | "blocked" | "unreachable" | "invalid";
/** Which source confirmed a `found` verdict. */
export type CitationVerifier = "austlii" | "exa";
export interface CitationValidationResult {
    valid: boolean;
    /** Distinguishes a definitive "not found" from "could not check". */
    status: CitationValidationStatus;
    /** Set when `status` is `found`: the source that confirmed the citation. */
    verifiedBy?: CitationVerifier;
    /** The HTTP status AustLII answered with, when a response was received. */
    httpStatus?: number;
    canonicalCitation?: string;
    austliiUrl?: string;
    message?: string;
}
/**
 * Structured pinpoint reference for AGLC4 citations.
 *
 * Use `formatPinpointRef` to convert to the correct AGLC4 string fragment.
 */
export type Pinpoint = {
    type: "para";
    n: number;
} | {
    type: "page";
    n: number;
} | {
    type: "paraRange";
    from: number;
    to: number;
} | {
    type: "pageRange";
    from: number;
    to: number;
} | {
    type: "legis";
    ref: string;
};
/** Convert a structured Pinpoint to the AGLC4 string fragment (without leading "at"). */
export declare function formatPinpointRef(p: Pinpoint): string;
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
export declare function formatShortForm(input: ShortFormInput): string;
export declare function parseCitation(text: string): ParsedCitation | null;
export declare function formatAGLC4(info: AGLC4FormatInput): string;
export declare function shortFormAGLC4(title: string, pinpoint?: string): string;
export declare function isValidNeutralCitation(s: string): boolean;
export declare function isValidReportedCitation(s: string): boolean;
export declare function normaliseCitation(s: string): string;
export interface PinpointResult {
    paragraphNumber: number;
    pinpointString: string;
    pageNumber?: number;
    pageString?: string;
}
export interface PinpointQuery {
    paragraphNumber?: number;
    phrase?: string;
}
/**
 * Finds the pinpoint reference for a paragraph in a judgment.
 * Can search by paragraph number or by a phrase appearing in the text.
 */
export declare function generatePinpoint(paragraphs: ParagraphBlock[], query: PinpointQuery): PinpointResult | null;
/**
 * Check whether a neutral citation resolves to a document on AustLII.
 *
 * The result's {@link CitationValidationResult.status} says *why* `valid` is
 * false: only `not_found` means AustLII confirmed the citation is absent.
 * `blocked` (Cloudflare challenge) and `unreachable` mean the check could not
 * be completed, so callers with a fallback discovery source (Exa, the direct
 * citation URL) should consult it rather than report the citation as missing.
 */
export declare function validateCitation(citation: string): Promise<CitationValidationResult>;
//# sourceMappingURL=citation.d.ts.map