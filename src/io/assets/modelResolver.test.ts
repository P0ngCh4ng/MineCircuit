import { describe, expect, it } from 'vitest'
import { BlockState } from '../../domain/blockState'
import { DIRECTIONS } from '../../domain/direction'
import { ResourceLocation } from '../../domain/resourceLocation'
import { MemoryAssetReader } from '../../../tests/fixtures/fakeAppearance'
import { BUILTIN_PARENT_MODEL_IDS } from './builtinParentModels'
import { MISSING_TEXTURE, ModelResolver, resolveTextureReference } from './modelResolver'

function state(id: string, properties: Record<string, string> = {}): BlockState {
  return new BlockState(ResourceLocation.parse(id), properties)
}

const json = (v: unknown): string => JSON.stringify(v)

function resolverOf(files: Record<string, unknown>): { resolver: ModelResolver; reader: MemoryAssetReader } {
  const text: Record<string, string> = {}
  for (const [path, v] of Object.entries(files)) text[path] = typeof v === 'string' ? v : json(v)
  const reader = new MemoryAssetReader(text)
  return { resolver: new ModelResolver(reader), reader }
}

// y 軸の柱。uv を書かない面がある
const shaftModel = {
  parent: 'block/block',
  textures: { axis: 'test:block/shaft', axis_top: 'test:block/shaft_end', particle: '#axis' },
  elements: [
    {
      from: [6, 0, 6],
      to: [10, 16, 10],
      faces: {
        north: { texture: '#axis', uv: [6, 0, 10, 16] },
        east: { texture: '#axis' },
        up: { texture: '#axis_top', cullface: 'up' },
        down: { texture: '#axis_top', cullface: 'down' },
      },
    },
  ],
}

describe('ModelResolver：variants', () => {
  const files = {
    'assets/test/blockstates/shaft.json': {
      variants: {
        'axis=x': { model: 'test:block/shaft', x: 90, y: 90 },
        'axis=y': { model: 'test:block/shaft' },
        'axis=z': [{ model: 'test:block/shaft', x: 90, weight: 2 }, { model: 'test:block/other' }],
      },
    },
    'assets/test/models/block/shaft.json': shaftModel,
  }

  it('状態に合うモデルを選び、x / y を付ける。要素とテクスチャを確定する', async () => {
    const { resolver } = resolverOf(files)
    const a = await resolver.resolve(state('test:shaft', { axis: 'x' }))
    expect(a?.parts).toHaveLength(1)
    const part = a!.parts[0]!
    expect(part).toMatchObject({ x: 90, y: 90, uvlock: false })
    expect(part.model.id).toBe('test:block/shaft')
    expect(part.model.ambientOcclusion).toBe(true)
    const e = part.model.elements[0]!
    expect(e.from).toEqual([6, 0, 6])
    expect(e.shade).toBe(true)
    expect(e.rotation).toBeNull()
    expect(e.faces.north).toEqual({ texture: 'test:block/shaft', uv: [6, 0, 10, 16], rotation: 0, cullface: null, tintIndex: null })
    // uv を書いていない面は、要素の範囲から決める
    expect(e.faces.east?.uv).toEqual([6, 0, 10, 16])
    expect(e.faces.up).toEqual({ texture: 'test:block/shaft_end', uv: [6, 6, 10, 10], rotation: 0, cullface: 'up', tintIndex: null })
    expect(e.faces.south).toBeUndefined()
    expect(resolver.problems).toEqual([])
  })

  it('重み付きの配列は先頭', async () => {
    const { resolver } = resolverOf(files)
    const a = await resolver.resolve(state('test:shaft', { axis: 'z' }))
    expect(a?.parts[0]).toMatchObject({ x: 90, y: 0 })
    expect(a?.parts[0]?.model.id).toBe('test:block/shaft')
  })

  it('"" のキーは properties のない状態にも合う', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/plain.json': { variants: { '': { model: 'test:block/shaft' } } },
      'assets/test/models/block/shaft.json': shaftModel,
    })
    expect((await resolver.resolve(state('test:plain')))?.parts).toHaveLength(1)
    expect((await resolver.resolve(state('test:plain', { waterlogged: 'true' })))?.parts).toHaveLength(1)
  })

  it('一部の property だけのキーでも合う', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/lamp.json': { variants: { 'lit=true': { model: 'test:block/shaft', y: 180 } } },
      'assets/test/models/block/shaft.json': shaftModel,
    })
    const a = await resolver.resolve(state('test:lamp', { lit: 'true', waterlogged: 'false' }))
    expect(a?.parts[0]?.y).toBe(180)
  })

  it('合う variant がなければ null と問題', async () => {
    const { resolver } = resolverOf(files)
    expect(await resolver.resolve(state('test:shaft', { axis: 'w' }))).toBeNull()
    expect(resolver.problems).toHaveLength(1)
    expect(resolver.problems[0]).toContain('test:shaft[axis=w]')
  })
})

