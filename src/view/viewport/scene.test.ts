import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { blueprintFixture, state } from '../../../tests/fixtures/blueprintFixture'
import { BlockVolume } from '../../domain/blockVolume'
import { Blueprint } from '../../domain/blueprint'
import { placeBlock } from '../../edit/editCommand'
import { EditHistory } from '../../edit/editHistory'
import { layerVisibility, SHOW_ALL_LAYERS, type LayerDisplay } from '../layers/layerDisplay'
import { blockColor, blockColorCss, hslToHex } from './blockColor'
import { collectBlockInstances, countInstances, countVisible } from './blockInstances'
import { BlueprintMeshBuilder, layerClipFor, type BlockMeshInfo } from './blueprintMeshBuilder'
import { BlueprintScene } from './blueprintScene'
import { blueprintCenter, cameraPose, fitDistance, viewDirection } from './cameraViews'
import { DARK_THEME, LIGHT_THEME } from './viewportTheme'

/** 3×3×3 の設計図。下の段に石 3 つと軸 1 つ、真ん中の段に石 1 つ、上の段に歯車 1 つ */
function sample() {
  return blueprintFixture({ size: [3, 3, 3] })
    .fill([0, 0, 0], [2, 0, 0], 'minecraft:stone')
    .place([1, 0, 1], 'create:shaft', { axis: 'y' })
    .place([1, 1, 1], 'minecraft:stone')
    .place([2, 2, 2], 'create:cogwheel', { axis: 'x' })
    .toBlueprint()
}

function display(layer: number, mode: LayerDisplay['mode'], hidden: number[] = []): LayerDisplay {
  return { layer, mode, hidden: new Set(hidden) }
}

describe('blockColor', () => {
  it('同じ ID はいつも同じ色、違う ID は違う色になる', () => {
    expect(blockColor('create:shaft')).toBe(blockColor('create:shaft'))
    expect(blockColor('create:shaft')).not.toBe(blockColor('create:cogwheel'))
    expect(blockColorCss('create:shaft')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('HSL を 0xRRGGBB にする', () => {
    expect(hslToHex(0, 1, 0.5)).toBe(0xff0000)
    expect(hslToHex(120, 1, 0.5)).toBe(0x00ff00)
    expect(hslToHex(240, 1, 0.5)).toBe(0x0000ff)
    expect(hslToHex(0, 0, 1)).toBe(0xffffff)
  })
})

describe('layerVisibility', () => {
  it('表示方法ごとに段の見え方を決める', () => {
    const modes = (d: LayerDisplay) => [0, 1, 2].map((y) => layerVisibility(d, y))
    expect(modes(SHOW_ALL_LAYERS)).toEqual(['solid', 'solid', 'solid'])
    expect(modes(display(1, 'hideAbove'))).toEqual(['solid', 'solid', 'hidden'])
    expect(modes(display(1, 'ghostAbove'))).toEqual(['solid', 'solid', 'ghost'])
    expect(modes(display(1, 'only'))).toEqual(['hidden', 'solid', 'hidden'])
  })

  it('非表示にした段は、どの表示方法でも隠す', () => {
    expect(layerVisibility(display(1, 'all', [0]), 0)).toBe('hidden')
    expect(layerVisibility(display(1, 'ghostAbove', [2]), 2)).toBe('hidden')
  })
})

describe('collectBlockInstances', () => {
  it('ID ごとにまとめ、状態が違っても同じ ID は1つにする', () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:shaft', { axis: 'x' })
      .place([1, 0, 0], 'create:shaft', { axis: 'y' })
      .toBlueprint()
    const groups = collectBlockInstances(bp)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: 'create:shaft', color: blockColor('create:shaft') })
    expect(groups[0].positions).toEqual([0, 0, 0, 1, 0, 0])
    expect([...groups[0].layerCounts]).toEqual([[0, 2]])
  })

  it('ID の順に並べ、すべての段を集め、段ごとの数から見える数を数える', () => {
    const groups = collectBlockInstances(sample())
    expect(groups.map((g) => g.id)).toEqual(['create:cogwheel', 'create:shaft', 'minecraft:stone'])
    expect(groups[0].positions).toEqual([2, 2, 2])
    expect([...groups[2].layerCounts]).toEqual([
      [0, 3],
      [1, 1],
    ])
    const visibility = (d: LayerDisplay) => (y: number) => layerVisibility(d, y)
    expect(countInstances(groups, visibility(SHOW_ALL_LAYERS))).toEqual({ solid: 6, ghost: 0 })
    expect(countInstances(groups, visibility(display(0, 'ghostAbove', [1])))).toEqual({ solid: 4, ghost: 1 })
    expect(countVisible(groups[2], visibility(display(1, 'only')))).toEqual({ solid: 1, ghost: 0 })
  })

  it('リージョンのずれを足し、重なる位置は先のリージョンだけを入れる', () => {
    // a：(0,0,0) に石。b：(0,0,0)〜(1,0,0) にガラス（(0,0,0) は a と重なる）。c：ずれ (4,2,0) に土
    const a = new BlockVolume({ name: 'a', size: [1, 1, 1], palette: [state('minecraft:stone')], cells: Int32Array.of(0) })
    const b = new BlockVolume({ name: 'b', size: [2, 1, 1], palette: [state('minecraft:glass')], cells: Int32Array.of(0, 0) })
    const c = new BlockVolume({ name: 'c', size: [1, 1, 1], offset: [4, 2, 0], palette: [state('minecraft:dirt')], cells: Int32Array.of(0) })
    const bp = new Blueprint('multi.litematic', 'litematic', 0, [a, c, b])
    const groups = collectBlockInstances(bp)
    expect(Object.fromEntries(groups.map((g) => [g.id, g.positions]))).toEqual({
      'minecraft:dirt': [4, 2, 0],
      'minecraft:glass': [1, 0, 0],
      'minecraft:stone': [0, 0, 0],
    })
  })
})

