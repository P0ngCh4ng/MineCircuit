/** namespace を省略したときに使う値。Minecraft と同じ */
export const DEFAULT_NAMESPACE = 'minecraft'

/**
 * "create:shaft" を namespace と path に分けて持つ。
 * 文字の種類は検査しない。ファイルにある ID を捨てずに持つため。
 */
export class ResourceLocation {
  constructor(
    readonly namespace: string,
    readonly path: string,
  ) {}

  /**
   * "namespace:path" を読む。namespace がなければ "minecraft" とみなす。
   * path が空のときと、":" が2つ以上あるときはエラーにする。
   */
  static parse(s: string): ResourceLocation {
    const colon = s.indexOf(':')
    const namespace = colon < 0 ? DEFAULT_NAMESPACE : s.slice(0, colon) || DEFAULT_NAMESPACE
    const path = colon < 0 ? s : s.slice(colon + 1)
    if (path === '') {
      throw new Error(`ID "${s}" に path がありません。"namespace:path" の形で指定してください。`)
    }
    if (path.includes(':')) {
      throw new Error(`ID "${s}" に ":" が2つ以上あります。"namespace:path" の形で指定してください。`)
    }
    return new ResourceLocation(namespace, path)
  }

  toString(): string {
    return `${this.namespace}:${this.path}`
  }

  equals(other: ResourceLocation): boolean {
    return this.namespace === other.namespace && this.path === other.path
  }
}
