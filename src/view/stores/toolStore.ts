import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'
import { boxFromCorners, singleCellBox, type Box } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { SelectTool } from '../tools/selectTool'
import type { PickModifiers, PickTarget, Tool, ToolId, ToolOverride } from '../tools/tool'
import { ToolController } from '../tools/toolController'

/**
 * 今のツールと、選択中・マウスの下のブロック。
 * docs/design.md の ViewState のうちツールに関わる部分。ViewState を作るときにまとめてよい。
 */
export const useToolStore = defineStore('tool', () => {
  const activeToolId = ref<ToolId | null>(null)
  /** ツールが登録されるたびに増える。ツールバーの「使えるか」を作り直すのに使う */
  const registeredIds = ref<ToolId[]>([])
  /**
   * 選択中のブロック（右パネルに出す）。範囲を選んでいるときは、範囲の起点（最初にクリックした所）
   */
  const selectedPos = shallowRef<Vec3 | null>(null)
  /**
   * 選択範囲（#130、docs/ui.md「範囲の選択と一括操作」）。1つのブロックを選んでいるときは 1×1×1 の箱。
   * 何も選んでいなければ null
   */
  const selectionBox = shallowRef<Box | null>(null)
  /** マウスの下のブロック */
  const hoveredPos = shallowRef<Vec3 | null>(null)
  /** 表示から来た最後の PickTarget（下の状態表示のマウス位置に使う） */
  const hoverTarget = shallowRef<PickTarget | null>(null)

  const controller = markRaw(new ToolController())
  controller.onActiveChange = (id) => {
    activeToolId.value = id
  }

  function register(tool: Tool): void {
    controller.register(tool)
    if (!registeredIds.value.includes(tool.id)) registeredIds.value = [...registeredIds.value, tool.id]
    activeToolId.value = controller.active
  }

  function isAvailable(id: ToolId): boolean {
    return registeredIds.value.includes(id)
  }

  /** ツールを切り替える。まだ使えないツールなら何もしない */
  function setTool(id: ToolId): boolean {
    return controller.setActive(id)
  }

  /** 3D/2D表示から呼ぶ。マウスが表示の外に出たら null */
  function hover(target: PickTarget | null): void {
    hoverTarget.value = target
    controller.hover(target)
  }

  /** 3D/2D表示から呼ぶ */
  function click(target: PickTarget, mods: PickModifiers = { shift: false }): void {
    controller.click(target, mods)
  }

  /** 1つのブロックを選ぶ（範囲もそのマスだけにする）。null なら選択を解除する */
  function setSelected(pos: Vec3 | null): void {
    selectedPos.value = pos
    selectionBox.value = pos ? singleCellBox(pos) : null
  }

  /** 起点（selectedPos）と pos を角にした範囲に広げる。起点がなければ pos を選ぶ */
  function extendSelection(pos: Vec3): void {
    const anchor = selectedPos.value
    if (!anchor) {
      setSelected(pos)
      return
    }
    selectionBox.value = boxFromCorners(anchor, pos)
  }

  /**
   * 範囲を直接決める（2D のドラッグ、パネルの座標の入力、Ctrl+A）。null なら解除。
   * 起点は anchor（ドラッグを始めたマスなど）。省略したら範囲の最小の角。続けて Shift+クリックすると、起点から広げる
   */
  function setSelectionBox(box: Box | null, anchor?: Vec3): void {
    selectionBox.value = box
    selectedPos.value = box ? (anchor ?? box.min) : null
  }

  function setHovered(pos: Vec3 | null): void {
    hoveredPos.value = pos
  }

  /** 今のツールの代わりにマウスを受け取るもの（貼り付けの見本。#133）。null で外す */
  function setOverride(next: ToolOverride | null): void {
    controller.setOverride(next)
  }

  // 選択ツールは最初から使える。ほかのツールは各 Issue で register する
  register(new SelectTool({ setSelected, extendSelection, setHovered }))

  return {
    activeToolId,
    registeredIds,
    selectedPos,
    selectionBox,
    hoveredPos,
    hoverTarget,
    register,
    isAvailable,
    setTool,
    hover,
    click,
    setSelected,
    extendSelection,
    setSelectionBox,
    setHovered,
    setOverride,
  }
})
