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
    const state: { selected: Vec3 | null; hovered: Vec3 | null } = { selected: null, hovered: null }
    const tool = new SelectTool({
      setSelected: (p) => (state.selected = p),
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
})
