// OBJ のモデル（docs/design.md「モデルの解決」の「OBJ のモデル」）。
// Create などは、モデルの JSON に `"loader": "forge:obj"` と `"model": "<ns>:models/.../x.obj"` を書き、
// 形を Wavefront OBJ（.obj）に、材質ごとのテクスチャを MTL（.mtl）に置く。ここではその2つを読む。
// 材質のテクスチャ（`map_Kd #0`）の変数は、modelResolver がモデルのテクスチャで解決する。
//
// 決まり（Forge の OBJ の読み込みと同じ）：
// - 位置はブロック単位で、ブロックの角（西・下・北）が原点。要素と同じ 0〜16 の座標に直す
// - テクスチャの座標の v は、flip-v なら 1 - v にする（Minecraft のテクスチャは v が下向き）
// - 4つ以上の頂点を持つ面は、最初の頂点から扇形に三角形に分ける
// - 法線（vn）がなければ、三角形の向きから決める

/** OBJ の材質1つ分の三角形。座標は 0〜16（ModelMesh と同じ） */
export interface ObjGroup {
  /** usemtl の名前。usemtl の前の面は null */
  readonly material: string | null
  readonly positions: number[]
  readonly uvs: number[]
  readonly normals: number[]
}

export interface ParsedObj {
  /** mtllib に書いてあるファイル名（.obj からの相対パス） */
  readonly materialLibraries: string[]
  /** 材質ごとの三角形。出てきた順 */
  readonly groups: ObjGroup[]
}

/** 読めない行を飛ばすときに、知らせる行の数の上限（壊れたファイルで problems があふれないように） */
const MAX_NOTES = 5

function parseIndex(token: string | undefined, count: number): number | null {
  if (token === undefined || token === '') return null
  const n = Number(token)
  if (!Number.isInteger(n) || n === 0) return null
  const i = n > 0 ? n - 1 : count + n // 負の番号は、そこまでに出てきたものの後ろから数える
  return i >= 0 && i < count ? i : null
}

/** OBJ の文字列を読む。読めない行は notes に書いて飛ばす */
export function parseObj(text: string, flipV: boolean, note: (m: string) => void): ParsedObj {
  const vertices: number[][] = []
  const texCoords: number[][] = []
  const normals: number[][] = []
  const materialLibraries: string[] = []
  const groups: ObjGroup[] = []
  const byMaterial = new Map<string | null, ObjGroup>()
  let current: ObjGroup | null = null
  let material: string | null = null
  let notes = 0
  const bad = (line: number, what: string): void => {
    if (notes++ < MAX_NOTES) note(`${line} 行目: ${what}`)
  }

  const groupFor = (name: string | null): ObjGroup => {
    let g = byMaterial.get(name)
    if (!g) {
      g = { material: name, positions: [], uvs: [], normals: [] }
      byMaterial.set(name, g)
      groups.push(g)
    }
    return g
  }

  const lines = text.split(/\r?\n/)
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const keyword = parts[0]
    const nums = parts.slice(1).map(Number)
    switch (keyword) {
      case 'v':
        // 読めなくても、あとの番号がずれないよう何か入れておく
        if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) {
          bad(li + 1, '頂点の位置が読めません')
          vertices.push([0, 0, 0])
        } else vertices.push(nums.slice(0, 3))
        break
      case 'vt':
        if (nums.length < 2 || nums.slice(0, 2).some((n) => !Number.isFinite(n))) {
          bad(li + 1, 'テクスチャの座標が読めません')
          texCoords.push([0, 0])
        } else texCoords.push(nums.slice(0, 2))
        break
      case 'vn':
        if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) {
          bad(li + 1, '法線が読めません')
          normals.push([0, 1, 0])
        } else normals.push(nums.slice(0, 3))
        break
      case 'mtllib':
        if (parts.length > 1) materialLibraries.push(parts.slice(1).join(' '))
        break
      case 'usemtl':
        material = parts.length > 1 ? parts.slice(1).join(' ') : null
        current = null
        break
      case 'f': {
        const corners = parts.slice(1).map((token) => {
          const [vi, ti, ni] = token.split('/')
          return { v: parseIndex(vi, vertices.length), t: parseIndex(ti, texCoords.length), n: parseIndex(ni, normals.length) }
        })
        if (corners.length < 3 || corners.some((c) => c.v === null)) {
          bad(li + 1, '面の頂点が読めません')
          break
        }
        current ??= groupFor(material)
        for (let i = 1; i + 1 < corners.length; i++) addTriangle(current, [corners[0]!, corners[i]!, corners[i + 1]!])
        break
      }
      default:
        // o・g・s など、形に関係しない行は読まない
        break
    }
  }

  function addTriangle(g: ObjGroup, tri: { v: number | null; t: number | null; n: number | null }[]): void {
    const ps = tri.map((c) => vertices[c.v!]!)
    const flat = faceNormal(ps[0]!, ps[1]!, ps[2]!)
    for (const c of tri) {
      const p = vertices[c.v!]!
      g.positions.push(p[0]! * 16, p[1]! * 16, p[2]! * 16)
      const t = c.t === null ? [0, 0] : texCoords[c.t]!
      g.uvs.push(t[0]! * 16, (flipV ? 1 - t[1]! : t[1]!) * 16)
      const n = c.n === null ? flat : normalize(normals[c.n]!)
      g.normals.push(n[0]!, n[1]!, n[2]!)
    }
  }

  return { materialLibraries, groups: groups.filter((g) => g.positions.length > 0) }
}

function normalize(v: readonly number[]): number[] {
  const len = Math.hypot(v[0]!, v[1]!, v[2]!)
  return len === 0 ? [0, 1, 0] : [v[0]! / len, v[1]! / len, v[2]! / len]
}

function faceNormal(a: readonly number[], b: readonly number[], c: readonly number[]): number[] {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
  const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
  return normalize([u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!])
}

/** MTL の文字列から、材質の名前 → テクスチャ（map_Kd の値。`#0` のような変数か ID）を読む */
export function parseMtl(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let name: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const space = line.search(/\s/)
    if (space < 0) continue
    const keyword = line.slice(0, space)
    const value = line.slice(space).trim()
    if (keyword === 'newmtl') name = value
    else if (keyword === 'map_Kd' && name !== null && value !== '') out[name] = value
  }
  return out
}

/** file と同じフォルダのファイルのパス。name は .obj に書いてある相対パス */
export function siblingPath(file: string, name: string): string {
  const dir = file.slice(0, file.lastIndexOf('/') + 1)
  return `${dir}${name.replace(/\\/g, '/')}`
}

/** OBJ のモデルの ID（`create:models/block/x.obj`）→ 資産のパス（`assets/create/models/block/x.obj`） */
export function objModelPath(id: string): string {
  const colon = id.indexOf(':')
  const ns = colon < 0 ? 'minecraft' : id.slice(0, colon)
  return `assets/${ns}/${colon < 0 ? id : id.slice(colon + 1)}`
}
