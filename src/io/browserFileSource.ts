// File System Access API で選んだフォルダを読む FileSource（Chrome / Edge）。
// フォルダのハンドルは IndexedDB に保存でき、次回も同じフォルダを読める。
// Firefox / Safari にはフォルダを選ぶ画面（showDirectoryPicker）がないので、
// <input webkitdirectory> と MemoryFileSource で読む（memoryFileSource.ts）。

import { FileNotFoundError, normalizePath, splitPath, type FileSource } from './fileSource'

// showDirectoryPicker と権限の確認は Chromium だけにあり、TypeScript の lib.dom にない。使う部分だけ型を書く
type PermissionMode = 'read' | 'readwrite'

interface PermissionCapableHandle {
  queryPermission?(descriptor: { mode: PermissionMode }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: PermissionMode }): Promise<PermissionState>
}

type DirectoryPicker = (options?: { id?: string; mode?: PermissionMode }) => Promise<FileSystemDirectoryHandle>

function directoryPicker(): DirectoryPicker | null {
  if (typeof window === 'undefined') return null
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

/** フォルダを選ぶ画面（File System Access API）が使えるか。Chrome / Edge で true */
export function supportsDirectoryPicker(): boolean {
  return directoryPicker() !== null
}

/**
 * フォルダを選ぶ画面を出す。利用者が取り消したら null。
 * 画面が使えないブラウザでは呼ばない（supportsDirectoryPicker を先に確かめる）。
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const picker = directoryPicker()
  if (!picker) throw new Error('このブラウザでは、フォルダを選ぶ画面を使えません。')
  try {
    // id を付けると、次に開いたときも同じ場所から始まる
    return await picker({ id: 'minecircuit-modpack', mode: 'read' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/**
 * フォルダを読む許可があるか確かめる。request が true なら、なければ利用者に許可を求める。
 * 許可を求めるのは、ボタンを押したときなど利用者の操作の中だけにする（ブラウザの決まり）。
 */
export async function ensureReadPermission(handle: FileSystemHandle, request: boolean): Promise<boolean> {
  const h = handle as FileSystemHandle & PermissionCapableHandle
  // 権限の API がないブラウザでは、ハンドルを持っていれば読める
  if (!h.queryPermission) return true
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
  if (!request || !h.requestPermission) return false
  return (await h.requestPermission({ mode: 'read' })) === 'granted'
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')
}

/** File System Access API のフォルダのハンドルから読む FileSource */
export class BrowserFileSource implements FileSource {
  readonly root: FileSystemDirectoryHandle

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root
  }

  async list(dir: string): Promise<string[]> {
    const handle = await this.directory(splitPath(dir), dir)
    const names: string[] = []
    try {
      for await (const [name, entry] of handle.entries()) {
        names.push(entry.kind === 'directory' ? `${name}/` : name)
      }
    } catch (e) {
      // 登録したあとにフォルダが消された、など
      if (isNotFound(e)) throw new FileNotFoundError(normalizePath(dir))
      throw e
    }
    return names.sort()
  }

  async read(path: string): Promise<ArrayBuffer> {
    const parts = splitPath(path)
    const fileName = parts.pop()
    if (fileName === undefined) throw new FileNotFoundError('')
    const dir = await this.directory(parts, path)
    try {
      const file = await (await dir.getFileHandle(fileName)).getFile()
      return await file.arrayBuffer()
    } catch (e) {
      if (isNotFound(e)) throw new FileNotFoundError(normalizePath(path))
      throw e
    }
  }

  private async directory(parts: string[], original: string): Promise<FileSystemDirectoryHandle> {
    let handle = this.root
    try {
      for (const part of parts) {
        handle = await handle.getDirectoryHandle(part)
      }
    } catch (e) {
      if (isNotFound(e)) throw new FileNotFoundError(normalizePath(original))
      throw e
    }
    return handle
  }
}
