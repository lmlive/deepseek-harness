/**
 * `SearxngSearchProvider`: a `WebSearchProvider` backed by a SearXNG JSON API
 * instance (`GET /search?q=...&format=json`). It maps `content` to `snippet`
 * and `publishedDate` to `publishedAt`, and sends a browser-like User-Agent so
 * Anubis-protected public instances answer JSON instead of a challenge page.
 * SearXNG returns no generated answer, so `content` is omitted.
 * @module @deepseek-ai/dsh-web-search-searxng/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { SearxngError, SearxngResult, SearxngSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/**
 * Default instance. Public SearXNG instances are unstable (many answer an
 * Anubis challenge page instead of JSON, or rate-limit aggressively); this is
 * a currently-working instance that serves browser-like JSON. Prefer a
 * self-hosted instance via `baseURL` for production.
 */
export const SEARXNG_DEFAULT_BASE_URL = 'https://search.mectov.my.id'

/** Default request count when a request carries no `maxResults`. */
export const SEARXNG_DEFAULT_NUM_RESULTS = 8

/**
 * Browser-like User-Agent sent to the instance. SearXNG's anonymous JSON API
 * answers 200+JSON to a browser UA but often 429 / an Anubis challenge page to
 * a bare or bot UA; pinning a real desktop UA keeps the JSON path reachable on
 * public instances. Configurable via `userAgent` for self-hosted instances.
 */
export const SEARXNG_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export interface SearxngSearchProviderOptions {
  /** Endpoint base; `/search` is appended and `format=json` is always sent. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. */
  numResults: number
  /** User-Agent header value; defaults to a browser-like UA. */
  userAgent: string
  /** Optional timeout (ms) per request; undefined leaves the default fetch budget. */
  timeoutMs?: number
}

/**
 * Map one SearXNG result to a normalized source)Skip entries with no usable
 * snippet (`content` blank) — the seam has no other field to derive a snippet
 * from, and inventing one would lie.
 *
 * @param result - one entry of SearXNG's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no snippet.
 */
export function mapSearxngResult(result: SearxngResult): WebSearchSource | undefined {
  const snippet = typeof result.content === 'string' && result.content.trim().length > 0
    ? result.content.trim()
    : undefined
  if (snippet === undefined) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.trim().length > 0 ? { title: result.title.trim() } : {},
    snippet,
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Map a SearXNG response envelope to a normalized search result; snippet-less
 * entries are dropped.
 *
 * @param response - the parsed `GET /search?format=json` response body.
 * @returns the normalized result.
 */
export function mapSearxngResponse(response: SearxngSearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapSearxngResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // SearXNG returns no generated answer, so `content` is omitted. The web
  // service owns the final `maxResults` truncation; `truncated` is false here.
  return { sources, truncated: false }
}

/** The SearXNG-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  constructor(private readonly options: SearxngSearchProviderOptions) {}

  available(): boolean {
    return isValidBaseUrl(this.options.baseURL)
      && isPositiveInteger(this.options.numResults)
      && (this.options.timeoutMs === undefined || isPositiveInteger(this.options.timeoutMs))
      && this.options.userAgent.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const numResults = request.maxResults ?? this.options.numResults
    const url = new URL('/search', this.options.baseURL)
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')
    // Bound results at the instance as a latency/cost optimization; the service
    // still enforces the final cap and flags truncation.
    url.searchParams.set('results', String(numResults))

    const signals: AbortSignal[] = signal !== undefined ? [signal] : []
    if (this.options.timeoutMs !== undefined) signals.push(AbortSignal.timeout(this.options.timeoutMs))
    const init: RequestInit = {
      method: 'GET',
      redirect: 'error',
      headers: {
        'accept': 'application/json',
        'user-agent': this.options.userAgent,
      },
      ...signals.length > 0 ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) } : {},
    }

    let response: Response
    try {
      response = await fetch(url.toString(), init)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`SearXNG search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `SearXNG API error (HTTP ${status})`
      try {
        const parsed = await response.json() as SearxngError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed.
        if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
        // 429 from a public instance usually means rate-limited JSON, not a
        // broken body; keep the status-line message so the model can retry.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as SearxngSearchResponse
      return mapSearxngResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`SearXNG returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to SearXNG (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}