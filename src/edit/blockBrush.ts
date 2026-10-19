import type { BlockState } from '../domain/blockState'
import { rotateState, type PropertyValueOptions } from './rotation'

/** 置くブロック。置くツールで使うブロック状態を持ち、R / Shift+R で回す */
export class BlockBrush {
  constructor(
    public state: BlockState,
    /** このブロックの properties が取りうる値。Modpack がなければ null（#27 で渡す） */
    public options: PropertyValueOptions | null = null,
  ) {}

  /**
   * R（水平）/ Shift+R（縦）で回す。
   * 状態が変わったら true。回せる向きがなければ false を返し、状態は変えない。
   */
  rotate(vertical: boolean): boolean {
    const next = rotateState(this.state, vertical, this.options)
    if (next.equals(this.state)) return false
    this.state = next
    return true
  }

  /** スポイト：クリックしたブロックの状態をそのまま置くブロックにする */
  static fromBlock(state: BlockState, options: PropertyValueOptions | null = null): BlockBrush {
    return new BlockBrush(state, options)
  }
}
