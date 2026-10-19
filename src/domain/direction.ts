import type { Vec3 } from './vec3'

/** ブロックの面の向き。名前は Minecraft の facing の値と同じ */
export type Direction = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

/** すべての向き。Minecraft の順（down, up, north, south, west, east） */
export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'north', 'south', 'west', 'east']

/** 水平の4方向。north から時計回り（上から見て） */
export const HORIZONTAL_DIRECTIONS: readonly Direction[] = ['north', 'east', 'south', 'west']

// Minecraft の向き: north = -z, south = +z, west = -x, east = +x, up = +y
const VECTORS: Readonly<Record<Direction, Vec3>> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
}

const OPPOSITES: Readonly<Record<Direction, Direction>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
  up: 'down',
  down: 'up',
}

/** 向きの単位ベクトル */
export function directionVector(dir: Direction): Vec3 {
  return VECTORS[dir]
}

/** 反対の向き */
export function oppositeDirection(dir: Direction): Direction {
  return OPPOSITES[dir]
}

/** 文字列が Direction の値なら true。properties の facing などを読むときに使う */
export function isDirection(s: string): s is Direction {
  return Object.hasOwn(VECTORS, s)
}
