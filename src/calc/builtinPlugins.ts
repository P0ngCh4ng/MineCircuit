// アプリに入れる計算プラグインの一覧。計算の Worker（workers/calcWorker.ts）がこれを使う。
// プラグインは関数を持つので Worker へ送れない。Worker の中でこの一覧から作る。

import type { CalcPlugin } from './calcPlugin'
import { createStressPlugin } from './create/createStressPlugin'
import { PluginRegistry } from './pluginRegistry'

/** 内蔵のプラグイン。Create の応力（#30）などをここに足す */
export const BUILTIN_PLUGINS: readonly (() => CalcPlugin)[] = [createStressPlugin]

export function createBuiltinRegistry(): PluginRegistry {
  return new PluginRegistry(BUILTIN_PLUGINS.map((make) => make()))
}
