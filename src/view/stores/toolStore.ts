import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'
import type { Vec3 } from '../../domain/vec3'
import { SelectTool } from '../tools/selectTool'
import type { PickModifiers, PickTarget, Tool, ToolId } from '../tools/tool'
import { ToolController } from '../tools/toolController'

/**
 * 今のツールと、選択中・マウスの下のブロック。
 * docs/design.md の ViewState のうちツールに関わる部分。ViewState を作るときにまとめてよい。
 */
export const useToolStore = defineStore('tool', () => {
  const activeToolId = ref<ToolId | null>(null)
  /** ツールが登録されるたびに増える。ツールバーの「使えるか」を作り直すのに使う */
  const registeredIds = ref<ToolId[]>([])
  /** 選択中のブロック（右パネルに出す） */
  const selectedPos = shallowRef<Vec3 | null>(null)
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

  function setSelected(pos: Vec3 | null): void {
    selectedPos.value = pos
  }

  function setHovered(pos: Vec3 | null): void {
    hoveredPos.value = pos
  }

  // 選択ツールは最初から使える。ほかのツールは各 Issue で register する
  register(new SelectTool({ setSelected, setHovered }))

  return {
    activeToolId,
    registeredIds,
    selectedPos,
    hoveredPos,
    hoverTarget,
    register,
    isAvailable,
    setTool,
    hover,
    click,
    setSelected,
    setHovered,
  }
})
