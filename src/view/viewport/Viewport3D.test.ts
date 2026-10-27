import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import type { Vec3 } from '../../domain/vec3'
import { placeBlock } from '../../edit/editCommand'
import { createDocumentSession, DOCUMENT_SESSION_KEY } from '../document/documentSession'
import ViewControls from '../shell/ViewControls.vue'
import { useLayerStore } from '../stores/layerStore'
import { useToolStore } from '../stores/toolStore'
import { useViewStore } from '../stores/viewStore'
import type { PickRay } from '../tools/picker'
import type { BlueprintScene } from './blueprintScene'
import type { CameraView } from './cameraViews'
import type { SceneRenderer } from './viewportRenderer'
import Viewport3D from './Viewport3D.vue'

/** WebGL を使わない偽の描画。レイは「画面の x, y の真上から下へ」にする */
class FakeRenderer implements SceneRenderer {
  onUserMove: (() => void) | null = null
  renders = 0
  views: (CameraView | 'fit')[] = []
  rayAt(clientX: number, clientY: number): PickRay {
    return { origin: [clientX + 0.5, 50, clientY + 0.5], direction: [0, -1, 0] }
  }
  resize(): void {}
  requestRender(): void {
    this.renders++
  }
  showView(view: CameraView, _size: Vec3): void {
    this.views.push(view)
  }
  fitAll(): void {
    this.views.push('fit')
  }
  dispose(): void {}
}

function sample() {
  return blueprintFixture({ size: [3, 2, 3], name: 'line.nbt' })
    .fill([0, 0, 0], [2, 0, 0], 'minecraft:stone')
    .place([1, 1, 0], 'create:shaft', { axis: 'y' })
    .toBlueprint()
}

function setup(factory?: () => SceneRenderer) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = createDocumentSession()
  session.setBlueprint(sample())
  const fake = new FakeRenderer()
  const wrapper = mount(Viewport3D, {
    props: { createRenderer: factory ?? (() => fake) },
    global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
  })
  const scene = (wrapper.vm as unknown as { scene: BlueprintScene }).scene
  return { session, fake, wrapper, scene, tools: useToolStore(), view: useViewStore() }
}

function pointer(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 0, bubbles: true, ...extra })
}

describe('Viewport3D', () => {
  it('開いている設計図を描き、斜めの視点で全体を見る', () => {
    const { scene, fake, view } = setup()
    expect(scene.renderStats).toEqual({ solid: 4, ghost: 0, meshes: 2 })
    expect(fake.views).toEqual(['iso'])
    expect(view.cameraView).toBe('iso')
  })

  it('編集と元に戻すのたびに描き直す', async () => {
    const { session, scene } = setup()
    const bp = session.current.value!.blueprint
    session.apply(placeBlock(bp, [0, 1, 2], state('minecraft:glass'), false))
    await nextTick()
    expect(scene.renderStats.solid).toBe(5)
    session.undo()
    await nextTick()
    expect(scene.renderStats.solid).toBe(4)
  })

  it('マウスの下のブロックを選択ツールに渡し、クリックで選択して枠を出す', async () => {
    const { wrapper, tools } = setup()
    const canvas = wrapper.get('canvas').element
    // (1, *, 0) の列：上の段の軸に当たる
    canvas.dispatchEvent(pointer('pointermove', 1, 0))
    expect(tools.hoverTarget).toMatchObject({ pos: [1, 1, 0], face: 'up', empty: false })
    expect(tools.hoveredPos).toEqual([1, 1, 0])

    canvas.dispatchEvent(pointer('pointerdown', 1, 0, { buttons: 1 }))
    canvas.dispatchEvent(pointer('pointerup', 1, 0))
    expect(tools.selectedPos).toEqual([1, 1, 0])

    // 空きマス（今の段の床）をクリックすると選択を外す
    canvas.dispatchEvent(pointer('pointerdown', 2, 2, { buttons: 1 }))
    canvas.dispatchEvent(pointer('pointerup', 2, 2))
    expect(tools.selectedPos).toBeNull()

    canvas.dispatchEvent(pointer('pointerleave', 0, 0))
    expect(tools.hoverTarget).toBeNull()
  })

  it('ドラッグ（カメラの操作）はクリックにしない', () => {
    const { wrapper, tools, fake, view } = setup()
    const canvas = wrapper.get('canvas').element
    canvas.dispatchEvent(pointer('pointerdown', 1, 0, { buttons: 1 }))
    fake.onUserMove?.()
    canvas.dispatchEvent(pointer('pointerup', 30, 40))
    expect(tools.selectedPos).toBeNull()
    expect(view.cameraView).toBeNull()
  })

  it('選択と強調の枠は、ストアの選択に合わせる', async () => {
    const { tools, scene, fake } = setup()
    const before = fake.renders
    tools.setSelected([0, 0, 0])
    await nextTick()
    const visible = scene.scene.children.filter((o) => o.type === 'LineSegments' && o.name === '' && o.visible)
    expect(visible.map((o) => o.position.toArray())).toEqual([[0.5, 0.5, 0.5]])
    expect(fake.renders).toBeGreaterThan(before)
  })

  it('段の表示方法、グリッド、座標軸の変更を描画に伝える', async () => {
    const { view, scene } = setup()
    useLayerStore().setLayer(0)
    view.setLayerMode('only')
    view.setGrid(false)
    view.setAxes(true)
    await nextTick()
    expect(scene.renderStats.solid).toBe(3)
    expect(scene.scene.getObjectByName('grid')!.visible).toBe(false)
    expect(scene.scene.getObjectByName('axes')!.visible).toBe(true)
  })

  it('視点のボタンでカメラを動かす', async () => {
    const { fake, wrapper } = setup()
    const pinia = (wrapper.vm as unknown as { $pinia: ReturnType<typeof createPinia> }).$pinia
    const session = createDocumentSession()
    session.setBlueprint(sample())
    const controls = mount(ViewControls, {
      global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    })
    await controls.get('[data-view="top"]').trigger('click')
    await controls.get('[data-view="top"]').trigger('click')
    await controls.get('[data-view="fit"]').trigger('click')
    expect(fake.views).toEqual(['iso', 'top', 'top', 'fit'])
    expect(controls.get('[data-view="top"]').attributes('aria-pressed')).toBe('true')
    expect(controls.get('[data-view="iso"]').attributes('aria-pressed')).toBe('false')

    await controls.get('[data-toggle="grid"]').trigger('click')
    expect(controls.get('[data-toggle="grid"]').attributes('aria-pressed')).toBe('false')
    await controls.get('[data-toggle="axes"]').trigger('click')
    expect(controls.get('[data-toggle="axes"]').attributes('aria-pressed')).toBe('true')
  })

  it('WebGL を使えないときは、理由とどうすればよいかを出す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { wrapper } = setup(() => {
      throw new Error('Error creating WebGL context.')
    })
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain('WebGL を使えない')
    warn.mockRestore()
  })
})

describe('ViewControls', () => {
  it('設計図を開いていなければ視点のボタンを押せない', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = createDocumentSession()
    const wrapper = mount(ViewControls, {
      global: { plugins: [pinia], provide: { [DOCUMENT_SESSION_KEY as symbol]: session } },
    })
    expect(wrapper.get('[data-view="iso"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-view="fit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-toggle="grid"]').attributes('disabled')).toBeUndefined()
  })
})
