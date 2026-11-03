import { afterEach, describe, expect, it, vi } from 'vitest'

const dialog = vi.hoisted(() => ({ confirm: vi.fn(async (_message: string, _options?: unknown) => false) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: dialog.confirm }))

import { confirmOnPlatform } from './confirmDialog'

type TauriMarker = { isTauri?: boolean }

describe('confirmOnPlatform', () => {
  afterEach(() => {
    delete (globalThis as TauriMarker).isTauri
    delete (window as { confirm?: unknown }).confirm
    dialog.confirm.mockClear()
  })

  it('ブラウザ版では window.confirm で確かめる', async () => {
    // テストの環境には window.confirm がないので置く
    const confirm = vi.fn((_message?: string) => true)
    window.confirm = confirm
    expect(await confirmOnPlatform('閉じますか。')).toBe(true)
    expect(confirm).toHaveBeenCalledWith('閉じますか。')
    expect(dialog.confirm).not.toHaveBeenCalled()
  })

  it('デスクトップ版では dialog プラグインの確認の画面で確かめ、答えを待つ（#225）', async () => {
    ;(globalThis as TauriMarker).isTauri = true
    const confirm = vi.fn((_message?: string) => true)
    window.confirm = confirm
    expect(await confirmOnPlatform('閉じますか。')).toBe(false)
    dialog.confirm.mockResolvedValueOnce(true)
    expect(await confirmOnPlatform('閉じますか。')).toBe(true)
    expect(dialog.confirm).toHaveBeenCalledWith('閉じますか。', expect.objectContaining({ okLabel: 'OK', cancelLabel: 'キャンセル' }))
    expect(confirm).not.toHaveBeenCalled()
  })
})
