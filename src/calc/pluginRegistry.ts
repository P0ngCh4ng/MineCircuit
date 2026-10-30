// 計算プラグインの一覧と、まとめて走らせる処理。

import type { BlockState } from '../domain/blockState'
import type { BlockTransform } from '../domain/blockTransform'
import type { Blueprint } from '../domain/blueprint'
import type { Box } from '../domain/box'
import type { Direction } from '../domain/direction'
import type { RawNbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'
import type { BlockEntityTransform } from '../edit/regionTransform'
import { transformVanillaState } from '../edit/stateTransform'
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

  /** 足りないブロック状態を補う。最初に答えたプラグインのもの。どれも答えなければ state のまま（理由なし） */
  completeState(state: BlockState): { state: BlockState; problem: string | null } {
    for (const p of this.plugins.values()) {
      const r = p.completeState?.(state) ?? null
      if (r) return r
    }
    return { state, problem: null }
  }

  /** Modpack がないときの棚に出す基本の部品。プラグインの順に並べる（#162） */
  basicBlocks(): { state: BlockState; name: string }[] {
    return [...this.plugins.values()].flatMap((p) => p.basicBlocks ?? [])
  }

  /** 置き方の補助。最初に位置を返したプラグインのもの。どれも使わなければ null */
  placementHelper(
    bp: Blueprint,
    hit: { readonly pos: Vec3; readonly face: Direction; readonly point: Vec3 },
    state: BlockState,
  ): { pos: Vec3; state: BlockState } | null {
    for (const p of this.plugins.values()) {
      const r = p.placementHelper?.(bp, hit, state) ?? null
      if (r) return r
    }
    return null
  }

  /** 範囲の回転・反転でのブロック状態。最初に答えたプラグインのもの。どれも答えなければバニラの規則 */
  transformState(state: BlockState, t: BlockTransform): BlockState {
    for (const p of this.plugins.values()) {
      const r = p.transformState?.(state, t) ?? null
      if (r) return r
    }
    return transformVanillaState(state, t)
  }

  /** 生データの中の座標の書き直し。最初に答えたプラグインのもの。どれも答えなければ null（そのまま） */
  transformBlockEntity(state: BlockState, nbt: RawNbt, t: BlockTransform, from: Vec3, to: Vec3, source: Box): BlockEntityTransform | null {
    for (const p of this.plugins.values()) {
      const r = p.transformBlockEntity?.(state, nbt, t, from, to, source) ?? null
      if (r) return r
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