describe('BlueprintMeshBuilder', () => {
  it('種類ごとに普通と半透明の InstancedMesh を作り、置き場所を共有してブロックの中心に置く', () => {
    const builder = new BlueprintMeshBuilder()
    const { root, pairs } = builder.build(collectBlockInstances(sample()))
    const meshes = root.children as THREE.InstancedMesh[]
    expect(meshes.map((m) => m.userData as BlockMeshInfo)).toEqual([
      { id: 'create:cogwheel', ghost: false },
      { id: 'create:cogwheel', ghost: true },
      { id: 'create:shaft', ghost: false },
      { id: 'create:shaft', ghost: true },
      { id: 'minecraft:stone', ghost: false },
      { id: 'minecraft:stone', ghost: true },
    ])
    expect(pairs).toHaveLength(3)
    const stone = pairs[2]
    expect(stone.solid.count).toBe(4)
    expect(stone.ghost.instanceMatrix).toBe(stone.solid.instanceMatrix)
    const centers = () =>
      [0, 1, 2, 3].map((i) => {
        const m = new THREE.Matrix4()
        stone.solid.getMatrixAt(i, m)
        const p = new THREE.Vector3().setFromMatrixPosition(m)
        const s = new THREE.Vector3().setFromMatrixScale(m)
        return [p.x, p.y, p.z, s.x]
      })
    expect(centers()).toEqual([
      [0.5, 0.5, 0.5, 1],
      [1.5, 0.5, 0.5, 1],
      [2.5, 0.5, 0.5, 1],
      [1.5, 1.5, 1.5, 1],
    ])
    // 隠す段のブロックは大きさを 0 にする
    builder.writeMatrices(stone, (y) => y === 0)
    expect(centers().map((c) => c[3])).toEqual([0, 0, 0, 1])
    expect((stone.solid.material as THREE.MeshLambertMaterial).color.getHex()).toBe(blockColor('minecraft:stone'))
    const ghost = stone.ghost.material as THREE.MeshLambertMaterial
    expect(ghost.transparent).toBe(true)
    expect(ghost.depthWrite).toBe(false)
    builder.disposeMeshes(root)
    expect(root.children).toHaveLength(0)
    builder.dispose()
  })

  it('段の表示方法をクリッピング面の位置に変える。面の数は変えない', () => {
    const builder = new BlueprintMeshBuilder()
    const { pairs } = builder.build(collectBlockInstances(sample()))
    const solid = pairs[0].solid.material as THREE.MeshLambertMaterial
    const ghost = pairs[0].ghost.material as THREE.MeshLambertMaterial
    const kept = (planes: THREE.Plane[], y: number) => planes.every((p) => p.distanceToPoint(new THREE.Vector3(0, y, 0)) >= 0)
    // 段 y のブロックの中心は y + 0.5
    const solidLayers = () => [0, 1, 2].filter((y) => kept(solid.clippingPlanes!, y + 0.5))
    const ghostLayers = () => [0, 1, 2].filter((y) => kept(ghost.clippingPlanes!, y + 0.5))

    builder.setClip(layerClipFor('all', 1))
    expect([solidLayers(), ghostLayers()]).toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ])
    builder.setClip(layerClipFor('hideAbove', 1))
    expect(solidLayers()).toEqual([0, 1])
    builder.setClip(layerClipFor('ghostAbove', 0))
    expect([solidLayers(), ghostLayers()]).toEqual([[0], [1, 2]])
    builder.setClip(layerClipFor('only', 1))
    expect(solidLayers()).toEqual([1])
    expect([solid.clippingPlanes!.length, ghost.clippingPlanes!.length]).toEqual([2, 1])
    builder.dispose()
  })

  it('約1万ブロックでも種類の数だけのメッシュになる', () => {
    const f = blueprintFixture({ size: [32, 10, 32] })
    const ids = ['minecraft:stone', 'create:shaft', 'create:cogwheel', 'minecraft:glass']
    for (let y = 0; y < 10; y++) {
      for (let z = 0; z < 32; z++) {
        for (let x = 0; x < 32; x++) f.place([x, y, z], ids[(x + y + z) % ids.length])
      }
    }
    const bp = f.toBlueprint()
    const scene = new BlueprintScene()
    const started = performance.now()
    scene.setBlueprint(bp)
    const elapsed = performance.now() - started
    expect(scene.renderStats).toEqual({ solid: 10240, ghost: 0, meshes: 4 })
    // 編集のたびに作り直すので、十分に速いこと（目安。遅い環境でも通るよう緩くする）
    expect(elapsed).toBeLessThan(2000)
    scene.dispose()
  })
})

