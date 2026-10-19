// 新規作成 → 編集 → 書き出し → 読み直し（#20 の完了の条件）
import { describe, expect, it } from 'vitest'
import { createEmptyBlueprint } from '../src/domain/newBlueprint'
import { eraseBlock, placeBlock } from '../src/edit/editCommand'
import { EditHistory } from '../src/edit/editHistory'
import { MemoryFileSink } from '../src/io/memoryFileSink'
import { parseNbtFile } from '../src/io/nbt/index'
import { readBlueprint } from '../src/io/readers/readBlueprint'
import { exportBlueprint } from '../src/io/writers/exportBlueprint'
import { blueprintContents, state } from './fixtures/blueprintFixture'

describe('新規の設計図', () => {
  it('作って編集し、書き出して読み直すと一致する', async () => {
    const bp = createEmptyBlueprint({ name: '新しい設計図', size: [3, 2, 4], dataVersion: 3465 })
    const history = new EditHistory(bp)
    const place = (pos: [number, number, number], s: string) => {
      const cmd = placeBlock(bp, pos, state(s), false)
      if (!cmd) throw new Error('置けませんでした')
      history.apply(cmd)
    }
    place([0, 0, 0], 'create:shaft[axis=x]')
    place([2, 1, 3], 'minecraft:stone')
    place([1, 0, 2], 'create:cogwheel[axis=y]')
    const erase = eraseBlock(bp, [1, 0, 2])
    if (!erase) throw new Error('消せませんでした')
    history.apply(erase)

    const sink = new MemoryFileSink()
    const result = await exportBlueprint(bp, sink)
    expect(result.status).toBe('saved')
    expect(result.fileName).toBe('新しい設計図.nbt')

    const bytes = sink.files.get('新しい設計図.nbt')
    if (!bytes) throw new Error('保存されていません')
    const reread = await readBlueprint(result.fileName, bytes)
    expect(blueprintContents(reread)).toEqual(blueprintContents(bp))
    expect(reread.dataVersion).toBe(3465)

    // 選んだバージョンの DataVersion を書く
    const doc = await parseNbtFile(bytes)
    expect(doc.root.value.get('DataVersion')).toEqual({ type: 'int', value: 3465 })
  })

  it('何も置かずに書き出せる', async () => {
    const bp = createEmptyBlueprint({ name: 'empty', size: [2, 2, 2], dataVersion: 2975 })
    const sink = new MemoryFileSink()
    await exportBlueprint(bp, sink)
    const reread = await readBlueprint('empty.nbt', sink.files.get('empty.nbt') ?? new Uint8Array())
    expect(reread.size).toEqual([2, 2, 2])
    expect(blueprintContents(reread)).toEqual(blueprintContents(bp))
  })

  it('編集を元に戻すと空に戻る', () => {
    const bp = createEmptyBlueprint({ name: 'u', size: [2, 1, 2], dataVersion: 2975 })
    const before = blueprintContents(bp)
    const history = new EditHistory(bp)
    const cmd = placeBlock(bp, [1, 0, 1], state('minecraft:stone'), false)
    if (!cmd) throw new Error('置けませんでした')
    history.apply(cmd)
    history.undo()
    expect(blueprintContents(bp)).toEqual(before)
  })
})
