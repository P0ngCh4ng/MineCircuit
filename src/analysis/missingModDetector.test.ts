import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { fakeJar } from '../../tests/fixtures/fakeJar'
import { scanJar } from '../io/modpack/jarScanner'
import { Modpack } from '../io/modpack/modpack'
import { countNamespaces, MissingModDetector } from './missingModDetector'

/** create の jar だけが入った Modpack */
function createOnlyPack(): Modpack {
  const jar = fakeJar({
    forgeMods: [{ modId: 'create', displayName: 'Create' }],
    lang: { create: { en_us: { 'block.create.shaft': 'Shaft' } } },
  })
  return new Modpack([scanJar('create.jar', jar)], null)
}

/** create・createaddition・pipez・minecraft を使う設計図 */
function mixedBlueprint() {
  return blueprintFixture({ size: [4, 2, 2] })
    .fill([0, 0, 0], [3, 0, 1], 'minecraft:stone')
    .place([0, 1, 0], 'create:shaft[axis=x]')
    .place([1, 1, 0], 'create:shaft[axis=x]')
    .place([2, 1, 0], 'createaddition:electric_motor')
    .place([3, 1, 0], 'createaddition:alternator')
    .place([0, 1, 1], 'pipez:item_pipe')
    .toBlueprint()
}

describe('MissingModDetector.detect', () => {
  it('Modpack にない namespace を名前順に返す', () => {
    const missing = new MissingModDetector().detect(mixedBlueprint(), createOnlyPack())
    expect(missing).toEqual(['createaddition', 'pipez'])
  })

  it('minecraft は jar になくても足りないとしない', () => {
    const bp = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'minecraft:stone').toBlueprint()
    expect(new MissingModDetector().detect(bp, new Modpack([], null))).toEqual([])
  })

  it('Modpack がない（null）ときは何も出さない', () => {
    expect(new MissingModDetector().detect(mixedBlueprint(), null)).toEqual([])
  })

  it('全部そろっていれば空', () => {
    const bp = blueprintFixture({ size: [1, 1, 1] }).place([0, 0, 0], 'create:shaft').toBlueprint()
    expect(new MissingModDetector().detect(bp, createOnlyPack())).toEqual([])
  })

  it('パレットに残っているだけで置かれていないブロックは数えない', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'pipez:item_pipe')
      .place([1, 0, 0], 'create:shaft')
      .remove([0, 0, 0])
      .toBlueprint()
    expect(new MissingModDetector().detect(bp, createOnlyPack())).toEqual([])
  })
})

describe('MissingModDetector.usage', () => {
  it('namespace ごとのブロック数と、足りないかを返す。足りないものが先', () => {
    const usage = new MissingModDetector().usage(mixedBlueprint(), createOnlyPack())
    expect(usage).toEqual([
      { namespace: 'createaddition', blockCount: 2, missing: true },
      { namespace: 'pipez', blockCount: 1, missing: true },
      { namespace: 'minecraft', blockCount: 8, missing: false },
      { namespace: 'create', blockCount: 2, missing: false },
    ])
  })

  it('Modpack がないときは数だけ出し、どれも足りないとしない', () => {
    const usage = new MissingModDetector().usage(mixedBlueprint(), null)
    expect(usage.map((u) => [u.namespace, u.missing])).toEqual([
      ['minecraft', false],
      ['create', false],
      ['createaddition', false],
      ['pipez', false],
    ])
  })

  it('空の設計図は空', () => {
    const bp = blueprintFixture({ size: [2, 2, 2] }).toBlueprint()
    expect(new MissingModDetector().usage(bp, createOnlyPack())).toEqual([])
  })
})

describe('countNamespaces', () => {
  it('空気は数えない', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'minecraft:air')
      .place([1, 0, 0], 'create:shaft')
      .toBlueprint()
    expect([...countNamespaces(bp)]).toEqual([['create', 1]])
  })
})
