import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { boxFromCorners, singleCellBox } from '../../domain/box'
import { SELECTION_BOX_MARGIN, SelectionOverlay3D } from './selectionOverlay3D'
import { DARK_THEME, LIGHT_THEME } from './viewportTheme'

describe('SelectionOverlay3D', () => {
  it('2つ以上のマスが入る範囲を、箱の線で囲む', () => {
    const overlay = new SelectionOverlay3D()
    overlay.update(boxFromCorners([1, 0, 2], [3, 1, 2]))
    const edges = overlay.object
    expect(edges.visible).toBe(true)
    expect(overlay.shownBox).toEqual({ min: [1, 0, 2], max: [3, 1, 2] })
    // 箱の線の外形は、マスの範囲 [min, max+1) を少し広げたもの
    edges.updateMatrixWorld(true)
    edges.geometry.computeBoundingBox()
    const bounds = edges.geometry.boundingBox!.clone().applyMatrix4(edges.matrixWorld)
    const m = SELECTION_BOX_MARGIN
    expect(bounds.min.x).toBeCloseTo(1 - m)
    expect(bounds.min.y).toBeCloseTo(0 - m)
    expect(bounds.min.z).toBeCloseTo(2 - m)
    expect(bounds.max.x).toBeCloseTo(4 + m)
    expect(bounds.max.y).toBeCloseTo(2 + m)
    expect(bounds.max.z).toBeCloseTo(3 + m)
    overlay.dispose()
  })

  it('1マスの範囲と、選んでいないときは出さない', () => {
    const overlay = new SelectionOverlay3D()
    overlay.update(boxFromCorners([0, 0, 0], [1, 0, 0]))
    overlay.update(singleCellBox([1, 1, 1]))
    expect(overlay.object.visible).toBe(false)
    expect(overlay.shownBox).toBeNull()
    overlay.update(boxFromCorners([0, 0, 0], [1, 0, 0]))
    overlay.update(null)
    expect(overlay.object.visible).toBe(false)
    overlay.dispose()
  })

  it('テーマの選択の色で描き、テーマが変わると色も変える', () => {
    const overlay = new SelectionOverlay3D()
    const material = overlay.object.material as THREE.LineBasicMaterial
    expect(material.color.getHex()).toBe(LIGHT_THEME.selection)
    overlay.setTheme(DARK_THEME)
    expect(material.color.getHex()).toBe(DARK_THEME.selection)
    overlay.dispose()
  })

  it('捨てるとシーンから外す', () => {
    const scene = new THREE.Scene()
    const overlay = new SelectionOverlay3D()
    scene.add(overlay.group)
    overlay.dispose()
    expect(scene.children).not.toContain(overlay.group)
  })
})
