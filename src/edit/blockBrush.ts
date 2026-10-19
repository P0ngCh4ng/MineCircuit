import type { BlockState } from '../domain/blockState'
import { propertyValueOptionsFor, type BlockStateDefinitionSource } from './orientationOptions'
import { rotateState, type PropertyValueOptions } from './rotation'

/** 置くブロック。置くツールで使うブロック状態を持ち、R / Shift+R で回す */
export class BlockBrush {
  constructor(
    public state: BlockState,
    /** このブロックの properties が取りうる値。Modpack がなければ null（回転の規則のとおりに回す） */
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

  /**
   * スポイト・ブロックの選択：そのブロックの状態をそのまま置くブロックにする。
   * modpack があれば、ブロック状態の定義から取りうる値を読み、その範囲で回す。null なら規則のとおりに回す。
   */
  static fromBlock(state: BlockState, modpack: BlockStateDefinitionSource | null = null): BlockBrush {
    return new BlockBrush(state, propertyValueOptionsFor(modpack, state.id))
  }
}
