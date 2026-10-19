// jar の中の Mod の情報（modId、名前、バージョン）を読む。
// Forge / NeoForge は META-INF/mods.toml・META-INF/neoforge.mods.toml、Fabric は fabric.mod.json。
// TOML は全部を解釈せず、[[mods]] の表にある文字列の項目だけを読む。

/** Mod 1つ分の情報 */
export interface ModInfo {
  readonly modId: string
  /** 表示名。書いていなければ modId */
  readonly name: string
  /** バージョン。分からなければ null */
  readonly version: string | null
  /** 入っていた jar のファイル名（jar の中の jar なら `外.jar!/中.jar`） */
  readonly jar: string
}

/** Mod の情報が書いてあるファイルのパス（jar の中） */
export const FORGE_MODS_TOML = 'META-INF/mods.toml'
export const NEOFORGE_MODS_TOML = 'META-INF/neoforge.mods.toml'
export const FABRIC_MOD_JSON = 'fabric.mod.json'
export const MANIFEST = 'META-INF/MANIFEST.MF'

/** TOML の文字列（"..." / '...'）を読む。読めなければ null */
function parseTomlString(value: string): string | null {
  const v = value.trim()
  if (v.startsWith("'''") || v.startsWith('"""')) return null
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1)
    return end < 0 ? null : v.slice(1, end)
  }
  if (!v.startsWith('"')) return null
  let out = ''
  for (let i = 1; i < v.length; i++) {
    const c = v[i]
    if (c === '"') return out
    if (c === '\\' && i + 1 < v.length) {
      const n = v[++i]
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n
    } else {
      out += c
    }
  }
  return null
}

/** mods.toml の [[mods]] の1つ分 */
interface TomlMod {
  modId?: string
  displayName?: string
  version?: string
}

/** mods.toml から [[mods]] の modId・displayName・version を読む */
export function parseModsToml(text: string): TomlMod[] {
  const mods: TomlMod[] = []
  let current: TomlMod | null = null
  /** 複数行の文字列の中なら、その閉じ記号（''' / """） */
  let multiline: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (multiline !== null) {
      if (line.includes(multiline)) multiline = null
      continue
    }
    if (line === '' || line.startsWith('#')) continue
    const open = /=\s*('''|""")(.*)$/.exec(line)
    if (open && !open[2].includes(open[1])) {
      // 複数行の文字列（description など）の中身は読まない
      multiline = open[1]
      continue
    }
    if (line.startsWith('[')) {
      if (/^\[\[\s*mods\s*\]\]/.test(line)) {
        current = {}
        mods.push(current)
      } else {
        current = null
      }
      continue
    }
    if (!current) continue
    const m = /^(modId|displayName|version)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = parseTomlString(m[2])
    if (value === null) continue
    const key = m[1] as keyof TomlMod
    current[key] = value
  }
  return mods
}

/** MANIFEST.MF の Implementation-Version。mods.toml の `${file.jarVersion}` の中身 */
export function manifestVersion(text: string): string | null {
  const m = /^Implementation-Version:\s*(.+?)\s*$/m.exec(text)
  return m ? m[1] : null
}

/** mods.toml の Mod の一覧を ModInfo にする */
export function modsFromToml(text: string, jar: string, manifest: string | null): ModInfo[] {
  const jarVersion = manifest === null ? null : manifestVersion(manifest)
  const result: ModInfo[] = []
  for (const mod of parseModsToml(text)) {
    if (!mod.modId) continue
    let version = mod.version ?? null
    if (version !== null && version.includes('${file.jarVersion}')) {
      version = jarVersion === null ? null : version.replace('${file.jarVersion}', jarVersion)
    }
    result.push({ modId: mod.modId, name: mod.displayName ?? mod.modId, version, jar })
  }
  return result
}

/** fabric.mod.json を ModInfo にする。読めなければ空 */
export function modsFromFabricJson(text: string, jar: string): ModInfo[] {
  let data: unknown
  try {
    data = JSON.parse(stripBom(text))
  } catch {
    return []
  }
  if (typeof data !== 'object' || data === null) return []
  const o = data as Record<string, unknown>
  if (typeof o.id !== 'string') return []
  return [
    {
      modId: o.id,
      name: typeof o.name === 'string' ? o.name : o.id,
      version: typeof o.version === 'string' ? o.version : null,
      jar,
    },
  ]
}

/** 先頭の BOM を取り除く */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
