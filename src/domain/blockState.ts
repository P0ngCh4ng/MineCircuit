import type { ResourceLocation } from './resourceLocation'

/** ブロック状態。ID と properties（axis=y, facing=north など）を持つ */
export class BlockState {
  readonly properties: Readonly<Record<string, string>>

  constructor(
    readonly id: ResourceLocation,
    properties: Readonly<Record<string, string>> = {},
  ) {
    // 呼び出し側があとで元のオブジェクトを書き換えても影響しないように写す
    this.properties = Object.freeze({ ...properties })
  }

  /**
   * 同じ状態かを比べるための文字列。properties は名前順に並べる。
   * 例: "create:shaft[axis=y]"、properties がなければ "minecraft:stone"
   */
  get key(): string {
    return blockStateKey(this)
  }

  /** ID と properties がすべて同じなら true */
  equals(other: BlockState): boolean {
    return this.key === other.key
  }
}

/** BlockState の key を作る。Map のキーやパレットの重複検出に使う */
export function blockStateKey(state: BlockState): string {
  const names = Object.keys(state.properties).sort()
  if (names.length === 0) return state.id.toString()
  const props = names.map((name) => `${name}=${state.properties[name]}`).join(',')
  return `${state.id.toString()}[${props}]`
}
