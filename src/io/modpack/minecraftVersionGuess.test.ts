import { describe, expect, it } from 'vitest'
import { guessMinecraftVersion } from './minecraftVersionGuess'

const mod = (jar: string, version: string | null = null) => ({ jar, version })

describe('guessMinecraftVersion', () => {
  it('jar の名前と Mod のバージョンに一番多く出てくるバージョンを返す', () => {
    const v = guessMinecraftVersion([
      mod('create-1.20.1-0.5.1.f.jar', '0.5.1.f'),
      mod('jei-1.20.1-forge-15.2.0.27.jar'),
      mod('sodium.jar', '0.5.3+mc1.20.1'),
      mod('other-1.18.2.jar'),
    ])
    expect(v?.name).toBe('1.20.1')
    expect(v?.dataVersion).toBe(3465)
  })

  it('同じ jar の中の Mod は1つと数える', () => {
    const v = guessMinecraftVersion([
      mod('a-1.18.2.jar'),
      mod('a-1.18.2.jar!/inner-1.18.2.jar'),
      mod('b-1.20.1.jar'),
      mod('c-1.20.1.jar'),
    ])
    expect(v?.name).toBe('1.20.1')
  })

  it('Mod のバージョンの一部（0.5.1）や一覧にないものは数えない', () => {
    expect(guessMinecraftVersion([mod('x-11.18.2.jar', '1.18.21'), mod('y.jar', '0.5.1')])).toBeNull()
  })

  it('見つからない・同数のときは null', () => {
    expect(guessMinecraftVersion([])).toBeNull()
    expect(guessMinecraftVersion([mod('a-1.18.2.jar'), mod('b-1.20.1.jar')])).toBeNull()
  })
})
