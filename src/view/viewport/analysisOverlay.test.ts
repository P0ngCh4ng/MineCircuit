import { describe, expect, it } from 'vitest'
import { blueprintFixture } from '../../../tests/fixtures/blueprintFixture'
import { ANALYSIS_COLORS_2D, drawAnalysisOverlay2D, type AnalysisCanvas2D } from './analysisOverlay2D'
import { BlueprintScene } from './blueprintScene'

function sample() {
  return blueprintFixture({ size: [3, 3, 3] }).fill([0, 0, 0], [2, 2, 0], 'minecraft:stone').toBlueprint()
}

describe('BlueprintScene の計測と同じブロック', () => {
  it('計測の点は枠で、2点そろったら点線で結ぶ', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    expect(scene.analysisOverlay.stats).toEqual({ measurePoints: 0, measureLine: false, connectBlocks: 0 })
    scene.setMeasurePoints([[0, 0, 0]])
    expect(scene.analysisOverlay.stats).toMatchObject({ measurePoints: 1, measureLine: false })
    scene.setMeasurePoints([[0, 0, 0], [2, 2, 2]])
    expect(scene.analysisOverlay.stats).toMatchObject({ measurePoints: 2, measureLine: true })
    expect(scene.scene.getObjectByName('measure-line')).toBeDefined()
    scene.setMeasurePoints([])
    expect(scene.scene.getObjectByName('measure-line')).toBeUndefined()
    scene.dispose()
  })

  it('同じブロックのまとまりは、隠した段のブロックを除いて枠を描く', () => {
    const scene = new BlueprintScene()
    scene.setBlueprint(sample())
    scene.setConnectGroup([
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
    ])
    expect(scene.analysisOverlay.stats.connectBlocks).toBe(3)
    scene.setLayerDisplay({ layer: 1, mode: 'only', hidden: new Set() })
    expect(scene.analysisOverlay.stats.connectBlocks).toBe(1)
    scene.setConnectGroup(null)
    expect(scene.analysisOverlay.stats.connectBlocks).toBe(0)
    scene.dispose()
  })
})

/** 呼ばれた描画を記録する偽の canvas */
function recorder() {
  const calls: string[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    fillRect: (x: number, y: number) => calls.push(`fill ${x},${y}`),
    strokeRect: (x: number, y: number) => calls.push(`stroke ${x},${y}`),
    setLineDash: (d: number[]) => calls.push(`dash ${d.join(',')}`),
    beginPath: () => {},
    moveTo: (x: number, y: number) => calls.push(`move ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`line ${x},${y}`),
    stroke: () => calls.push('line-stroke'),
  }
  return { ctx: ctx as unknown as AnalysisCanvas2D, calls }
}

describe('drawAnalysisOverlay2D', () => {
  const layout = { originX: 0, originY: 0, cellSize: 10 }

  it('同じブロックは今の段のマスだけを塗る', () => {
    const { ctx, calls } = recorder()
    drawAnalysisOverlay2D(ctx, layout, 0, { measurePoints: [], connectGroup: [[1, 0, 2], [1, 1, 2]] }, ANALYSIS_COLORS_2D.light)
    expect(calls.filter((c) => c.startsWith('fill'))).toEqual(['fill 10,20'])
  })

  it('計測は点の枠と中心を結ぶ線。今の段にない点は点線の枠', () => {
    const { ctx, calls } = recorder()
    drawAnalysisOverlay2D(ctx, layout, 0, { measurePoints: [[0, 0, 0], [2, 1, 3]], connectGroup: null }, ANALYSIS_COLORS_2D.dark)
    expect(calls).toEqual([
      'save',
      'dash ',
      'stroke 0,0',
      'dash 4,3',
      'stroke 20,30',
      'dash 6,4',
      'move 5,5',
      'line 25,35',
      'line-stroke',
      'dash ',
      'restore',
    ])
  })
})
