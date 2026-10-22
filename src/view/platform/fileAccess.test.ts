import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserFileSink } from '../../io/browserFileSink'

const saved = vi.hoisted(() => [] as { name: string; data: Uint8Array }[])

// デスクトップ版の実装は Tauri なしでは動かないので、代わりを使う
vi.mock('../../io/tauri/tauriFileSink', () => ({
  TauriFileSink: class {
    async save(name: string, data: Uint8Array) {
      saved.push({ name, data })
      return 'saved'
    }
  },
}))
vi.mock('../../io/tauri/tauriBlueprintFiles', () => ({
  pickTauriBlueprintFile: async (extensions: readonly string[]) => ({
    name: `picked${extensions[0]}`,
    arrayBuffer: async () => new ArrayBuffer(1),
  }),
}))
vi.mock('../../io/tauri/tauriModpackRegistry', () => ({
  createTauriModpackRegistry: () => ({ kind: 'tauri-registry' }),
  pickTauriFolder: async () => ({ name: 'ATM10', path: 'C:\\ATM10', source: { kind: 'tauri-source' } }),
  createTauriGameFolderRegistry: () => ({ kind: 'tauri-game-registry' }),
  pickTauriGameFolder: async () => ({ name: 'Install', path: 'C:\\Install', source: { kind: 'tauri-source' } }),
}))

const { createBlueprintSink, fileHandlingNotice, loadDesktopGameFolders, loadDesktopModpackFolders, pickDesktopBlueprintFile } =
  await import('./fileAccess')

type TauriMarker = { isTauri?: boolean }

describe('fileAccess', () => {
  afterEach(() => {
    delete (globalThis as TauriMarker).isTauri
    saved.length = 0
  })

  it('ブラウザ版では BrowserFileSink を使い、ブラウザの文言を出す', () => {
    expect(createBlueprintSink()).toBeInstanceOf(BrowserFileSink)
    expect(fileHandlingNotice()).toContain('ブラウザ内だけ')
  })

  it('デスクトップ版では TauriFileSink に保存を任せ、PC の中だけで扱う文言を出す', async () => {
    ;(globalThis as TauriMarker).isTauri = true
    const sink = createBlueprintSink()
    expect(sink).not.toBeInstanceOf(BrowserFileSink)
    expect(await sink.save('a.nbt', new Uint8Array([1]))).toBe('saved')
    expect(saved.map((s) => s.name)).toEqual(['a.nbt'])
    expect(fileHandlingNotice()).toContain('この PC の中だけ')
    expect(fileHandlingNotice()).not.toContain('ブラウザ')
  })

  it('デスクトップ版の Modpack のフォルダは、パスを登録に使う', async () => {
    const folders = await loadDesktopModpackFolders()
    expect(folders.registry).toEqual({ kind: 'tauri-registry' })
    expect(await folders.pickFolder()).toMatchObject({ name: 'ATM10', handle: 'C:\\ATM10' })
  })

  it('デスクトップ版の Minecraft 本体のフォルダも、パスを保存に使う', async () => {
    const folders = await loadDesktopGameFolders()
    expect(folders.registry).toEqual({ kind: 'tauri-game-registry' })
    expect(await folders.pickFolder()).toMatchObject({ name: 'Install', handle: 'C:\\Install' })
  })

  it('デスクトップ版の設計図を開く画面', async () => {
    expect((await pickDesktopBlueprintFile(['.nbt']))?.name).toBe('picked.nbt')
  })
})
