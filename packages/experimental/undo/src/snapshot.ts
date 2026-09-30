import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { UndoConfig, WorkspaceSnapshot } from './types.ts'

const execFileAsync = promisify(execFile)

/** Standard directories skipped during workspace snapshotting. */
export const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '.dsh',
  '.dsh-build',
  '.pnpm-store',
  '.cache',
  'coverage',
  '.gradle',
])

/**
 * Scan directory recursively and yield relative paths of all regular files.
 */
async function collectFiles(
  dir: string,
  baseDir: string = dir,
  excludedDirs: ReadonlySet<string> = DEFAULT_EXCLUDED_DIRS,
): Promise<string[]> {
  const result: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) {
        const subFiles = await collectFiles(fullPath, baseDir, excludedDirs)
        result.push(...subFiles)
      }
    } else if (entry.isFile()) {
      const relPath = relative(baseDir, fullPath)
      result.push(relPath)
    }
  }
  return result
}

/**
 * Fast comparison of two files by byte content.
 */
async function filesMatch(fileA: string, fileB: string): Promise<boolean> {
  try {
    const [statA, statB] = await Promise.all([stat(fileA), stat(fileB)])
    if (statA.size !== statB.size) return false
    const [bufA, bufB] = await Promise.all([readFile(fileA), readFile(fileB)])
    return bufA.equals(bufB)
  } catch {
    return false
  }
}

interface SnapshotMeta {
  version: 1
  kind: 'git' | 'fs'
  sessionId: string
  seq: number
  cwd: string
  timestamp: number
  scratchDir: string
  capturedFiles: string[]
  treeOid?: string
}

/**
 * Pure file-system based workspace snapshot.
 * Copies files into an isolated scratch directory.
 */
export class FsWorkspaceSnapshot implements WorkspaceSnapshot {
  readonly kind = 'fs' as const

  constructor(
    readonly sessionId: SessionId,
    readonly seq: number,
    readonly cwd: string,
    readonly timestamp: number,
    private readonly scratchDir: string,
    private readonly capturedFiles: Set<string>,
  ) {}

  toMeta(): SnapshotMeta {
    return {
      version: 1,
      kind: this.kind,
      sessionId: this.sessionId,
      seq: this.seq,
      cwd: this.cwd,
      timestamp: this.timestamp,
      scratchDir: this.scratchDir,
      capturedFiles: [...this.capturedFiles],
    }
  }

  static fromMeta(meta: SnapshotMeta): FsWorkspaceSnapshot {
    return new FsWorkspaceSnapshot(
      meta.sessionId as SessionId,
      meta.seq,
      meta.cwd,
      meta.timestamp,
      meta.scratchDir,
      new Set(meta.capturedFiles),
    )
  }

  static async capture(
    sessionId: SessionId,
    seq: number,
    cwd: string,
    tempRoot = tmpdir(),
  ): Promise<FsWorkspaceSnapshot> {
    const scratchDir = await mkdtemp(join(tempRoot, `dsh-snap-fs-${sessionId}-${seq}-`))
    const files = await collectFiles(cwd)
    const capturedFiles = new Set<string>()

    for (const relPath of files) {
      const src = join(cwd, relPath)
      const dst = join(scratchDir, relPath)
      try {
        await mkdir(dirname(dst), { recursive: true })
        await copyFile(src, dst)
        capturedFiles.add(relPath)
      } catch {
        // Skip unreadable files
      }
    }

    return new FsWorkspaceSnapshot(sessionId, seq, cwd, Date.now(), scratchDir, capturedFiles)
  }

  async revert(): Promise<string[]> {
    const reverted: string[] = []
    const currentFiles = await collectFiles(this.cwd)

    // 1. Delete files that exist now but did not exist in the snapshot
    for (const file of currentFiles) {
      if (!this.capturedFiles.has(file)) {
        try {
          await rm(join(this.cwd, file), { force: true })
          reverted.push(file)
        } catch {
          // Ignore removal failure
        }
      }
    }

    // 2. Restore files from the snapshot that are missing or modified
    for (const file of this.capturedFiles) {
      const snapFile = join(this.scratchDir, file)
      const targetFile = join(this.cwd, file)
      const match = await filesMatch(snapFile, targetFile)
      if (!match) {
        try {
          await mkdir(dirname(targetFile), { recursive: true })
          await copyFile(snapFile, targetFile)
          reverted.push(file)
        } catch {
          // Ignore copy failure
        }
      }
    }

    return reverted
  }

