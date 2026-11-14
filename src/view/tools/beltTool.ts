import { beltShaftAxis, planBeltConnection, type BeltConnectOptions, type BeltPlan } from '../../calc/create/createBeltConnector'
import type { Blueprint } from '../../domain/blueprint'
import { boxFromCorners } from '../../domain/box'
import type { Vec3 } from '../../domain/vec3'
import { replaceCells } from '../../edit/editCommand'
import type { EditToolContext } from './editToolContext'
import type { PickModifiers, PickTarget, Tool } from './tool'

export const BELT_PICK_SHAFT_MESSAGE = 'ベルトはシャフトに掛けます。1本目のシャフトをクリックしてください。'
export const BELT_CANCELLED_MESSAGE = '1本目の選択をやめました。'

/** 1本目を選んだときの知らせ */
export function beltFirstMessage(pos: Vec3): string {
  return `1本目：(${pos[0]}, ${pos[1]}, ${pos[2]})。2本目のシャフトをクリックしてください。Shift+クリックか同じシャフトでやめます。`
}

/** 敷いたときの知らせ */
export function beltDoneMessage(length: number): string {
  return `ベルトを敷きました（${length} 区間）。`
}

/**
 * ベルトのツール（L。#248）。ゲームでベルトをシャフトに使うときと同じく、シャフトを2本順にクリックすると、
 * その間にベルトを敷く。つなげない組み合わせでは理由を出し、1本目は選んだままにする（ゲームと同じ）。
 * 規則は calc/create/createBeltConnector（docs/create-stress.md「ベルトをつなぐ」）
 */
export class BeltTool implements Tool {
  readonly id = 'belt' as const
  private first: Vec3 | null = null

  /** speedAt は最後の計算の回転数（PL-BELT-SPEED）。分からなければ null を返す */
  constructor(
    private readonly ctx: EditToolContext,
    private readonly speedAt: (pos: Vec3) => number | null = () => null,
  ) {}

  private options(): BeltConnectOptions {
    return { speedAt: this.speedAt }
  }

  /** 今の1本目（テストと画面の確かめ用） */
  get firstShaft(): Vec3 | null {
    return this.first
  }

  onHover(target: PickTarget | null): void {
    const bp = this.ctx.blueprint()
    const shaft = bp && target && !target.empty && beltShaftAxis(bp.get(target.pos)) !== null ? target.pos : null
    this.ctx.setHovered(target && !target.empty ? target.pos : null)
    if (!bp || !this.first) return
    // 1本目を選んでいれば、指しているシャフトまで敷くベルトを見本で出す
    const plan = shaft ? planBeltConnection(bp, this.first, shaft, this.options()) : null
    this.showPreview(plan && typeof plan !== 'string' ? plan : null, shaft)
  }

  onClick(target: PickTarget, mods: PickModifiers): void {
    const bp = this.ctx.blueprint()
    if (!bp) return
    if (mods.shift) {
      if (this.first) this.ctx.notify(BELT_CANCELLED_MESSAGE)
      this.reset()
      return
    }
    if (target.empty || beltShaftAxis(bp.get(target.pos)) === null) {
      this.ctx.notify(BELT_PICK_SHAFT_MESSAGE)
      return
    }
    if (!this.first) {
      this.first = [...target.pos]
      this.ctx.notify(beltFirstMessage(this.first))
      this.showPreview(null, null)
      return
    }
    const plan = planBeltConnection(bp, this.first, target.pos, this.options())
    if (plan === null) {
      // 同じシャフトをもう一度：やめる（PL-BELT-SAME）
      this.ctx.notify(BELT_CANCELLED_MESSAGE)
      this.reset()
      return
    }
    if (typeof plan === 'string') {
      this.ctx.notify(plan)
      return
    }
    this.connect(bp, plan)
  }

  private connect(bp: Blueprint, plan: BeltPlan): void {
    const cmd = replaceCells(bp, plan.segments, `ベルトをつなぐ（${plan.segments.length} 区間）`)
    this.reset()
    if (!this.ctx.apply(cmd)) return
    const first = plan.segments[0]
    if (first) this.ctx.revealLayer(first.pos[1])
    this.ctx.notify(beltDoneMessage(plan.segments.length))
  }

  private showPreview(plan: BeltPlan | null, hovered: Vec3 | null): void {
    if (!this.first) {
      this.ctx.setLinePreview(null)
      return
    }
    const cells = (plan?.segments ?? []).flatMap((s) => (s.after.state ? [{ pos: s.pos, state: s.after.state }] : []))
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
