/**
 * jurisd - Citation service
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * AGLC4-compliant citation parsing, formatting, validation, and normalisation.
 */
import axios from "axios";
import { NEUTRAL_CITATION_PATTERN, REPORTED_CITATION_PATTERNS, COURT_TO_AUSTLII_PATH, REPORTERS, } from "../constants.js";
import { isCloudflareBotBlock, isCloudflareChallengeHeader } from "./cloudflare.js";
/** Convert a structured Pinpoint to the AGLC4 string fragment (without leading "at"). */
export function formatPinpointRef(p) {
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
/**
 * Format an AGLC4-compliant short-form, Ibid, or subsequent reference.
 *
 * AGLC4 rr 1.4.3–1.4.5: Ibid for back-to-back same-source citations;
 * author/case-name (n X) for later subsequent references.
 */
export function formatShortForm(input) {
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
const PINPOINT_PATTERNS = [
    { re: /\bat\s+\[(\d+)\]\s+to\s+\[(\d+)\]/, extract: (m) => `[${m[1]}] to [${m[2]}]` },
    { re: /\bat\s+(\d+)\s+to\s+(\d+)(?!\])/, extract: (m) => `${m[1]} to ${m[2]}` },
    { re: /\bat\s+\[(\d+)\]/, extract: (m) => `[${m[1]}]` },
    { re: /\bat\s+(\d+)(?!\])/, extract: (m) => m[1] },
    { re: /\bat\s+((?:ss?|reg|regs?|sch)\s+\S[^,;]*)/, extract: (m) => m[1].trim() },
];
export function parseCitation(text) {
    const neutralMatch = text.match(NEUTRAL_CITATION_PATTERN);
    const reportedCitations = [];
    for (const pattern of REPORTED_CITATION_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[3] && Object.prototype.hasOwnProperty.call(REPORTERS, match[3])) {
            reportedCitations.push(match[0]);
        }
        else if (match && match[3] && /^[A-Z]{2,8}$/.test(match[3])) {
            // Accept uppercase-only reporters even if not in REPORTERS table
            reportedCitations.push(match[0]);
        }
    }
    if (!neutralMatch && reportedCitations.length === 0) {
        return null;
    }
    // Try each pinpoint pattern in priority order
    let pinpoint;
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
export function formatAGLC4(info) {
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
function containsCitation(text, citation) {
    const normalisedText = normaliseCitation(text).toLowerCase();
    const normalisedCitation = normaliseCitation(citation).toLowerCase();
    return normalisedCitation.length > 0 && normalisedText.includes(normalisedCitation);
}
export function shortFormAGLC4(title, pinpoint) {
    return pinpoint ? `${title} ${pinpoint}` : title;
}
export function isValidNeutralCitation(s) {
    return NEUTRAL_CITATION_PATTERN.test(s);
}
export function isValidReportedCitation(s) {
    for (const pattern of REPORTED_CITATION_PATTERNS) {
        const match = s.match(pattern);
        if (match && match[3]) {
            // Accept if known reporter OR all-uppercase (standard abbreviation)
            if (Object.prototype.hasOwnProperty.call(REPORTERS, match[3]) ||
                /^[A-Z]{2,8}$/.test(match[3])) {
                return true;
            }
        }
    }
    return false;
}
export function normaliseCitation(s) {
    return s.replace(/\s+/g, " ").trim();
}
/**
 * Finds the pinpoint reference for a paragraph in a judgment.
 * Can search by paragraph number or by a phrase appearing in the text.
 */
export function generatePinpoint(paragraphs, query) {
    let para;
    if (query.paragraphNumber !== undefined) {
        para = paragraphs.find((p) => p.number === query.paragraphNumber);
    }
    else if (query.phrase) {
        const phraseLower = query.phrase.toLowerCase();
        para = paragraphs.find((p) => p.text.toLowerCase().includes(phraseLower));
    }
    if (!para)
        return null;
    return {
        paragraphNumber: para.number,
        pinpointString: `at [${para.number}]`,
        pageNumber: para.pageNumber,
        pageString: para.pageNumber !== undefined ? `at ${para.pageNumber}` : undefined,
    };
}
/** Normalise axios-style header values (string | string[] | undefined) to strings. */
function headerRecord(headers) {
    if (typeof headers !== "object" || headers === null)
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string")
            out[key] = value;
        else if (Array.isArray(value))
            out[key] = value.map(String).join(", ");
    }
    return out;
}
/**
 * Classify an AustLII HEAD response. A Cloudflare challenge is recognised by
 * the documented `cf-mitigated` header or, since a HEAD carries no body to
 * fingerprint, by CF's 403/503 bot-block codes; both are "blocked", never
 * "not found".
 */
function classifyAustliiHead(status, headers) {
    if (isCloudflareChallengeHeader(headers) || isCloudflareBotBlock(status))
        return "blocked";
    if (status >= 200 && status < 300)
        return "found";
    if (status === 404)
        return "not_found";
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
export async function validateCitation(citation) {
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
    const path = COURT_TO_AUSTLII_PATH[court];
    if (!path) {
        return { valid: false, status: "invalid", message: `Unknown court code: ${court}` };
    }
    const url = `https://www.austlii.edu.au/cgi-bin/viewdoc/${path}/${year}/${num}.html`;
    let status;
    let httpStatus;
    try {
        // validateStatus: accept every status so a 403/404/503 is classified here
        // rather than surfacing as a thrown error that loses the headers.
        const response = await axios.head(url, { timeout: 10000, validateStatus: () => true });
        httpStatus = response.status;
        status = classifyAustliiHead(response.status, headerRecord(response.headers));
    }
    catch (error) {
        // An HTTP error response that still reached us (e.g. a mocked or
        // interceptor-raised rejection carrying `response`) is classified by its
        // status; anything else (DNS, timeout, reset) is a transport failure.
        const response = error.response;
        if (typeof response?.status === "number") {
            httpStatus = response.status;
            status = classifyAustliiHead(response.status, headerRecord(response.headers));
        }
        else {
            status = "unreachable";
        }
    }
    const base = {
        status,
        canonicalCitation: normalised,
        austliiUrl: url,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
    switch (status) {
        case "found":
            return { valid: true, verifiedBy: "austlii", ...base };
        case "not_found":
            return { valid: false, message: "Citation not found on AustLII", ...base };
        case "blocked":
            return {
                valid: false,
                message: "AustLII is behind a Cloudflare challenge, so the citation could not be verified " +
                    "(it was not proven absent). The canonical URL is deterministic and may still resolve.",
                ...base,
            };
        case "unreachable":
            return {
                valid: false,
                message: httpStatus !== undefined
                    ? `AustLII answered HTTP ${httpStatus}, so the citation could not be verified ` +
                        "(it was not proven absent)."
                    : "AustLII could not be reached (network error or timeout), so the citation " +
                        "could not be verified (it was not proven absent).",
                ...base,
            };
    }
}
//# sourceMappingURL=citation.js.map