describe('BlueprintScene', () => {
  it('設計図を入れ替えると描き直し、null なら何も描かない', () => {
    const scene = new BlueprintScene()
    expect(scene.size).toBeNull()
    scene.setBlueprint(sample())
    expect(scene.size).toEqual([3, 3, 3])
    expect(scene.renderStats).toEqual({ solid: 6, ghost: 0, meshes: 3 })
    expect(scene.scene.getObjectByName('grid')).toBeDefined()
    scene.setBlueprint(null)
    expect(scene.renderStats).toEqual({ solid: 0, ghost: 0, meshes: 0 })
    expect(scene.blockGroup).toBeNull()
    expect(scene.scene.getObjectByName('grid')).toBeUndefined()
  })

  it('編集のあとに同じ設計図で呼ぶと、変わった中身を描く', () => {
    const bp = sample()
    const history = new EditHistory(bp)
    const scene = new BlueprintScene()
    scene.setBlueprint(bp)
    history.apply(placeBlock(bp, [0, 2, 0], state('minecraft:glass'), false)!)
    scene.setBlueprint(bp)
    expect(scene.renderStats.solid).toBe(7)
    history.undo()
    scene.setBlueprint(bp)
    expect(scene.renderStats.solid).toBe(6)
  })

  it('段の表示方法を変えると、隠す段を描かず、今の段に枠を出す', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    const frame = scene.scene.getObjectByName('layer-frame')!
    expect(frame.visible).toBe(false)
    scene.setLayerDisplay(display(1, 'ghostAbove'))
    expect(scene.renderStats).toEqual({ solid: 5, ghost: 1, meshes: 3 })
    expect(frame.visible).toBe(true)
    expect(frame.position.y).toBeCloseTo(1.02)
    scene.setLayerDisplay(display(0, 'only'))
    expect(scene.renderStats).toEqual({ solid: 4, ghost: 0, meshes: 2 })
  })

  it('段の表示方法と今の段を変えても、メッシュを作り直さない', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    const group = scene.blockGroup!
    const meshes = [...group.children]
    for (const mode of ['hideAbove', 'ghostAbove', 'only', 'all'] as const) {
      for (const layer of [0, 1, 2]) scene.setLayerDisplay(display(layer, mode))
    }
    expect(scene.blockGroup).toBe(group)
    expect(group.children).toEqual(meshes)
  })

  it('非表示にした段は、ブロックの大きさを 0 にして隠し、表示に戻すと元に戻す', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    const group = scene.blockGroup!
    const stone = () => scene.blockGroup!.children.find((o) => o.name === 'minecraft:stone') as THREE.InstancedMesh
    const scales = () =>
      [0, 1, 2, 3].map((i) => {
        const m = new THREE.Matrix4()
        stone().getMatrixAt(i, m)
        return new THREE.Vector3().setFromMatrixScale(m).x
      })
    scene.setLayerDisplay(display(0, 'all', [0]))
    expect(scales()).toEqual([0, 0, 0, 1])
    expect(scene.renderStats).toEqual({ solid: 2, ghost: 0, meshes: 2 })
    scene.setLayerDisplay(display(0, 'all', [0, 1, 2]))
    expect(scene.renderStats).toEqual({ solid: 0, ghost: 0, meshes: 0 })
    scene.setLayerDisplay(display(0, 'all'))
    expect(scales()).toEqual([1, 1, 1, 1])
    expect(scene.blockGroup).toBe(group)
    // 隠した段は、設計図を描き直しても隠したまま
    scene.setLayerDisplay(display(0, 'all', [0]))
    scene.setBlueprint(sample())
    expect(scene.renderStats.solid).toBe(2)
    expect(scales()).toEqual([0, 0, 0, 1])
  })

  it('グリッドと座標軸の表示を切り替える', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    const grid = scene.scene.getObjectByName('grid')!
    const axes = scene.scene.getObjectByName('axes')!
    expect([grid.visible, axes.visible]).toEqual([true, false])
    scene.setGridVisible(false)
    scene.setAxesVisible(true)
    expect([grid.visible, axes.visible]).toEqual([false, true])
    // 設計図を入れ替えても、表示の切り替えは残る
    scene.setBlueprint(blueprintFixture({ size: [5, 1, 5] }).toBlueprint())
    expect(scene.scene.getObjectByName('grid')!.visible).toBe(false)
    expect(scene.scene.getObjectByName('axes')!.visible).toBe(true)
  })

  it('テーマに合わせて線の色と光を変える', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setTheme(DARK_THEME)
    const grid = scene.scene.getObjectByName('grid') as THREE.LineSegments
    expect((grid.material as THREE.LineBasicMaterial).color.getHex()).toBe(DARK_THEME.grid)
    scene.setTheme(LIGHT_THEME)
    expect((grid.material as THREE.LineBasicMaterial).color.getHex()).toBe(LIGHT_THEME.grid)
  })

  it('レイからブロックを選ぶ。隠した段と半透明の段には当たらず、今の段の床に落ちる', () => {
    const scene = new BlueprintScene()
    expect(scene.pick({ origin: [1.5, 10, 1.5], direction: [0, -1, 0] })).toBeNull()
    scene.setBlueprint(sample())
    // 真上から (1, *, 1) の列を見る：真ん中の段の石に上から当たる
    expect(scene.pick({ origin: [1.5, 10, 1.5], direction: [0, -1, 0] })).toMatchObject({ pos: [1, 1, 1], face: 'up', empty: false })
    scene.setLayerDisplay(display(0, 'ghostAbove'))
    expect(scene.pick({ origin: [1.5, 10, 1.5], direction: [0, -1, 0] })).toMatchObject({ pos: [1, 0, 1], face: 'up', empty: false })
    // 何もない列は今の段の床の空きマス
    expect(scene.pick({ origin: [0.5, 10, 2.5], direction: [0, -1, 0] })).toEqual({ pos: [0, 0, 2], empty: true })
  })

  it('選択とマウスの下の枠を置く。同じブロックなら選択の枠だけ', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    const boxes = () => scene.scene.children.filter((o) => o instanceof THREE.LineSegments && o.name === '' && o.visible)
    scene.setSelected([1, 0, 1])
    scene.setHovered([2, 0, 0])
    expect(boxes().map((b) => b.position.toArray())).toEqual([
      [1.5, 0.5, 1.5],
      [2.5, 0.5, 0.5],
    ])
    scene.setHovered([1, 0, 1])
    expect(boxes()).toHaveLength(1)
    scene.setSelected(null)
    scene.setHovered(null)
    expect(boxes()).toHaveLength(0)
  })
})

