import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { UndoService } from '../src/service.ts'

describe('UndoService', () => {
  let ctx: Context
  let tempWorkspace: string
  const cleanups: Array<() => Promise<void>> = []

  beforeEach(async () => {
    tempWorkspace = await mkdtemp(join(tmpdir(), 'dsh-undo-svc-test-'))
    ctx = new Context()
    cleanups.push(async () => {
      await ctx.fiber.dispose()
      await rm(tempWorkspace, { recursive: true, force: true }).catch(() => {})
    })
    await ctx.plugin(SessionStore)
  })

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    cleanups.length = 0
  })

  it('automatically snapshots on user/message and performs undo with session fork', async () => {
    await ctx.plugin(UndoService, { preferGit: false })
    const fileA = join(tempWorkspace, 'hello.txt')
    await writeFile(fileA, 'initial text')

    // Create session with working directory
    const session = ctx.sessions.create(SessionId('test-sess-1'), {
      meta: { cwd: tempWorkspace },
    })

    // Turn 1 start
    session.append('turn/start', { turn: 1, attempt: 1 })
    // User message (seq: 1)
    const userMsgEvent = session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'Please modify hello.txt' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )
    expect(userMsgEvent.seq).toBe(1)

    // Wait slightly for async snapshot to complete
    await new Promise(resolve => setTimeout(resolve, 50))

    // Agent executes tool and modifies file
    await writeFile(fileA, 'modified by agent during turn 1')
    const fileNew = join(tempWorkspace, 'generated.txt')
    await writeFile(fileNew, 'brand new file created by agent')

    // Complete Turn 1
    session.append('turn/end', { turn: 1, reason: 'completed' })

    // Execute undo for user message at seq 1
    const result = await ctx.undo.undo({ sessionId: session.id, seq: userMsgEvent.seq })
    expect(result.success).toBe(true)
    expect(result.revertedFiles).toContain('hello.txt')
    expect(result.revertedFiles).toContain('generated.txt')

    // Workspace files should be restored
    expect(await readFile(fileA, 'utf-8')).toBe('initial text')
    await expect(readFile(fileNew, 'utf-8')).rejects.toThrow()

    // A child session should have been created
    expect(result.newSessionId).toBeDefined()
    expect(result.newSessionId).not.toBe(session.id)

    const childSession = ctx.sessions.get(result.newSessionId!)
    expect(childSession).toBeDefined()
    expect(childSession?.header.cwd).toBe(tempWorkspace)
  })

  it('supports revert(sessionId, seq) positional RPC method', async () => {
    await ctx.plugin(UndoService, { preferGit: false })
    const fileA = join(tempWorkspace, 'config.json')
    await writeFile(fileA, '{"version": 1}')

    const session = ctx.sessions.create(SessionId('test-sess-2'), {
      meta: { cwd: tempWorkspace },
    })

    session.append('turn/start', { turn: 1, attempt: 1 })
    const userMsg = session.append(
      'user/message',
      createUserMessage({ content: [{ type: 'text', text: 'Change config' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' },
    )

    await new Promise(resolve => setTimeout(resolve, 50))

    // Modify file
    await writeFile(fileA, '{"version": 2}')

    // Call revert with positional arguments
    const result = await ctx.undo.revert(session.id, userMsg.seq)
    expect(result.success).toBe(true)
    expect(await readFile(fileA, 'utf-8')).toBe('{"version": 1}')
    expect(result.revertedFiles).toContain('config.json')
  })

  it('throws RemoteError if snapshot is not found', async () => {
    await ctx.plugin(UndoService, { preferGit: false })
    const session = ctx.sessions.create(SessionId('test-sess-3'), {
      meta: { cwd: tempWorkspace },
    })

    await expect(ctx.undo.undo({ sessionId: session.id, seq: 999 })).rejects.toMatchObject({
      name: 'RemoteError',
      code: 'undo/snapshot-not-found',
    })
  })

  it('rejects invalid arguments with gateway/bad-request', async () => {
    await ctx.plugin(UndoService, { preferGit: false })
    await expect(ctx.undo.undo({} as never)).rejects.toMatchObject({
      name: 'RemoteError',
      code: 'gateway/bad-request',
    })
    await expect(ctx.undo.revert('' as never, undefined as never)).rejects.toMatchObject({
      name: 'RemoteError',
      code: 'gateway/bad-request',
    })
  })
})
