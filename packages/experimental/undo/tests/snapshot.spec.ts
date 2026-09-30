import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { FsWorkspaceSnapshot, SnapshotManager } from '../src/snapshot.ts'

describe('FsWorkspaceSnapshot', () => {
  let tempWorkspace: string
  const cleanups: Array<() => Promise<void>> = []

  beforeEach(async () => {
    tempWorkspace = await mkdtemp(join(tmpdir(), 'dsh-undo-test-ws-'))
    cleanups.push(async () => {
      await rm(tempWorkspace, { recursive: true, force: true }).catch(() => {})
    })
  })

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    cleanups.length = 0
  })

  it('restores modified files back to snapshot state', async () => {
    const fileA = join(tempWorkspace, 'fileA.txt')
    await writeFile(fileA, 'initial content of A')

    const snapshot = await FsWorkspaceSnapshot.capture(SessionId('s-1'), 1, tempWorkspace)
    cleanups.push(() => snapshot.dispose())

    // Modify file
    await writeFile(fileA, 'modified content of A')
    expect(await readFile(fileA, 'utf-8')).toBe('modified content of A')

    // Revert
    const reverted = await snapshot.revert()
    expect(reverted).toContain('fileA.txt')
    expect(await readFile(fileA, 'utf-8')).toBe('initial content of A')
  })

  it('removes files that were created after the snapshot', async () => {
    const fileA = join(tempWorkspace, 'fileA.txt')
    await writeFile(fileA, 'initial A')

    const snapshot = await FsWorkspaceSnapshot.capture(SessionId('s-1'), 1, tempWorkspace)
    cleanups.push(() => snapshot.dispose())

    // Create a new file
    const fileNew = join(tempWorkspace, 'new-file.txt')
    await writeFile(fileNew, 'brand new file')
    expect(await readFile(fileNew, 'utf-8')).toBe('brand new file')

    // Revert
    const reverted = await snapshot.revert()
    expect(reverted).toContain('new-file.txt')

    // New file should be deleted
    await expect(readFile(fileNew, 'utf-8')).rejects.toThrow()
    // Original file intact
    expect(await readFile(fileA, 'utf-8')).toBe('initial A')
  })

  it('re-creates files that were deleted after the snapshot', async () => {
    const fileA = join(tempWorkspace, 'fileA.txt')
    await writeFile(fileA, 'initial A')

    const snapshot = await FsWorkspaceSnapshot.capture(SessionId('s-1'), 1, tempWorkspace)
    cleanups.push(() => snapshot.dispose())

    // Delete file
    await rm(fileA)
    await expect(readFile(fileA, 'utf-8')).rejects.toThrow()

    // Revert
    const reverted = await snapshot.revert()
    expect(reverted).toContain('fileA.txt')
    expect(await readFile(fileA, 'utf-8')).toBe('initial A')
  })

  it('handles nested directory structures and composite mutations', async () => {
    const subDir = join(tempWorkspace, 'src', 'deep')
    await mkdir(subDir, { recursive: true })
    const file1 = join(subDir, 'index.ts')
    const file2 = join(tempWorkspace, 'README.md')
    await writeFile(file1, 'export const a = 1')
    await writeFile(file2, '# Hello')

    const snapshot = await FsWorkspaceSnapshot.capture(SessionId('s-1'), 1, tempWorkspace)
    cleanups.push(() => snapshot.dispose())

    // Composite mutations:
    // 1. modify file1
    await writeFile(file1, 'export const a = 999')
    // 2. delete file2
    await rm(file2)
    // 3. add new file in nested dir
    const file3 = join(subDir, 'new.ts')
    await writeFile(file3, 'export const b = 2')

    const reverted = await snapshot.revert()
    expect(reverted.sort()).toEqual(['README.md', join('src', 'deep', 'index.ts'), join('src', 'deep', 'new.ts')].sort())

    expect(await readFile(file1, 'utf-8')).toBe('export const a = 1')
    expect(await readFile(file2, 'utf-8')).toBe('# Hello')
    await expect(readFile(file3, 'utf-8')).rejects.toThrow()
  })
})

