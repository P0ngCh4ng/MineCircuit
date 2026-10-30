import type { Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'
import type { PickModifiers, PickTarget, Tool } from './tool'

/** 仮の入出力のツールが結果を渡す先。画面では portStore と toolStore が実装する */
export interface PortSink {
  /** マウスの下のブロック（枠の表示） */
  setHovered(pos: Vec3 | null): void
  /** 2D表示など、面が分からないときに置く面を決める（右パネルの「2Dで置く面」。#167） */
  defaultFace(pos: Vec3): Direction
  /** pos の face に置く（同じ面にあれば選ぶ） */
  place(pos: Vec3, face: Direction): void
  /** 選択を外す */
  deselect(): void
}

/**
 * 仮の入出力（docs/ui.md「ツール」）。キーは O。
 * ブロックの面をクリックすると、右パネルで選んだ種類の仮の動力源や負荷をその面に置く。
 * 2D表示では面が分からないので、右パネルで選んだ面に置く（初期値は、ブロックの軸と隣の空きから決める。あとで一覧で直せる）。
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
    this.sink.place(target.pos, target.face ?? this.sink.defaultFace(target.pos))
  }

  deactivate(): void {
    this.sink.setHovered(null)
  }
}