describe('ModelResolver：multipart', () => {
  const files = {
    'assets/test/blockstates/fence.json': {
      multipart: [
        { apply: { model: 'test:block/post' } },
        { when: { north: 'true' }, apply: { model: 'test:block/side', uvlock: true } },
        { when: { east: 'true' }, apply: { model: 'test:block/side', y: 90, uvlock: true } },
        { when: { OR: [{ north: 'true' }, { east: 'true' }] }, apply: { model: 'test:block/cap' } },
        { when: { AND: [{ north: 'true' }, { east: 'true' }] }, apply: { model: 'test:block/corner' } },
        { when: { facing: 'south|west' }, apply: { model: 'test:block/cap', x: 180 } },
      ],
    },
    'assets/test/models/block/post.json': { parent: 'block/cube_all', textures: { all: 'test:block/red' } },
    'assets/test/models/block/side.json': { parent: 'block/cube_all', textures: { all: 'test:block/green' } },
    'assets/test/models/block/cap.json': { parent: 'block/cube_all', textures: { all: 'test:block/blue' } },
    'assets/test/models/block/corner.json': { parent: 'block/cube_all', textures: { all: 'test:block/blue' } },
  }

  const models = async (resolver: ModelResolver, props: Record<string, string>): Promise<string[] | undefined> =>
    (await resolver.resolve(state('test:fence', props)))?.parts.map((p) => `${p.model.id}@${p.x},${p.y}${p.uvlock ? 'u' : ''}`)

  it('when が合う部分を重ねる（OR・AND・|）', async () => {
    const { resolver } = resolverOf(files)
    expect(await models(resolver, { north: 'false', east: 'false', facing: 'north' })).toEqual(['test:block/post@0,0'])
    expect(await models(resolver, { north: 'true', east: 'false', facing: 'north' })).toEqual([
      'test:block/post@0,0',
      'test:block/side@0,0u',
      'test:block/cap@0,0',
    ])
    expect(await models(resolver, { north: 'true', east: 'true', facing: 'west' })).toEqual([
      'test:block/post@0,0',
      'test:block/side@0,0u',
      'test:block/side@0,90u',
      'test:block/cap@0,0',
      'test:block/corner@0,0',
      'test:block/cap@180,0',
    ])
    expect(resolver.problems).toEqual([])
  })

  it('同じモデルは1つの結果を共有する', async () => {
    const { resolver } = resolverOf(files)
    const a = await resolver.resolve(state('test:fence', { north: 'true', east: 'true', facing: 'north' }))
    expect(a!.parts[1]!.model).toBe(a!.parts[2]!.model)
  })
})

