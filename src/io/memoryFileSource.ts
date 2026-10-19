import { FileNotFoundError, normalizePath, splitPath, type FileSource } from './fileSource'

/** ファイルの中身。バイト列そのものか、呼ばれたときに読む関数 */
export type FileContent = Uint8Array | (() => Promise<ArrayBuffer>)

/**
 * ファイルの一覧から作る FileSource。
 * テストのほか、`<input webkitdirectory>` で選んだファイル（Firefox / Safari）にも使う。
 * フォルダは、ファイルのパスに出てくるものだけがあるとみなす。
 */
export class MemoryFileSource implements FileSource {
  private readonly files = new Map<string, FileContent>()
  /** フォルダのパス → 中にある項目の名前（フォルダは末尾 `/`） */
  private readonly dirs = new Map<string, Set<string>>([['', new Set()]])

  constructor(files: Iterable<readonly [string, FileContent]> = []) {
    for (const [path, content] of files) {
      this.add(path, content)
    }
  }

  /** ファイルを足す。途中のフォルダも作る */
  add(path: string, content: FileContent): void {
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
    // 呼び出し元が書き換えても元に影響しないよう、コピーを返す
    return content.slice().buffer
  }
}

/** `<input webkitdirectory>` で選んだファイルの1つ分。File のうち使う部分だけ */
export interface PickedFile {
  readonly webkitRelativePath: string
  arrayBuffer(): Promise<ArrayBuffer>
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
    source.add(parts.slice(1).join('/'), () => file.arrayBuffer())
  }
  return name === null ? null : { name, source }
}
