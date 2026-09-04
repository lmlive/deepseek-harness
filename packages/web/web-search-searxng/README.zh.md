---
description: "面向 ctx.web 的 SearXNG 搜索提供方：如何挂载免密钥的元搜索引擎，返回可移植摘要，无需 API key。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

[English](README.md) | 中文

## 概要

有了 `dsh-web-search-searxng`，harness 通过 SearXNG JSON API 实例搜索 web，获得免密钥、与厂商无关的可移植结果。选择它：当部署想要免费网页搜索、不依赖厂商 API key，或想通过自建 SearXNG 自行控制查询引擎时。SearXNG 不返回生成式答案，因此结果不携带 `content`，只产出可引用的来源。没有非空白 `content` 的结果会被丢弃，所以一次调用返回的来源可能少于请求数量。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [进一步探索](#进一步探索)
- [模型体验](#模型体验)
- [已知限制与待办](#已知限制与待办)
- [开发备注](#开发备注)

-----

<a id="使用本包"></a>
## 使用本包

在已经加载 web 服务的组合中挂载本提供方；它以 `searxng` 作为搜索提供方注册，因此当它是唯一可用的搜索后端时 `ctx.web.search()` 会自动选中——或用 `searchProvider: searxng` 显式指定。

### 何时选择它

当部署想要免费、免密钥的网页搜索时选择本后端。当端点 base 无法解析或配置的结果数为非正整数时，提供方不可用——每次搜索调用都以结构化错误失败。

### 最小配置

加载 web 服务与提供方；每个字段都有指向公共实例的安全默认值。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: searxng
- name: '@deepseek-ai/dsh-web-search-searxng'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://search.mectov.my.id` | SearXNG 实例 base；追加 `/search` 并带 `format=json`。无法解析时提供方不可用 |
| `numResults` | `8` | 请求未带 `maxResults` 时的默认结果数；须为正整数 |
| `userAgent` | 桌面浏览器 UA | 发送给实例的 User-Agent 头；公共实例常只对浏览器型 UA 返回 JSON |
| `timeoutMs` | （未设） | 可选：每次请求的超时（毫秒） |

生成的[配置目录](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng)是每个接受字段及其 JSDoc 的权威来源。

### 一次搜索返回什么

每个 SearXNG 结果映射为一个 `WebSearchSource`：`url`、`title`、`content` 作为 `snippet`，`publishedDate` 作为 `publishedAt`；没有可用 `content` 的结果因无可移植摘要被丢弃。请求的 `maxResults` 优先于配置的 `numResults` 默认值，并作为成本与延迟优化发送给实例——最终上限由服务强制执行并标记截断。SearXNG 不返回生成式答案，因此结果不携带 `content`。

### 失败与恢复

每次调用发起一个 `GET /search?q=...&format=json` 请求。提供方失败以结构化 `WebError` 代码呈现：HTTP 错误、网络失败、响应体无法解析或结构不符为 `WEB_PROVIDER_ERROR`；请求中止为 `WEB_ABORTED`；HTTP 重定向在访问 `Location` 目标之前被拒绝。面向模型的 `web_search` 工具会在自己的错误包装层内把失败呈现给模型。

公共 SearXNG 实例**并不可靠**：许多返回 Anubis 的「正在验证您的浏览器」挑战页而非 JSON、激进限流（HTTP 429），或在部分网络内无法解析。在屏蔽/污染公共实例 DNS 的网络（例如国内网络）中，harness 的 Node fetch 必须经由可达的代理——在启动环境中设置 `NODE_USE_ENV_PROXY=1` 让 Node 遵守 `HTTP_PROXY`/`HTTPS_PROXY`——或将 `baseURL` 指向自建实例。生产环境建议自建 SearXNG 并把 `baseURL` 指向它。

<a id="理解实现"></a>
## 理解实现

提供方是覆盖在 SearXNG JSON API 之上的轻量 `WebSearchProvider`：

1. `search()` 构造 `GET {baseURL}/search?q={query}&format=json&results={n}`，并以浏览器型 `User-Agent`（真实桌面 UA 让 JSON 路径在受 Anubis 保护的公共实例上可达）加上可选超时（与调用方的 abort 信号合并）发送。
2. `mapSearxngResult` 把每个结果映射为 `WebSearchSource`，修剪标题、把 `content` 作为摘要、把 `publishedDate` 映射为 `publishedAt`；没有可用摘要的条目被丢弃。
3. `mapSearxngResponse` 把信封展平为 `{ sources, truncated: false }`；web 服务拥有最终的 `maxResults` 截断。

插件把提供方注册进 `ctx.web`（配置为唯一可用时由 `searchProvider` 解析器选中）。settings 命名空间 `web-search-searxng` 接受上述字段。本包不强制运行时不变量；契约在 web seam。

-----

<a id="进一步探索"></a>
## 进一步探索

- [dsh-web](../../../packages/web/README.md) — 本提供方注册进的与提供方无关的 seam。
- [dsh-tool-web](../tool-web/README.md) — 基于该 seam 的面向模型 `web_search`/`web_fetch` 工具。
- SearXNG 的 [JSON API 文档](https://docs.searxng.org/dev/search_api.html) 用于 wire 格式。

<a id="模型体验"></a>
## 模型体验

模型调用 `web_search({ queries })`，随后看到可选的提供方答案，后接 `Sources:`——每行一个来源 `- [<title-or-url>](<url>)`，可选附摘要与日期，以及一句固定的引用 URL 指引。

<a id="已知限制与待办"></a>
## 已知限制与待办

- 公共实例不可靠（Anubis 挑战、429 限流、DNS 屏蔽）——生产环境请自建。
- 语言/分类/安全搜索等控制项尚未公开；等待与提供方无关的服务字段。
- 没有 `content` 的结果被丢弃，因此一次调用返回的来源可能少于请求数量。

<a id="开发备注"></a>
## 开发备注

- 25 个单元测试覆盖映射、可用性、请求构造与错误处理；一个针对公共实例的 live e2e 测试在 `test:e2e` 下运行（网络需要代理时配合 `NODE_USE_ENV_PROXY=1`）。