import { describe, expect, it } from 'vitest'
import { defaultFaceUv, modelPath, parseModelJson, withNamespace } from './modelJson'

describe('withNamespace / modelPath', () => {
  it('namespace のない ID は minecraft', () => {
    expect(withNamespace('block/cube_all')).toBe('minecraft:block/cube_all')
    expect(withNamespace('create:block/shaft')).toBe('create:block/shaft')
    expect(modelPath('create:block/shaft')).toBe('assets/create/models/block/shaft.json')
    expect(modelPath('block/stone')).toBe('assets/minecraft/models/block/stone.json')
  })
})

describe('defaultFaceUv', () => {
  // 中央の柱 [6,0,6]〜[10,16,10] と、角の小さな箱 [1,2,3]〜[5,7,11]
  it('Minecraft と同じく、要素の範囲を面に投影する', () => {
    expect(defaultFaceUv('up', [6, 0, 6], [10, 16, 10])).toEqual([6, 6, 10, 10])
    expect(defaultFaceUv('north', [6, 0, 6], [10, 16, 10])).toEqual([6, 0, 10, 16])
    const from = [1, 2, 3] as const
    const to = [5, 7, 11] as const
    expect(defaultFaceUv('down', from, to)).toEqual([1, 5, 5, 13])
    expect(defaultFaceUv('up', from, to)).toEqual([1, 3, 5, 11])
    expect(defaultFaceUv('north', from, to)).toEqual([11, 9, 15, 14])
    expect(defaultFaceUv('south', from, to)).toEqual([1, 9, 5, 14])
    expect(defaultFaceUv('west', from, to)).toEqual([3, 9, 11, 14])
    expect(defaultFaceUv('east', from, to)).toEqual([5, 9, 13, 14])
  })
})

describe('parseModelJson', () => {
  it('要素・面・回転を読み、書いていない値は既定値にする', () => {
    const notes: string[] = []
    const m = parseModelJson(
      {
        parent: 'block/block',
        ambientocclusion: false,
        textures: { side: 'create:block/x', end: '#side', other: 'block/stone', obj: { sprite: 'test:block/s' } },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 8, 16],
            rotation: { origin: [8, 8, 8], axis: 'y', angle: 22.5, rescale: true },
            shade: false,
            faces: {
              up: { texture: '#end', cullface: 'up', tintindex: 0 },
              bottom: { texture: '#side', uv: [1, 2, 3, 4], rotation: 270 },
            },
          },
        ],
      },
      (n) => notes.push(n),
    )
    expect(notes).toEqual([])
    expect(m).toEqual({
      parent: 'minecraft:block/block',
      ambientOcclusion: false,
      textures: { side: 'create:block/x', end: '#side', other: 'minecraft:block/stone', obj: 'test:block/s' },
      elements: [
        {
          from: [0, 0, 0],
          to: [16, 8, 16],
          rotation: { origin: [8, 8, 8], axis: 'y', angle: 22.5, rescale: true },
          shade: false,
          faces: {
            up: { texture: '#end', uv: [0, 0, 16, 16], rotation: 0, cullface: 'up', tintIndex: 0 },
            down: { texture: '#side', uv: [1, 2, 3, 4], rotation: 270, cullface: null, tintIndex: null },
          },
        },
      ],
    })
  })

  it('elements を書いていなければ null（親のものを使う）。空の配列は空', () => {
    expect(parseModelJson({ parent: 'a:b' }, () => {})?.elements).toBeNull()
    expect(parseModelJson({ elements: [] }, () => {})?.elements).toEqual([])
    expect(parseModelJson({}, () => {})?.ambientOcclusion).toBeNull()
  })

  it('読めない部分は飛ばして書き残す', () => {
    const notes: string[] = []
    const m = parseModelJson(
      {
        elements: [
          { from: [0, 0], to: [1, 1, 1] },
          { from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#a', rotation: 45 }, sideways: { texture: '#a' }, down: {} } },
        ],
      },
      (n) => notes.push(n),
    )
    expect(m?.elements).toHaveLength(1)
    expect(m?.elements?.[0]?.faces.up?.rotation).toBe(0)
    expect(Object.keys(m?.elements?.[0]?.faces ?? {})).toEqual(['up'])
    expect(notes).toHaveLength(4)
  })

  it('オブジェクトでなければ null', () => {
    expect(parseModelJson([], () => {})).toBeNull()
  })
})
