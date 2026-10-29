import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** プローブが結果を渡す先。画面では probeStore と toolStore が実装する */
export interface ProbeSink {
  /** マウスの下のブロック。枠の表示と、右パネルの値（クリック前の見本）に使う */
  setHovered(pos: Vec3 | null): void
  /** クリックしたブロック。値を右パネルに出し、つながったブロックを強調する。空きマスなら null（解除） */
  setProbed(pos: Vec3 | null): void
}

/**
 * プローブ（docs/ui.md「ツール」）。キーは P。
 * ほかのツールに替えたら、プローブの結果（右パネルの欄と強調）を消す（#154）。
 * マウスの下のブロックの回転数・応力を右パネルに出し、クリックしたブロックのネットワークを強調する。
 */
export class ProbeTool implements Tool {
  readonly id = 'probe' as const

  constructor(private readonly sink: ProbeSink) {}

  onHover(target: PickTarget | null): void {
    this.sink.setHovered(target && !target.empty ? target.pos : null)
  }

  onClick(target: PickTarget, _mods: PickModifiers): void {
    this.sink.setProbed(target.empty ? null : target.pos)
  }

  deactivate(): void {
    this.sink.setHovered(null)
    this.sink.setProbed(null)
  }
}
