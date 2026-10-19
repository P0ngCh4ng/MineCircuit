import { describe, expect, it, vi } from 'vitest'
import { BrowserFileSink, NBT_FILE_TYPE, supportsSaveFilePicker, type BrowserSaveEnvironment } from './browserFileSink'

/** 書き込みを記録するだけの FileSystemFileHandle */
function fakeHandle(options: { failWrite?: boolean } = {}) {
  const written: Uint8Array[] = []
  const calls: string[] = []
  const writable = {
    write: vi.fn(async (data: Uint8Array) => {
      if (options.failWrite) throw new DOMException('ディスクがいっぱいです', 'QuotaExceededError')
      written.push(data)
    }),
    close: vi.fn(async () => {
      calls.push('close')
    }),
    abort: vi.fn(async () => {
      calls.push('abort')
    }),
  }
  const handle = { createWritable: vi.fn(async () => writable) } as unknown as FileSystemFileHandle
  return { handle, written, calls }
}

function env(picker: BrowserSaveEnvironment['picker']): BrowserSaveEnvironment & { downloads: string[] } {
  const downloads: string[] = []
  return { picker, download: (name) => downloads.push(name), downloads }
}

const data = new Uint8Array([1, 2, 3])

describe('BrowserFileSink', () => {
  it('保存先を選ぶ画面で選んだファイルに書く', async () => {
    const { handle, written, calls } = fakeHandle()
    const picker = vi.fn(async () => handle)
    const sink = new BrowserFileSink({ id: 'export' }, env(picker))
    expect(await sink.save('mill.nbt', data)).toBe('saved')
    expect(picker).toHaveBeenCalledWith({ id: 'export', suggestedName: 'mill.nbt', types: [NBT_FILE_TYPE] })
    expect(written).toEqual([data])
    expect(calls).toEqual(['close'])
  })

  it('画面を閉じたら cancelled', async () => {
    const picker = vi.fn(async (): Promise<FileSystemFileHandle> => {
      throw new DOMException('取り消し', 'AbortError')
    })
    expect(await new BrowserFileSink({}, env(picker)).save('mill.nbt', data)).toBe('cancelled')
  })

  it('書き込みに失敗したら途中のファイルを捨てて、エラーをそのまま投げる', async () => {
    const { handle, calls } = fakeHandle({ failWrite: true })
    const sink = new BrowserFileSink({}, env(async () => handle))
    await expect(sink.save('mill.nbt', data)).rejects.toThrow('ディスクがいっぱいです')
    expect(calls).toEqual(['abort'])
  })

  it('保存先を選ぶ画面がないブラウザではダウンロードする', async () => {
    const e = env(null)
    expect(await new BrowserFileSink({}, e).save('mill.nbt', data)).toBe('saved')
    expect(e.downloads).toEqual(['mill.nbt'])
  })

  it('happy-dom には showSaveFilePicker がない', () => {
    expect(supportsSaveFilePicker()).toBe(false)
  })
})
