import { checkRange, FileNotFoundError, normalizePath, splitPath, type FileSource, type FileStat } from './fileSource'

/** 呼ばれたときに読むファイル。一部だけを読む方法も持つ */
export interface LazyFileContent {
  read(): Promise<ArrayBuffer>
  readRange(start: number, end: number): Promise<ArrayBuffer>
}

/**
 * ファイルの中身。バイト列そのものか、呼ばれたときに読む関数か、一部だけも読めるもの。
 * 関数のときは、readRange でも全体を読んでから切り出す
 */
export type FileContent = Uint8Array | (() => Promise<ArrayBuffer>) | LazyFileContent

/**
 * ファイルの一覧から作る FileSource。
 * テストのほか、`<input webkitdirectory>` で選んだファイル（Firefox / Safari）にも使う。
 * フォルダは、ファイルのパスに出てくるものだけがあるとみなす。
 */
export class MemoryFileSource implements FileSource {
  private readonly files = new Map<string, FileContent>()
  private readonly stats = new Map<string, FileStat>()
  /** フォルダのパス → 中にある項目の名前（フォルダは末尾 `/`） */
  private readonly dirs = new Map<string, Set<string>>([['', new Set()]])

  constructor(files: Iterable<readonly [string, FileContent]> = []) {
    for (const [path, content] of files) {
      this.add(path, content)
    }
  }

  /** ファイルを足す。途中のフォルダも作る。stat を渡すと、stat() がそれを返す */
  add(path: string, content: FileContent, stat?: FileStat): void {
    const parts = splitPath(path)
    if (parts.length === 0) throw new Error('ファイルのパスが空です')
    let dir = ''
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1
      const children = this.dirs.get(dir)
      if (!children) throw new Error(`フォルダとファイルの名前が重なっています: ${path}`)
      children.add(isFile ? parts[i] : `${parts[i]}/`)
      dir = dir === '' ? parts[i] : `${dir}/${parts[i]}`
      if (!isFile && !this.dirs.has(dir)) this.dirs.set(dir, new Set())
    }
    this.files.set(dir, content)
    if (stat) this.stats.set(dir, stat)
    else this.stats.delete(dir)
  }

  async list(dir: string): Promise<string[]> {
    const key = normalizePath(dir)
    const children = this.dirs.get(key)
    if (!children) throw new FileNotFoundError(key)
    return [...children].sort()
  }

  async read(path: string): Promise<ArrayBuffer> {
    const key = normalizePath(path)
    const content = this.files.get(key)
    if (content === undefined) throw new FileNotFoundError(key)
    if (typeof content === 'function') return content()
    if (!(content instanceof Uint8Array)) return content.read()
    // 呼び出し元が書き換えても元に影響しないよう、コピーを返す
    return content.slice().buffer
  }

  async readRange(path: string, start: number, end: number): Promise<ArrayBuffer> {
    checkRange(start, end)
    const key = normalizePath(path)
    const content = this.files.get(key)
    if (content === undefined) throw new FileNotFoundError(key)
    if (typeof content === 'function') return (await content()).slice(start, end)
    if (!(content instanceof Uint8Array)) return content.readRange(start, end)
    return content.slice(start, end).buffer
  }

  /** add で stat を渡したファイルだけ、大きさと更新時刻を返す。渡していなければ null */
  async stat(path: string): Promise<FileStat | null> {
    const key = normalizePath(path)
    if (!this.files.has(key)) throw new FileNotFoundError(key)
    return this.stats.get(key) ?? null
  }
}

/** `<input webkitdirectory>` で選んだファイルの1つ分。File のうち使う部分だけ */
export interface PickedFile {
  readonly webkitRelativePath: string
  readonly size?: number
  readonly lastModified?: number
  arrayBuffer(): Promise<ArrayBuffer>
  /** 一部を切り出す（File.slice）。あれば jar の一部だけを読める */
  slice?(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

/**
 * `<input webkitdirectory>` で選んだファイルから FileSource を作る。
 * webkitRelativePath は選んだフォルダの名前から始まるので、それを取り除いてフォルダの中からのパスにする。
 * ファイルがないときは null。
 */
export function fileSourceFromPickedFiles(files: ArrayLike<PickedFile>): { name: string; source: FileSource } | null {
  const source = new MemoryFileSource()
  let name: string | null = null
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const parts = splitPath(file.webkitRelativePath)
    if (parts.length < 2) continue
    name ??= parts[0]
    const stat =
      file.size !== undefined && file.lastModified !== undefined
        ? { size: file.size, lastModified: file.lastModified }
        : undefined
    const slice = file.slice?.bind(file)
    const content: FileContent = slice
      ? { read: () => file.arrayBuffer(), readRange: (start, end) => slice(start, end).arrayBuffer() }
      : () => file.arrayBuffer()
    source.add(parts.slice(1).join('/'), content, stat)
  }
  return name === null ? null : { name, source }
}
