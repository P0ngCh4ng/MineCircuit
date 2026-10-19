// ブラウザでファイルを保存する FileSink。
// Chrome / Edge では保存先を選ぶ画面（File System Access API の showSaveFilePicker）を出す。
// その画面がないブラウザ（Firefox / Safari）では、ふつうのダウンロードとして保存する。
// どちらも利用者の PC に書くだけで、外部には送らない。

import type { FileSink, SaveResult } from './fileSink'

/** 保存先を選ぶ画面に出すファイルの種類 */
export interface SaveFileType {
  /** 「構造物 NBT」 */
  description: string
  /** MIME タイプ → 拡張子（`.nbt`） */
  accept: Record<string, string[]>
}

// showSaveFilePicker は Chromium だけにあり、TypeScript の lib.dom にない。使う部分だけ型を書く
interface SaveFilePickerOptions {
  id?: string
  suggestedName?: string
  types?: SaveFileType[]
}
type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>

/** 保存の方法。テストでは差し替える */
export interface BrowserSaveEnvironment {
  /** 保存先を選ぶ画面。ないブラウザでは null */
  picker: SaveFilePicker | null
  /** ダウンロードとして保存する */
  download(name: string, data: Uint8Array, mimeType: string): void
}

/** 構造物 NBT（.nbt）のファイルの種類 */
export const NBT_FILE_TYPE: SaveFileType = {
  description: '構造物 NBT',
  accept: { 'application/octet-stream': ['.nbt'] },
}

function savePicker(): SaveFilePicker | null {
  if (typeof window === 'undefined') return null
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

/** <a download> でダウンロードする */
function downloadWithLink(name: string, data: Uint8Array, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([data.slice()], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    // ダウンロードが始まるまで URL を残す
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** 今のブラウザでの保存の方法 */
export function browserSaveEnvironment(): BrowserSaveEnvironment {
  return { picker: savePicker(), download: downloadWithLink }
}

/** 保存先を選ぶ画面（File System Access API）が使えるか。Chrome / Edge で true */
export function supportsSaveFilePicker(): boolean {
  return savePicker() !== null
}

/**
 * ブラウザで保存する FileSink。
 *
 * 保存先を選ぶ画面は、ボタンを押したときなど利用者の操作の中でしか開けない（ブラウザの決まり）。
 * save は操作から時間をおかずに呼ぶこと。
 */
export class BrowserFileSink implements FileSink {
  private readonly types: SaveFileType[]
  private readonly id: string | undefined
  private readonly env: BrowserSaveEnvironment

  constructor(
    options: { types?: SaveFileType[]; id?: string } = {},
    env: BrowserSaveEnvironment = browserSaveEnvironment(),
  ) {
    this.types = options.types ?? [NBT_FILE_TYPE]
    this.id = options.id
    this.env = env
  }

  async save(suggestedName: string, data: Uint8Array): Promise<SaveResult> {
    if (!this.env.picker) {
      // ダウンロードは取り消されたかどうかが分からないので、保存したものとして扱う
      this.env.download(suggestedName, data, this.mimeType())
      return 'saved'
    }

    let handle: FileSystemFileHandle
    try {
      handle = await this.env.picker({ id: this.id, suggestedName, types: this.types })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      throw e
    }
    const writable = await handle.createWritable()
    try {
      await writable.write(data.slice())
      await writable.close()
    } catch (e) {
      // 途中まで書いたファイルを残さない
      await writable.abort().catch(() => undefined)
      throw e
    }
    return 'saved'
  }

  private mimeType(): string {
    return Object.keys(this.types[0]?.accept ?? {})[0] ?? 'application/octet-stream'
  }
}
