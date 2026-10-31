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
import type { PickTarget } from '../tools/tool'
import type { BlueprintScene } from './blueprintScene'
import type { FrameOverlay3D } from './frameOverlay3D'
import type { CameraView } from './cameraViews'
import type { SelectionOverlay3D } from './selectionOverlay3D'
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

  it('選択ツールで範囲の取っ手を引くと、面の向きに範囲を広げる。カメラは回さず、履歴にも入れない（#200）', async () => {
    class OrbitRenderer extends FakeRenderer {
      orbit: boolean[] = []
      setOrbitEnabled(on: boolean): void {
        this.orbit.push(on)
      }
    }
    const fake = new OrbitRenderer()
    const { wrapper, tools, session } = setup(() => fake)
    const overlay = (wrapper.vm as unknown as { selectionOverlay: SelectionOverlay3D }).selectionOverlay
    tools.setSelectionBox({ min: [0, 0, 0], max: [1, 0, 0] })
    await nextTick()
    // 選択ツール（既定）なら6つの取っ手を出す
    expect(overlay.shownHandles).toBe(6)
    const canvas = wrapper.get('canvas').element
    // x の大きい側の取っ手は (2.4, 0.5, 0.5)。偽のレイは画面の (x, y) の真上から下へ
    canvas.dispatchEvent(pointer('pointerdown', 1.9, 0, { buttons: 1 }))
    expect(fake.orbit).toEqual([false])
    canvas.dispatchEvent(pointer('pointermove', 2.7, 0, { buttons: 1 }))
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 0, 0] })
    canvas.dispatchEvent(pointer('pointerup', 2.7, 0))
    expect(fake.orbit).toEqual([false, true])
    expect(tools.selectionBox).toEqual({ min: [0, 0, 0], max: [2, 0, 0] })
    expect(session.canUndo.value).toBe(false)
    // ほかのツールでは出さない
    tools.register({ id: 'place', onHover: () => {}, onClick: () => {} })
    tools.setTool('place')
    await nextTick()
    expect(overlay.shownHandles).toBe(0)
  })

  it('選択ツールで設計図の枠の取っ手を引くと、変えたあとの枠を出し、離すと大きさを変える（#201）', async () => {
    class OrbitRenderer extends FakeRenderer {
      orbit: boolean[] = []
      setOrbitEnabled(on: boolean): void {
        this.orbit.push(on)
      }
    }
    const fake = new OrbitRenderer()
    const { wrapper, session } = setup(() => fake)
    await nextTick()
    const overlay = (wrapper.vm as unknown as { frameOverlay: FrameOverlay3D }).frameOverlay
    expect(overlay.shownHandles).toBe(6)
    const canvas = wrapper.get('canvas').element
    // 3×2×3 の x の大きい側の取っ手は (4.2, 1, 1.5)。偽のレイは画面の (x, y) の真上から下へ
    canvas.dispatchEvent(pointer('pointerdown', 3.7, 1, { buttons: 1 }))
    expect(fake.orbit).toEqual([false])
    canvas.dispatchEvent(pointer('pointermove', 5.6, 1, { buttons: 1 }))
    await nextTick()
    expect(overlay.shownPreviewBox).toEqual({ min: [0, 0, 0], max: [5, 1, 2] })
    canvas.dispatchEvent(pointer('pointerup', 5.6, 1))
    await nextTick()
    expect(fake.orbit).toEqual([false, true])
    expect(overlay.shownPreviewBox).toBeNull()
    expect(session.current.value!.blueprint.size).toEqual([6, 2, 3])
    session.undo()
    expect(session.current.value!.blueprint.size).toEqual([3, 2, 3])
  })

  it('置くツールでブロックか床からドラッグすると、カメラを回さずに一直線のドラッグを渡す（#161）', () => {
    /** 画面の 10px が 1 マス。カメラを回すのを止めたかを記録する */
    class ScaledRenderer extends FakeRenderer {
      orbit: boolean[] = []
      override rayAt(clientX: number, clientY: number): PickRay {
        return { origin: [clientX / 10 + 0.05, 50, clientY / 10 + 0.05], direction: [0, -1, 0] }
      }
      setOrbitEnabled(enabled: boolean): void {
        this.orbit.push(enabled)
      }
    }
    const fake = new ScaledRenderer()
    const { wrapper, tools } = setup(() => fake)
    const log: string[] = []
    const pos = (t: PickTarget | null) => (t ? t.pos.join(',') : 'null')
    tools.register({
      id: 'place',
      onHover: () => {},
      onClick: (t) => log.push(`click:${pos(t)}`),
      dragStart: (t) => (log.push(`start:${pos(t)}`), true),
      dragMove: (t) => log.push(`move:${pos(t)}`),
      dragEnd: (t) => log.push(`end:${pos(t)}`),
    })
    tools.setTool('place')
    const canvas = wrapper.get('canvas').element

    // 石の列 (0..2, 0, 0) の上の面から、床の (0, *, 2) へ
    canvas.dispatchEvent(pointer('pointerdown', 0, 0, { buttons: 1 }))
    expect(fake.orbit).toEqual([false])
    canvas.dispatchEvent(pointer('pointermove', 2, 0, { buttons: 1 }))
    expect(log).toEqual([])
    canvas.dispatchEvent(pointer('pointermove', 0, 20, { buttons: 1 }))
    canvas.dispatchEvent(pointer('pointerup', 0, 25))
    expect(log).toEqual(['start:0,0,0', 'move:0,0,2', 'end:0,0,2'])
    expect(fake.orbit).toEqual([false, true])

    // 動かさずに離したときは、ふつうのクリック
    log.length = 0
    canvas.dispatchEvent(pointer('pointerdown', 15, 15, { buttons: 1 }))
    canvas.dispatchEvent(pointer('pointerup', 15, 15))
    expect(log).toEqual(['click:1,0,1'])

    // 設計図の外（何も指さない所）からは、今までどおりカメラを回す
    fake.orbit.length = 0
    canvas.dispatchEvent(pointer('pointerdown', 200, 200, { buttons: 1 }))
    expect(fake.orbit).toEqual([])
  })

  it('2つ以上のマスの範囲を選ぶと、箱を画面に写した所の近くに範囲のツールバーを出す（#160）', async () => {
    /** 真上から見た写し方：x・z をそのまま 10 倍する。描いたあとに onRender を呼ぶ */
    class ProjectingRenderer extends FakeRenderer {
      onRender: (() => void) | null = null
      projectToScreen(p: Vec3): [number, number] {
        return [p[0] * 10, p[2] * 10]
      }
      override requestRender(): void {
        super.requestRender()
        this.onRender?.()
      }
    }
    const fake = new ProjectingRenderer()
    const { wrapper, tools } = setup(() => fake)
    expect(wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
    tools.setSelectionBox({ min: [0, 0, 0], max: [2, 1, 0] })
    await nextTick()
    await nextTick()
    expect(wrapper.get('[data-testid="selection-toolbar"]').find('[data-action="select-all"]').exists()).toBe(true)
    // 1つのブロックなら出さない
    tools.setSelected([0, 0, 0])
    await nextTick()
    expect(wrapper.find('[data-testid="selection-toolbar"]').exists()).toBe(false)
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

  it('2つ以上のマスが入る範囲は箱の線で囲み、1つのブロックの枠は出さない（#130）', async () => {
    const { wrapper, tools, scene } = setup()
    const overlay = (wrapper.vm as unknown as { selectionOverlay: SelectionOverlay3D }).selectionOverlay
    expect(scene.scene.children).toContain(overlay.group)
    const singleFrames = () => scene.scene.children.filter((o) => o.type === 'LineSegments' && o.name === '' && o.visible)

    tools.setSelected([0, 0, 0])
    await nextTick()
    expect(overlay.object.visible).toBe(false)
    expect(singleFrames()).toHaveLength(1)

    tools.extendSelection([2, 1, 0])
    await nextTick()
    expect(overlay.shownBox).toEqual({ min: [0, 0, 0], max: [2, 1, 0] })
    expect(overlay.object.visible).toBe(true)
    expect(singleFrames()).toHaveLength(0)

    tools.setSelected(null)
    await nextTick()
    expect(overlay.object.visible).toBe(false)
    wrapper.unmount()
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
