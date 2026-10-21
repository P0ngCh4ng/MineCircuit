import { describe, expect, it } from 'vitest'
import { fakeJar } from '../../tests/fixtures/fakeJar'
import { BlockState } from '../domain/blockState'
import { ResourceLocation } from '../domain/resourceLocation'
import { scanJar } from '../io/modpack/jarScanner'
import { Modpack } from '../io/modpack/modpack'
import { blueprintFixture } from '../../tests/fixtures/blueprintFixture'
import { BlockBrush } from './blockBrush'
import { rotateBlock } from './editCommand'
import { initialPropertiesFor, parsePropertyValueOptions, propertyValueOptionsFor } from './orientationOptions'

const rl = (s: string) => ResourceLocation.parse(s)
const state = (id: string, properties: Record<string, string> = {}) => new BlockState(rl(id), properties)

// Create のブロックに似せた定義（本物の jar の中身は入れない）
function variantsFor(props: Record<string, string[]>): { variants: Record<string, { model: string }> } {
  let keys: string[] = ['']
  for (const [name, values] of Object.entries(props)) {
    keys = keys.flatMap((k) => values.map((v) => (k ? `${k},${name}=${v}` : `${name}=${v}`)))
  }
  return { variants: Object.fromEntries(keys.map((k) => [k, { model: 'test:block/x' }])) }
}

function createLikePack(): Modpack {
  const jar = fakeJar({
    forgeMods: [{ modId: 'create' }],
    blockStates: {
      // 軸の3方向
      'create:shaft': variantsFor({ axis: ['x', 'y', 'z'] }),
      // 水平の軸だけ（縦にできない）
      'create:belt_like': variantsFor({ axis: ['x', 'z'] }),
      // 6方向
      'create:creative_motor': variantsFor({ facing: ['down', 'up', 'north', 'south', 'west', 'east'] }),
      // facing が水平の4方向だけ
      'create:deployer_like': variantsFor({ facing: ['north', 'south', 'west', 'east'], powered: ['false', 'true'] }),
      'create:horizontal': variantsFor({ horizontal_facing: ['north', 'east', 'south', 'west'] }),
      // 向きのないブロック
      'create:andesite_casing': { variants: { '': { model: 'test:block/x' } } },
      // multipart（柵のような形と、向きを条件に持つ形）
      'create:pipe_like': {
        multipart: [
          { apply: { model: 'test:block/core' } },
          { when: { north: 'true' }, apply: { model: 'test:block/n' } },
          { when: { OR: [{ east: true }, { west: 'true' }] }, apply: { model: 'test:block/ew' } },
        ],
      },
      'create:multipart_facing': {
        multipart: [
          { when: { facing: 'north|south' }, apply: { model: 'test:block/ns' } },
          { when: { AND: [{ facing: 'east' }, { lit: 'false' }] }, apply: { model: 'test:block/e' } },
        ],
      },
    },
  })
  return new Modpack([scanJar('create.jar', jar)], null)
}

describe('parsePropertyValueOptions', () => {
  it('variants のキーから値を集める', () => {
    expect(parsePropertyValueOptions(variantsFor({ axis: ['x', 'z'], powered: ['false', 'true'] }))).toEqual({
      axis: ['x', 'z'],
      powered: ['false', 'true'],
    })
  })

  it('"" や "normal" のように = のないキーは読まない。何もなければ null', () => {
    expect(parsePropertyValueOptions({ variants: { '': {} } })).toBeNull()
    expect(parsePropertyValueOptions({ variants: { normal: {} } })).toBeNull()
  })

  it('multipart の when（| の区切り、OR、AND、文字列でない値）から値を集める', () => {
    const options = parsePropertyValueOptions({
      multipart: [
        { apply: {} },
        { when: { facing: 'north|south' }, apply: {} },
        { when: { OR: [{ facing: 'east' }, { lit: true }] }, apply: {} },
        { when: { AND: [{ facing: 'up' }, { lit: 'false' }] }, apply: {} },
      ],
    })
    expect(options).toEqual({ facing: ['north', 'south', 'east', 'up'], lit: ['true', 'false'] })
  })

  it('否定の条件がある property は制限しない', () => {
    const options = parsePropertyValueOptions({
      multipart: [
        { when: { facing: '!north' }, apply: {} },
        { when: { facing: 'south', axis: 'x' }, apply: {} },
      ],
    })
    expect(options).toEqual({ axis: ['x'] })
  })

  it('形の違う JSON は null', () => {
    expect(parsePropertyValueOptions(null)).toBeNull()
    expect(parsePropertyValueOptions([])).toBeNull()
    expect(parsePropertyValueOptions('x')).toBeNull()
    expect(parsePropertyValueOptions({ variants: [], multipart: {} })).toBeNull()
  })
})

describe('propertyValueOptionsFor', () => {
  it('Modpack がない・定義がないときは null', () => {
    expect(propertyValueOptionsFor(null, rl('create:shaft'))).toBeNull()
    expect(propertyValueOptionsFor(createLikePack(), rl('create:unknown'))).toBeNull()
  })

  it('jar のブロック状態の定義から読む', () => {
    const pack = createLikePack()
    expect(propertyValueOptionsFor(pack, rl('create:shaft'))).toEqual({ axis: ['x', 'y', 'z'] })
    expect(propertyValueOptionsFor(pack, rl('create:multipart_facing'))).toEqual({
      facing: ['north', 'south', 'east'],
      lit: ['false'],
    })
  })
})

