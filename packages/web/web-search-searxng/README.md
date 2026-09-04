---
description: "The SearXNG-backed search provider for ctx.web: how deployments mount keyless meta-search with portable snippets, no API key required."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-searxng`, the harness searches the web through a SearXNG JSON API instance and gets keyless, vendor-neutral results with portable snippets. Choose it when a deployment wants free web search without a vendor API key, or wants to control which engines are queried by self-hosting SearXNG. SearXNG returns no generated answer, so results carry no `content` — only citeable sources. A result with no non-blank `content` is dropped, so a call can return fewer sources than requested. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `searxng` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: searxng`.

### When to choose it

Choose this backend when a deployment wants free, keyless web search. The provider is unavailable — and every search call fails with a structured error — when the endpoint base does not parse or the configured result count is not a positive integer.

### Minimal configuration

Load the web service and the provider; every setting has a safe default that points at a public instance.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: searxng
- name: '@deepseek-ai/dsh-web-search-searxng'
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://search.mectov.my.id` | SearXNG instance base; `/search` is appended with `format=json`. An unparseable value makes the provider unavailable |
| `numResults` | `8` | Default result count when a request carries no `maxResults`; must be a positive integer |
| `userAgent` | a desktop browser UA | User-Agent header sent to the instance; public instances often answer JSON only to a browser-like UA |
| `timeoutMs` | (unset) | Optional per-request timeout (ms) |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each SearXNG result maps to a `WebSearchSource`: `url`, `title`, `content` as `snippet`, and `publishedDate` as `publishedAt`; a result with no usable `content` has no portable snippet and is dropped. A request's `maxResults` wins over the configured `numResults` default and is sent to the instance as a cost and latency optimization — the final bound is enforced by the service, which truncates and flags. SearXNG returns no generated answer, so the result carries no `content`.

### Failures and recovery

Each call makes one `GET /search?q=...&format=json` request. Provider failures surface as structured `WebError` codes: HTTP errors, network failures, unparseable or wrong-shape bodies are `WEB_PROVIDER_ERROR`; an aborted request is `WEB_ABORTED`; and HTTP redirects are rejected before the `Location` target is contacted. The model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

Public SearXNG instances are **unreliable**: many answer an Anubis "verifying your browser" challenge page instead of JSON, rate-limit aggressively (HTTP 429), or resolve only in certain networks. In networks that block or poison DNS for public instances (for example CN networks), the harness's Node fetch must route through a reachable proxy — set `NODE_USE_ENV_PROXY=1` in the launch environment so Node honors `HTTP_PROXY`/`HTTPS_PROXY` — or point `baseURL` at a self-hosted instance. For production, self-host SearXNG and set `baseURL` to it.

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider is a thin `WebSearchProvider` over SearXNG's JSON API:

1. `search()` builds `GET {baseURL}/search?q={query}&format=json&results={n}` and sends it with a browser-like `User-Agent` (a real desktop UA keeps the JSON path reachable on Anubis-protected public instances) plus an optional per-request timeout combined with the caller's abort signal.
2. `mapSearxngResult` maps each result to a `WebSearchSource`, trimming the title, treating `content` as the snippet, and mapping `publishedDate` to `publishedAt`; entries with no usable snippet are dropped.
3. `mapSearxngResponse` flattens the envelope into `{ sources, truncated: false }`; the web service owns the final `maxResults` truncation.

The plugin registers the provider into `ctx.web` (its `searchProvider` resolver picks it when configured or sole-usable). The settings namespace `web-search-searxng` accepts the fields above. No runtime invariant is enforced by this package; contracts live at the web seam.

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-web](../../../packages/web/README.md) — the provider-neutral seam this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search`/`web_fetch` tools over the seam.
- The SearXNG [JSON API docs](https://docs.searxng.org/dev/search_api.html) for the wire format.

<a id="model-experience"></a>
## Model Experience

The model calls `web_search({ queries: [...] })` and receives a provider answer (omitted here — SearXNG has none) followed by `Sources:` lines. Each source is `- [title](url)`, optionally with a snippet and date, plus a standing instruction to cite the URLs.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Public instances are unreliable (Anubis challenges, 429 rate limits, DNS blocking) — self-host for production.
- No language/category/safe-search controls are exposed yet; they wait on provider-neutral service fields.
- A result with no `content` is dropped, so a call can return fewer sources than requested.

<a id="dev-note"></a>
## Dev Note

- 25 unit tests cover mapping, availability, request building, and error handling; a live e2e test against a public instance runs under `test:e2e` with `NODE_USE_ENV_PROXY=1` when the network requires a proxy.