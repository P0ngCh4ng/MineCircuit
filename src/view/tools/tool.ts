import type { Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'

/** ツールの種類。docs/design.md「view」の Tool と同じ */
export type ToolId = 'select' | 'measure' | 'connect' | 'probe' | 'place' | 'erase' | 'pick'

/**
 * マウスの下にあるもの。3D表示と2D表示のどちらの Picker もこの形で返す。
 * - 3D：当たったブロックと、当たった面の向き。何もなければ今の段の床の空きマス（face なし）
 * - 2D：今の段のマス目（face なし）
 */
export interface PickTarget {
  /** 当たったブロック、または空きマスの座標 */
  readonly pos: Vec3
  /** 3D で当たった面。2D と床の空きマスでは undefined */
  readonly face?: Direction
  /** 空きマスなら true */
  readonly empty: boolean
}

/** クリックしたときに押していた修飾キー */
export interface PickModifiers {
  readonly shift: boolean
}

/**
 * ツール。ツールごとにクラスを分け、同じ形でマウスの移動とクリックを受け取る。
 * 表示（3D/2D）は Picker で PickTarget を求め、ToolController を通して今のツールに渡す。
 */
export interface Tool {
  readonly id: ToolId
  /** マウスが動いたとき。何も指していなければ null */
  onHover(target: PickTarget | null): void
  /** クリックしたとき */
  onClick(target: PickTarget, mods: PickModifiers): void
  /** このツールに切り替わったとき（任意） */
  activate?(): void
  /** 別のツールに切り替わるとき（任意）。途中の状態（計測の1点目など）を片付ける */
  deactivate?(): void
}