describe('ModelResolver：parent と変数', () => {
  it('親の要素を子が継承し、子の textures で変数を解決する（#a → #b のつながりも）', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/thing.json': { variants: { '': { model: 'test:block/child' } } },
      'assets/test/models/block/child.json': { parent: 'test:block/middle', textures: { base: 'test:block/red', top: 'test:block/blue' } },
      'assets/test/models/block/middle.json': { parent: 'test:block/root', textures: { side: '#base', top: 'test:block/green' }, ambientocclusion: false },
      'assets/test/models/block/root.json': {
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: { north: { texture: '#side' }, up: { texture: '#top', tintindex: 1 }, down: { texture: '#nothing' } },
          },
        ],
      },
    })
    const m = (await resolver.resolve(state('test:thing')))!.parts[0]!.model
    expect(m.id).toBe('test:block/child')
    expect(m.ambientOcclusion).toBe(false)
    expect(m.elements[0]!.faces.north?.texture).toBe('test:block/red')
    // 子の値が親の値に勝つ
    expect(m.elements[0]!.faces.up?.texture).toBe('test:block/blue')
    expect(m.elements[0]!.faces.up?.tintIndex).toBe(1)
    // 決まらない変数は missing にして問題に書く
    expect(m.elements[0]!.faces.down?.texture).toBe(MISSING_TEXTURE)
    expect(resolver.problems).toEqual(['モデル test:block/child: テクスチャの変数 #nothing が決まっていません'])
  })

  it('子が elements を持てば、親の要素は使わない', async () => {
    const { resolver } = resolverOf({
      'assets/test/models/block/child.json': {
        parent: 'test:block/root',
        elements: [{ from: [0, 0, 0], to: [16, 1, 16], faces: { up: { texture: '#all' } } }],
      },
      'assets/test/models/block/root.json': {
        textures: { all: 'test:block/red' },
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#all' } } }, { from: [1, 1, 1], to: [2, 2, 2], faces: {} }],
      },
    })
    const m = await resolver.resolveModel('test:block/child')
    expect(m?.elements).toHaveLength(1)
    expect(m?.elements[0]?.to).toEqual([16, 1, 16])
    expect(m?.elements[0]?.faces.up?.texture).toBe('test:block/red')
  })

  it('要素の回転と shade を写す', async () => {
    const { resolver } = resolverOf({
      'assets/test/models/block/tilted.json': {
        textures: { t: 'test:block/blue' },
        elements: [
          {
            from: [0, 7, 0],
            to: [16, 9, 16],
            shade: false,
            rotation: { origin: [8, 8, 8], axis: 'x', angle: -22.5 },
            faces: { up: { texture: '#t', rotation: 90 } },
          },
        ],
      },
    })
    const e = (await resolver.resolveModel('test:block/tilted'))!.elements[0]!
    expect(e.rotation).toEqual({ origin: [8, 8, 8], axis: 'x', angle: -22.5, rescale: false })
    expect(e.shade).toBe(false)
    expect(e.faces.up?.rotation).toBe(90)
  })

  it('親が見つからなければ null と問題', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/thing.json': { variants: { '': { model: 'test:block/child' } } },
      'assets/test/models/block/child.json': { parent: 'test:block/gone' },
    })
    expect(await resolver.resolve(state('test:thing'))).toBeNull()
    expect(resolver.problems).toEqual(['モデル test:block/gone（test:block/child の親） が見つかりません（assets/test/models/block/gone.json）'])
  })

  it('親が循環していても止まり、null と問題', async () => {
    const { resolver } = resolverOf({
      'assets/test/models/block/a.json': { parent: 'test:block/b' },
      'assets/test/models/block/b.json': { parent: 'test:block/a' },
    })
    const [a, b] = await Promise.all([resolver.resolveModel('test:block/a'), resolver.resolveModel('test:block/b')])
    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(resolver.problems[0]).toContain('循環')
  })

  it('builtin/generated・builtin/entity は描けないので null と問題', async () => {
    const { resolver, reader } = resolverOf({
      'assets/test/blockstates/chest.json': { variants: { '': { model: 'test:block/chest' } } },
      'assets/test/models/block/chest.json': { parent: 'builtin/entity', textures: { particle: 'test:block/red' } },
      'assets/test/blockstates/flat.json': { variants: { '': { model: 'test:item/flat' } } },
      'assets/test/models/item/flat.json': { parent: 'item/generated', textures: { layer0: 'test:block/red' } },
      'assets/minecraft/models/item/generated.json': { parent: 'builtin/generated' },
    })
    expect(await resolver.resolve(state('test:chest'))).toBeNull()
    expect(await resolver.resolve(state('test:flat'))).toBeNull()
    expect(resolver.problems).toHaveLength(2)
    expect(resolver.problems.every((p) => p.includes('描けません'))).toBe(true)
    expect(reader.reads).not.toContain('assets/minecraft/models/builtin/entity.json')
  })

  it('要素が1つもなければ null（ゲームではプログラムで描くブロック）', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/wheel.json': { variants: { '': { model: 'test:block/wheel' } } },
      'assets/test/models/block/wheel.json': { parent: 'block/block', textures: { particle: 'test:block/red' } },
    })
    expect(await resolver.resolve(state('test:wheel'))).toBeNull()
    expect(resolver.problems[0]).toContain('描く要素がありません')
  })
})

