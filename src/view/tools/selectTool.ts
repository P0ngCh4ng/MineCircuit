import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** 選択ツールが結果を渡す先。ストアが実装する */
export interface SelectionSink {
  /** 選択中のブロックを変える。空きマスをクリックしたら null（選択の解除） */
  setSelected(pos: Vec3 | null): void
  /** 起点とこの位置を角にした範囲に広げる（Shift+クリック。#130） */
  extendSelection(pos: Vec3): void
  /** マウスの下のブロック。強調の表示に使う */
  setHovered(pos: Vec3 | null): void
}

/**
 * 選択ツール（V）。クリックしたブロックを選択中にする。
 * Shift+クリックで、起点とクリックした所を角にした範囲に広げる（空きマスも角にできる）。docs/ui.md「範囲を選ぶ」
 */
export class SelectTool implements Tool {
  readonly id = 'select' as const

  constructor(private readonly sink: SelectionSink) {}

  onHover(target: PickTarget | null): void {
    this.sink.setHovered(target && !target.empty ? target.pos : null)
  }

  onClick(target: PickTarget, mods: PickModifiers): void {
    if (mods.shift) {
      this.sink.extendSelection(target.pos)
      return
    }
    this.sink.setSelected(target.empty ? null : target.pos)
  }

  deactivate(): void {
    this.sink.setHovered(null)
  }
}
