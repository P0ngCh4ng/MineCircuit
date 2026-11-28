// Create のサーバー設定（create-server.toml）を読む（docs/create-stress.md「設定ファイルの場所」「TOML の形」）。
// TOML の読み方は共通の calc/tomlSubset.ts。

import type { CalcModpack } from '../calcPlugin'
import { parseTomlSubset } from '../tomlSubset'

/** create-server.toml から取り出した、応力の計算に使う値 */
export interface CreateServerConfig {
  /** どのファイルから読んだか（Modpack のフォルダからの相対パス） */
  readonly path: string
  readonly maxRotationSpeed: number | null
  readonly disableStress: boolean | null
  readonly mediumSpeed: number | null
  readonly fastSpeed: number | null
  /** 風車を組み立てられる帆の数の下限（`kinetics.minimumWindmillSails`。#243） */
  readonly minimumWindmillSails: number | null
  /** 風車の回転数を 1 RPM 上げるのに要る帆の数（`kinetics.windmillSailsPerRPM`。#243） */
  readonly windmillSailsPerRPM: number | null
  /** ファンネルが取り出す間隔（tick。`logistics.defaultExtractionTimer`） */
  readonly extractionTimer: number | null
  /** プレスがスタックごと押すか（`recipes.bulkPressing`） */
  readonly bulkPressing: boolean | null
  /** stressValues の版（v2 なら 2）。表がなければ null */
  readonly stressVersion: number | null
  /** ブロック名（`create:` なし）→ SU/RPM */
  readonly impact: ReadonlyMap<string, number>
  readonly capacity: ReadonlyMap<string, number>
}

/** 設定ファイルの文字列から値を取り出す */
export function readCreateServerConfig(text: string, path: string): CreateServerConfig {
  const toml = parseTomlSubset(text)
  const num = (key: string): number | null => {
    const v = toml.get(key)
    return typeof v === 'number' ? v : null
  }
  const bool = (key: string): boolean | null => {
    const v = toml.get(key)
    return typeof v === 'boolean' ? v : null
  }
  // kinetics.stressValues.v<番号>.impact|capacity.<ブロック名>。番号が一番大きいものを使う
  const pattern = /^kinetics\.stressValues\.v(\d+)\.(impact|capacity)\.(.+)$/
  let version: number | null = null
  for (const key of toml.keys()) {
    const m = pattern.exec(key)
    if (m) version = Math.max(version ?? 0, Number(m[1]))
  }
  const impact = new Map<string, number>()
  const capacity = new Map<string, number>()
  if (version !== null) {
    for (const [key, value] of toml) {
      const m = pattern.exec(key)
      if (!m || Number(m[1]) !== version || typeof value !== 'number') continue
      ;(m[2] === 'impact' ? impact : capacity).set(m[3], value)
    }
  }
  return {
    path,
    maxRotationSpeed: num('kinetics.maxRotationSpeed'),
    disableStress: bool('kinetics.disableStress'),
    mediumSpeed: num('kinetics.stats.mediumSpeed'),
    fastSpeed: num('kinetics.stats.fastSpeed'),
    minimumWindmillSails: num('kinetics.minimumWindmillSails'),
    windmillSailsPerRPM: num('kinetics.windmillSailsPerRPM'),
    extractionTimer: num('logistics.defaultExtractionTimer'),
    bulkPressing: bool('recipes.bulkPressing'),
    stressVersion: version,
    impact,
    capacity,
  }
}

export const CREATE_SERVER_CONFIG = 'create-server.toml'

/** 設定ファイルを探した結果 */
export interface CreateConfigLookup {
  /** 見つからなければ null（内蔵の初期値を使う） */
  readonly config: CreateServerConfig | null
  /** 見つかったファイルのすべて。2つ以上なら、先頭を使ったことを仮定に載せる */
  readonly candidates: readonly string[]
}

/**
 * Modpack から create-server.toml を探す。
 * 1. saves/<ワールド>/serverconfig/create-server.toml（複数あれば名前順で先頭）
 * 2. defaultconfigs/create-server.toml
 * ゲームが実際に使うのはワールドの設定ファイル（足りない項目を初期値で補ったもの）なので、そちらを先に使う。
 * defaultconfigs/ は新しいワールドに写されるもとで、古い形のまま残っていることがある（docs/create-stress.md「Create Astral の設定」）。
 * Modpack がない、またはファイルがなければ config は null。
 */
export async function loadCreateConfig(pack: CalcModpack | null): Promise<CreateConfigLookup> {
  if (!pack) return { config: null, candidates: [] }
  const found: { path: string; text: string }[] = []
  for (const world of await listDirs(pack, 'saves/')) {
    const path = `saves/${world}serverconfig/${CREATE_SERVER_CONFIG}`
    const t = await pack.config(path)
    if (t !== null) found.push({ path, text: t })
  }
  if (found.length > 0) {
    return { config: readCreateServerConfig(found[0].text, found[0].path), candidates: found.map((f) => f.path) }
  }

  const defaults = `defaultconfigs/${CREATE_SERVER_CONFIG}`
  const text = await pack.config(defaults)
  if (text !== null) return { config: readCreateServerConfig(text, defaults), candidates: [defaults] }
  return { config: null, candidates: [] }
}

async function listDirs(pack: CalcModpack, dir: string): Promise<string[]> {
  if (!pack.list) return []
  let entries: string[]
  try {
    entries = await pack.list(dir)
  } catch {
    // saves/ がない Modpack（サーバー用など）もある
    return []
  }
  return entries.filter((e) => e.endsWith('/')).sort()
}
