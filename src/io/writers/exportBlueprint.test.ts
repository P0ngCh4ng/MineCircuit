import { describe, expect, it } from 'vitest'
import { nbt } from '../../domain/nbt'
import type { Blueprint } from '../../domain/blueprint'
import { blueprintFixture, entityNbt } from '../../../tests/fixtures/blueprintFixture'
import { blockEntityFixture, unknownKeysFixture } from '../../../tests/fixtures/examples'
import { MemoryFileSink } from '../memoryFileSink'
import { serializeNbtFile } from '../nbt/index'
import { NbtBlueprintReader } from '../readers/nbtBlueprintReader'
import { BlueprintWriteError, type BlueprintWriter } from './blueprintWriter'
import { compareBlueprints } from './compareBlueprints'
import { exportBlueprint, exportFileName } from './exportBlueprint'
import { NbtBlueprintWriter, blueprintToStructure } from './nbtBlueprintWriter'

const reader = new NbtBlueprintReader()

/** 書いた一番上の Compound を change で書き換えてから gzip にする、壊れた書き出し */
function brokenWriter(change: (root: ReturnType<typeof blueprintToStructure>) => void): BlueprintWriter {
  return {
    format: 'nbt',
    extension: '.nbt',
    async write(bp: Blueprint) {
      const root = blueprintToStructure(bp)
      change(root)
      return serializeNbtFile({ name: '', root })
    },
  }
}

describe('exportBlueprint', () => {
  it('書き出して読み直し、一致したら保存する', async () => {
    const bp = blockEntityFixture().toBlueprint()
    const sink = new MemoryFileSink()
    const result = await exportBlueprint(bp, sink)
    expect(result.status).toBe('saved')
    expect(result.fileName).toBe('block-entity.nbt')
    const saved = sink.files.get('block-entity.nbt')
    expect(saved).toBeDefined()
    expect(result.byteLength).toBe(saved?.length)
    const back = await reader.read('block-entity.nbt', saved as Uint8Array)
    expect(compareBlueprints(bp, back)).toEqual([])
  })

  it('保存先を選ぶ画面を閉じたら cancelled を返す', async () => {
    const sink = new MemoryFileSink()
    sink.cancel = true
    const result = await exportBlueprint(unknownKeysFixture().toBlueprint(), sink, { fileName: 'out.nbt' })
    expect(result).toMatchObject({ status: 'cancelled', fileName: 'out.nbt' })
    expect(sink.files.size).toBe(0)
  })

  it('読み直した内容が一致しなければ保存しない（ブロックが欠けた）', async () => {
    const sink = new MemoryFileSink()
    const writer = brokenWriter((root) => root.value.set('blocks', nbt.list('end')))
    const error = await exportBlueprint(blockEntityFixture().toBlueprint(), sink, { writer }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BlueprintWriteError)
    expect((error as Error).message).toMatch(/一致しませんでした。ファイルは保存していません。/)
    expect((error as Error).message).toMatch(/\[0, 0, 0\] のブロックが create:creative_motor\[facing=east\] から 空き に/)
    expect(sink.files.size).toBe(0)
  })

  it('読み直した内容が一致しなければ保存しない（知らない項目が消えた）', async () => {
    const sink = new MemoryFileSink()
    const writer = brokenWriter((root) => root.value.delete('Railways_DataVersion'))
    await expect(exportBlueprint(unknownKeysFixture().toBlueprint(), sink, { writer })).rejects.toThrow(
      /知らない項目 Railways_DataVersion がなくなりました/,
    )
    expect(sink.files.size).toBe(0)
  })

  it('読み直せないファイルは保存しない', async () => {
    const sink = new MemoryFileSink()
    const writer = brokenWriter((root) => root.value.delete('size'))
    await expect(exportBlueprint(unknownKeysFixture().toBlueprint(), sink, { writer })).rejects.toThrow(
      /読み直せませんでした。ファイルは保存していません。/,
    )
    expect(sink.files.size).toBe(0)
  })
})

describe('compareBlueprints', () => {
  const base = () =>
    blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, nbt.compound({ Speed: nbt.float(0.1) }))
      .entity(entityNbt([1, 0, 0], 'minecraft:armor_stand'))
      .extra('Mod_Key', nbt.int(1))

  it('同じ内容なら違いなし。float は 32 ビットに丸めて比べる', async () => {
    const bp = base().toBlueprint()
    const back = await reader.read('a.nbt', await new NbtBlueprintWriter().write(bp))
    expect(compareBlueprints(bp, back)).toEqual([])
  })

  it('空気は置かれていないものとして比べる', () => {
    const withAir = base().place([1, 0, 0], 'minecraft:air').toBlueprint()
    expect(compareBlueprints(withAir, base().toBlueprint())).toEqual([])
  })

  it('生データ・エンティティ・知らない項目・DataVersion・大きさの違いを書く', () => {
    const bp = base().toBlueprint()
    const other = blueprintFixture({ size: [2, 1, 1], dataVersion: 3465 })
      .place([0, 0, 0], 'create:creative_motor', { facing: 'up' }, nbt.compound({ Speed: nbt.float(16) }))
      .entity(entityNbt([0, 0, 0], 'minecraft:armor_stand'))
      .extra('Mod_Key', nbt.int(2))
      .extra('Mod_New', nbt.int(1))
      .toBlueprint()
    expect(compareBlueprints(bp, other)).toEqual([
      'DataVersion が 2975 から 3465 に変わりました。',
      '[0, 0, 0] の生データ（nbt）が変わりました。',
      'エンティティ 1 個の中身が変わりました。',
      '知らない項目 Mod_Key の中身が変わりました。',
      '知らない項目 Mod_New が増えました。',
    ])
    const bigger = blueprintFixture({ size: [3, 1, 1] }).toBlueprint()
    expect(compareBlueprints(blueprintFixture({ size: [2, 1, 1] }).toBlueprint(), bigger)).toEqual([
      '大きさが [2, 1, 1] から [3, 1, 1] に変わりました。',
    ])
  })

  it('ブロックの違いが多いときは件数をまとめる', () => {
    const full = blueprintFixture({ size: [8, 1, 1] }).fill([0, 0, 0], [7, 0, 0], 'minecraft:stone').toBlueprint()
    const empty = blueprintFixture({ size: [8, 1, 1] }).toBlueprint()
    const diffs = compareBlueprints(full, empty)
    expect(diffs).toHaveLength(6)
    expect(diffs[5]).toBe('ほかにもブロックの違いが 3 個あります。')
  })
})

describe('exportFileName', () => {
  it('拡張子を置き換える', () => {
    expect(exportFileName('mill.nbt', '.nbt')).toBe('mill.nbt')
    expect(exportFileName('mill.litematic', '.nbt')).toBe('mill.nbt')
    expect(exportFileName('mill', '.nbt')).toBe('mill.nbt')
    expect(exportFileName('', '.nbt')).toBe('blueprint.nbt')
  })
})