describe('cameraViews', () => {
  it('視点の向きは、斜めが南東の上、上が真上、正面が南、横が東', () => {
    const iso = viewDirection('iso')
    expect(iso[0]).toBeGreaterThan(0)
    expect(iso[1]).toBeGreaterThan(0)
    expect(iso[2]).toBeGreaterThan(0)
    expect(viewDirection('top')[1]).toBeCloseTo(1)
    expect(viewDirection('front')).toEqual([0, 0, 1])
    expect(viewDirection('side')).toEqual([1, 0, 0])
  })

  it('設計図の中心を見て、全体が入る距離に置く', () => {
    const size = [10, 4, 6] as const
    const pose = cameraPose('front', size, 45, 1.5)
    expect(pose.target).toEqual(blueprintCenter(size))
    const dist = fitDistance(size, 45, 1.5)
    expect(pose.position).toEqual([5, 2, 3 + dist])
    // 囲む球が視野に収まる
    const radius = 0.5 * Math.hypot(10, 4, 6)
    expect(dist * Math.sin((22.5 * Math.PI) / 180)).toBeGreaterThanOrEqual(radius)
    // 縦長の画面では、横の視野に合わせて遠くなる
    expect(fitDistance(size, 45, 0.5)).toBeGreaterThan(dist)
  })
})
