// アプリに入れる計算プラグインの一覧。計算の Worker（workers/calcWorker.ts）がこれを使う。
// プラグインは関数を持つので Worker へ送れない。Worker の中でこの一覧から作る。
// Mod の場所どうしは互いに import しないので、アドオンの表（docs/design.md「アドオンの表」）もここでつなぐ。

import type { CalcPlugin } from './calcPlugin'
import { createStressPlugin } from './create/createStressPlugin'
import { CREATE_ADDITION_KINETICS } from './createaddition/createAdditionBlocks'
import { createAdditionPowerPlugin } from './createaddition/createAdditionPowerPlugin'
import { PluginRegistry } from './pluginRegistry'

/**
 * 内蔵のプラグイン。並んだ順に走り、後のものは前の結果を使える（docs/design.md「プラグインの順番と、前の結果」）。
 * Crafts & Additions の電力は、発電機の回転数に Create の応力の結果を使うので、その後に置く
 */
export const BUILTIN_PLUGINS: readonly (() => CalcPlugin)[] = [
  () => createStressPlugin([CREATE_ADDITION_KINETICS]),
  createAdditionPowerPlugin,
]

export function createBuiltinRegistry(): PluginRegistry {
  return new PluginRegistry(BUILTIN_PLUGINS.map((make) => make()))
}
