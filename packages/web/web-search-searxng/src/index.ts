/**
 * SearXNG-backed `WebSearchProvider` plugin. It contributes to the `ctx.web`
 * registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-search-searxng
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  SearxngSearchProvider,
  SEARXNG_DEFAULT_BASE_URL,
  SEARXNG_DEFAULT_NUM_RESULTS,
  SEARXNG_DEFAULT_USER_AGENT,
} from './provider.ts'

export {
  SEARXNG_DEFAULT_BASE_URL,
  SEARXNG_DEFAULT_NUM_RESULTS,
  SEARXNG_DEFAULT_USER_AGENT,
  SEARXNG_PROVIDER_ID,
  SearxngSearchProvider,
} from './provider.ts'
export type { SearxngSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills constant defaults). */
export interface Config {
  /** Endpoint base; `/search` is appended and `format=json` is always sent. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
  /** User-Agent header value; defaults to a browser-like UA. */
  userAgent?: string
  /** Optional per-request timeout (ms). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  numResults: z.number().step(1).min(1),
  userAgent: z.string(),
  timeoutMs: z.number().step(1).min(1),
})

/** Register the SearXNG search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new SearxngSearchProvider({
    baseURL: config.baseURL ?? SEARXNG_DEFAULT_BASE_URL,
    numResults: config.numResults ?? SEARXNG_DEFAULT_NUM_RESULTS,
    userAgent: config.userAgent ?? SEARXNG_DEFAULT_USER_AGENT,
    ...config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {},
  }))
}