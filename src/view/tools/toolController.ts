import type { PickModifiers, PickTarget, Tool, ToolId } from './tool'

/**
 * ツールを登録し、今のツールにマウスの移動とクリックを渡す。
 * Vue に依存しないので、表示なしでテストできる。画面からは useToolStore を通して使う。
 */
export class ToolController {
  private readonly tools = new Map<ToolId, Tool>()
  private activeId: ToolId | null = null
  private lastHover: PickTarget | null = null

  /** 今のツールが変わったときに呼ばれる */
  onActiveChange: ((id: ToolId | null) => void) | null = null

  /** ツールを登録する。同じ id があれば置き換える。最初に登録したツールが今のツールになる */
  register(tool: Tool): void {
    const wasActive = this.activeId === tool.id
    if (wasActive) this.tools.get(tool.id)?.deactivate?.()
    this.tools.set(tool.id, tool)
    if (wasActive) tool.activate?.()
    else if (this.activeId === null) this.setActive(tool.id)
  }

  /** 登録済みなら true。ツールバーで、まだ作っていないツールを使えなくするのに使う */
  has(id: ToolId): boolean {
    return this.tools.has(id)
  }

  get active(): ToolId | null {
    return this.activeId
  }

  get activeTool(): Tool | null {
    return this.activeId === null ? null : (this.tools.get(this.activeId) ?? null)
  }

  /** ツールを切り替える。登録されていないツールなら何もせず false */
  setActive(id: ToolId): boolean {
    const next = this.tools.get(id)
    if (!next) return false
    if (this.activeId === id) return true
    const prev = this.activeTool
    if (prev) {
      prev.onHover(null)
      prev.deactivate?.()
    }
    this.activeId = id
    next.activate?.()
    // マウスが表示の上にあるまま切り替えたときも、すぐに新しいツールの表示を出す
    next.onHover(this.lastHover)
    this.onActiveChange?.(id)
    return true
  }

  /** 表示からマウスの移動を受け取る。表示の外に出たら null */
  hover(target: PickTarget | null): void {
    this.lastHover = target
    this.activeTool?.onHover(target)
  }

  /** 表示からクリックを受け取る */
  click(target: PickTarget, mods: PickModifiers = { shift: false }): void {
    this.activeTool?.onClick(target, mods)
  }
}
