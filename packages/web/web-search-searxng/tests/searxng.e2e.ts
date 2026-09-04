import { describe, expect, it } from 'vitest'
import {
  SearxngSearchProvider,
  SEARXNG_DEFAULT_BASE_URL,
  SEARXNG_DEFAULT_NUM_RESULTS,
  SEARXNG_DEFAULT_USER_AGENT,
} from '@deepseek-ai/dsh-web-search-searxng'

/**
 * Real-API smoke for the SearXNG search provider against a live public
 * instance. Always runs (public SearXNG instances need no key). Pinned to a
 * known-working instance by default; override with $SEARXNG_BASE_URL for a
 * self-hosted or different instance.
 */
const baseURL = process.env.SEARXNG_BASE_URL ?? SEARXNG_DEFAULT_BASE_URL

describe('SearxngSearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new SearxngSearchProvider({
      baseURL,
      numResults: SEARXNG_DEFAULT_NUM_RESULTS,
      userAgent: SEARXNG_DEFAULT_USER_AGENT,
      timeoutMs: 15_000,
    })
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) {
      expect(source.url).toMatch(/^https?:\/\//)
      expect(source.snippet?.length).toBeGreaterThan(0)
    }
  }, 30_000)
})