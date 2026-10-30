import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../tests/fixtures/blueprintFixture'
import type { Vec3 } from '../domain/vec3'
import { AttachmentLedger, vacatedPositions } from './attachmentLedger'
import { eraseBlock, placeBlock } from './editCommand'
import { EditHistory } from './editHistory'

interface Tag {
  readonly id: string
  readonly pos: Vec3
}

function sample() {
  return blueprintFixture({ size: [3, 1, 1] }).fill([0, 0, 0], [2, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
}

describe('vacatedPositions（#167）', () => {
  it('ブロックが空きになったマスだけを返す', () => {
    const bp = sample()
    expect(vacatedPositions(eraseBlock(bp, [1, 0, 0])!)).toEqual([[1, 0, 0]])
    expect(vacatedPositions(placeBlock(bp, [1, 0, 0], state('minecraft:stone'), true)!)).toEqual([])
  })
})

describe('AttachmentLedger（#167）', () => {
  it('消したブロックに付けたものを除き、元に戻すと戻し、やり直すとまた除く', () => {
    const bp = sample()
    const history = new EditHistory(bp)
    const ledger = new AttachmentLedger<Tag>((t) => t.pos)
    const a: Tag = { id: 'a', pos: [1, 0, 0] }
    const b: Tag = { id: 'b', pos: [2, 0, 0] }
    let items: readonly Tag[] = [a, b]

    const cmd = eraseBlock(bp, [1, 0, 0])!
    history.apply(cmd)
    items = ledger.applied(cmd, items)
    expect(items).toEqual([b])

    items = ledger.undone(history.undo()!, items)
    expect(items).toEqual([b, a])

    items = ledger.applied(history.redo()!, items)
    expect(items).toEqual([b])
    items = ledger.undone(history.undo()!, items)
    expect(items.map((t) => t.id).sort()).toEqual(['a', 'b'])
  })

  it('ブロックを消さない操作では何も除かない。覚えていない操作を戻しても変えない', () => {
    const bp = sample()
    const ledger = new AttachmentLedger<Tag>((t) => t.pos)
    const items: readonly Tag[] = [{ id: 'a', pos: [1, 0, 0] }]
    const cmd = placeBlock(bp, [1, 0, 0], state('minecraft:stone'), true)!
    expect(ledger.applied(cmd, items)).toBe(items)
    expect(ledger.undone(cmd, items)).toBe(items)
  })
})
