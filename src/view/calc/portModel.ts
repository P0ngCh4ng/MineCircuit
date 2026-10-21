// 仮の入出力（VirtualPort）を置く・直す・消すための関数（#70）。
// Vue に依存しない関数だけを置くので、画面なしでテストできる。

import type { CalcPlugin } from '../../calc/calcPlugin'
import type { PortKindDef, VirtualPort } from '../../calc/virtualPort'
import type { Blueprint } from '../../domain/blueprint'
import { DIRECTIONS, directionVector, type Direction } from '../../domain/direction'
import { addVec3, equalsVec3, type Vec3 } from '../../domain/vec3'

/** 置ける仮の入出力の種類1つ分（どのプラグインのものか付き） */
export interface PortKindOption {
  readonly pluginId: string
  readonly pluginLabel: string
  readonly def: PortKindDef
}

/** 種類を選ぶ欄の値（`create-stress/rotation-source`） */
export function portKindKey(pluginId: string, kind: string): string {
  return `${pluginId}/${kind}`
}

/** プラグインの一覧から、置ける仮の入出力の種類を並べる */
export function portKindOptions(plugins: readonly Pick<CalcPlugin, 'id' | 'label' | 'portKinds'>[]): PortKindOption[] {
  return plugins.flatMap((p) => p.portKinds.map((def) => ({ pluginId: p.id, pluginLabel: p.label, def })))
}

/** port の種類の定義。プラグインがその種類を持っていなければ null */
export function findPortKind(options: readonly PortKindOption[], port: Pick<VirtualPort, 'pluginId' | 'kind'>): PortKindOption | null {
  return options.find((o) => o.pluginId === port.pluginId && o.def.kind === port.kind) ?? null
}

/**
 * 置いたときの数値。省略できない値はすべて、省略できる値は最初の1つだけ初期値を入れる
 * （Create の負荷の「応力」と「1 RPM あたりの応力」は、どちらか一方だけを使うため）
 */
export function defaultPortParams(def: PortKindDef): Record<string, number> {
  const params: Record<string, number> = {}
  let optionalUsed = false
  for (const p of def.params) {
    if (p.optional) {
      if (optionalUsed) continue
      optionalUsed = true
    }
    params[p.key] = p.defaultValue
  }
  return params
}

/** 新しい仮の入出力を作る */
export function createPort(id: string, option: PortKindOption, pos: Vec3, face: Direction): VirtualPort {
  return {
    id,
    pos: [pos[0], pos[1], pos[2]],
    face,
    pluginId: option.pluginId,
    kind: option.def.kind,
    params: defaultPortParams(option.def),
  }
}

/** 数値を1つ変えた仮の入出力。value が null なら、その値を消す（省略できる値） */
export function withPortParam(port: VirtualPort, key: string, value: number | null): VirtualPort {
  const params: Record<string, number> = { ...port.params }
  if (value === null) delete params[key]
  else params[key] = value
  return { ...port, params }
}

/** 面を変えた仮の入出力 */
export function withPortFace(port: VirtualPort, face: Direction): VirtualPort {
  return { ...port, face }
}

/** メモを変えた仮の入出力。空ならメモを消す */
export function withPortLabel(port: VirtualPort, label: string): VirtualPort {
  const text = label.trim()
  const { label: _old, ...rest } = port
  return text === '' ? rest : { ...rest, label: text }
}

/** 入力欄の文字を数値に直す。空なら null、数でなければ undefined（変えない） */
export function parsePortNumber(text: string): number | null | undefined {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** pos の face に置いた仮の入出力。なければ null */
export function portAt(ports: readonly VirtualPort[], pos: Vec3, face: Direction): VirtualPort | null {
  return ports.find((p) => p.face === face && equalsVec3(p.pos, pos)) ?? null
}

/** 面の名前（画面用） */
export const FACE_LABELS: Readonly<Record<Direction, string>> = {
  north: '北（−Z）',
  south: '南（+Z）',
  west: '西（−X）',
  east: '東（+X）',
  up: '上（+Y）',
  down: '下（−Y）',
}

const AXIS_FACES: Readonly<Record<string, readonly Direction[]>> = {
  x: ['east', 'west'],
  y: ['up', 'down'],
  z: ['south', 'north'],
}

/**
 * 面が分からないクリック（2D表示）で置く面を決める。
 * ブロック状態に axis があればその軸の面を、なければ全部の面を候補にし、
 * 隣が設計図の外か空いている面を選ぶ。どれも埋まっていれば最初の候補。
 * 合わなければ、利用者が一覧で面を直す（つなげない面なら計算の問題に出る）
 */
export function defaultPortFace(bp: Blueprint, pos: Vec3): Direction {
  const axis = bp.get(pos)?.properties['axis']
  const candidates = (axis !== undefined ? AXIS_FACES[axis] : undefined) ?? DIRECTIONS
  const [sx, sy, sz] = bp.size
  for (const face of candidates) {
    const n = addVec3(pos, directionVector(face))
    const outside = n[0] < 0 || n[1] < 0 || n[2] < 0 || n[0] >= sx || n[1] >= sy || n[2] >= sz
    if (outside || bp.get(n) === null) return face
  }
  return candidates[0]
}
