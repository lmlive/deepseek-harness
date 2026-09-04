/**
 * Wire types for the SearXNG JSON API (`GET /search?q=...&format=json`). Types
 * only — no runtime code. SearXNG returns a flat `results[]`; each entry carries
 * a URL, optional title, optional `content` (the snippet), optional
 * `publishedDate`, and metadata about the engines that produced it.
 *
 * @module @deepseek-ai/dsh-web-search-searxng/types
 */

/** One entry of SearXNG's flat `results[]`. */
export interface SearxngResult {
  /** Absolute URL of the result page. */
  url: string
  /** Result title; often present but may be blank. */
  title?: string | null
  /** Search-engine snippet / abstract text; used as the portable snippet. */
  content?: string | null
  /** ISO date when an engine exposes a publication date. */
  publishedDate?: string | null
  /** Engine(s) that surfaced the result (informational; not surfaced upstream). */
  engine?: string | null
  /** Result score/rank (informational; not surfaced upstream). */
  score?: number | null
}

/** SearXNG's JSON search response envelope. */
export interface SearxngSearchResponse {
  /** The echoed query (informational). */
  query?: string
  /** Estimated number of results (informational). */
  number_of_results?: number
  /** The flat result list; absent on some empty/error responses. */
  results?: SearxngResult[]
  /** Any error message SearXNG attached in-band. */
  error?: string
}

/** Best-effort error envelope for non-JSON / gateway error bodies. */
export interface SearxngError {
  error?: string
  message?: string
}