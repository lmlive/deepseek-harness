import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Request payload for undo operations.
 */
export interface UndoRequest {
  /** Target session identifier. */
  sessionId: SessionId
  /** Event sequence number where the user message started. */
  seq: number
}

/**
 * Outcome of an undo operation.
 */
export interface UndoResult {
  /** Whether the undo operation succeeded. */
  success: boolean
  /**
   * The effective session ID after undo.
   * If a new forked session was created, this contains the child session ID.
   */
  sessionId: SessionId
  /** Newly created session ID if forked. */
  newSessionId?: SessionId
  /** List of workspace relative file paths reverted, modified, or removed during undo. */
  revertedFiles?: string[]
  /** Optional diagnostic message or reason on failure. */
  message?: string
}

/**
 * A captured workspace snapshot at a specific event sequence.
 */
export interface WorkspaceSnapshot {
  readonly sessionId: SessionId
  readonly seq: number
  readonly cwd: string
  readonly timestamp: number
  readonly kind: 'git' | 'fs'
  /**
   * Revert workspace files back to the captured state.
   * @returns List of relative paths modified, restored, or removed.
   */
  revert(): Promise<string[]>
  /**
   * Clean up any temporary files or storage associated with this snapshot.
   */
  dispose(): Promise<void>
}

/**
 * Summary information for a snapshot.
 */
export interface UndoSnapshotSummary {
  sessionId: SessionId
  seq: number
  timestamp: number
  kind: 'git' | 'fs'
}

/**
 * Configuration for the undo plugin.
 */
export interface UndoConfig {
  /** Maximum number of snapshots retained per session. Defaults to 50. */
  maxSnapshotsPerSession?: number
  /** Whether to prefer git snapshots when the workspace is a git repository. Defaults to true. */
  preferGit?: boolean
  /** Directory that stores snapshots across Harness process restarts. */
  persistRoot?: string
}
