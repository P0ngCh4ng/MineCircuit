import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../domain/vec3'
import { SelectTool } from './selectTool'
import type { PickModifiers, PickTarget, Tool, ToolId } from './tool'
import { ToolController } from './toolController'

/** 呼ばれた順を記録する偽物のツール */
class FakeTool implements Tool {
  readonly log: string[] = []
  constructor(readonly id: ToolId) {}
  onHover(target: PickTarget | null): void {
    this.log.push(`hover:${target ? target.pos.join(',') : 'null'}`)
  }
  onClick(target: PickTarget, mods: PickModifiers): void {
    this.log.push(`click:${target.pos.join(',')}${mods.shift ? ':shift' : ''}`)
  }
  activate(): void {
    this.log.push('activate')
  }
  deactivate(): void {
    this.log.push('deactivate')
  }
}

const block = (pos: Vec3): PickTarget => ({ pos, face: 'up', empty: false })
const empty = (pos: Vec3): PickTarget => ({ pos, empty: true })

describe('ToolController', () => {
  it('最初に登録したツールが今のツールになる', () => {
    const c = new ToolController()
    const a = new FakeTool('select')
    c.register(a)
    c.register(new FakeTool('measure'))
    expect(c.active).toBe('select')
    expect(a.log).toEqual(['activate', 'hover:null'])
  })

  it('移動とクリックは今のツールだけに渡す', () => {
    const c = new ToolController()
    const a = new FakeTool('select')
    const b = new FakeTool('measure')
    c.register(a)
    c.register(b)
    a.log.length = 0
    c.hover(block([1, 2, 3]))
    c.click(block([1, 2, 3]), { shift: true })
    expect(a.log).toEqual(['hover:1,2,3', 'click:1,2,3:shift'])
    expect(b.log).toEqual([])
  })

  it('切り替えると、前のツールを片付け、次のツールに今のマウス位置を渡す', () => {
    const c = new ToolController()
    const a = new FakeTool('select')
    const b = new FakeTool('measure')
    const changes: (ToolId | null)[] = []
    c.register(a)
    c.register(b)
    c.onActiveChange = (id) => changes.push(id)
    c.hover(block([0, 0, 0]))
    a.log.length = 0
    expect(c.setActive('measure')).toBe(true)
    expect(a.log).toEqual(['hover:null', 'deactivate'])
    expect(b.log).toEqual(['activate', 'hover:0,0,0'])
    expect(changes).toEqual(['measure'])
  })

  it('登録されていないツールには切り替えない', () => {
    const c = new ToolController()
    c.register(new FakeTool('select'))
    expect(c.setActive('probe')).toBe(false)
    expect(c.active).toBe('select')
    expect(c.has('probe')).toBe(false)
  })

  it('ツールがなければ、移動とクリックは何もしない', () => {
    const c = new ToolController()
    expect(() => {
      c.hover(block([0, 0, 0]))
      c.click(block([0, 0, 0]))
    }).not.toThrow()
    expect(c.active).toBeNull()
  })

  it('今のツールを登録し直すと、新しいほうに切り替わる', () => {
    const c = new ToolController()
    const a1 = new FakeTool('select')
    const a2 = new FakeTool('select')
    c.register(a1)
    c.register(a2)
    expect(a1.log.at(-1)).toBe('deactivate')
    expect(a2.log).toEqual(['activate'])
    expect(c.activeTool).toBe(a2)
  })
})

