/**
 * Minimal Browser MCP Server fixture with persistent user data dir / cookie store support.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as fs from 'node:fs'
import * as path from 'node:path'

const args = process.argv.slice(2)
let userDataDir = ''
for (const arg of args) {
  if (arg.startsWith('--user-data-dir=')) {
    userDataDir = arg.split('=')[1]
  }
}

function getLocalProfileState(dir: string) {
  const profileStateFile = path.join(dir, 'Default', 'Cookies.json')
  if (fs.existsSync(profileStateFile)) {
    try {
      return JSON.parse(fs.readFileSync(profileStateFile, 'utf-8'))
    } catch {
      return {}
    }
  }
  return {
    user: 'authenticated_user_001',
    tokens: { session_token: 'dsh_live_session_cookie_abc123' },
    cookies: [
      { domain: '.example.com', name: 'AUTH_SESSION', value: 's%3A987654321', httpOnly: true, secure: true },
      { domain: '.example.com', name: 'USER_ID', value: 'uid_8848', httpOnly: false, secure: false }
    ]
  }
}

const server = new McpServer(
  { name: 'browser-mcp-server', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
)

// 1. Tool: browser_navigate
server.registerTool('navigate', {
  title: 'Navigate to URL using local browser profile',
  description: 'Navigates to a webpage using the persistent browser context and local login sessions.',
  inputSchema: {
    url: z.string().describe('The URL to navigate to')
  },
}, async ({ url }) => {
  const session = getLocalProfileState(userDataDir)
  const isTargetSite = url.includes('example.com') || url.includes('app.internal')

  if (isTargetSite && session.cookies?.length) {
    const authCookie = session.cookies.find((c: any) => c.name === 'AUTH_SESSION')
    return {
      content: [{
        type: 'text',
        text: `[Page Loaded Successfully: ${url}]\n` +
              `Status: 200 OK (Authenticated)\n` +
              `User Context: ${session.user} (Logged in via local profile: ${userDataDir})\n` +
              `Active Auth Cookie: ${authCookie ? authCookie.name + '=' + authCookie.value : 'None'}\n` +
              `Page Title: Dashboard | Account Settings\n` +
              `Page Content: Welcome back, ${session.user}! Your workspace is active.`
      }]
    }
  }

  return {
    content: [{
      type: 'text',
      text: `[Page Loaded: ${url}]\nStatus: 200 OK (Public content, no specific auth session attached)`
    }]
  }
})

// 2. Tool: get_session_cookies
server.registerTool('get_session_cookies', {
  title: 'Get local session cookies for domain',
  description: 'Retrieves active cookies from the local browser profile for a specific domain.',
  inputSchema: {
    domain: z.string().describe('The target domain to inspect cookies for')
  },
}, async ({ domain }) => {
  const session = getLocalProfileState(userDataDir)
  const matched = (session.cookies || []).filter((c: any) => c.domain.includes(domain))
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        domain,
        userDataDir,
        foundCount: matched.length,
        cookies: matched
      }, null, 2)
    }]
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
