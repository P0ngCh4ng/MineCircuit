// jar の外にある翻訳（docs/design.md「Modpack / ModpackLoader」の「jar の外の翻訳」）。
// Modpack によっては、resourcepacks/ のリソースパック（zip またはフォルダ）や ModTranslations/、kubejs/assets/ で
// Mod の翻訳を足している。そこから assets/<namespace>/lang/ の ja_jp / en_us を読み、jar の翻訳の上に重ねる。
// zip のリソースパックは jar と同じ読み方（scanJar、Worker、保存）で読むので、ここではフォルダだけを読む。

import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'
import { LANG_CODES, parseLenientJson, pickNames, type JarSummary, type LangCode, type LangTable } from './jarScanner'
import { KUBEJS_DIR } from './kubejs'
import { stripBom } from './modMetadata'

/** リソースパックを置くフォルダ */
export const RESOURCEPACKS_DIR = 'resourcepacks'
/** Mod の翻訳を足すフォルダ。中は `assets/<namespace>/lang/` の形（pack.mcmeta はない） */
export const MOD_TRANSLATIONS_DIR = 'ModTranslations'
/** ゲームの設定。有効なリソースパックとその順番（`resourcePacks:[...]`）が書いてある */
export const OPTIONS_TXT = 'options.txt'

/** jar の外の翻訳の置き場所1つ。path は Modpack のフォルダからの相対パス */
export interface LangPackLocation {
  readonly kind: 'zip' | 'folder'
  readonly path: string
}

/** 翻訳の置き場所1つを読んだ結果 */
export interface LangPack {
  /** Modpack のフォルダからの相対パス（`resourcepacks/foo.zip`、`ModTranslations`） */
  readonly path: string
  /** 言語ごとの表示名。ブロック・アイテム・エンティティ・液体の名前だけ */
  readonly lang: Record<LangCode, LangTable>
  /** 読めなかったファイル。読み込みは続ける */
  readonly problems: string[]
}

const LANG_FILE = /^(ja_jp|en_us)\.json$/i

function isZip(name: string): boolean {
  return !isDirectoryEntry(name) && name.toLowerCase().endsWith('.zip')
}

/** フォルダの中身。なければ null */
async function listOrNull(source: FileSource, dir: string): Promise<string[] | null> {
  try {
    return await source.list(dir)
  } catch (e) {
    if (e instanceof FileNotFoundError) return null
    throw e
  }
}

/**
 * options.txt の `resourcePacks:[...]` から、resourcepacks/ の中のパックの名前を順に取り出す。
 * 並びはゲームと同じで、後ろのものほど優先される。`file/` の付かないもの（vanilla、Mod 内蔵のパック）は除く。
 * 書いていなければ null。
 */
export function resourcePackOrder(optionsTxt: string): string[] | null {
  for (const line of stripBom(optionsTxt).split(/\r?\n/)) {
    if (!line.startsWith('resourcePacks:')) continue
    try {
      const value: unknown = JSON.parse(line.slice('resourcePacks:'.length))
      if (!Array.isArray(value)) return null
      return value
        .filter((v): v is string => typeof v === 'string' && v.startsWith('file/'))
        .map((v) => v.slice('file/'.length))
    } catch {
      return null
    }
  }
  return null
}

/**
 * jar の外の翻訳の置き場所を、優先度の低い順に並べる（後ろのものが前のものを上書きする）。
 *
 * 1. `kubejs/`（`kubejs/assets/` があるとき。KubeJS が足したブロックの翻訳と資産。jar の翻訳より優先）
 * 2. `ModTranslations/`（Mod の翻訳を足すもの）
 * 3. `resourcepacks/` のうち options.txt に書いていないもの（名前順）
 * 4. `resourcepacks/` のうち options.txt に書いてあるもの（options.txt の順。ゲームで有効にしたパック）
 *
 * どれもなければ空の配列。options.txt がなくても、resourcepacks/ にあるものはすべて読む
 * （Modpack が別の Mod でパックを有効にしていることがあるため）。
 */
export async function findLangPacks(source: FileSource): Promise<LangPackLocation[]> {
  const top = await source.list('')
  const out: LangPackLocation[] = []
  if (top.includes(`${KUBEJS_DIR}/`) && (await listOrNull(source, `${KUBEJS_DIR}/assets`))) {
    out.push({ kind: 'folder', path: KUBEJS_DIR })
  }
  if (top.includes(`${MOD_TRANSLATIONS_DIR}/`)) out.push({ kind: 'folder', path: MOD_TRANSLATIONS_DIR })

  const packs = top.includes(`${RESOURCEPACKS_DIR}/`) ? await listOrNull(source, RESOURCEPACKS_DIR) : null
  if (!packs) return out

  let order: string[] = []
  if (top.includes(OPTIONS_TXT)) {
    try {
      const text = new TextDecoder('utf-8').decode(await source.read(OPTIONS_TXT))
      order = resourcePackOrder(text) ?? []
    } catch {
      // options.txt が読めなくても、パックは名前順で読む
    }
  }

  const candidates = packs.filter((name) => isZip(name) || isDirectoryEntry(name)).sort()
  const bareName = (name: string) => (isDirectoryEntry(name) ? name.slice(0, -1) : name)
  const rank = (name: string) => order.lastIndexOf(bareName(name))
  const unlisted = candidates.filter((name) => rank(name) < 0)
  const listed = candidates.filter((name) => rank(name) >= 0).sort((a, b) => rank(a) - rank(b))
  for (const name of [...unlisted, ...listed]) {
    out.push({ kind: isZip(name) ? 'zip' : 'folder', path: `${RESOURCEPACKS_DIR}/${bareName(name)}` })
  }
  return out
}

function emptyLangPack(path: string): LangPack {
  return { path, lang: { ja_jp: {}, en_us: {} }, problems: [] }
}

/**
 * フォルダのリソースパック（または ModTranslations/）から、`assets/<namespace>/lang/` の ja_jp / en_us を読む。
 * assets/ がなければ空の結果を返す。
 */
export async function readFolderLangPack(source: FileSource, dir: string): Promise<LangPack> {
  const pack = emptyLangPack(dir)
  const namespaces = await listOrNull(source, `${dir}/assets`)
  if (!namespaces) return pack
  const decoder = new TextDecoder('utf-8')
  for (const ns of namespaces.filter(isDirectoryEntry).sort()) {
    const langDir = `${dir}/assets/${ns}lang`
    const files = await listOrNull(source, langDir)
    if (!files) continue
    for (const file of files.sort()) {
      const m = LANG_FILE.exec(file)
      if (!m) continue
      const code = m[1].toLowerCase() as LangCode
      const name = `assets/${ns}lang/${file}`
      try {
        const names = pickNames(parseLenientJson(stripBom(decoder.decode(await source.read(`${langDir}/${file}`)))))
        if (names) Object.assign(pack.lang[code], names)
        else pack.problems.push(`${name}: 翻訳ファイルの形が違います`)
      } catch {
        pack.problems.push(`${name}: JSON として読めません`)
      }
    }
  }
  return pack
}

/** zip のリソースパックを scanJar で読んだ結果から、翻訳だけを取り出す */
export function langPackFromSummary(path: string, summary: JarSummary): LangPack {
  const pack = emptyLangPack(path)
  for (const code of LANG_CODES) Object.assign(pack.lang[code], summary.lang[code])
  pack.problems.push(...summary.problems)
  return pack
}

/** 表示名を1つでも持つか */
export function hasNames(pack: LangPack): boolean {
  return LANG_CODES.some((code) => Object.keys(pack.lang[code]).length > 0)
}
