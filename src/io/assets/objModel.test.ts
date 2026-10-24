import { describe, expect, it } from 'vitest'
import { objModelPath, parseMtl, parseObj, siblingPath } from './objModel'

// 下の面（y=0）が1つの四角、上の面（y=1）が材質 top の三角1つ
const OBJ = `# テスト
mtllib cage.mtl
o cube
v 0 0 0
v 1 0 0
v 1 0 1
v 0 0 1
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 -1 0
usemtl side
s off
f 1/1/1 2/2/1 3/3/1 4/4/1
usemtl top
f -1/1 -4/2 -5/3
`

describe('parseObj', () => {
  it('位置を 0〜16 に、四角を三角形2つにし、材質ごとにまとめる', () => {
    const notes: string[] = []
    const obj = parseObj(OBJ, false, (n) => notes.push(n))
    expect(notes).toEqual([])
    expect(obj.materialLibraries).toEqual(['cage.mtl'])
    expect(obj.groups.map((g) => g.material)).toEqual(['side', 'top'])
    const side = obj.groups[0]!
    // 1-2-3 と 1-3-4 の扇形
    expect(side.positions).toEqual([0, 0, 0, 16, 0, 0, 16, 0, 16, 0, 0, 0, 16, 0, 16, 0, 0, 16])
    expect(side.uvs.slice(0, 6)).toEqual([0, 0, 16, 0, 16, 16])
    expect(side.normals.slice(0, 3)).toEqual([0, -1, 0])
  })

  it('負の番号は後ろから数え、法線がなければ三角形の向きから決める', () => {
    const top = parseObj(OBJ, false, () => {}).groups[1]!
    // -1 → 5、-4 → 2、-5 → 1
    expect(top.positions).toEqual([0, 16, 0, 16, 0, 0, 0, 0, 0])
    const [nx, ny, nz] = top.normals
    expect(Math.hypot(nx!, ny!, nz!)).toBeCloseTo(1)
    expect(top.normals.slice(0, 3)).toEqual(top.normals.slice(3, 6))
  })

  it('flip-v なら v を 1 - v にする', () => {
    const side = parseObj(OBJ, true, () => {}).groups[0]!
    expect(side.uvs.slice(0, 6)).toEqual([0, 16, 16, 16, 16, 0])
  })

  it('読めない行は notes に書いて飛ばし、番号はずらさない', () => {
    const notes: string[] = []
    const obj = parseObj('v 0 0 0\nv a b c\nv 1 0 0\nv 0 0 1\nf 1 3 4\nf 1 9 3\n', false, (n) => notes.push(n))
    expect(notes).toEqual(['2 行目: 頂点の位置が読めません', '6 行目: 面の頂点が読めません'])
    expect(obj.groups).toHaveLength(1)
    expect(obj.groups[0]!.material).toBeNull()
    expect(obj.groups[0]!.positions).toEqual([0, 0, 0, 16, 0, 0, 0, 0, 16])
  })
})

describe('parseMtl', () => {
  it('材質の名前 → map_Kd を読む', () => {
    const mtl = '# Blender\nnewmtl m_0\nKd 1 1 1\nmap_Kd #0\n\nnewmtl plates\nmap_Kd create:block/plates\nnewmtl none\n'
    expect(parseMtl(mtl)).toEqual({ m_0: '#0', plates: 'create:block/plates' })
  })
})

describe('パス', () => {
  it('OBJ の ID を資産のパスにし、同じフォルダの MTL を指す', () => {
    const path = objModelPath('create:models/block/blaze_burner/blaze_cage.obj')
    expect(path).toBe('assets/create/models/block/blaze_burner/blaze_cage.obj')
    expect(siblingPath(path, 'blaze_cage.mtl')).toBe('assets/create/models/block/blaze_burner/blaze_cage.mtl')
  })
})
