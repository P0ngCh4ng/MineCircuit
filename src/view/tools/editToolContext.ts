import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'
import type { EditCommand } from '../../edit/editCommand'

/**
 * 編集のツール（置く・消す・スポイト）が使うもの。画面では useEditTools がストアと DocumentSession でこれを作る。
 * テストでは偽物を渡せるので、ツールの動きを画面なしで確かめられる。
 */
export interface EditToolContext {
  /** 開いている設計図。開いていなければ null */
  blueprint(): Blueprint | null
  /** 編集の操作を設計図に書き込む（DocumentSession.apply）。null（変化なし）なら何もせず false */
  apply(cmd: EditCommand | null): boolean
  /** 今の置くブロック。まだ選んでいなければ null */
  brush(): BlockState | null
  /** 置くブロックを変える（スポイト） */
  setBrush(state: BlockState): void
  /** 下の状態表示に出す知らせ。null で消す */
  notify(message: string | null): void
  /** マウスの下のブロックの枠 */
  setHovered(pos: Vec3 | null): void
  /** 置くブロックの見本を出すマス。null で消す */
  setGhost(pos: Vec3 | null, blocked?: boolean): void
  /** 段 y が今の表示で隠れていれば、その段へ移って見えるようにする */
  revealLayer(y: number): void
  /**
   * 置くときの向き（#119）。pos に state を置くとき、隣とつながる向きに合わせた状態。変えないなら state のまま。
   * from は優先する隣の向き（3D でクリックした面の側）
   */
  orient(bp: Blueprint, pos: Vec3, state: BlockState, from: Direction | null): BlockState
  /** pos に state を置けるか（#121）。ゲームで置けないなら理由、置けるなら null */
  placementProblem(bp: Blueprint, pos: Vec3, state: BlockState): string | null
}

/** 範囲の外を指したときの知らせ */
export function outOfRangeMessage(bp: Blueprint): string {
  const [w, h, d] = bp.size
  return `範囲の外には置けません。設計図の大きさ（${w}×${h}×${d}）の中に置いてください。`
}

/** pos が設計図のどれかのリージョンの中なら true */
export function isInside(bp: Blueprint, pos: Vec3): boolean {
  return bp.locate(pos) !== null
}
