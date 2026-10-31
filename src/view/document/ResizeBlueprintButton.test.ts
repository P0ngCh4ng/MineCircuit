import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { useBrushStore } from '../stores/brushStore'
import { createDocumentSession, provideDocumentSession, type DocumentSession } from './documentSession'
import ResizeBlueprintButton from './ResizeBlueprintButton.vue'

function mountWith(session: DocumentSession) {
  const Host = defineComponent({
    setup() {
      provideDocumentSession(session)
      return () => h(ResizeBlueprintButton)
    },
  })
  return mount(Host)
}

// 4×2×3。(1,0,1) と (3,1,2) に石
function opened(): DocumentSession {
  const session = createDocumentSession()
  session.setBlueprint(
    blueprintFixture({ size: [4, 2, 3] }).place([1, 0, 1], 'minecraft:stone').place([3, 1, 2], 'minecraft:stone').toBlueprint(),
    'sample.nbt',
  )
  return session
}

describe('ResizeBlueprintButton（#191）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('設計図がなければ押せない', () => {
    const wrapper = mountWith(createDocumentSession())
    expect(wrapper.find('[data-action="resize-blueprint"]').attributes('disabled')).toBeDefined()
  })

  it('6方向に足すマス数を入れて広げる。負の向きなら座標がずれたと知らせ、元に戻すと元の大きさ', async () => {
    const session = opened()
    const wrapper = mountWith(session)
    await wrapper.find('[data-action="resize-blueprint"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    // 変わらないうちは押せない
    expect(wrapper.find('[data-action="apply-resize"]').attributes('disabled')).toBeDefined()

    await wrapper.find('input[name="x-min"]').setValue('2')
    await wrapper.find('input[name="y-max"]').setValue('3')
    expect(wrapper.find('[data-role="next-size"]').text()).toContain('4 × 2 × 3 → 6 × 5 × 3')
    await wrapper.find('form').trigger('submit')
    const bp = session.current.value!.blueprint
    expect(bp.size).toEqual([6, 5, 3])
    expect(bp.get([3, 0, 1])?.key).toBe('minecraft:stone')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(useBrushStore().message).toBe('設計図を負の向きに広げたので、座標が x +2 ずれました')

    session.undo()
    expect(bp.size).toEqual([4, 2, 3])
    expect(bp.get([1, 0, 1])?.key).toBe('minecraft:stone')
  })

  it('縮めて消えるブロックがあれば数を出し、ボタンを「消して変える」にする。各辺 1 未満なら理由を出して押せない', async () => {
    const session = opened()
    const wrapper = mountWith(session)
    await wrapper.find('[data-action="resize-blueprint"]').trigger('click')
    await wrapper.find('input[name="y-max"]').setValue('-1')
    expect(wrapper.find('[data-role="removed"]').text()).toContain('ブロック 1 個')
    expect(wrapper.find('[data-action="apply-resize"]').text()).toBe('ブロックを 1 個消して変える')

    await wrapper.find('input[name="y-max"]').setValue('-2')
    expect(wrapper.find('[role="alert"]').text()).toBe('各辺は 1 以上にしてください')
    expect(wrapper.find('[data-action="apply-resize"]').attributes('disabled')).toBeDefined()

    await wrapper.find('input[name="y-max"]').setValue('-1')
    await wrapper.find('form').trigger('submit')
    expect(session.current.value!.blueprint.size).toEqual([4, 1, 3])
    expect(session.current.value!.blueprint.get([3, 1, 2])).toBeNull()
  })

  it('余白を詰める。詰めたあとは押せない', async () => {
    const session = opened()
    const wrapper = mountWith(session)
    await wrapper.find('[data-action="resize-blueprint"]').trigger('click')
    await wrapper.find('[data-action="trim-blueprint"]').trigger('click')
    const bp = session.current.value!.blueprint
    expect(bp.size).toEqual([3, 2, 2])
    expect(bp.get([0, 0, 0])?.key).toBe('minecraft:stone')

    await wrapper.find('[data-action="resize-blueprint"]').trigger('click')
    expect(wrapper.find('[data-action="trim-blueprint"]').attributes('disabled')).toBeDefined()
  })
})
