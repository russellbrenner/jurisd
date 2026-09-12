/**
 * jurisd - Custom error classes
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Provides structured error types for different failure modes.
 */
import { config } from "./config.js";
/**
 * Error thrown when an AustLII search or API call fails.
 */
export class AustLiiError extends Error {
    statusCode;
    cause;
    constructor(message, statusCode, cause) {
        super(message);
        this.statusCode = statusCode;
        this.cause = cause;
        this.name = "AustLiiError";
    }
}
export class CloudflareBlockedError extends AustLiiError {
    resourceUrl;
    fallbackTried;
    constructor(resourceUrl, fallbackTried, options = {}) {
        super(CloudflareBlockedError.buildMessage(resourceUrl, fallbackTried, options.exaConfigured ?? Boolean(config.exa?.apiKey)), 403);
        this.resourceUrl = resourceUrl;
        this.fallbackTried = fallbackTried;
        this.name = "CloudflareBlockedError";
    }
    /**
     * Builds the actionable, secret-free guidance message. Kept static so it can
     * run before `super()` completes.
     */
    static buildMessage(resourceUrl, fallbackTried, exaConfigured) {
        const fallbackClause = fallbackTried
            ? ", and the document was not in the Open Australian Legal Corpus fallback"
            : "";
        const exaClause = exaConfigured
            ? "EXA_API_KEY is configured, but Exa search discovery did not recover this request " +
                "(it covers search, not direct document fetch, and its index is not exhaustive). "
            : "Configure EXA_API_KEY (Exa search discovery returns canonical austlii.edu.au URLs). ";
        return (`AustLII is behind a Cloudflare challenge and cannot be accessed directly ` +
            `(${resourceUrl})${fallbackClause}. Direct AustLII search and fetch are ` +
            `unavailable without a working fallback source. ${exaClause}` +
            "Advanced: AUSTLII_CF_CLEARANCE from a solved browser session.");
    }
}
/**
 * Error thrown when a network request fails (fetch, axios, etc.).
 */
export class NetworkError extends Error {
    url;
    cause;
    constructor(message, url, cause) {
        super(message);
        this.url = url;
        this.cause = cause;
        this.name = "NetworkError";
    }
}
/**
 * Error thrown when an HTTP response is reachable but not successful after any
 * domain-specific challenge handling has run.
 */
export class HttpStatusError extends NetworkError {
    url;
    statusCode;
    constructor(url, statusCode) {
        super(`HTTP ${statusCode} fetching ${url}`, url);
        this.url = url;
        this.statusCode = statusCode;
        this.name = "HttpStatusError";
    }
}
/**
 * Error thrown when parsing HTML or other response content fails.
 */
export class ParseError extends Error {
    content;
    cause;
    constructor(message, content, cause) {
        super(message);
        this.content = content;
        this.cause = cause;
        this.name = "ParseError";
    }
}
//# sourceMappingURL=errors.js.map