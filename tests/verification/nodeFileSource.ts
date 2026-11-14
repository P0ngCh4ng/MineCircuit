// 手元のフォルダを読む FileSource（Node 用）。段階 C の確かめ（realBlueprints.test.ts）だけで使う。
// アプリはブラウザ・Tauri の FileSource を使うので、ここには置かない（src/ には入れない）。
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { FileNotFoundError, normalizePath, type FileSource, type FileStat } from '../../src/io/fileSource'

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

export class NodeFileSource implements FileSource {
  constructor(private readonly root: string) {}

  private full(path: string): string {
    return join(this.root, normalizePath(path))
  }

  private async guard<T>(path: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') throw new FileNotFoundError(path)
      throw e
    }
  }

  list(dir: string): Promise<string[]> {
    return this.guard(dir, async () => {
      const entries = await readdir(this.full(dir), { withFileTypes: true })
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort()
    })
  }

  read(path: string): Promise<ArrayBuffer> {
    return this.guard(path, async () => toArrayBuffer(await readFile(this.full(path))))
  }

  stat(path: string): Promise<FileStat | null> {
    return this.guard(path, async () => {
      const s = await stat(this.full(path))
      return { size: s.size, lastModified: s.mtimeMs }
    })
  }

  readRange(path: string, start: number, end: number): Promise<ArrayBuffer> {
    return this.guard(path, async () => {
      const f = await open(this.full(path), 'r')
      try {
        const size = (await f.stat()).size
        const to = Math.min(end, size)
        const buf = new Uint8Array(Math.max(0, to - start))
        await f.read(buf, 0, buf.length, start)
        return toArrayBuffer(buf)
      } finally {
        await f.close()
      }
    })
  }
}
