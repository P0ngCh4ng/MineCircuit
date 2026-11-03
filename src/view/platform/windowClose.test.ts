import { afterEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  handler: null as ((event: { preventDefault(): void }) => void | Promise<void>) | null,
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault(): void }) => void | Promise<void>) => {
      tauri.handler = handler
      return tauri.unlisten
    },
  }),
}))

import { onDesktopWindowClose } from './windowClose'

type TauriMarker = { isTauri?: boolean }

/** 閉じる求めを送る。Tauri と同じく、受けた関数が終わるのを待ってから止めたかどうかを見る */
async function requestClose(): Promise<boolean> {
  let prevented = false
  await tauri.handler?.({ preventDefault: () => (prevented = true) })
  return prevented
}

describe('onDesktopWindowClose', () => {
  afterEach(() => {
    delete (globalThis as TauriMarker).isTauri
    tauri.handler = null
  })

  it('ブラウザ版では受けない', async () => {
    const stop = await onDesktopWindowClose(() => false)
    expect(tauri.handler).toBeNull()
    stop()
    expect(tauri.unlisten).not.toHaveBeenCalled()
  })

  it('デスクトップ版では、shouldClose が false なら閉じるのを止める', async () => {
    ;(globalThis as TauriMarker).isTauri = true
    let allow = false
    const stop = await onDesktopWindowClose(() => allow)
    expect(await requestClose()).toBe(true)
    allow = true
    expect(await requestClose()).toBe(false)
    stop()
    expect(tauri.unlisten).toHaveBeenCalled()
  })

  it('shouldClose の答えが Promise なら、答えを待ってから決める（#225）', async () => {
    ;(globalThis as TauriMarker).isTauri = true
    await onDesktopWindowClose(async () => false)
    expect(await requestClose()).toBe(true)
    await onDesktopWindowClose(async () => true)
    expect(await requestClose()).toBe(false)
  })
})