describe('SnapshotManager', () => {
  let tempWorkspace: string
  const cleanups: Array<() => Promise<void>> = []

  beforeEach(async () => {
    tempWorkspace = await mkdtemp(join(tmpdir(), 'dsh-undo-mgr-ws-'))
    cleanups.push(async () => {
      await rm(tempWorkspace, { recursive: true, force: true }).catch(() => {})
    })
  })

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup()
    }
    cleanups.length = 0
  })

  it('manages multiple snapshots per session and retrieves nearest snapshot', async () => {
    const manager = new SnapshotManager({ maxSnapshotsPerSession: 5, preferGit: false })
    cleanups.push(() => manager.dispose())

    const sessionId = SessionId('sess-multi')
    const file = join(tempWorkspace, 'counter.txt')

    await writeFile(file, 'v1')
    await manager.createSnapshot(sessionId, 2, tempWorkspace)

    await writeFile(file, 'v2')
    await manager.createSnapshot(sessionId, 6, tempWorkspace)

    // Exact query
    const snap2 = manager.getSnapshot(sessionId, 2)
    expect(snap2).toBeDefined()
    expect(snap2?.seq).toBe(2)

    const snap6 = manager.getSnapshot(sessionId, 6)
    expect(snap6).toBeDefined()
    expect(snap6?.seq).toBe(6)

    // Nearest query (seq: 4 -> matches seq 2)
    const snap4 = manager.getSnapshot(sessionId, 4)
    expect(snap4?.seq).toBe(2)

    // Revert to seq 2
    await writeFile(file, 'v3')
    const reverted = await snap2!.revert()
    expect(reverted).toContain('counter.txt')
    expect(await readFile(file, 'utf-8')).toBe('v1')
  })

  it('prunes oldest snapshots when exceeding max limit', async () => {
    const manager = new SnapshotManager({ maxSnapshotsPerSession: 3, preferGit: false })
    cleanups.push(() => manager.dispose())

    const sessionId = SessionId('sess-cap')
    await manager.createSnapshot(sessionId, 1, tempWorkspace)
    await manager.createSnapshot(sessionId, 2, tempWorkspace)
    await manager.createSnapshot(sessionId, 3, tempWorkspace)
    expect(manager.getSnapshot(sessionId, 1)).toBeDefined()

    // Adding 4th should prune seq 1
    await manager.createSnapshot(sessionId, 4, tempWorkspace)
    expect(manager.getSnapshot(sessionId, 1)).toBeUndefined()
    expect(manager.getSnapshot(sessionId, 2)).toBeDefined()
    expect(manager.getSnapshot(sessionId, 4)).toBeDefined()
  })

  it('restores persisted filesystem snapshots after a manager restart', async () => {
    const persistRoot = join(tempWorkspace, '.undo-snapshots')
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-undo-persist-ws-'))
    cleanups.push(() => rm(workspace, { recursive: true, force: true }))
    const sessionId = SessionId('sess-persist')
    const file = join(workspace, 'state.txt')
    await writeFile(file, 'before')

    const first = new SnapshotManager({ preferGit: false, persistRoot })
    await first.createSnapshot(sessionId, 7, workspace)
    first.close()

    await writeFile(file, 'after')
    const restored = new SnapshotManager({ preferGit: false, persistRoot })
    cleanups.push(() => restored.dispose())
    await restored.restore()

    const snapshot = restored.getSnapshot(sessionId, 7)
    expect(snapshot?.seq).toBe(7)
    await snapshot?.revert()
    expect(await readFile(file, 'utf-8')).toBe('before')
  })

  it('keeps snapshots when a live session detaches and deletes them only explicitly', async () => {
    const persistRoot = join(tempWorkspace, '.undo-snapshots')
    const manager = new SnapshotManager({ preferGit: false, persistRoot })
    const sessionId = SessionId('sess-dispose')
    await manager.createSnapshot(sessionId, 1, tempWorkspace)

    manager.close()
    const restored = new SnapshotManager({ preferGit: false, persistRoot })
    cleanups.push(() => restored.dispose())
    await restored.restore()
    expect(restored.getSnapshot(sessionId, 1)).toBeDefined()

    await restored.disposeSession(sessionId)
    expect(restored.getSnapshot(sessionId, 1)).toBeUndefined()
  })
})
