import type { EditToolContext } from './editToolContext'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** スポイト（I）。クリックしたブロックの状態を、そのまま置くブロックにする */
export class PickTool implements Tool {
  readonly id = 'pick' as const

  constructor(private readonly ctx: EditToolContext) {}

  onHover(target: PickTarget | null): void {
    this.ctx.setHovered(target && !target.empty ? target.pos : null)
  }

  onClick(target: PickTarget, _mods: PickModifiers): void {
    const state = target.empty ? null : (this.ctx.blueprint()?.get(target.pos) ?? null)
    if (!state) return
    this.ctx.setBrush(state)
    this.ctx.notify(`置くブロックを ${state.key} にしました`)
  }

  deactivate(): void {
    this.ctx.setHovered(null)
  }
}