describe('ModelResolver：内蔵のバニラの親', () => {
  it('cube_all は全面が #all の立方体。各面はその向きで隠れる', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/block.json': { variants: { '': { model: 'test:block/block' } } },
      'assets/test/models/block/block.json': { parent: 'minecraft:block/cube_all', textures: { all: 'test:block/red' } },
    })
    const m = (await resolver.resolve(state('test:block')))!.parts[0]!.model
    expect(m.elements).toHaveLength(1)
    const e = m.elements[0]!
    expect(e.from).toEqual([0, 0, 0])
    expect(e.to).toEqual([16, 16, 16])
    for (const d of DIRECTIONS) {
      expect(e.faces[d]).toEqual({ texture: 'test:block/red', uv: [0, 0, 16, 16], rotation: 0, cullface: d, tintIndex: null })
    }
    expect(resolver.problems).toEqual([])
  })

  it.each([
    ['block/cube_column', { end: 'test:block/blue', side: 'test:block/green' }, { up: 'test:block/blue', down: 'test:block/blue', north: 'test:block/green', east: 'test:block/green' }],
    [
      'block/cube_bottom_top',
      { top: 'test:block/blue', bottom: 'test:block/red', side: 'test:block/green' },
      { up: 'test:block/blue', down: 'test:block/red', west: 'test:block/green' },
    ],
    [
      'block/orientable',
      { top: 'test:block/blue', front: 'test:block/red', side: 'test:block/green' },
      { up: 'test:block/blue', down: 'test:block/blue', north: 'test:block/red', south: 'test:block/green' },
    ],
    [
      'block/orientable_with_bottom',
      { top: 'test:block/blue', bottom: 'test:block/shaft', front: 'test:block/red', side: 'test:block/green' },
      { down: 'test:block/shaft', north: 'test:block/red' },
    ],
    [
      'block/cube',
      { down: 'test:block/a', up: 'test:block/b', north: 'test:block/c', south: 'test:block/d', west: 'test:block/e', east: 'test:block/f' },
      { down: 'test:block/a', up: 'test:block/b', north: 'test:block/c', south: 'test:block/d', west: 'test:block/e', east: 'test:block/f' },
    ],
  ])('%s の変数の対応', async (parent, textures, expected) => {
    const { resolver } = resolverOf({ 'assets/test/models/block/m.json': { parent, textures } })
    const e = (await resolver.resolveModel('test:block/m'))!.elements[0]!
    for (const [dir, tex] of Object.entries(expected)) expect(e.faces[dir as keyof typeof e.faces]?.texture).toBe(tex)
    expect(resolver.problems).toEqual([])
  })

  it('利用者の資産に同じ ID のモデルがあれば、そちらを使う', async () => {
    const { resolver } = resolverOf({
      'assets/test/models/block/m.json': { parent: 'block/cube_all', textures: { all: 'test:block/red' } },
      'assets/minecraft/models/block/cube_all.json': {
        elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: '#all' } } }],
      },
    })
    const m = await resolver.resolveModel('test:block/m')
    expect(m?.elements[0]?.to).toEqual([16, 8, 16])
  })

  it('内蔵の親はどれも親をたどれる', async () => {
    const { resolver } = resolverOf({})
    for (const id of BUILTIN_PARENT_MODEL_IDS) expect(await resolver.resolveModel(id)).not.toBeNull()
  })
})

