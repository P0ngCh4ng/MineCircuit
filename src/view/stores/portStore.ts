// 仮の入出力（VirtualPort）を置く画面の状態（#70）。
// 置いた仮の入出力そのものは calcStore.ports に持ち、ここは置く種類・選択中の1つと、変更の操作を持つ。
// 保存先：今は開いている設計図1つ分をメモリに持つだけで、別の設計図を開くと消す
// （docs/design.md「アプリ独自のファイル」。.mcircuit.json への保存は後の Issue）。

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BUILTIN_PLUGINS } from '../../calc/builtinPlugins'
import type { VirtualPort } from '../../calc/virtualPort'
import type { Vec3 } from '../../domain/vec3'
import { createPort, portAt, portKindKey, portKindOptions, type PortKindOption } from '../calc/portModel'
import { useCalcStore } from './calcStore'

export const usePortStore = defineStore('port', () => {
  const calc = useCalcStore()

  /** 置ける種類。プラグインの portKinds から作る（画面の入力欄に使うだけなので、Worker とは別に作ってよい） */
  const options: readonly PortKindOption[] = portKindOptions(BUILTIN_PLUGINS.map((make) => make()))

  /** 次に置く種類（portKindKey）。置ける種類がなければ null */
  const placeKey = ref<string | null>(options[0] ? portKindKey(options[0].pluginId, options[0].def.kind) : null)
  /** 一覧で選んでいる仮の入出力の id */
  const selectedId = ref<string | null>(null)
  let nextNumber = 1

  const ports = computed<readonly VirtualPort[]>(() => calc.ports)
  const placeOption = computed<PortKindOption | null>(
    () => options.find((o) => portKindKey(o.pluginId, o.def.kind) === placeKey.value) ?? null,
  )

  function setPorts(value: readonly VirtualPort[]): void {
    calc.setPorts(value)
  }

  /**
   * pos のブロックに、今の種類の仮の入出力を付けて選ぶ（#195）。同じブロックに同じ種類があれば、新しく置かずにそれを選ぶ。
   * 置ける種類がなければ null
   */
  function place(pos: Vec3): VirtualPort | null {
    const option = placeOption.value
    if (!option) return null
    const existing = portAt(calc.ports, pos, option)
    if (existing) {
      selectedId.value = existing.id
      return existing
    }
    const port = createPort(`port-${nextNumber++}`, option, pos)
    setPorts([...calc.ports, port])
    selectedId.value = port.id
    return port
  }

  /** 仮の入出力を差し替える（id で探す） */
  function update(port: VirtualPort): void {
    setPorts(calc.ports.map((p) => (p.id === port.id ? port : p)))
  }

  function remove(id: string): void {
    setPorts(calc.ports.filter((p) => p.id !== id))
    if (selectedId.value === id) selectedId.value = null
  }

  /** 範囲を動かす・回す・反転したとき、すべての仮の入出力の位置を map で直す */
  function relocate(map: (pos: Vec3) => Vec3): void {
    if (calc.ports.length === 0) return
    setPorts(calc.ports.map((p) => ({ ...p, pos: map(p.pos) })))
  }

  /** 一覧を丸ごと差し替える（消したブロックの仮の入出力を消す・戻すとき。#167）。選んでいたものがなくなれば選択を外す */
  function replaceAll(value: readonly VirtualPort[]): void {
    setPorts(value)
    if (selectedId.value !== null && !value.some((p) => p.id === selectedId.value)) selectedId.value = null
  }

  /** すべて消す（別の設計図を開いたときも） */
  function clear(): void {
    if (calc.ports.length > 0) setPorts([])
    selectedId.value = null
  }

  function select(id: string | null): void {
    selectedId.value = id
  }

  function setPlaceKey(key: string): void {
    placeKey.value = key
  }

  return { options, placeKey, placeOption, selectedId, ports, place, update, relocate, replaceAll, remove, clear, select, setPlaceKey }
})