describe('Modpack の定義の範囲で回す', () => {
  const pack = createLikePack()

  it('軸：3方向あれば縦にでき、水平の軸だけなら縦にできない', () => {
    const shaft = BlockBrush.fromBlock(state('create:shaft', { axis: 'x' }), pack)
    expect(shaft.rotate(true)).toBe(true)
    expect(shaft.state.properties.axis).toBe('y')

    const belt = BlockBrush.fromBlock(state('create:belt_like', { axis: 'x' }), pack)
    expect(belt.rotate(true)).toBe(false)
    expect(belt.rotate(false)).toBe(true)
    expect(belt.state.properties.axis).toBe('z')
  })

  it('facing：6方向なら上下にでき、水平の4方向だけなら縦にできない', () => {
    const motor = BlockBrush.fromBlock(state('create:creative_motor', { facing: 'north' }), pack)
    expect(motor.rotate(true)).toBe(true)
    expect(motor.state.properties.facing).toBe('up')

    const deployer = BlockBrush.fromBlock(state('create:deployer_like', { facing: 'north', powered: 'false' }), pack)
    expect(deployer.rotate(true)).toBe(false)
    expect(deployer.rotate(false)).toBe(true)
    expect(deployer.state.properties).toEqual({ facing: 'east', powered: 'false' })
  })

  it('horizontal_facing：水平に一周する', () => {
    const b = BlockBrush.fromBlock(state('create:horizontal', { horizontal_facing: 'west' }), pack)
    expect(b.rotate(false)).toBe(true)
    expect(b.state.properties.horizontal_facing).toBe('north')
  })

  it('multipart：条件に出てくる向きだけを使う', () => {
    const b = BlockBrush.fromBlock(state('create:multipart_facing', { facing: 'north', lit: 'false' }), pack)
    expect(b.rotate(false)).toBe(true)
    expect(b.state.properties.facing).toBe('east')
    expect(b.rotate(false)).toBe(true)
    expect(b.state.properties.facing).toBe('south')
    expect(b.rotate(false)).toBe(true) // west は定義にないので飛ばす
    expect(b.state.properties.facing).toBe('north')
    expect(b.rotate(true)).toBe(false) // up / down は定義にない
  })

  it('向きのないブロックは回せない。Modpack がなければ規則のとおりに回す', () => {
    expect(BlockBrush.fromBlock(state('create:andesite_casing'), pack).rotate(false)).toBe(false)
    expect(BlockBrush.fromBlock(state('create:pipe_like', { north: 'true' }), pack).rotate(false)).toBe(false)

    const noPack = BlockBrush.fromBlock(state('create:belt_like', { axis: 'x' }), null)
    expect(noPack.options).toBeNull()
    expect(noPack.rotate(true)).toBe(true)
    expect(noPack.state.properties.axis).toBe('y')
  })

  it('rotateBlock も Modpack の定義に従う', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:belt_like', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'x' })
      .toBlueprint()
    expect(rotateBlock(bp, [0, 0, 0], true, pack)).toBeNull()
    expect(rotateBlock(bp, [0, 0, 0], true, null)).not.toBeNull()
    const cmd = rotateBlock(bp, [1, 0, 0], true, pack)
    expect(cmd?.changes[0]?.after.state?.properties.axis).toBe('y')
  })
})

describe('initialPropertiesFor（一覧から選んだときの状態）', () => {
  const pack = new Modpack(
    [
      scanJar(
        'x.jar',
        fakeJar({
          blockStates: {
            'x:motor': variantsFor({ facing: ['north', 'east', 'south', 'west', 'up', 'down'], powered: ['false', 'true'] }),
            'x:plain': { variants: { '': { model: 'x:block/plain' } } },
            'x:fence': {
              multipart: [
                { apply: { model: 'x:block/post' } },
                { when: { north: 'true' }, apply: { model: 'x:block/side' } },
                { when: { OR: [{ east: 'false' }, { east: 'true' }] }, apply: { model: 'x:block/side' } },
              ],
            },
          },
        }),
      ),
    ],
    null,
  )

  it('variants 形式は最初のキーの値', () => {
    expect(initialPropertiesFor(pack, rl('x:motor'))).toEqual({ facing: 'north', powered: 'false' })
  })

  it('multipart 形式は取りうる値のそれぞれ最初の値', () => {
    expect(initialPropertiesFor(pack, rl('x:fence'))).toEqual({ north: 'true', east: 'false' })
  })

  it('properties のないブロック、定義のないブロック、Modpack がないときは空', () => {
    expect(initialPropertiesFor(pack, rl('x:plain'))).toEqual({})
    expect(initialPropertiesFor(pack, rl('x:none'))).toEqual({})
    expect(initialPropertiesFor(null, rl('x:motor'))).toEqual({})
  })
})
