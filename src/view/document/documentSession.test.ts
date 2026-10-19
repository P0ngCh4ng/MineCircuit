import { describe, expect, it } from 'vitest'
import { nbt } from '../../domain/nbt'
import { eraseBlock, placeBlock, rotateBlock } from '../../edit/editCommand'
import { blueprintContents, blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { createDocumentSession, type FileLike } from './documentSession'

function sample() {
  return blueprintFixture({ size: [3, 2, 3], name: 'sample.nbt' })
    .place([0, 0, 0], 'create:shaft', { axis: 'x' })
    .place([1, 0, 0], 'create:creative_motor', { facing: 'east' }, nbt.compound({ Speed: nbt.int(64) }))
    .fill([0, 1, 0], [2, 1, 0], 'minecraft:stone')
}

function fileOf(name: string, bytes: Uint8Array): FileLike {
  return { name, arrayBuffer: async () => bytes.slice().buffer }
}

describe('DocumentSession', () => {
  it('.nbt を開くと、設計図と空の履歴ができ、version が増える', async () => {
    const session = createDocumentSession()
    expect(session.current.value).toBeNull()
    const before = session.version.value

    const ok = await session.openFile(fileOf('sample.nbt', await sample().toNbtBytes()))

    expect(ok).toBe(true)
    const doc = session.current.value
    expect(doc?.fileName).toBe('sample.nbt')
    expect(blueprintContents(doc!.blueprint)).toEqual(blueprintContents(sample().toBlueprint()))
    expect(doc?.history.count).toBe(0)
    expect(session.version.value).toBeGreaterThan(before)
    expect(session.opening.value).toBe(false)
    expect(session.error.value).toBeNull()
  })

  it('palettes 形式の .nbt も開ける', async () => {
    const session = createDocumentSession()
    const ok = await session.openBytes('p.nbt', await sample().toNbtBytes({ paletteForm: 'palettes' }))
    expect(ok).toBe(true)
    expect(session.current.value?.blueprint.get([1, 0, 0])?.id.toString()).toBe('create:creative_motor')
  })

  it('対応していない形式は、何が起きたかとどうすればよいかを出し、今の設計図はそのまま', async () => {
    const session = createDocumentSession()
    await session.openBytes('sample.nbt', await sample().toNbtBytes())
    const opened = session.current.value

    const ok = await session.openBytes('house.schem', new Uint8Array([1, 2, 3]))

    expect(ok).toBe(false)
    expect(session.current.value).toBe(opened)
    expect(session.error.value).toContain('house.schem')
    expect(session.error.value).toContain('選んでください')
  })

  it('壊れた .nbt はエラーを出す。clearError で消える', async () => {
    const session = createDocumentSession()
    const ok = await session.openBytes('broken.nbt', new Uint8Array([0x1f, 0x8b, 0, 0, 0]))
    expect(ok).toBe(false)
    expect(session.current.value).toBeNull()
    expect(session.error.value).toMatch(/broken\.nbt|NBT|設計図/)
    session.clearError()
    expect(session.error.value).toBeNull()
  })

  it('ファイルを読めなかったときも、理由とどうすればよいかを出す', async () => {
    const session = createDocumentSession()
    const ok = await session.openFile({
      name: 'gone.nbt',
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
    })
    expect(ok).toBe(false)
    expect(session.error.value).toBe(
      '"gone.nbt" を開けませんでした（NotReadableError）。ファイルが壊れていないか確かめて、もう一度開いてください。',
    )
  })

  it('読んでいる間に次のファイルを開いたら、後のファイルを使う', async () => {
    const session = createDocumentSession()
    const first = await sample().toNbtBytes()
    const second = await blueprintFixture({ name: 'b.nbt' }).place([0, 0, 0], 'minecraft:stone').toNbtBytes()
    let release: () => void = () => {}
    const slow: FileLike = {
      name: 'a.nbt',
      arrayBuffer: () => new Promise((resolve) => (release = () => resolve(first.slice().buffer))),
    }

    const a = session.openFile(slow)
    expect(session.opening.value).toBe(true)
    await session.openFile(fileOf('b.nbt', second))
    release()

    expect(await a).toBe(false)
    expect(session.current.value?.fileName).toBe('b.nbt')
    expect(session.opening.value).toBe(false)
  })

  it('編集の操作を通して変え、元に戻すと完全に元の状態になる。やり直しも同じ', async () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(sample().toBlueprint())
    const bp = doc.blueprint
    const original = blueprintContents(bp)

    expect(session.apply(placeBlock(bp, [2, 0, 2], state('create:cogwheel', { axis: 'y' }), false))).toBe(true)
    expect(session.apply(eraseBlock(bp, [1, 0, 0]))).toBe(true)
    expect(session.apply(rotateBlock(bp, [0, 0, 0], false))).toBe(true)
    const edited = blueprintContents(bp)
    expect(session.editCount.value).toBe(3)
    expect(session.nextUndoLabel.value).toBe('shaft を回す')

    expect(session.undo()?.label).toBe('shaft を回す')
    expect(session.nextRedoLabel.value).toBe('shaft を回す')
    session.undo()
    session.undo()
    expect(session.undo()).toBeNull()
    expect(blueprintContents(bp)).toEqual(original)
    expect(session.canUndo.value).toBe(false)
    expect(session.canRedo.value).toBe(true)

    session.redo()
    session.redo()
    session.redo()
    expect(session.redo()).toBeNull()
    expect(blueprintContents(bp)).toEqual(edited)
    expect(session.canRedo.value).toBe(false)
  })

  it('変化のない操作（null）と、開いていないときの操作は何もしない', () => {
    const session = createDocumentSession()
    expect(session.apply(null)).toBe(false)
    expect(session.undo()).toBeNull()
    expect(session.redo()).toBeNull()
    expect(session.canUndo.value).toBe(false)
    expect(session.editCount.value).toBe(0)

    const doc = session.setBlueprint(sample().toBlueprint())
    const v = session.version.value
    expect(session.apply(eraseBlock(doc.blueprint, [2, 0, 2]))).toBe(false)
    expect(session.version.value).toBe(v)
  })

  it('編集・元に戻す・やり直すのたびに version が増える', () => {
    const session = createDocumentSession()
    const doc = session.setBlueprint(sample().toBlueprint())
    const v0 = session.version.value
    session.apply(eraseBlock(doc.blueprint, [0, 0, 0]))
    expect(session.version.value).toBe(v0 + 1)
    session.undo()
    expect(session.version.value).toBe(v0 + 2)
    session.redo()
    expect(session.version.value).toBe(v0 + 3)
  })

  it('別の設計図を開くと履歴は新しくなり、前の履歴の変化では version が増えない', () => {
    const session = createDocumentSession()
    const first = session.setBlueprint(sample().toBlueprint())
    session.apply(eraseBlock(first.blueprint, [0, 0, 0]))
    const second = session.setBlueprint(sample().toBlueprint(), 'other.nbt')

    expect(second.history).not.toBe(first.history)
    expect(session.canUndo.value).toBe(false)
    expect(session.current.value?.fileName).toBe('other.nbt')
    const v = session.version.value
    first.history.undo()
    expect(session.version.value).toBe(v)
  })

  it('close で閉じる', () => {
    const session = createDocumentSession()
    session.setBlueprint(sample().toBlueprint())
    session.close()
    expect(session.current.value).toBeNull()
    expect(session.editCount.value).toBe(0)
  })
})