  async dispose(): Promise<void> {
    try {
      await rm(this.scratchDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Git-based workspace snapshot.
 * Uses a private index to write a tree object without mutating the user's git index or refs.
 */
export class GitWorkspaceSnapshot implements WorkspaceSnapshot {
  readonly kind = 'git' as const

  constructor(
    readonly sessionId: SessionId,
    readonly seq: number,
    readonly cwd: string,
    readonly timestamp: number,
    private readonly treeOid: string,
    private readonly scratchDir: string,
    private readonly capturedFiles: Set<string>,
  ) {}

  toMeta(): SnapshotMeta {
    return {
      version: 1,
      kind: this.kind,
      sessionId: this.sessionId,
      seq: this.seq,
      cwd: this.cwd,
      timestamp: this.timestamp,
      scratchDir: this.scratchDir,
      capturedFiles: [...this.capturedFiles],
      treeOid: this.treeOid,
    }
  }

  static async fromMeta(meta: SnapshotMeta): Promise<GitWorkspaceSnapshot | undefined> {
    if (!meta.treeOid) return undefined
    try {
      await stat(meta.scratchDir)
      await execFileAsync('git', ['cat-file', '-e', `${meta.treeOid}^{tree}`], { cwd: meta.cwd })
    } catch {
      return undefined
    }
    return new GitWorkspaceSnapshot(
      meta.sessionId as SessionId,
      meta.seq,
      meta.cwd,
      meta.timestamp,
      meta.treeOid,
      meta.scratchDir,
      new Set(meta.capturedFiles),
    )
  }

  static async isGitRepo(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd })
      return stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  static async capture(
    sessionId: SessionId,
    seq: number,
    cwd: string,
    tempRoot = tmpdir(),
  ): Promise<GitWorkspaceSnapshot | null> {
    if (!await GitWorkspaceSnapshot.isGitRepo(cwd)) return null

    const scratchDir = await mkdtemp(join(tempRoot, `dsh-snap-git-${sessionId}-${seq}-`))
    const indexFile = join(scratchDir, 'index')

    try {
      // Seed index from repository index if available
      try {
        const { stdout: gitDir } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd })
        const resolvedGitDir = resolve(cwd, gitDir.trim())
        await copyFile(join(resolvedGitDir, 'index'), indexFile).catch(() => {})
      } catch {
        // Fresh or unseeded index
      }

      const env = { ...process.env, GIT_INDEX_FILE: indexFile }

      // Stage all working tree files into the private index
      await execFileAsync('git', ['add', '--all', '--ignore-errors'], { cwd, env })

      // Write tree object
      const { stdout: treeStdout } = await execFileAsync('git', ['write-tree'], { cwd, env })
      const treeOid = treeStdout.trim()

      // List captured files
      const { stdout: lsStdout } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', treeOid], { cwd, env })
      const capturedFiles = new Set(lsStdout.split('\n').filter(Boolean))

      return new GitWorkspaceSnapshot(sessionId, seq, cwd, Date.now(), treeOid, scratchDir, capturedFiles)
    } catch {
      // Clean up scratchDir on failure
      await rm(scratchDir, { recursive: true, force: true }).catch(() => {})
      return null
    }
  }

  async revert(): Promise<string[]> {
    const reverted: string[] = []
    const indexFile = join(this.scratchDir, 'restore-index')
    const env = { ...process.env, GIT_INDEX_FILE: indexFile }

    try {
      // 1. Read the snapshot tree into our restore index
      await execFileAsync('git', ['read-tree', this.treeOid], { cwd: this.cwd, env })

      // 2. Identify files in the current work tree to see what was added since snapshot
      const currentFiles = await collectFiles(this.cwd)
      for (const file of currentFiles) {
        if (!this.capturedFiles.has(file)) {
          try {
            await rm(join(this.cwd, file), { force: true })
            reverted.push(file)
          } catch {
            // Ignore removal error
          }
        }
      }

      // 3. Checkout all files from the snapshot tree to restore modified / deleted files
      await execFileAsync('git', ['checkout-index', '-a', '-f'], { cwd: this.cwd, env })

      // 4. Record any files from the snapshot that were restored
      for (const file of this.capturedFiles) {
        if (!reverted.includes(file)) {
          reverted.push(file)
        }
      }
    } catch {
      // If git checkout-index failed, fallback to file-by-file cat-file if needed
    } finally {
      await rm(indexFile, { force: true }).catch(() => {})
    }

    return reverted
  }

  async dispose(): Promise<void> {
    try {
      await rm(this.scratchDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Manages snapshot lifecycles per session and sequence.
 */
export class SnapshotManager {
  private readonly snapshots = new Map<SessionId, Map<number, WorkspaceSnapshot>>()
  private readonly maxSnapshots: number
  private readonly preferGit: boolean
  private readonly persistRoot: string

  constructor(config: UndoConfig = {}) {
    this.maxSnapshots = config.maxSnapshotsPerSession ?? 50
    this.preferGit = config.preferGit ?? true
    const dshHome = process.env['DSH_HOME']?.trim()
    this.persistRoot = config.persistRoot ?? join(dshHome || join(homedir(), '.dsh'), 'undo-snapshots')
  }

  private snapshotDir(sessionId: SessionId, seq: number): string {
    return join(this.persistRoot, sessionId, String(seq))
  }

  private async persist(snapshot: FsWorkspaceSnapshot | GitWorkspaceSnapshot): Promise<void> {
    const meta = snapshot.toMeta()
    const dir = this.snapshotDir(snapshot.sessionId, snapshot.seq)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'meta.json'), `${JSON.stringify(meta)}\n`, 'utf8')
  }

  private remember(snapshot: WorkspaceSnapshot): void {
    let sessionMap = this.snapshots.get(snapshot.sessionId)
    if (!sessionMap) {
      sessionMap = new Map()
      this.snapshots.set(snapshot.sessionId, sessionMap)
    }
    sessionMap.set(snapshot.seq, snapshot)
  }

  /** Restore valid snapshots persisted by an earlier Harness process. */
  async restore(): Promise<void> {
    let sessions
    try {
      sessions = await readdir(this.persistRoot, { withFileTypes: true })
    } catch {
      return
    }
    for (const sessionEntry of sessions) {
      if (!sessionEntry.isDirectory()) continue
      const sessionDir = join(this.persistRoot, sessionEntry.name)
      let seqEntries
      try {
        seqEntries = await readdir(sessionDir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const seqEntry of seqEntries) {
        if (!seqEntry.isDirectory()) continue
        const persistedDir = join(sessionDir, seqEntry.name)
        try {
          const meta = JSON.parse(await readFile(join(persistedDir, 'meta.json'), 'utf8')) as SnapshotMeta
          if (meta.version !== 1 || meta.sessionId !== sessionEntry.name || String(meta.seq) !== seqEntry.name) {
            throw new Error('invalid snapshot metadata')
          }
          let snapshot: WorkspaceSnapshot | undefined
          if (meta.kind === 'fs') {
            await stat(meta.scratchDir)
            snapshot = FsWorkspaceSnapshot.fromMeta(meta)
          } else if (meta.kind === 'git') {
            snapshot = await GitWorkspaceSnapshot.fromMeta(meta)
          }
          if (!snapshot) throw new Error('snapshot backing data is unavailable')
          this.remember(snapshot)
        } catch {
          await rm(persistedDir, { recursive: true, force: true })
        }
      }
    }
  }

  /**
   * Capture a snapshot of cwd at seq for a given session.
   */
  async createSnapshot(
    sessionId: SessionId,
    seq: number,
    cwd: string,
  ): Promise<WorkspaceSnapshot> {
    let sessionMap = this.snapshots.get(sessionId)
    if (!sessionMap) {
      sessionMap = new Map()
      this.snapshots.set(sessionId, sessionMap)
    }

    let snapshot: FsWorkspaceSnapshot | GitWorkspaceSnapshot | null = null

    if (this.preferGit) {
      snapshot = await GitWorkspaceSnapshot.capture(sessionId, seq, cwd)
    }

    if (!snapshot) {
      snapshot = await FsWorkspaceSnapshot.capture(sessionId, seq, cwd)
    }

    // Store snapshot before publishing its metadata.
    sessionMap.set(seq, snapshot)
    try {
      await this.persist(snapshot)
    } catch (error) {
      sessionMap.delete(seq)
      await snapshot.dispose()
      throw error
    }

    // Enforce max snapshots limit (prune oldest)
    if (sessionMap.size > this.maxSnapshots) {
      const oldestSeq = [...sessionMap.keys()].sort((a, b) => a - b)[0]
      if (oldestSeq !== undefined && oldestSeq !== seq) {
        const oldest = sessionMap.get(oldestSeq)
        sessionMap.delete(oldestSeq)
        void Promise.all([
          oldest?.dispose(),
          rm(this.snapshotDir(sessionId, oldestSeq), { recursive: true, force: true }),
        ])
      }
    }

    return snapshot
  }

  /**
   * Retrieve snapshot for a session at seq, or the nearest earlier snapshot.
   */
  getSnapshot(sessionId: SessionId, seq: number): WorkspaceSnapshot | undefined {
    const sessionMap = this.snapshots.get(sessionId)
    if (!sessionMap) return undefined

    // Exact match
    const exact = sessionMap.get(seq)
    if (exact) return exact

    // Nearest <= seq
    const sortedSeqs = [...sessionMap.keys()].filter(s => s <= seq).sort((a, b) => b - a)
    const nearestSeq = sortedSeqs[0]
    return nearestSeq === undefined ? undefined : sessionMap.get(nearestSeq)
  }

  /**
   * Dispose all snapshots for one session.
   */
  async disposeSession(sessionId: SessionId): Promise<void> {
    const sessionMap = this.snapshots.get(sessionId)
    this.snapshots.delete(sessionId)
    if (sessionMap) await Promise.all([...sessionMap.values()].map(s => s.dispose()))
    await rm(join(this.persistRoot, sessionId), { recursive: true, force: true })
  }

  /** Forget in-memory handles without deleting persistent snapshots. */
  close(): void {
    this.snapshots.clear()
  }

  /**
   * Dispose all snapshots across all sessions.
   */
  async dispose(): Promise<void> {
    const all = [...this.snapshots.values()].flatMap(m => [...m.values()])
    this.snapshots.clear()
    await Promise.all(all.map(s => s.dispose()))
    await rm(this.persistRoot, { recursive: true, force: true })
  }
}
