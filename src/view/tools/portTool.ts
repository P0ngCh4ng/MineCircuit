import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** 仮の入出力のツールが結果を渡す先。画面では portStore と toolStore が実装する */
export interface PortSink {
  /** マウスの下のブロック（枠の表示） */
  setHovered(pos: Vec3 | null): void
  /** pos のブロックに付ける（同じブロックに同じ種類があれば選ぶ） */
  place(pos: Vec3): void
  /** 選択を外す */
  deselect(): void
}

/**
 * 仮の入出力（docs/ui.md「ツール」）。キーは O。
 * ブロックをクリックすると、右パネルで選んだ種類の仮の動力源や負荷をそのブロックに付ける。面は選ばない（#195）。
 */
export class PortTool implements Tool {
  readonly id = 'port' as const

  constructor(private readonly sink: PortSink) {}

  onHover(target: PickTarget | null): void {
    this.sink.setHovered(target && !target.empty ? target.pos : null)
  }

  onClick(target: PickTarget, _mods: PickModifiers): void {
    if (target.empty) {
      this.sink.deselect()
      return
    }
    this.sink.place(target.pos)
  }

  deactivate(): void {
    this.sink.setHovered(null)
  }
}