describe('SelectTool', () => {
  function setup() {
    const state: { selected: Vec3 | null; extendedTo: Vec3 | null; hovered: Vec3 | null } = {
      selected: null,
      extendedTo: null,
      hovered: null,
    }
    const tool = new SelectTool({
      setSelected: (p) => (state.selected = p),
      extendSelection: (p) => (state.extendedTo = p),
      setHovered: (p) => (state.hovered = p),
    })
    const c = new ToolController()
    c.register(tool)
    return { c, state }
  }

  it('ブロックをクリックすると選択し、空きマスをクリックすると選択を解除する', () => {
    const { c, state } = setup()
    c.click(block([2, 1, 0]))
    expect(state.selected).toEqual([2, 1, 0])
    c.click(empty([3, 1, 0]))
    expect(state.selected).toBeNull()
  })

  it('Shift+クリックで範囲を広げる。空きマスも角にでき、選択は解除しない', () => {
    const { c, state } = setup()
    c.click(block([0, 0, 0]))
    c.click(block([2, 1, 3]), { shift: true })
    expect(state.extendedTo).toEqual([2, 1, 3])
    expect(state.selected).toEqual([0, 0, 0])
    c.click(empty([4, 0, 0]), { shift: true })
    expect(state.extendedTo).toEqual([4, 0, 0])
    expect(state.selected).toEqual([0, 0, 0])
  })

  it('マウスの下のブロックを伝え、空きマスや外では null にする', () => {
    const { c, state } = setup()
    c.hover(block([1, 1, 1]))
    expect(state.hovered).toEqual([1, 1, 1])
    c.hover(empty([1, 1, 1]))
    expect(state.hovered).toBeNull()
    c.hover(block([1, 1, 1]))
    c.hover(null)
    expect(state.hovered).toBeNull()
  })

  it('差し込んだもの（貼り付けの見本）が、外すまで今のツールの代わりに移動とクリックを受け取る（#133）', () => {
    const c = new ToolController()
    const a = new FakeTool('select')
    c.register(a)
    c.hover(block([1, 0, 0]))
    a.log.length = 0
    const log: string[] = []
    c.setOverride({
      onHover: (t) => log.push(`hover:${t ? t.pos.join(',') : 'null'}`),
      onClick: (t) => log.push(`click:${t.pos.join(',')}`),
    })
    // 差し込んだらすぐに今のマウスの位置を渡し、今のツールの表示は消す
    expect(log).toEqual(['hover:1,0,0'])
    expect(a.log).toEqual(['hover:null'])
    c.hover(empty([2, 0, 0]))
    c.click(empty([2, 0, 0]))
    expect(log).toEqual(['hover:1,0,0', 'hover:2,0,0', 'click:2,0,0'])
    expect(a.log).toEqual(['hover:null'])
    expect(c.overriding).toBe(true)
    c.setOverride(null)
    expect(log.at(-1)).toBe('hover:null')
    expect(a.log.at(-1)).toBe('hover:2,0,0')
    expect(c.overriding).toBe(false)
  })
})

/** ドラッグを受け取る偽物のツール（置くツールの一直線。#161） */
class DragTool extends FakeTool {
  accept = true
  dragStart(target: PickTarget): boolean {
    this.log.push(`dragStart:${target.pos.join(',')}`)
    return this.accept
  }
  dragMove(target: PickTarget | null): void {
    this.log.push(`dragMove:${target ? target.pos.join(',') : 'null'}`)
  }
  dragEnd(target: PickTarget | null): void {
    this.log.push(`dragEnd:${target ? target.pos.join(',') : 'null'}`)
  }
  dragCancel(): void {
    this.log.push('dragCancel')
  }
}

describe('ToolController のドラッグ（#161）', () => {
  it('今のツールにドラッグを渡す。受け取らないツールなら false', () => {
    const c = new ToolController()
    const t = new DragTool('place')
    c.register(t)
    c.register(new FakeTool('select'))
    t.log.length = 0
    expect(c.beginDrag(empty([0, 0, 0]))).toBe(true)
    expect(c.isDragging).toBe(true)
    c.dragTo(empty([1, 0, 0]))
    c.endDrag(empty([2, 0, 0]))
    expect(c.isDragging).toBe(false)
    expect(t.log).toEqual(['dragStart:0,0,0', 'dragMove:1,0,0', 'dragEnd:2,0,0'])

    t.accept = false
    expect(c.beginDrag(empty([0, 0, 0]))).toBe(false)
    c.setActive('select')
    expect(c.beginDrag(empty([0, 0, 0]))).toBe(false)
  })

  it('ツールを替える・貼り付けの見本を差し込むと、ドラッグをやめる', () => {
    const c = new ToolController()
    const t = new DragTool('place')
    c.register(t)
    c.register(new FakeTool('select'))
    c.beginDrag(empty([0, 0, 0]))
    t.log.length = 0
    c.setActive('select')
    expect(t.log[0]).toBe('dragCancel')

    c.setActive('place')
    c.beginDrag(empty([0, 0, 0]))
    t.log.length = 0
    c.setOverride({ onHover: () => {}, onClick: () => {} })
    expect(t.log[0]).toBe('dragCancel')
    // 見本を出している間はドラッグを受け取らない
    expect(c.beginDrag(empty([0, 0, 0]))).toBe(false)
  })
})
