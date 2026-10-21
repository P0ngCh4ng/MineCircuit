// テスト用の、Tauri の fs・dialog プラグインの代わり。本物の Tauri なしで io/tauri/ を試す。
// 使うテストでは、vi.mock('@tauri-apps/plugin-fs') と vi.mock('@tauri-apps/plugin-dialog') で、ここの関数に差し替える。

/** Windows のパス → ファイルの中身（フォルダはパスの途中に出てくるものだけ） */
export class FakeTauriFs {
  readonly files = new Map<string, { data: Uint8Array; mtime: Date | null }>()
  /** 読む許可の範囲（このパスで始まるものだけ読み書きできる）。null なら範囲を見ない */
  allowed: string[] | null = null
  /** 開いたファイルの数（閉じたら減る） */
  openHandles = 0
  /** read 1回で返す最大のバイト数（少しずつしか返さない read を試す） */
  readChunk = Number.POSITIVE_INFINITY
  readonly calls: string[] = []

  add(path: string, data: Uint8Array, mtime: Date | null = new Date(1000)): void {
    this.files.set(path, { data, mtime })
  }

  private check(path: string): void {
    if (this.allowed && !this.allowed.some((a) => path === a || path.startsWith(`${a}\\`))) {
      throw `forbidden path: ${path}, maybe it is not allowed on the scope for \`allow-read-dir\` permission in your capability file`
    }
  }

  private notFound(path: string): string {
    return `failed to open file at path: ${path} with error: 指定されたファイルが見つかりません。 (os error 2)`
  }

  readDir = async (path: string) => {
    this.calls.push(`readDir ${path}`)
    this.check(path)
    const prefix = `${path}\\`
    const names = new Map<string, boolean>()
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length).split('\\')
      names.set(rest[0], rest.length > 1 || names.get(rest[0]) === true)
    }
    if (names.size === 0) throw `failed to read directory at path: ${path} with error: (os error 3)`
    return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }))
  }

  readFile = async (path: string) => {
    this.calls.push(`readFile ${path}`)
    this.check(path)
    const f = this.files.get(path)
    if (!f) throw this.notFound(path)
    return f.data.slice()
  }

  stat = async (path: string) => {
    this.calls.push(`stat ${path}`)
    this.check(path)
    const f = this.files.get(path)
    if (!f) throw this.notFound(path)
    return { size: f.data.length, mtime: f.mtime, isFile: true, isDirectory: false }
  }

  writeFile = async (path: string, data: Uint8Array) => {
    this.calls.push(`writeFile ${path}`)
    this.check(path)
    this.files.set(path, { data: data.slice(), mtime: new Date(2000) })
  }

  open = async (path: string, options: { read?: boolean }) => {
    this.calls.push(`open ${path}`)
    this.check(path)
    const f = this.files.get(path)
    if (!f) throw this.notFound(path)
    if (!options.read) throw new Error('read で開いていません')
    this.openHandles++
    let pos = 0
    return {
      seek: async (offset: number, whence: number) => {
        if (whence !== 0) throw new Error('Start だけを使う')
        pos = offset
        return pos
      },
      read: async (buffer: Uint8Array) => {
        const n = Math.min(buffer.length, f.data.length - pos, this.readChunk)
        if (n <= 0) return null
        buffer.set(f.data.subarray(pos, pos + n))
        pos += n
        return n
      },
      close: async () => {
        this.openHandles--
      },
    }
  }
}

/** dialog プラグインの代わり。次に返すパスを決めておく */
export class FakeTauriDialog {
  nextOpen: string | null = null
  nextSave: string | null = null
  readonly openOptions: unknown[] = []
  readonly saveOptions: unknown[] = []

  open = async (options: unknown) => {
    this.openOptions.push(options)
    return this.nextOpen
  }

  save = async (options: unknown) => {
    this.saveOptions.push(options)
    return this.nextSave
  }
}
