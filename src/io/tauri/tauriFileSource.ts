// デスクトップ版（Tauri）で、PC のフォルダを直接読む FileSource（docs/design.md「デスクトップ版（Tauri）」）。
// 読めるのは、利用者がダイアログで選んだフォルダの中だけ（fs プラグインの範囲。persisted-scope で次回も残る）。
// この FileSource は読むだけで、書き込みはしない。

import { open, readDir, readFile, SeekMode, stat } from '@tauri-apps/plugin-fs'
import { checkRange, FileNotFoundError, normalizePath, splitPath, type FileSource, type FileStat } from '../fileSource'

/** 読む許可の範囲の外を読もうとした（登録したあとに範囲が消えた、など） */
export class TauriForbiddenError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`このフォルダを読む許可がありません: ${path}`)
    this.name = 'TauriForbiddenError'
    this.path = path
  }
}

/** Tauri から返ったエラーの文。Tauri のエラーは文字列のことが多い */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Tauri のエラーを、FileSource のエラーに直す。
 * ないファイル・フォルダは FileNotFoundError、許可の範囲の外は TauriForbiddenError。
 * relative は画面に出すパス（フォルダの中からの相対パス）
 */
export function toFileError(e: unknown, relative: string): Error {
  const text = errorText(e)
  if (/forbidden path/i.test(text)) return new TauriForbiddenError(relative)
  // os error 2 / 3 は、Windows と Linux・macOS のどちらでも「ファイル・フォルダがない」
  if (/os error [23]\b|no such file|cannot find|not found/i.test(text)) return new FileNotFoundError(relative)
  return e instanceof Error ? e : new Error(text)
}

/** パスの区切り。フォルダのパスに `\` があれば `\`（Windows）、なければ `/` */
function separatorOf(root: string): string {
  return root.includes('\\') ? '\\' : '/'
}

/** フォルダのパスと、フォルダの中からの相対パスをつなぐ。`..` は受け付けない（splitPath） */
export function joinPath(root: string, relative: string): string {
  const parts = splitPath(relative)
  if (parts.length === 0) return root
  const sep = separatorOf(root)
  return `${root.replace(/[\\/]+$/, '')}${sep}${parts.join(sep)}`
}

/** パスの最後の部分（フォルダやファイルの名前） */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== '')
  return parts[parts.length - 1] ?? path
}

/** ArrayBuffer にする。Uint8Array がバッファ全体を指していれば、写さずにそのまま返す */
function toArrayBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer
  return bytes.slice().buffer
}

/** フォルダのパス（`C:\Users\...\Instances\ATM10` など）から読む FileSource */
export class TauriFileSource implements FileSource {
  /** フォルダの絶対パス */
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async list(dir: string): Promise<string[]> {
    const relative = normalizePath(dir)
    try {
      const entries = await readDir(joinPath(this.root, relative))
      return entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name)).sort()
    } catch (e) {
      throw toFileError(e, relative)
    }
  }

  async read(path: string): Promise<ArrayBuffer> {
    const relative = this.filePath(path)
    try {
      return toArrayBuffer(await readFile(joinPath(this.root, relative)))
    } catch (e) {
      throw toFileError(e, relative)
    }
  }

  /** 大きさと更新時刻。フォルダや、更新時刻が分からないときは null */
  async stat(path: string): Promise<FileStat | null> {
    const relative = this.filePath(path)
    try {
      const info = await stat(joinPath(this.root, relative))
      if (!info.isFile || info.mtime === null) return null
      return { size: info.size, lastModified: info.mtime.getTime() }
    } catch (e) {
      throw toFileError(e, relative)
    }
  }

  /** ファイルの一部だけを読む。ファイルを開き、start まで進めて end - start バイトまで読む */
  async readRange(path: string, start: number, end: number): Promise<ArrayBuffer> {
    checkRange(start, end)
    const relative = this.filePath(path)
    const buffer = new Uint8Array(end - start)
    try {
      const file = await open(joinPath(this.root, relative), { read: true })
      try {
        if (start > 0) await file.seek(start, SeekMode.Start)
        let filled = 0
        while (filled < buffer.length) {
          // read は求めたより少なく返すことがある。末尾に着いたら null
          const n = await file.read(buffer.subarray(filled))
          if (n === null || n === 0) break
          filled += n
        }
        return filled === buffer.length ? buffer.buffer : buffer.slice(0, filled).buffer
      } finally {
        await file.close()
      }
    } catch (e) {
      throw toFileError(e, relative)
    }
  }

  private filePath(path: string): string {
    const relative = normalizePath(path)
    if (relative === '') throw new FileNotFoundError('')
    return relative
  }
}
