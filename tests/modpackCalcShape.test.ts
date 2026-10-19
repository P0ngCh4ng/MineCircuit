// io の Modpack が、計算プラグインの受け取る CalcModpack の形を満たすことを確かめる
// （io は calc を import できないので、ここで確かめる）
import { describe, expect, it } from 'vitest'
import type { CalcModpack } from '../src/calc/calcPlugin'
import { Modpack } from '../src/io/modpack/modpack'

describe('Modpack と CalcModpack', () => {
  it('Modpack をそのまま CalcModpack として渡せる', async () => {
    const pack: CalcModpack = new Modpack([], null)
    expect(pack.hasNamespace('minecraft')).toBe(true)
    expect(await pack.config('config/x.toml')).toBeNull()
  })
})
