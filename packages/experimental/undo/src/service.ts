import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { SnapshotManager } from './snapshot.ts'
import type { UndoConfig, UndoRequest, UndoResult } from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No retained workspace snapshot can satisfy the requested Session sequence. */
    'undo/snapshot-not-found': { readonly sessionId: SessionId; readonly seq: number }
    /** The retained workspace snapshot could not restore its captured files. */
    'undo/revert-failed': { readonly sessionId: SessionId; readonly seq: number }
  }
}

/** Session commands interface (if session-controller is present). */
interface SessionCommandsService {
  fork(request: { sessionId: SessionId; atSeq?: number }): Promise<{ sessionId: SessionId }>
  create(request: { cwd?: string }): Promise<{ sessionId: SessionId }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    undo: UndoService
    sessionCommands?: SessionCommandsService
  }
}

/**
 * Host-side service providing workspace undo and session forking.
 */
export class UndoService extends TypertRemoteService {
  static inject = ['sessions']

  static Config: z<UndoConfig> = z.object({
    maxSnapshotsPerSession: z.number().default(50),
    preferGit: z.boolean().default(true),
  })

  readonly snapshotManager: SnapshotManager
  private readonly restoreReady: Promise<void>

  constructor(ctx: Context, config: UndoConfig = {}) {
    super(ctx, 'undo')
    this.snapshotManager = new SnapshotManager(config)
    this.restoreReady = this.snapshotManager.restore().catch((err) => {
      this.ctx.logger?.warn?.(`[undo] Failed to restore persisted snapshots: ${String(err)}`)
    })

    // Capture workspace snapshot on user message start
    ctx.on('session/event', (session: Session, event) => {
      if (event.type === 'user/message') {
        const cwd = session.header.cwd
        if (cwd) {
          // Asynchronously capture workspace snapshot without blocking event loop
          void this.snapshotManager.createSnapshot(session.id, event.seq, cwd).catch((err) => {
            this.ctx.logger?.warn?.(`[undo] Failed to capture snapshot for session ${session.id} at seq ${String(event.seq)}: ${String(err)}`)
          })
        }
      }
    })

    // Session detachment is not deletion; persisted snapshots remain available.

    // Drop in-memory handles when the plugin is unloaded. Persistent snapshots
    // remain available to the next process and are pruned by retention policy.
    ctx.effect(() => () => {
      this.snapshotManager.close()
    })
  }

  /**
   * Core execution of undo: restore workspace files and fork session at previous event boundary.
   */
  async executeUndo(sessionId: SessionId, seq: number): Promise<UndoResult> {
    await this.restoreReady
    const snapshot = this.snapshotManager.getSnapshot(sessionId, seq)
    if (!snapshot) {
      throw new RemoteError(
        'undo/snapshot-not-found',
        `No workspace snapshot found for session "${sessionId}" at seq ${String(seq)}`,
        { sessionId, seq },
      )
    }

    // 1. Revert workspace files back to pre-turn snapshot state
    let revertedFiles: string[] = []
    try {
      revertedFiles = await snapshot.revert()
    } catch (error) {
      throw new RemoteError(
        'undo/revert-failed',
        `Failed to revert workspace files for session "${sessionId}": ${String(error)}`,
        { sessionId, seq },
      )
    }

    // 2. Find cut boundary before the given message
    const session = this.ctx.sessions.get(sessionId)
    if (!session) {
      throw new RemoteError(
        'session/not-found',
        `Session "${sessionId}" not found in session store`,
        { sessionId },
      )
    }

    const events = session.snapshotEvents()
    // Find the latest completed boundary strictly before the given seq
    // Exclude the turn/start and user/message belonging to this turn
    let boundary: number | undefined
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e && e.seq < seq) {
        // If this event is a turn start for the turn being reverted, keep searching backwards
        if (e.type === 'turn/start') {
          continue
        }
        boundary = e.seq
        break
      }
    }

    // 3. Fork new session or create initial session
    let newSessionId: SessionId = sessionId
    const sessionCommands = this.ctx.get('sessionCommands')

    try {
      if (sessionCommands) {
        if (boundary !== undefined && boundary >= 0) {
          const forked = await sessionCommands.fork({ sessionId, atSeq: boundary })
          newSessionId = forked.sessionId
        } else {
          // If no prefix event exists (reverting first turn), create a fresh session
          const created = await sessionCommands.create({
            ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
          })
          newSessionId = created.sessionId
        }
      } else if (this.ctx.sessions) {
        if (boundary !== undefined && boundary >= 0) {
          const child = this.ctx.sessions.fork(session, SessionSeq(boundary))
          newSessionId = child.id
        } else {
          const child = this.ctx.sessions.create(undefined, {
            meta: session.header.cwd ? { cwd: session.header.cwd } : {},
          })
          newSessionId = child.id
        }
      }
    } catch (error) {
      // Fork error does not invalidate successful file rollback
      return {
        success: true,
        sessionId,
        revertedFiles,
        message: `Files reverted, but session fork failed: ${String(error)}`,
      }
    }

    return {
      success: true,
      sessionId: newSessionId,
      newSessionId,
      revertedFiles,
    }
  }

  /**
   * Remote method accepting an UndoRequest object { sessionId, seq }.
   */
  @Remote('undo')
  async undo(request: UndoRequest): Promise<UndoResult> {
    if (!request || !request.sessionId || typeof request.seq !== 'number') {
      throw new RemoteError('gateway/bad-request', 'undo requires sessionId and seq', {})
    }
    return this.executeUndo(request.sessionId, request.seq)
  }

  /**
   * Remote method accepting positional (sessionId, seq) parameters.
   */
  @Remote('revert')
  async revert(sessionId: SessionId, seq: number): Promise<UndoResult> {
    if (!sessionId || typeof seq !== 'number') {
      throw new RemoteError('gateway/bad-request', 'revert requires sessionId and seq', {})
    }
    return this.executeUndo(sessionId, seq)
  }
}