describe('ModelResolver：読めないもの・覚えておくこと', () => {
  it('blockstates がなければ null と問題（同じブロックの問題は1回だけ）', async () => {
    const { resolver } = resolverOf({})
    expect(await resolver.resolve(state('test:none', { a: '1' }))).toBeNull()
    expect(await resolver.resolve(state('test:none', { a: '2' }))).toBeNull()
    expect(resolver.problems).toHaveLength(1)
    expect(resolver.problems[0]).toContain('assets/test/blockstates/none.json')
  })

  it('壊れた JSON は null と問題。コメントや余分な , は読める', async () => {
    const { resolver } = resolverOf({
      'assets/test/blockstates/broken.json': '{ "variants": ',
      'assets/test/blockstates/lenient.json': '﻿{ "variants": { "": { "model": "test:block/m" }, }, }',
      'assets/test/models/block/m.json': { parent: 'block/cube_all', textures: { all: 'test:block/red' } },
    })
    expect(await resolver.resolve(state('test:broken'))).toBeNull()
    expect(await resolver.resolve(state('test:lenient'))).not.toBeNull()
    expect(resolver.problems).toHaveLength(1)
    expect(resolver.problems[0]).toContain('JSON')
  })

  it('空気は何もない見た目', async () => {
    const { resolver } = resolverOf({})
    expect(await resolver.resolve(state('minecraft:air'))).toEqual({ parts: [] })
    expect(resolver.problems).toEqual([])
  })

  it('同じブロック状態・同じモデルは2度読まない', async () => {
    const { resolver, reader } = resolverOf({
      'assets/test/blockstates/a.json': { variants: { 'n=1': { model: 'test:block/m' }, 'n=2': { model: 'test:block/m', y: 90 } } },
      'assets/test/models/block/m.json': { parent: 'block/cube_all', textures: { all: 'test:block/red' } },
    })
    const s1 = state('test:a', { n: '1' })
    const [a, b] = await Promise.all([resolver.resolve(s1), resolver.resolve(state('test:a', { n: '1' }))])
    expect(a).toBe(b)
    const all = await resolver.resolveAll([s1, state('test:a', { n: '2' })])
    expect(Object.keys(all)).toEqual(['test:a[n=1]', 'test:a[n=2]'])
    expect(all['test:a[n=2]']!.parts[0]!.model).toBe(a!.parts[0]!.model)
    const counts = new Map<string, number>()
    for (const r of reader.reads) counts.set(r, (counts.get(r) ?? 0) + 1)
    expect([...counts.values()].every((n) => n === 1)).toBe(true)
  })

  it('読み込みのエラーは問題に書いて null', async () => {
    const resolver = new ModelResolver({
      readText: () => Promise.reject(new Error('壊れた jar')),
      readBytes: () => Promise.resolve(null),
    })
    expect(await resolver.resolve(state('test:x'))).toBeNull()
    expect(resolver.problems[0]).toContain('壊れた jar')
  })
})

describe('ModelResolver：OBJ のモデル', () => {
  const cage = {
    parent: 'block/block',
    loader: 'forge:obj',
    'flip-v': true,
    model: 'test:models/block/burner/cage.obj',
    textures: { '0': 'test:block/brazier', particle: 'test:block/dark' },
  }
  const obj = [
    'mtllib cage.mtl',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'vt 0 0',
    'vt 1 0',
    'vt 1 1',
    'usemtl m_0',
    'f 1/1 2/2 3/3',
    'usemtl m_unknown',
    'f 3/3 2/2 1/1',
  ].join('\n')
  const files = {
    'assets/test/blockstates/burner.json': { variants: { 'facing=east': { model: 'test:block/burner/block', y: 90 } } },
    'assets/test/models/block/burner/block.json': cage,
    'assets/test/models/block/burner/cage.obj': obj,
    'assets/test/models/block/burner/cage.mtl': 'newmtl m_0\nmap_Kd #0\n',
  }

  it('.obj と .mtl を読み、材質のテクスチャをモデルの変数で決める。置き方の回転はそのまま渡す', async () => {
    const { resolver } = resolverOf(files)
    const look = await resolver.resolve(state('test:burner', { facing: 'east' }))
    expect(look?.parts).toHaveLength(1)
    const part = look!.parts[0]!
    expect(part.y).toBe(90)
    expect(part.model.elements).toEqual([])
    expect(part.model.meshes.map((m) => m.texture)).toEqual(['test:block/brazier', MISSING_TEXTURE])
    const mesh = part.model.meshes[0]!
    expect(mesh.positions).toEqual([0, 0, 0, 16, 0, 0, 16, 16, 0])
    // flip-v なので v は 1 - v
    expect(mesh.uvs).toEqual([0, 16, 16, 16, 16, 0])
    expect(resolver.problems).toEqual(['モデル test:block/burner/block: テクスチャの変数 （材質 m_unknown） が決まっていません'])
  })

  it('子が OBJ を指せば、親の elements は使わない。OBJ がなければ null にして理由を書く', async () => {
    const { resolver } = resolverOf({
      ...files,
      'assets/test/models/block/burner/block.json': { ...cage, parent: 'test:block/cubeish' },
      'assets/test/models/block/cubeish.json': { elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }] },
    })
    const look = await resolver.resolve(state('test:burner', { facing: 'east' }))
    expect(look!.parts[0]!.model.elements).toEqual([])
    expect(look!.parts[0]!.model.meshes).toHaveLength(2)

    const missing = resolverOf({ ...files, 'assets/test/models/block/burner/cage.obj': undefined as unknown as string })
    expect(await missing.resolver.resolve(state('test:burner', { facing: 'east' }))).toBeNull()
    expect(missing.resolver.problems).toContain(
      'モデル test:block/burner/block: OBJ のファイルが見つかりません（assets/test/models/block/burner/cage.obj）',
    )
  })
})

