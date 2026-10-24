// Minecraft 本体の jar（クライアントの jar）と、ランチャーの資産フォルダ（assets/）を探す
// （docs/design.md「Minecraft 本体の資産」）。
// 本体の jar はアプリにもリポジトリにも入れない。利用者の PC にあるものを、その場で読むだけにする。
//
// ランチャーごとの置き場所（「ゲームのフォルダ」は versions/・libraries/・assets/ が入っているフォルダ）:
//
// | ランチャー | ゲームのフォルダ | 本体の jar | 資産の索引 |
// | --- | --- | --- | --- |
// | 公式ランチャー | `.minecraft` | `versions/<版>/<版>.jar` | `versions/<版>/<版>.json` の assetIndex.id |
// | CurseForge | `curseforge/minecraft/Install` | 同上 | 同上 |
// | Modrinth App | `ModrinthApp/meta` | 同上（Mod ローダーを使うと `versions/<版>-<ローダー>/` の下） | 同上 |
// | Prism / MultiMC | ランチャーのフォルダ | `libraries/com/mojang/minecraft/<版>/minecraft-<版>-client.jar` | `meta/net.minecraft/<版>.json` の assetIndex.id |
//
// 資産の索引は `assets/indexes/<id>.json`、中身は `assets/objects/<ハッシュの先頭2文字>/<ハッシュ>`。
// 本体の jar の翻訳は en_us だけで、ja_jp は資産の索引から読む。

import type { MinecraftVersion } from '../../domain/minecraftVersion'
import { FileNotFoundError, isDirectoryEntry, type FileSource } from '../fileSource'
import { parseLenientJson, pickNames, type JarSummary, type LangTable } from './jarScanner'
import { guessMinecraftVersion } from './minecraftVersionGuess'
import type { ModInfo } from './modMetadata'

/** 本体の jar の場所 */
export interface ClientJarLocation {
  /** ゲームのフォルダからの相対パス */
  readonly path: string
  /** 版の情報（`versions/<id>/<id>.json`）を探すときの id。Prism の配置では null */
  readonly versionId: string | null
}

/** 読み込んだ本体の資産。Modpack に一番優先度の低い資産として足す */
export interface VanillaAssets {
  /** Minecraft の版（`1.20.1`） */
  readonly version: string
  /** 本体の jar を読むフォルダ（Modpack のフォルダか、利用者が選んだゲームのフォルダ） */
  readonly source: FileSource
  /** source からの本体の jar のパス */
  readonly jarPath: string
  /** 本体の jar を読んだ結果（翻訳は en_us だけ。資産の索引付き） */
  readonly summary: JarSummary
  /** 資産の索引から読んだ日本語の表示名。読めなければ空 */
  readonly jaJp: LangTable
}

/** 本体の資産を探した結果。画面に出す */
export type VanillaStatus =
  | {
      readonly kind: 'found'
      readonly version: string
      /** 本体の jar を見つけたフォルダの名前（`Modpack のフォルダ` か、選んだフォルダの名前）と jar のパス */
      readonly where: string
      readonly jarPath: string
      /** 日本語の表示名を読めたか */
      readonly jaJp: boolean
    }
  | {
      readonly kind: 'missing'
      /** 探した版。分からなければ null */
      readonly version: string | null
    }

/** 本体の資産を探した結果と、読めたときの中身 */
export interface VanillaLoadResult {
  readonly status: VanillaStatus
  readonly assets: VanillaAssets | null
}

/** 版の名前の形（`1.20.1`、`1.21`） */
const RELEASE_NAME = /^1\.\d{1,2}(?:\.\d{1,2})?$/

/** ファイルがあるか。親のフォルダの一覧で確かめる */
export async function fileExists(source: FileSource, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const dir = slash < 0 ? '' : path.slice(0, slash)
  const name = path.slice(slash + 1)
  try {
    return (await source.list(dir)).includes(name)
  } catch (e) {
    if (e instanceof FileNotFoundError) return false
    throw e
  }
}

async function listOrEmpty(source: FileSource, dir: string): Promise<string[]> {
  try {
    return await source.list(dir)
  } catch (e) {
    if (e instanceof FileNotFoundError) return []
    throw e
  }
}

