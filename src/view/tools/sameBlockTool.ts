import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** 同じブロックツールが結果を渡す先。ストアが実装する */
export interface SameBlockSink {
  /** まとまりの始めのブロック。null なら強調を消す */
  setSameBlockStart(pos: Vec3 | null): void
}

/**
 * 同じブロックツール（S。#163 までは「つながり（C）」）。クリックしたブロックと、隣り合う同じ種類のブロックをまとめて強調する。
 * まとまりはストアが analysis/floodSameState で求める（編集のあとに求め直せるように、始めの位置だけを渡す）。
 * 回転や配管のつながりではない。
 */
export class SameBlockTool implements Tool {
  readonly id = 'sameBlock' as const

  constructor(private readonly sink: SameBlockSink) {}

  onHover(_target: PickTarget | null): void {}

  onClick(target: PickTarget, _mods: PickModifiers): void {
    this.sink.setSameBlockStart(target.empty ? null : target.pos)
  }

  activate(): void {
    this.sink.setSameBlockStart(null)
  }

  deactivate(): void {
    this.sink.setSameBlockStart(null)
  }
}
