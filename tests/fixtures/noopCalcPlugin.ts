// 何もしないテスト用の計算プラグイン。計算の土台（#29）の確認に使う。
// ブロックの数を数えるだけで、Mod の意味づけはしない。

import { AssumptionLog } from '../../src/calc/assumptionLog'
import type { CalcContext, CalcIssue, CalcModpack, CalcPlugin, CalcResult } from '../../src/calc/calcPlugin'
import { nbtNumber } from '../../src/calc/nbtValues'
import { candidate, resolved } from '../../src/calc/provenance'
import type { Blueprint } from '../../src/domain/blueprint'
import type { Vec3 } from '../../src/domain/vec3'

export const NOOP_PLUGIN_ID = 'test-noop'

export interface NoopPluginOptions {
  /** run の中で例外を出す */
  fail?: boolean
  /** 計算できるとみなすか */
  supports?: boolean
}

/**
 * - 合計：ブロック数（出どころ blueprint）、係数（設定ファイル → 内蔵の初期値）
 * - 問題：生データの "Broken" が 0 でないブロック。2 なら警告
 * - 仮定：範囲外は空気とみなしたこと、仮の入出力の数
 */
export function noopCalcPlugin(options: NoopPluginOptions = {}): CalcPlugin {
  return {
    id: NOOP_PLUGIN_ID,
    label: 'テスト用',
    portKinds: [
      {
        kind: 'test-source',
        label: 'テストの供給',
        params: [{ key: 'amount', label: '量', defaultValue: 1 }],
      },
    ],
    supports: (_bp: Blueprint, _pack: CalcModpack | null) => options.supports ?? true,
    async run(bp: Blueprint, ctx: CalcContext): Promise<CalcResult> {
      if (options.fail) throw new Error('テスト用の失敗')
      const log = new AssumptionLog()
      let count = 0
      const issues: CalcIssue[] = []
      for (const region of bp.regions) {
        region.forEachBlock((x, y, z, _state, be) => {
          count++
          const pos: Vec3 = [x + region.offset[0], y + region.offset[1], z + region.offset[2]]
          const broken = nbtNumber(be, 'Broken') ?? 0
          if (broken === 2) issues.push({ pos, message: '壊れそう', severity: 'warning' })
          else if (broken !== 0) issues.push({ pos, message: '壊れている' })
        })
      }
      const configText = ctx.pack ? await ctx.pack.config('config/test.txt') : null
      const factor = log.resolve(
        [candidate('modpack', () => (configText === null ? null : Number(configText)))],
        resolved(1, 'builtin'),
      )
      log.add('範囲外は空気とみなした', [0, 0, 0])
      for (const port of ctx.ports) log.add(`仮の入出力 ${port.kind} を使った`, port.pos)
      return {
        summary: [
          { label: 'ブロック数', value: resolved(String(count), 'blueprint') },
          { label: '係数', value: resolved(String(factor.value), factor.source) },
        ],
        issues,
        assumptions: log.list(),
      }
    },
  }
}
