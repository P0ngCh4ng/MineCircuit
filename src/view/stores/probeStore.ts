// プローブとネットのハイライトの状態（#31）。持つのは位置だけで、値は計算結果（calcStore）から引く。

import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import type { Vec3 } from '../../domain/vec3'
import { networkAt, probeAt, type ProbeReading } from '../calc/probeModel'
import { useCalcStore } from './calcStore'

export const useProbeStore = defineStore('probe', () => {
  const calc = useCalcStore()

  /** プローブでクリックしたブロック。このブロックのネットワークを強調する */
  const probedPos = shallowRef<Vec3 | null>(null)
  /** プローブを使っている間の、マウスの下のブロック */
  const hoveredPos = shallowRef<Vec3 | null>(null)

  /** 右パネルに値を出すブロック。マウスの下を優先し、なければクリックしたブロック */
  const shownPos = computed<Vec3 | null>(() => hoveredPos.value ?? probedPos.value)

  /** shownPos のブロックの値（プラグインごと） */
  const readings = computed<ProbeReading[]>(() => (shownPos.value ? probeAt(calc.outcomes, shownPos.value) : []))

  /** 強調するネットワークのブロックの位置。クリックしていない、またはネットワークがなければ null */
  const networkPositions = computed<Vec3[] | null>(() =>
    probedPos.value ? networkAt(calc.outcomes, probedPos.value) : null,
  )

  function setProbed(pos: Vec3 | null): void {
    probedPos.value = pos
  }

  function setHovered(pos: Vec3 | null): void {
    hoveredPos.value = pos
  }

  /** 強調とプローブの表示を消す */
  function clear(): void {
    probedPos.value = null
    hoveredPos.value = null
  }

  return { probedPos, hoveredPos, shownPos, readings, networkPositions, setProbed, setHovered, clear }
})
