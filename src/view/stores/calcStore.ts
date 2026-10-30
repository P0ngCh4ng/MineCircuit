// 計算の状態（右パネルの計算結果）。持つのは画面に出す結果と状態だけ。
// 設計図そのものは持たず、attach で渡されたものを計算のたびに読む。

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import { issueSeverity, type CalcModpack, type CalcRotation, type IssueSeverity } from '../../calc/calcPlugin'
import {
  CalcScheduler,
  InlineCalcBackend,
  type CalcBackend,
  type CalcRequest,
  type CalcSchedulerOptions,
  type CalcStatus,
} from '../../calc/calcScheduler'
import type { PluginOutcome } from '../../calc/pluginRegistry'
import type { VirtualPort } from '../../calc/virtualPort'
import type { Blueprint } from '../../domain/blueprint'
import type { Vec3 } from '../../domain/vec3'
import type { Signal } from '../../edit/signal'
import { createCalcWorkerBackend } from '../../workers/calcWorkerClient'

export const useCalcStore = defineStore('calc', () => {
  const status = ref<CalcStatus>('idle')
  /** 最後の計算の結果。まだ計算していなければ null */
  const outcomes = shallowRef<PluginOutcome[] | null>(null)
  /** 計算の仕組みの失敗 */
  const error = ref<string | null>(null)
  const hasBlueprint = ref(false)
  /** 仮の入出力。画面からは portStore（#70）を通して変える。.mcircuit.json への保存は後の Issue */
  const ports = shallowRef<readonly VirtualPort[]>([])

  // 設計図・Modpack・計算の仕組みは画面の状態ではないので、リアクティブにしない
  let blueprint: Blueprint | null = null
  let pack: CalcModpack | null = null
  let scheduler: CalcScheduler | null = null
  let disconnect: (() => void) | null = null

  function request(): CalcRequest | null {
    return blueprint ? { blueprint, pack, ports: ports.value } : null
  }

  /** 計算の仕組みを差し替える。テストでは InlineCalcBackend を渡す */
  function setBackend(backend: CalcBackend, options: CalcSchedulerOptions = {}): void {
    scheduler?.dispose()
    const s = markRaw(new CalcScheduler(backend, options))
    s.onStatus.connect((value) => {
      status.value = value
    })
    s.onResult.connect((value) => {
      error.value = null
      outcomes.value = markRaw(value)
    })
    s.onError.connect((message) => {
      error.value = message
    })
    scheduler = s
    status.value = s.status
  }

  function ensureScheduler(): CalcScheduler {
    if (!scheduler) setBackend(createCalcWorkerBackend() ?? new InlineCalcBackend(createBuiltinRegistry()))
    return scheduler as CalcScheduler
  }

  /**
   * 計算する設計図を決める。changed（EditHistory.onChange）が来るたびに、変更が止まってから計算し直す。
   * null を渡すと結果を消す。
   */
  function attach(bp: Blueprint | null, changed: Signal<void> | null = null): Promise<void> {
    disconnect?.()
    disconnect = null
    blueprint = bp
    hasBlueprint.value = bp !== null
    outcomes.value = null
    error.value = null
    const s = ensureScheduler()
    if (!bp) {
      s.cancel()
      return Promise.resolve()
    }
    if (changed) disconnect = changed.connect(() => s.schedule(request))
    return s.runNow(request)
  }

  /** Modpack を変えたら計算し直す */
  function setPack(value: CalcModpack | null): void {
    pack = value
    if (blueprint) ensureScheduler().schedule(request)
  }

  function setPorts(value: readonly VirtualPort[]): void {
    ports.value = value
    if (blueprint) ensureScheduler().schedule(request)
  }

  /** すぐ計算し直す */
  function recalculate(): Promise<void> {
    return ensureScheduler().runNow(request)
  }

  /** 3D 表示で強調する位置（全プラグインの問題のうちエラー。警告と情報は組み立て途中で多く出るので強調しない） */
  const issuePositions = computed<Vec3[]>(() =>
    (outcomes.value ?? []).flatMap((o) =>
      o.status === 'ok'
        ? o.result.issues.filter((i) => issueSeverity(i) === 'error').flatMap((i) => i.positions ?? [i.pos])
        : [],
    ),
  )

  /** 重さごとの問題の件数（全プラグインの分）。下の状態表示に出す（#159） */
  const issueCounts = computed<Record<IssueSeverity, number>>(() => {
    const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 }
    for (const o of outcomes.value ?? []) {
      if (o.status === 'ok') for (const i of o.result.issues) counts[issueSeverity(i)]++
    }
    return counts
  })

  /** 回るブロックごとの回転（すべてのプラグインの分）。表示部分の「回転」で使う */
  const rotations = computed<readonly CalcRotation[]>(() =>
    (outcomes.value ?? []).flatMap((o) => (o.status === 'ok' ? (o.result.rotations ?? []) : [])),
  )

  return {
    status,
    outcomes,
    error,
    hasBlueprint,
    ports,
    issuePositions,
    issueCounts,
    rotations,
    setBackend,
    attach,
    setPack,
    setPorts,
    recalculate,
  }
})
