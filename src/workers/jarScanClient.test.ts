import { describe, expect, it } from 'vitest'
import { fakeJar } from '../../tests/fixtures/fakeJar'
import { isWantedJarEntry, scanJar, scanJarContent, type JarContent } from '../io/modpack/jarScanner'
import { readZipPartially } from '../io/modpack/partialZip'
import { jarContentTransfer } from './jarScanClient'

const jar = () =>
  fakeJar({
    forgeMods: [{ modId: 'gears', displayName: 'Gears' }],
    lang: { gears: { en_us: { 'block.gears.gear': 'Gear' } } },
    blockStates: { 'gears:gear': { variants: {} } },
  })

describe('jarContentTransfer', () => {
  it('jar 全体はそのバッファを移す', () => {
    const bytes = jar()
    expect(jarContentTransfer({ kind: 'zip', bytes })).toEqual([bytes.buffer])
  })

  it('一部だけ読んだものは、重ならないバッファの一覧を移し、Worker 側で同じ結果になる', async () => {
    const bytes = jar()
    const zip = await readZipPartially({ size: bytes.length, read: async (s, e) => bytes.slice(s, e) }, isWantedJarEntry)
    const content: JarContent = { kind: 'entries', zip }
    const transfer = jarContentTransfer(content)
    expect(transfer.length).toBeGreaterThan(0)
    expect(new Set(transfer).size).toBe(transfer.length)
    // Worker へ送るときと同じく、移して写す
    const moved = structuredClone(content, { transfer })
    expect(scanJarContent('gears.jar', moved)).toEqual(scanJar('gears.jar', bytes))
  })
})
