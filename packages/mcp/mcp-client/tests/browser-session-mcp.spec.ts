/**
 * End-to-end integration test for connecting a Browser MCP Server with local
 * session/profile reuse via @deepseek-ai/dsh-mcp-client.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { apply } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'

const fixtureServerPath = fileURLToPath(new URL('./browser-fixture-server.ts', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const testToolSignal = new AbortController().signal

let callSeq = 0
function nextCallId(): ToolCallId {
  return ToolCallId(`browser-test-${++callSeq}`)
}

describe('Browser MCP with Local Session Reuse (Scheme B)', () => {
  let ctx: Context
  let tempProfileDir: string

  beforeAll(async () => {
    // 1. Prepare simulated local browser user-data-dir with saved authentication cookie session
    tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chrome-profile-'))
    const defaultDir = path.join(tempProfileDir, 'Default')
    fs.mkdirSync(defaultDir, { recursive: true })

    const cookieData = {
      user: 'liming_engineer',
      tokens: { session_token: 'live_browser_token_778899' },
      cookies: [
        { domain: '.example.com', name: 'AUTH_SESSION', value: 's%3Areal_session_token_xyz', httpOnly: true, secure: true },
        { domain: '.example.com', name: 'USER_ID', value: 'uid_100234', httpOnly: false, secure: false }
      ]
    }
    fs.writeFileSync(path.join(defaultDir, 'Cookies.json'), JSON.stringify(cookieData, null, 2))

    // 2. Initialize Cordis Context with SystemPrompt & ToolRuntime
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    const config: Config = {
      serverName: 'browser',
      transport: 'stdio',
      command: process.execPath,
      args: [fixtureServerPath, `--user-data-dir=${tempProfileDir}`],
      env: {},
      cwd: packageDir,
      toolCallTimeoutMs: 15_000,
      failOnStartupError: true
    }

    // 3. Mount dsh-mcp-client pointing to the browser MCP server with --user-data-dir
    await apply(ctx, config)

    // Allow MCP handshake & tools synchronization
    await new Promise(resolve => setTimeout(resolve, 1000))
  })

  afterAll(async () => {
    if (ctx) {
      await ctx.fiber.dispose()
    }
    if (tempProfileDir && fs.existsSync(tempProfileDir)) {
      fs.rmSync(tempProfileDir, { recursive: true, force: true })
    }
  })

  it('automatically discovers and registers browser tools under the server namespace', () => {
    const schemas = ctx.tools.schemas()
    const toolNames = schemas.map(s => s.name)

    expect(toolNames).toContain('mcp__browser__navigate')
    expect(toolNames).toContain('mcp__browser__get_session_cookies')
  })

  it('retrieves cookies from the persistent local browser profile', async () => {
    const execution = await ctx.tools.execute({
      callId: nextCallId(),
      name: 'mcp__browser__get_session_cookies',
      arguments: { domain: 'example.com' },
      signal: testToolSignal,
    })

    expect(execution.isError).toBe(false)
    expect(execution.content).toBeDefined()
    const content = execution.content[0]
    expect(content.type).toBe('text')

    const parsed = JSON.parse((content as { text: string }).text)
    expect(parsed.domain).toBe('example.com')
    expect(parsed.foundCount).toBe(2)
    expect(parsed.cookies[0].name).toBe('AUTH_SESSION')
    expect(parsed.cookies[0].value).toBe('s%3Areal_session_token_xyz')
  })

  it('navigates with authenticated context using local profile state', async () => {
    const execution = await ctx.tools.execute({
      callId: nextCallId(),
      name: 'mcp__browser__navigate',
      arguments: { url: 'https://app.example.com/dashboard' },
      signal: testToolSignal,
    })

    expect(execution.isError).toBe(false)
    expect(execution.content).toBeDefined()
    const content = execution.content[0]
    expect(content.type).toBe('text')
    const text = (content as { text: string }).text

    expect(text).toContain('Status: 200 OK (Authenticated)')
    expect(text).toContain('User Context: liming_engineer')
    expect(text).toContain('AUTH_SESSION=s%3Areal_session_token_xyz')
    expect(text).toContain('Welcome back, liming_engineer!')
  })
})
