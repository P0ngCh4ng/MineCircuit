import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** 計測ツールが結果を渡す先。ストアが実装する */
export interface MeasureSink {
  /** 選んだ点（0〜2個）。2個そろったら計測の結果を出す */
  setMeasurePoints(points: readonly Vec3[]): void
}

/**
 * 計測ツール（M）。2つのブロックをクリックして距離を測る。
 * 3つ目のクリックで、新しい1つ目からやり直す。空きマス（3D では今の段の床）も選べる。
 */
export class MeasureTool implements Tool {
  readonly id = 'measure' as const
  private points: readonly Vec3[] = []

  constructor(private readonly sink: MeasureSink) {}

  onHover(_target: PickTarget | null): void {}

  onClick(target: PickTarget, _mods: PickModifiers): void {
    this.points = this.points.length >= 2 ? [target.pos] : [...this.points, target.pos]
    this.sink.setMeasurePoints(this.points)
  }

  activate(): void {
    this.reset()
  }

  deactivate(): void {
    this.reset()
  }

  /** 途中の点と結果を消す */
  reset(): void {
    this.points = []
    this.sink.setMeasurePoints(this.points)
  }
}
