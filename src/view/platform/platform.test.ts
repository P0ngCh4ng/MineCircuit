import { afterEach, describe, expect, it } from 'vitest'
import { currentPlatform, isDesktop } from './platform'

type TauriMarker = { isTauri?: boolean }

describe('platform', () => {
  afterEach(() => {
    delete (globalThis as TauriMarker).isTauri
  })

  it('ブラウザでは browser を返す', () => {
    expect(isDesktop()).toBe(false)
    expect(currentPlatform()).toBe('browser')
  })

  it('Tauri の目印があれば desktop を返す', () => {
    ;(globalThis as TauriMarker).isTauri = true
    expect(isDesktop()).toBe(true)
    expect(currentPlatform()).toBe('desktop')
  })
})
