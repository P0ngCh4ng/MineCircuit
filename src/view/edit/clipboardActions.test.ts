import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { noopCalcPlugin } from '../../../tests/fixtures/noopCalcPlugin'
import { InlineCalcBackend } from '../../calc/calcScheduler'
import { PluginRegistry } from '../../calc/pluginRegistry'
import type { Vec3 } from '../../domain/vec3'
import { CLIP_MESSAGES } from '../../edit/regionClip'
import App from '../App.vue'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import { useBrushStore } from '../stores/brushStore'
import { useCalcStore } from '../stores/calcStore'
import { usePasteStore } from '../stores/pasteStore'
import { useToolStore } from '../stores/toolStore'
import { CLIPBOARD_MESSAGES } from './clipboardActions'

function press(key: string, opts: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...opts }))
}

const empty = (pos: Vec3) => ({ pos, empty: true })

let wrapper: VueWrapper | null = null

// 4×1×3。[0,0,0] に x 向きのシャフト、[1,0,0] に石、[3,0,2] に土
function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useCalcStore().setBackend(new InlineCalcBackend(new PluginRegistry([noopCalcPlugin()])), { delayMs: 0 })
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [4, 1, 3] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'minecraft:stone')
      .place([3, 0, 2], 'minecraft:dirt')
      .toBlueprint(),
  )
  wrapper = mount(App, {
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    attachTo: document.body,
  })
  const tools = useToolStore()
  tools.setSelectionBox({ min: [0, 0, 0], max: [1, 0, 0] })
  return { session, bp: session.current.value!.blueprint, tools, brush: useBrushStore(), paste: usePasteStore() }
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('コピー・貼り付け（#133）', () => {
  it('Ctrl+C で写し、Ctrl+V の見本がマウスについて動き、クリックで貼る。貼った所を選び、元に戻すと選択を解除する', () => {
    const { session, bp, tools, brush, paste } = mountApp()
    press('c', { ctrlKey: true })
    expect(brush.message).toBe(CLIPBOARD_MESSAGES.copied(2))
    press('v', { ctrlKey: true })
    expect(paste.active).toBe(true)
    expect(brush.message).toBe(CLIPBOARD_MESSAGES.pasting)

    tools.hover(empty([0, 0, 1]))
    expect(paste.box).toEqual({ min: [0, 0, 1], max: [1, 0, 1] })
    expect(paste.cells.map((c) => c.pos)).toEqual([
      [0, 0, 1],
      [1, 0, 1],
    ])
    expect(paste.blocked).toBe(false)

    tools.click(empty([0, 0, 1]))
    expect(bp.get([0, 0, 1])?.key).toBe('create:shaft[axis=x]')
    expect(bp.get([1, 0, 1])?.key).toBe('minecraft:stone')
    expect(paste.active).toBe(false)
    expect(tools.selectionBox).toEqual({ min: [0, 0, 1], max: [1, 0, 1] })
    expect(session.nextUndoLabel.value).toBe('貼り付け（2 個）')

    session.undo()
    expect(bp.get([0, 0, 1])).toBeNull()
    expect(tools.selectionBox).toBeNull()
  })

  it('R で見本を回す。重なれば赤くして貼らず、Ctrl+クリックで上書きする', () => {
    const { bp, tools, brush, paste } = mountApp()
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })
    press('r')
    expect(paste.turns).toBe(1)
    // 縦に2つ並ぶ。[3,0,1] から下へ、[3,0,2] の土に重なる
    tools.hover(empty([3, 0, 1]))
    expect(paste.box).toEqual({ min: [3, 0, 1], max: [3, 0, 2] })
    expect(paste.blocked).toBe(true)
    tools.click(empty([3, 0, 1]))
    expect(brush.message).toBe(CLIP_MESSAGES.blocked(1))
    expect(bp.get([3, 0, 2])?.key).toBe('minecraft:dirt')
    expect(paste.active).toBe(true)

    tools.click(empty([3, 0, 1]), { shift: false, ctrl: true })
    expect(bp.get([3, 0, 1])?.key).toBe('create:shaft[axis=z]')
    expect(bp.get([3, 0, 2])?.key).toBe('minecraft:stone')
  })

  it('Esc で貼り付けをやめ、選択は残す。もう1回 Esc で選択を解除する', () => {
    const { tools, paste } = mountApp()
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })
    press('Escape')
    expect(paste.active).toBe(false)
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [1, 0, 0] })
    press('Escape')
    expect(tools.selectionBox).toBeNull()
  })

  it('ツールを切り替えると貼り付けをやめる', () => {
    const { tools, paste } = mountApp()
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })
    tools.setTool('place')
    expect(paste.active).toBe(false)
  })

  it('切り抜きがなければ Ctrl+V で知らせる', () => {
    const { brush, paste } = mountApp()
    press('v', { ctrlKey: true })
    expect(paste.active).toBe(false)
    expect(brush.message).toBe(CLIPBOARD_MESSAGES.noClip)
  })

  it('Ctrl+X で写してから消し、別の所に貼れる', () => {
    const { session, bp, tools } = mountApp()
    press('x', { ctrlKey: true })
    expect(bp.get([0, 0, 0])).toBeNull()
    expect(session.nextUndoLabel.value).toBe('範囲を切り取る（2 個）')
    press('v', { ctrlKey: true })
    tools.click(empty([1, 0, 1]))
    expect(bp.get([1, 0, 1])?.key).toBe('create:shaft[axis=x]')
  })

  it('Ctrl+D で写し、すぐ隣（x の正の向き）に見本を出す。はみ出せば設計図を広げる', () => {
    const { bp, tools, paste } = mountApp()
    press('d', { ctrlKey: true })
    expect(paste.active).toBe(true)
    expect(paste.box).toEqual({ min: [2, 0, 0], max: [3, 0, 0] })
    tools.click(empty([3, 0, 0]))
    expect(bp.size).toEqual([5, 1, 3])
    expect(bp.get([4, 0, 0])?.key).toBe('minecraft:stone')
  })
})
