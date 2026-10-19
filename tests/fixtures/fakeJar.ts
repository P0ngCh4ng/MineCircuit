// テスト用の小さな jar（zip）をコードで作る。本物の Mod の jar や翻訳ファイルはリポジトリに入れない。

import { strToU8, zipSync, type Zippable } from 'fflate'

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike }

export interface FakeMod {
  modId: string
  displayName?: string
  version?: string
}

export interface FakeJarOptions {
  /** META-INF/mods.toml に書く Mod */
  forgeMods?: FakeMod[]
  /** META-INF/neoforge.mods.toml に書く Mod */
  neoforgeMods?: FakeMod[]
  /** fabric.mod.json に書く Mod */
  fabricMod?: FakeMod
  /** META-INF/MANIFEST.MF の Implementation-Version */
  manifestVersion?: string
  /** namespace → 言語 → 翻訳 */
  lang?: Record<string, Partial<Record<'ja_jp' | 'en_us', Record<string, string>>>>
  /** `namespace:path` → ブロック状態の定義 */
  blockStates?: Record<string, JsonLike>
  /** そのまま入れるファイル */
  files?: Record<string, string | Uint8Array>
  /** META-INF/jarjar/ に入れる jar */
  nestedJars?: Record<string, Uint8Array>
}

function modsToml(mods: FakeMod[]): string {
  const lines = ['modLoader="javafml"', 'loaderVersion="[47,)"', 'license="MIT"', '']
  for (const m of mods) {
    lines.push('[[mods]]', `modId="${m.modId}"`)
    if (m.version !== undefined) lines.push(`version="${m.version}"`)
    if (m.displayName !== undefined) lines.push(`displayName="${m.displayName}" # 表示名`)
    lines.push('')
    lines.push(`[[dependencies.${m.modId}]]`, 'modId="minecraft"', 'version="[1.20.1]"', '')
  }
  return lines.join('\n')
}

/** jar のバイト列を作る */
export function fakeJar(options: FakeJarOptions = {}): Uint8Array {
  const files: Zippable = {}
  const put = (path: string, content: string | Uint8Array) => {
    files[path] = typeof content === 'string' ? strToU8(content) : content
  }
  if (options.forgeMods) put('META-INF/mods.toml', modsToml(options.forgeMods))
  if (options.neoforgeMods) put('META-INF/neoforge.mods.toml', modsToml(options.neoforgeMods))
  if (options.fabricMod) {
    const m = options.fabricMod
    put('fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: m.modId, name: m.displayName, version: m.version }))
  }
  if (options.manifestVersion !== undefined) {
    put('META-INF/MANIFEST.MF', `Manifest-Version: 1.0\r\nImplementation-Version: ${options.manifestVersion}\r\n`)
  }
  for (const [ns, langs] of Object.entries(options.lang ?? {})) {
    for (const [code, table] of Object.entries(langs)) {
      put(`assets/${ns}/lang/${code}.json`, JSON.stringify(table))
    }
  }
  for (const [id, def] of Object.entries(options.blockStates ?? {})) {
    const [ns, path] = id.split(':')
    put(`assets/${ns}/blockstates/${path}.json`, JSON.stringify(def))
  }
  for (const [path, content] of Object.entries(options.files ?? {})) put(path, content)
  for (const [name, bytes] of Object.entries(options.nestedJars ?? {})) {
    // jar の中の jar は圧縮せずに入れる（本物と同じ）
    files[`META-INF/jarjar/${name}`] = [bytes, { level: 0 }]
  }
  // 入れておくが読まないファイル（クラスやテクスチャの代わり）
  files['com/example/Mod.class'] = new Uint8Array([0xca, 0xfe, 0xba, 0xbe])
  return zipSync(files)
}
