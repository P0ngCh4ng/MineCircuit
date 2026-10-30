import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** ネットワークのツールが結果を渡す先。画面では probeStore が実装する */
export interface NetworkSink {
  /** クリックしたブロック。このブロックのネットワークを強調する。空きマスなら null（解除） */
  setProbed(pos: Vec3 | null): void
}

/**
 * ネットワーク（C。docs/ui.md「ツール」「強調」）。クリックしたブロックと、回転でつながったブロックを強調する。
 * 強調はプローブと同じもの（probeStore の probedPos）を使う。
 * プローブと違い、ほかのツールに替えても強調を残す（消すのは Esc か「強調を解除」）。
 */
export class NetworkTool implements Tool {
  readonly id = 'network' as const

  constructor(private readonly sink: NetworkSink) {}

  onHover(_target: PickTarget | null): void {}

  onClick(target: PickTarget, _mods: PickModifiers): void {
    this.sink.setProbed(target.empty ? null : target.pos)
  }
}