describe('ModelResolver：部品のモデルの表', () => {
  const plate = (y: number) => ({ textures: { 0: 'create:block/belt' }, elements: [{ from: [1, y, 0], to: [15, y + 1, 16], faces: { up: { texture: '#0' } } }] })
  const files = {
    'assets/create/blockstates/belt.json': { variants: { '': { model: 'create:block/belt/particle' } } },
    'assets/create/models/block/belt/particle.json': { textures: { particle: 'create:block/belt' }, elements: [] },
    'assets/create/models/block/belt/middle.json': plate(12),
    'assets/create/models/block/belt/middle_bottom.json': plate(3),
  }
  const belt = state('create:belt', { facing: 'east', part: 'middle', slope: 'horizontal' })

  it('blockstates のモデルが空でも、表の部品を回して重ねる', async () => {
    const { resolver } = resolverOf(files)
    const look = await resolver.resolve(belt)
    expect(look!.parts.map((p) => p.model.id)).toEqual([
      'create:block/belt/particle',
      'create:block/belt/middle',
      'create:block/belt/middle_bottom',
    ])
    expect(look!.parts[1]!.matrix).toBeDefined()
    expect(look!.parts[0]!.matrix).toBeUndefined()
  })

  it('読めない部品は飛ばし、何も描くものがなければ null', async () => {
    const { resolver } = resolverOf({ ...files, 'assets/create/models/block/belt/middle_bottom.json': undefined as unknown as string })
    expect((await resolver.resolve(belt))!.parts).toHaveLength(2)
    expect(resolver.problems).toContain('モデル create:block/belt/middle_bottom が見つかりません（assets/create/models/block/belt/middle_bottom.json）')

    const none = resolverOf({ 'assets/create/blockstates/belt.json': files['assets/create/blockstates/belt.json'], 'assets/create/models/block/belt/particle.json': files['assets/create/models/block/belt/particle.json'] })
    expect(await none.resolver.resolve(belt)).toBeNull()
  })
})

describe('ModelResolver：液体', () => {
  it('形がなく particle が still のテクスチャなら、液体の箱にする。ほかの形のないモデルは null のまま', async () => {
    const { resolver } = resolverOf({
      'assets/minecraft/blockstates/water.json': { variants: { '': { model: 'minecraft:block/water' } } },
      'assets/minecraft/models/block/water.json': { textures: { particle: 'block/water_still' } },
      'assets/test/blockstates/chest.json': { variants: { '': { model: 'test:block/chest' } } },
      'assets/test/models/block/chest.json': { textures: { particle: 'test:block/planks' } },
    })
    const water = await resolver.resolve(state('minecraft:water', { level: '4' }))
    expect(water!.parts[0]!.model.id).toBe('minecraft:water#fluid')
    expect(water!.parts[0]!.model.elements[0]!.to[1]).toBeCloseTo((4 / 9) * 16)
    expect(await resolver.resolve(state('test:chest'))).toBeNull()
    expect(resolver.problems).toEqual(['test:chest: モデルに描く要素がありません（ゲームではプログラムで描くブロックです）'])
  })
})

describe('resolveTextureReference', () => {
  it('変数をたどる。# のない値は変数名として探し、なければ ID とみなす', () => {
    const t = { a: '#b', b: 'test:block/x', c: '#c', name: 'test:block/y' }
    expect(resolveTextureReference('#a', t)).toBe('test:block/x')
    expect(resolveTextureReference('name', t)).toBe('test:block/y')
    expect(resolveTextureReference('block/stone', t)).toBe('minecraft:block/stone')
    expect(resolveTextureReference('#c', t)).toBeNull()
    expect(resolveTextureReference('#constructor', t)).toBeNull()
    expect(resolveTextureReference('missing', t)).toBeNull()
  })
})
