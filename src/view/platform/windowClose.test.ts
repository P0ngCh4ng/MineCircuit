import { afterEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({
  handler: null as ((event: { preventDefault(): void }) => void) | null,
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault(): void }) => void) => {
      tauri.handler = handler
      return tauri.unlisten
    },
  }),
}))

import { onDesktopWindowClose } from './windowClose'

type TauriMarker = { isTauri?: boolean }

function requestClose(): boolean {
  let prevented = false
  tauri.handler?.({ preventDefault: () => (prevented = true) })
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
    expect(requestClose()).toBe(true)
    allow = true
    expect(requestClose()).toBe(false)
    stop()
    expect(tauri.unlisten).toHaveBeenCalled()
  })
})
