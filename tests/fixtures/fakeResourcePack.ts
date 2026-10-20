// テスト用のリソースパック（zip またはフォルダ）をコードで作る。本物のリソースパックや翻訳ファイルはリポジトリに入れない。

import { strToU8, zipSync, type Zippable } from 'fflate'

/** namespace → 言語 → 翻訳 */
export type FakeLang = Record<string, Partial<Record<'ja_jp' | 'en_us', Record<string, string>>>>

export interface FakeResourcePackOptions {
  lang?: FakeLang
  /** pack.mcmeta を入れるか（既定は入れる。ModTranslations/ には入っていない） */
  mcmeta?: boolean
  /** そのまま入れるファイル */
  files?: Record<string, string | Uint8Array>
}

/** リソースパックの中のファイルを、パック内のパス → バイト列で返す */
export function fakeResourcePackFiles(options: FakeResourcePackOptions = {}): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  const put = (path: string, content: string | Uint8Array) => {
    out[path] = typeof content === 'string' ? strToU8(content) : content
  }
  if (options.mcmeta ?? true) put('pack.mcmeta', JSON.stringify({ pack: { pack_format: 15, description: 'テスト' } }))
  for (const [ns, langs] of Object.entries(options.lang ?? {})) {
    for (const [code, table] of Object.entries(langs)) {
      put(`assets/${ns}/lang/${code}.json`, JSON.stringify(table))
    }
  }
  for (const [path, content] of Object.entries(options.files ?? {})) put(path, content)
  // 入れておくが読まないファイル（テクスチャの代わり）
  put('assets/example/textures/block/a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  return out
}

/** zip のリソースパックのバイト列を作る */
export function fakeResourcePackZip(options: FakeResourcePackOptions = {}): Uint8Array {
  const files: Zippable = { ...fakeResourcePackFiles(options) }
  return zipSync(files)
}

/** フォルダのリソースパックを、MemoryFileSource に渡せる [パス, 中身] の一覧にする。dir はフォルダのパス */
export function fakeResourcePackFolder(
  dir: string,
  options: FakeResourcePackOptions = {},
): [string, Uint8Array][] {
  return Object.entries(fakeResourcePackFiles(options)).map(([path, bytes]) => [`${dir}/${path}`, bytes])
}
