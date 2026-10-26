// 計算プラグインの一覧と、まとめて走らせる処理。

import type { BlockState } from '../domain/blockState'
import type { Blueprint } from '../domain/blueprint'
import type { Direction } from '../domain/direction'
import type { Vec3 } from '../domain/vec3'
import type { CalcModpack, CalcPlugin, CalcResult } from './calcPlugin'
import { portsFor, type VirtualPort } from './virtualPort'

export class PluginRegistry {
  private readonly plugins = new Map<string, CalcPlugin>()

  constructor(plugins: Iterable<CalcPlugin> = []) {
    for (const p of plugins) this.register(p)
  }

  /** プラグインを足す。同じ id があればエラー */
  register(p: CalcPlugin): void {
    if (this.plugins.has(p.id)) throw new Error(`計算プラグイン "${p.id}" はすでに登録されています。`)
    this.plugins.set(p.id, p)
  }

  get(id: string): CalcPlugin | null {
    return this.plugins.get(id) ?? null
  }

  /** 登録した順 */
  /**
   * 置くときの向き。向きを決めるプラグインに順に聞き、最初に変えたものを返す。どれも変えなければ state のまま。
   * 置く前の設計図には、まだそのプラグインのブロックがないことがあるので、supports は見ない
   */
  orientForPlacement(bp: Blueprint, pos: Vec3, state: BlockState, from: Direction | null): BlockState {
    for (const p of this.plugins.values()) {
      const oriented = p.orientForPlacement?.(bp, pos, state, from)
      if (oriented) return oriented
    }
    return state
  }

  /** その場所に置けるか。置けないと答えたプラグインの理由。どれも答えなければ null */
  placementProblem(bp: Blueprint, pos: Vec3, state: BlockState): string | null {
    for (const p of this.plugins.values()) {
      const problem = p.placementProblem?.(bp, pos, state) ?? null
      if (problem) return problem
    }
    return null
  }

  all(): CalcPlugin[] {
    return [...this.plugins.values()]
  }

  /** この設計図を計算できるプラグイン。supports が例外を出したものは除く */
  available(bp: Blueprint, pack: CalcModpack | null): CalcPlugin[] {
    return this.all().filter((p) => {
      try {
        return p.supports(bp, pack)
      } catch {
        return false
      }
    })
  }
}

/** プラグイン1つ分の計算の結果。失敗しても他のプラグインの結果は残す */
export type PluginOutcome =
  | { readonly pluginId: string; readonly label: string; readonly status: 'ok'; readonly result: CalcResult }
  | { readonly pluginId: string; readonly label: string; readonly status: 'error'; readonly message: string }

/**
 * 計算できるプラグインを順に走らせる。各プラグインには自分宛ての仮の入出力だけを渡す。
 * プラグインの例外は、そのプラグインの 'error' にして続ける。
 */
export async function runPlugins(
  registry: PluginRegistry,
  bp: Blueprint,
  pack: CalcModpack | null,
  ports: readonly VirtualPort[],
): Promise<PluginOutcome[]> {
  const outcomes: PluginOutcome[] = []
  for (const plugin of registry.available(bp, pack)) {
    const base = { pluginId: plugin.id, label: plugin.label }
    try {
      const result = await plugin.run(bp, { pack, ports: portsFor(ports, plugin.id) })
      outcomes.push({ ...base, status: 'ok', result })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      outcomes.push({
        ...base,
        status: 'error',
        message: `計算の途中でエラーが起きました（${detail}）。設計図を確かめて、直らなければ不具合として報告してください。`,
      })
    }
  }
  return outcomes
}