async function readJson(source: FileSource, path: string): Promise<unknown> {
  try {
    const text = new TextDecoder('utf-8').decode(await source.read(path))
    return parseLenientJson(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return null
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function releaseName(value: unknown): string | null {
  return typeof value === 'string' && RELEASE_NAME.test(value) ? value : null
}

/**
 * Modpack のフォルダにあるランチャーの情報から、Minecraft の版を読む。なければ null。
 * - CurseForge：`minecraftinstance.json` の `gameVersion`（なければ `baseModLoader.minecraftVersion`）
 * - Modrinth App（0.8 より前）：`profile.json` の `metadata.game_version`
 */
export async function readInstanceVersion(source: FileSource): Promise<string | null> {
  const top = await listOrEmpty(source, '')
  if (top.includes('minecraftinstance.json')) {
    const json = await readJson(source, 'minecraftinstance.json')
    const v = releaseName(field(json, 'gameVersion')) ?? releaseName(field(field(json, 'baseModLoader'), 'minecraftVersion'))
    if (v) return v
  }
  if (top.includes('profile.json')) {
    const json = await readJson(source, 'profile.json')
    const v = releaseName(field(field(json, 'metadata'), 'game_version'))
    if (v) return v
  }
  return null
}

/**
 * Modpack の Minecraft の版を決める。ランチャーの情報 → Mod の jar の名前とバージョンからの推定、の順。
 * どちらでも分からなければ null
 */
export async function modpackMinecraftVersion(
  source: FileSource,
  mods: readonly Pick<ModInfo, 'jar' | 'version'>[],
): Promise<string | null> {
  const fromInstance = await readInstanceVersion(source)
  if (fromInstance) return fromInstance
  const guessed: MinecraftVersion | null = guessMinecraftVersion(mods)
  return guessed?.name ?? null
}

/**
 * ゲームのフォルダ（または Modpack のフォルダ）から、版 version の本体の jar を探す。なければ null。
 * 探す順：`versions/<版>/<版>.jar` → Prism の `libraries/…/minecraft-<版>-client.jar` →
 * `versions/<版>-<ローダー>/<同じ名前>.jar`（Modrinth App）→ フォルダの一番上の `<版>.jar`・`minecraft-<版>-client.jar`
 * （版のフォルダそのものを選んだとき）
 */
export async function findClientJar(source: FileSource, version: string): Promise<ClientJarLocation | null> {
  const exact = `versions/${version}/${version}.jar`
  if (await fileExists(source, exact)) return { path: exact, versionId: version }
  const prism = `libraries/com/mojang/minecraft/${version}/minecraft-${version}-client.jar`
  if (await fileExists(source, prism)) return { path: prism, versionId: null }
  for (const name of (await listOrEmpty(source, 'versions')).sort()) {
    if (!isDirectoryEntry(name) || !name.startsWith(`${version}-`)) continue
    const id = name.slice(0, -1)
    const path = `versions/${id}/${id}.jar`
    if (await fileExists(source, path)) return { path, versionId: id }
  }
  const top = await listOrEmpty(source, '')
  if (top.includes(`${version}.jar`)) return { path: `${version}.jar`, versionId: null }
  if (top.includes(`minecraft-${version}-client.jar`)) return { path: `minecraft-${version}-client.jar`, versionId: null }
  return null
}

/**
 * 版が分からないとき、フォルダにある本体の版が1つだけならそれを返す。0個か2個以上なら null
 */
export async function soleInstalledVersion(source: FileSource): Promise<string | null> {
  const found = new Set<string>()
  for (const name of await listOrEmpty(source, 'versions')) {
    const v = name.endsWith('/') ? name.slice(0, -1) : ''
    if (RELEASE_NAME.test(v)) found.add(v)
  }
  for (const name of await listOrEmpty(source, 'libraries/com/mojang/minecraft')) {
    const v = name.endsWith('/') ? name.slice(0, -1) : ''
    if (RELEASE_NAME.test(v)) found.add(v)
  }
  return found.size === 1 ? [...found][0] : null
}

/** ゲームのフォルダらしいか（versions/・libraries/・assets/ のどれかか、一番上に jar がある） */
export async function looksLikeGameFolder(source: FileSource): Promise<boolean> {
  const top = await listOrEmpty(source, '')
  return top.some(
    (n) => n === 'versions/' || n === 'libraries/' || n === 'assets/' || (!isDirectoryEntry(n) && n.toLowerCase().endsWith('.jar')),
  )
}

/**
 * Modpack のフォルダの絶対パスから、ランチャーのゲームのフォルダの絶対パスを割り出す（フォルダを選ぶ画面の初めの場所に使う）。
 * CurseForge は `<L>/Instances/<名前>` → `<L>/Install`、Modrinth App は `<L>/profiles/<名前>` → `<L>/meta`、
 * Prism Launcher・MultiMC は `<L>/instances/<名前>/.minecraft`（または `minecraft`）→ `<L>`。
 * どれにも当たらなければ null。区切りは元のパスに合わせる。フォルダがあるかは確かめない
 */
export function guessGameFolderPath(modpackPath: string): string | null {
  const sep = modpackPath.includes('\\') ? '\\' : '/'
  const parts = modpackPath.replace(/[\\/]+$/, '').split(/[\\/]+/)
  const at = (fromEnd: number) => (parts[parts.length - fromEnd] ?? '').toLowerCase()
  const join = (keep: number, ...rest: string[]) => [...parts.slice(0, parts.length - keep), ...rest].join(sep)
  if (parts.length >= 4 && (at(1) === '.minecraft' || at(1) === 'minecraft') && at(3) === 'instances') return join(3)
  if (parts.length >= 3 && at(2) === 'instances') return join(2, 'Install')
  if (parts.length >= 3 && at(2) === 'profiles') return join(2, 'meta')
  return null
}

/**
 * 資産の索引（`assets/indexes/<id>.json`）のパスを探す。id は版の情報の `assetIndex.id` から読む
 * （`versions/<id>/<id>.json`、Prism は `meta/net.minecraft/<版>.json`）。
 * 版の情報がなければ `assets/indexes/<版>.json` と `<1.xx>.json` を試す。なければ null
 */
export async function findAssetIndex(source: FileSource, version: string, jar: ClientJarLocation): Promise<string | null> {
  const infoPaths = [
    ...(jar.versionId ? [`versions/${jar.versionId}/${jar.versionId}.json`] : []),
    `versions/${version}/${version}.json`,
    `meta/net.minecraft/${version}.json`,
  ]
  const ids: string[] = []
  for (const path of infoPaths) {
    if (!(await fileExists(source, path))) continue
    const id = field(field(await readJson(source, path), 'assetIndex'), 'id')
    if (typeof id === 'string' && /^[\w.-]+$/.test(id)) ids.push(id)
  }
  ids.push(version, version.split('.').slice(0, 2).join('.'))
  for (const id of ids) {
    const path = `assets/indexes/${id}.json`
    if (await fileExists(source, path)) return path
  }
  return null
}

/** 資産の索引の中の、日本語の翻訳ファイルの名前 */
const JA_JP_OBJECT = 'minecraft/lang/ja_jp.json'

/**
 * 資産の索引から、日本語の翻訳ファイルの中身の場所（`assets/objects/<2文字>/<ハッシュ>`）を返す。なければ null
 */
export async function findJaJpObject(source: FileSource, indexPath: string): Promise<{ path: string; hash: string } | null> {
  const index = await readJson(source, indexPath)
  const hash = field(field(field(index, 'objects'), JA_JP_OBJECT), 'hash')
  if (typeof hash !== 'string' || !/^[0-9a-f]{40}$/i.test(hash)) return null
  const h = hash.toLowerCase()
  return { path: `assets/objects/${h.slice(0, 2)}/${h}`, hash: h }
}

/** 日本語の翻訳ファイルを読み、名前のキーだけを取り出す。読めなければ null */
export async function readJaJpObject(source: FileSource, path: string): Promise<LangTable | null> {
  return pickNames(await readJson(source, path))
}
