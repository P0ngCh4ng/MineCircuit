import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** つながりツールが結果を渡す先。ストアが実装する */
export interface ConnectSink {
  /** まとまりの始めのブロック。null なら強調を消す */
  setConnectStart(pos: Vec3 | null): void
}

/**
 * つながりツール（C）。クリックしたブロックと、隣り合う同じ種類のブロックをまとめて強調する。
 * まとまりはストアが analysis/floodSameState で求める（編集のあとに求め直せるように、始めの位置だけを渡す）。
 * 回転や配管のつながりではない。
 */
export class ConnectTool implements Tool {
  readonly id = 'connect' as const

  constructor(private readonly sink: ConnectSink) {}

  onHover(_target: PickTarget | null): void {}

  onClick(target: PickTarget, _mods: PickModifiers): void {
    this.sink.setConnectStart(target.empty ? null : target.pos)
  }

  activate(): void {
    this.sink.setConnectStart(null)
  }

  deactivate(): void {
    this.sink.setConnectStart(null)
  }
}
