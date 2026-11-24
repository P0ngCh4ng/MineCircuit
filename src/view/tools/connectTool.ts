import type { ConnectOptions, ConnectPlan, ConnectToolDef } from '../../calc/connectTool'
import type { Blueprint } from '../../domain/blueprint'
import { boxFromCorners } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { replaceCells } from '../../edit/editCommand'
import type { EditToolContext } from './editToolContext'
import type { PickModifiers, PickTarget, Tool, ToolId } from './tool'

/**
 * つなぐツール（#248・#266）。2つのブロックを順にクリックすると、その間を埋める（Create のベルトなど）。
 * つなげない組み合わせでは理由を出し、1本目は選んだままにする。
 * 規則と文言は計算プラグインのもの（calc/connectTool.ts の ConnectToolDef。docs/design.md「Mod ごとのものを足す口」）
 */
export class ConnectTool implements Tool {
  readonly id: ToolId
  private first: Vec3 | null = null

  /** speedAt は最後の計算の回転数。分からなければ null を返す */
  constructor(
    private readonly def: ConnectToolDef,
    private readonly ctx: EditToolContext,
    private readonly speedAt: (pos: Vec3) => number | null = () => null,
  ) {
    this.id = def.id
  }

  private options(): ConnectOptions {
    return { speedAt: this.speedAt }
  }

  /** 今の1本目（テストと画面の確かめ用） */
  get firstPos(): Vec3 | null {
    return this.first
  }

  onHover(target: PickTarget | null): void {
    const bp = this.ctx.blueprint()
    const end = bp && target && !target.empty && this.def.canStart(bp.get(target.pos)) ? target.pos : null
    this.ctx.setHovered(target && !target.empty ? target.pos : null)
    if (!bp || !this.first) return
    // 1本目を選んでいれば、指しているブロックまで置くものを見本で出す
    const plan = end ? this.def.plan(bp, this.first, end, this.options()) : null
    this.showPreview(plan && typeof plan !== 'string' ? plan : null, end)
  }

  onClick(target: PickTarget, mods: PickModifiers): void {
    const bp = this.ctx.blueprint()
    if (!bp) return
    const messages = this.def.messages
    if (mods.shift) {
      if (this.first) this.ctx.notify(messages.cancelled)
      this.reset()
      return
    }
    if (target.empty || !this.def.canStart(bp.get(target.pos))) {
      this.ctx.notify(messages.pickStart)
      return
    }
    if (!this.first) {
      this.first = [...target.pos]
      this.ctx.notify(messages.first(this.first))
      this.showPreview(null, null)
      return
    }
    const plan = this.def.plan(bp, this.first, target.pos, this.options())
    if (plan === null) {
      // 同じブロックをもう一度：やめる
      this.ctx.notify(messages.cancelled)
      this.reset()
      return
    }
    if (typeof plan === 'string') {
      this.ctx.notify(plan)
      return
    }
    this.connect(bp, plan)
  }

  private connect(bp: Blueprint, plan: ConnectPlan): void {
    const count = plan.cells.length
    const cmd = replaceCells(bp, plan.cells, this.def.messages.command(count))
    this.reset()
    if (!this.ctx.apply(cmd)) return
    const first = plan.cells[0]
    if (first) this.ctx.revealLayer(first.pos[1])
    this.ctx.notify(this.def.messages.done(count))
  }

  private showPreview(plan: ConnectPlan | null, hovered: Vec3 | null): void {
    if (!this.first) {
      this.ctx.setLinePreview(null)
      return
    }
    const cells = (plan?.cells ?? []).flatMap((c) => (c.after.state ? [{ pos: c.pos, state: c.after.state }] : []))
    this.ctx.setLinePreview({ cells, box: boxFromCorners(this.first, plan && hovered ? hovered : this.first) })
  }

  private reset(): void {
    this.first = null
    this.ctx.setLinePreview(null)
  }

  deactivate(): void {
    this.reset()
    this.ctx.setHovered(null)
  }
}
