// Modpack の Minecraft のバージョンを、jar の名前と Mod のバージョンから推定する。
// 新規の設計図の DataVersion の初期値に使う（docs/design.md「BlueprintWriter」）。
// jar には Minecraft のバージョンを確実に書いた場所がないので、推定にとどめ、利用者が選び直せるようにする。

import { MINECRAFT_VERSIONS, type MinecraftVersion } from '../../domain/minecraftVersion'
import type { ModInfo } from './modMetadata'

/** 前後が数字や . でない "1.20.1" を探す（"create-1.20.1-0.5.1.f.jar"、"sodium-0.5.3+mc1.20.1"） */
const VERSION_PATTERN = /(?<![\d.])1\.\d{1,2}(?:\.\d{1,2})?(?![\d.])/g

/**
 * Mod の一覧から Minecraft のバージョンを推定する。
 * 各 jar の名前と Mod のバージョンに出てくる、一覧（MINECRAFT_VERSIONS）にあるバージョンを数え、
 * 一番多く出てくるものを返す。見つからないときや、一番多いものが2つ以上あるときは null。
 */
export function guessMinecraftVersion(mods: readonly Pick<ModInfo, 'jar' | 'version'>[]): MinecraftVersion | null {
  // 同じ jar の中の Mod は1つと数える。中の jar（外.jar!/中.jar）は外の jar に含める
  const textsByJar = new Map<string, string[]>()
  for (const mod of mods) {
    const outer = mod.jar.split('!/')[0]
    // 拡張子の . がバージョンの続きに見えないように取る
    const texts = textsByJar.get(outer) ?? [outer.replace(/\.jar$/i, '')]
    if (mod.version !== null) texts.push(mod.version)
    textsByJar.set(outer, texts)
  }

  const counts = new Map<string, number>()
  for (const texts of textsByJar.values()) {
    const found = new Set<string>()
    for (const text of texts) for (const m of text.matchAll(VERSION_PATTERN)) found.add(m[0])
    for (const name of found) counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  let best: MinecraftVersion | null = null
  let bestCount = 0
  let tie = false
  for (const version of MINECRAFT_VERSIONS) {
    const n = counts.get(version.name) ?? 0
    if (n === 0) continue
    if (n > bestCount) {
      best = version
      bestCount = n
      tie = false
    } else if (n === bestCount) {
      tie = true
    }
  }
  return tie ? null : best
}
