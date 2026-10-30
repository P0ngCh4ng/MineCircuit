import type { PickModifiers, PickTarget, Tool, ToolId, ToolOverride } from './tool'

/**
 * ツールを登録し、今のツールにマウスの移動とクリックを渡す。
 * Vue に依存しないので、表示なしでテストできる。画面からは useToolStore を通して使う。
 */
export class ToolController {
  private readonly tools = new Map<ToolId, Tool>()
  private activeId: ToolId | null = null
  private lastHover: PickTarget | null = null
  private override: ToolOverride | null = null
  /** ドラッグを受け取っているツール（#161） */
  private dragging: Tool | null = null

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
    this.cancelDrag()
    if (prev) {
      prev.onHover(null)
      prev.deactivate?.()
    }
    this.activeId = id
    next.activate?.()
    // マウスが表示の上にあるまま切り替えたときも、すぐに新しいツールの表示を出す
    if (!this.override) next.onHover(this.lastHover)
    this.onActiveChange?.(id)
    return true
  }

  /**
   * 今のツールの代わりにマウスを受け取るものを差し込む（貼り付けの見本。#133）。null で外す。
   * 差し込んだときと外したときは、今のマウスの位置をすぐに渡す
   */
  setOverride(next: ToolOverride | null): void {
    if (this.override === next) return
    if (next) this.cancelDrag()
    if (next) this.activeTool?.onHover(null)
    else this.override?.onHover(null)
    this.override = next
    ;(next ?? this.activeTool)?.onHover(this.lastHover)
  }

  get overriding(): boolean {
    return this.override !== null
  }

  /** 最後に表示から来たマウスの下のもの */
  get lastTarget(): PickTarget | null {
    return this.lastHover
  }

  /** 表示からマウスの移動を受け取る。表示の外に出たら null */
  hover(target: PickTarget | null): void {
    this.lastHover = target
    ;(this.override ?? this.activeTool)?.onHover(target)
  }

  /**
   * 表示からドラッグの始まりを受け取る（#161）。今のツールがドラッグを受け取れば true。
   * 貼り付けの見本を出している間は受け取らない
   */
  beginDrag(target: PickTarget, mods: PickModifiers = { shift: false }): boolean {
    this.cancelDrag()
    const tool = this.override ? null : this.activeTool
    if (!tool?.dragStart?.(target, mods)) return false
    this.dragging = tool
    return true
  }

  get isDragging(): boolean {
    return this.dragging !== null
  }

  /** ドラッグ中のマウスの移動 */
  dragTo(target: PickTarget | null): void {
    this.lastHover = target
    this.dragging?.dragMove?.(target)
  }

  /** ドラッグを終える（ボタンを離した） */
  endDrag(target: PickTarget | null, mods: PickModifiers = { shift: false }): void {
    const tool = this.dragging
    this.dragging = null
    tool?.dragEnd?.(target, mods)
  }

  /** ドラッグをやめる。ドラッグしていなければ何もしない */
  cancelDrag(): void {
    const tool = this.dragging
    this.dragging = null
    tool?.dragCancel?.()
  }

  /** 表示からクリックを受け取る */
  click(target: PickTarget, mods: PickModifiers = { shift: false }): void {
    ;(this.override ?? this.activeTool)?.onClick(target, mods)
  }
}
