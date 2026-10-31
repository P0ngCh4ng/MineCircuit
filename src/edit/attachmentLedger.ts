// ブロックに付けたもの（仮の入出力など）を、ブロックを消す操作と一緒に消し、元に戻すと戻す（#167）。
// 付けたものは設計図の外（画面の状態）にあるので、型は呼ぶ側が決める（edit は calc の VirtualPort を知らない）。
// 消したものは操作ごとに覚えておく。操作（EditCommand）は書き換えない。

import type { Vec3 } from '../domain/vec3'
import type { EditCommand } from './editCommand'

function vec3Key(p: Vec3): string {
  return p.join(',')
}

/**
 * 操作でブロックがなくなったマス（前はブロックがあり、後は空き）。pos は操作の後の座標。
 * 縮めて消えたマス（cleared、#191）は設計図の外になるが、付けたものも同じだけずれているので、shift を足して数える
 */
export function vacatedPositions(cmd: EditCommand): Vec3[] {
  const out = new Map<string, Vec3>()
  const shift = cmd.relocation?.shift ?? [0, 0, 0]
  for (const c of cmd.cleared ?? []) {
    if (c.before.state === null) continue
    const pos: Vec3 = [c.pos[0] + shift[0], c.pos[1] + shift[1], c.pos[2] + shift[2]]
    out.set(vec3Key(pos), pos)
  }
  for (const c of cmd.changes) {
    const key = vec3Key(c.pos)
    // 同じマスを何度か変える操作では、最後の変更で決まる
    if (c.before.state !== null && c.after.state === null) out.set(key, c.pos)
    else out.delete(key)
  }
  return [...out.values()]
}

/**
 * ブロックに付けたものの、操作ごとの控え。
 * - applied：操作を書いた・やり直したあとに呼ぶ。なくなったマスに付いていたものを除いた一覧を返し、除いたものを覚える
 * - undone：操作を元に戻したあとに呼ぶ。その操作で除いたものを戻した一覧を返す
 */
export class AttachmentLedger<T> {
  private readonly removed = new WeakMap<EditCommand, readonly T[]>()

  constructor(private readonly posOf: (item: T) => Vec3) {}

  applied(cmd: EditCommand, items: readonly T[]): readonly T[] {
    const vacated = new Set(vacatedPositions(cmd).map(vec3Key))
    if (vacated.size === 0) return items
    const kept: T[] = []
    const gone: T[] = []
    for (const item of items) (vacated.has(vec3Key(this.posOf(item))) ? gone : kept).push(item)
    if (gone.length === 0) return items
    this.removed.set(cmd, gone)
    return kept
  }

  /** restore は、除いたときの位置（操作の後の座標）を操作の前の座標に直す（範囲を動かした操作のとき） */
  undone(cmd: EditCommand, items: readonly T[], restore: (item: T) => T = (item) => item): readonly T[] {
    const gone = this.removed.get(cmd)
    if (!gone) return items
    this.removed.delete(cmd)
    return [...items, ...gone.map(restore)]
  }
}
