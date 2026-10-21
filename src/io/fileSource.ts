// ファイルの読み方をここに閉じ込める（docs/design.md「io：FileSource」）。
// ブラウザでは File System Access API か <input webkitdirectory>、
// Tauri 版ではファイルを直接読む実装に差し替える。読む側はこの型だけを使う。

/**
 * フォルダ1つ分のファイルを読む。
 *
 * パスはフォルダの中からの相対パスで、区切りは `/`。`''` はフォルダそのもの。
 */
export interface FileSource {
  /**
   * フォルダの中にある項目の名前を返す（名前順）。フォルダは末尾に `/` を付ける（`mods/`）。
   * フォルダがなければ FileNotFoundError を投げる。
   */
  list(dir: string): Promise<string[]>
  /** ファイルの中身を返す。ファイルがなければ FileNotFoundError を投げる */
  read(path: string): Promise<ArrayBuffer>
  /**
   * ファイルの大きさと更新時刻を、中身を読まずに返す。分からなければ null。
   * 変わったファイルだけ読み直すために使う。この関数がない FileSource もある。
   * ファイルがなければ FileNotFoundError を投げる。
   */
  stat?(path: string): Promise<FileStat | null>
  /**
   * ファイルの一部（start 以上 end 未満のバイト）だけを返す。end がファイルの大きさを超えたら、末尾までを返す。
   * jar（zip）の末尾のファイルの一覧と必要な項目だけを読むために使う（modpack/partialZip.ts）。
   * この関数がない FileSource もある。ファイルがなければ FileNotFoundError を投げる。
   */
  readRange?(path: string, start: number, end: number): Promise<ArrayBuffer>
}

/** readRange の start と end を確かめる。おかしければエラーを投げる */
export function checkRange(start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new RangeError(`読む範囲が正しくありません: ${start}〜${end}`)
  }
}

/** ファイルの大きさと更新時刻 */
export interface FileStat {
  /** バイト数 */
  readonly size: number
  /** 更新時刻（ミリ秒） */
  readonly lastModified: number
}

/** 指定したファイルやフォルダがないときのエラー */
export class FileNotFoundError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`ファイルが見つかりません: ${path === '' ? '（フォルダの一番上）' : path}`)
    this.name = 'FileNotFoundError'
    this.path = path
  }
}

/**
 * パスを部分に分ける。`\` も区切りとして扱い、空の部分と `.` は捨てる。
 * フォルダの外を指す `..` は受け付けない。
 */
export function splitPath(path: string): string[] {
  const parts = path.split(/[\\/]/).filter((p) => p !== '' && p !== '.')
  if (parts.includes('..')) {
    throw new Error(`フォルダの外を指すパスは使えません: ${path}`)
  }
  return parts
}

/** パスを `/` 区切りの形にそろえる */
export function normalizePath(path: string): string {
  return splitPath(path).join('/')
}

/** list の結果の名前がフォルダか */
export function isDirectoryEntry(name: string): boolean {
  return name.endsWith('/')
}
