import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeTauriDialog, FakeTauriFs } from '../../../tests/fixtures/fakeTauri'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { exportBlueprint } from '../writers/exportBlueprint'
import { readBlueprint } from '../readers/readBlueprint'

const fake = vi.hoisted(() => ({ fs: null as FakeTauriFs | null, dialog: null as FakeTauriDialog | null }))
const fs = () => {
  if (!fake.fs) throw new Error('fs を用意していません')
  return fake.fs
}
const dialog = () => {
  if (!fake.dialog) throw new Error('dialog を用意していません')
  return fake.dialog
}

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: (p: string, d: Uint8Array) => fs().writeFile(p, d),
  readFile: (p: string) => fs().readFile(p),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (o: unknown) => dialog().save(o),
  open: (o: unknown) => dialog().open(o),
}))

const { TauriFileSink } = await import('./tauriFileSink')
const { pickTauriBlueprintFile } = await import('./tauriBlueprintFiles')

beforeEach(() => {
  fake.fs = new FakeTauriFs()
  fake.dialog = new FakeTauriDialog()
})

describe('TauriFileSink', () => {
  it('保存先を選ぶ画面で選んだパスにだけ書く', async () => {
    dialog().nextSave = 'D:\\schematics\\mill.nbt'
    const result = await new TauriFileSink().save('mill.nbt', new Uint8Array([1, 2, 3]))
    expect(result).toBe('saved')
    expect(fs().calls).toEqual(['writeFile D:\\schematics\\mill.nbt'])
    expect(fs().files.get('D:\\schematics\\mill.nbt')?.data).toEqual(new Uint8Array([1, 2, 3]))
    expect(dialog().saveOptions[0]).toMatchObject({
      defaultPath: 'mill.nbt',
      filters: [{ name: '構造物 NBT', extensions: ['nbt'] }],
    })
  })

  it('画面を閉じたら何も書かずに cancelled', async () => {
    dialog().nextSave = null
    expect(await new TauriFileSink().save('mill.nbt', new Uint8Array([1]))).toBe('cancelled')
    expect(fs().calls).toEqual([])
  })

  it('書けなければ、何が起きたかとどうすればよいかを書いたエラー', async () => {
    dialog().nextSave = 'C:\\Windows\\mill.nbt'
    fs().allowed = ['D:\\']
    await expect(new TauriFileSink().save('mill.nbt', new Uint8Array([1]))).rejects.toThrow(/保存できませんでした.*別の場所/)
  })

  it('書き出し（exportBlueprint）で .nbt を保存し、読み直すと同じ設計図になる', async () => {
    dialog().nextSave = 'D:\\out.nbt'
    const bp = blueprintFixture().place([0, 0, 0], 'create:shaft', { axis: 'x' }).toBlueprint()
    const result = await exportBlueprint(bp, new TauriFileSink())
    expect(result).toMatchObject({ status: 'saved' })
    const saved = fs().files.get('D:\\out.nbt')?.data
    expect(saved).toBeDefined()
    const back = await readBlueprint('out.nbt', saved ?? new Uint8Array())
    expect(back.get([0, 0, 0])?.properties).toEqual({ axis: 'x' })
  })
})

describe('pickTauriBlueprintFile', () => {
  it('選んだファイルの名前と中身を返す。拡張子の点は取る', async () => {
    fs().add('D:\\bp\\mill.nbt', new Uint8Array([7, 8]))
    dialog().nextOpen = 'D:\\bp\\mill.nbt'
    const file = await pickTauriBlueprintFile(['.nbt'])
    expect(file?.name).toBe('mill.nbt')
    expect(new Uint8Array((await file?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(new Uint8Array([7, 8]))
    expect(dialog().openOptions[0]).toMatchObject({ directory: false, multiple: false, filters: [{ extensions: ['nbt'] }] })
  })

  it('取り消したら null', async () => {
    dialog().nextOpen = null
    expect(await pickTauriBlueprintFile(['.nbt'])).toBeNull()
  })
})
