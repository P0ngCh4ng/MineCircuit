import { eraseBlock } from '../../edit/editCommand'
import type { EditToolContext } from './editToolContext'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** 消すツール（E）。クリックしたブロックを消す。空きマスでは何もしない */
export class EraseTool implements Tool {
  readonly id = 'erase' as const

  constructor(private readonly ctx: EditToolContext) {}

  onHover(target: PickTarget | null): void {
    this.ctx.setHovered(target && !target.empty ? target.pos : null)
  }

  onClick(target: PickTarget, _mods: PickModifiers): void {
    const bp = this.ctx.blueprint()
    if (!bp || target.empty) return
    this.ctx.notify(null)
    this.ctx.apply(eraseBlock(bp, target.pos))
  }

  deactivate(): void {
    this.ctx.setHovered(null)
  }
}
