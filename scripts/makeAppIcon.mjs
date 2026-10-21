// MineCircuit のアイコン（オリジナル。Minecraft や Mod の素材は使わない）を 1024x1024 の PNG で作る。
// 角の丸い濃い四角に、3x3 の格子と、橙の回路の線と点を描く。
// 使い方：node scripts/makeAppIcon.mjs src-tauri/app-icon.png && npx tauri icon src-tauri/app-icon.png -o src-tauri/icons
// tauri icon が作るもののうち、Windows 以外（android/、ios/、Square*、StoreLogo、64x64）は使わないので消す
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const N = 1024
const px = new Uint8Array(N * N * 4)

const BG = [0x1f, 0x29, 0x37]
const CELL = [0x2f, 0x3e, 0x52]
const LINE = [0xf5, 0x9e, 0x0b]
const DOT = [0xfd, 0xe6, 0x8a]

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// 4x4 のサンプルで縁をなめらかにする
function coverage(fn, x, y) {
  let n = 0
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (fn(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++
  return n / 16
}

function blend(x, y, rgb, a) {
  if (a <= 0) return
  const k = (y * N + x) * 4
  const srcA = a
  const dstA = px[k + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  for (let c = 0; c < 3; c++) {
    px[k + c] = Math.round((rgb[c] * srcA + px[k + c] * dstA * (1 - srcA)) / outA)
  }
  px[k + 3] = Math.round(outA * 255)
}

function paint(fn, rgb, bounds = [0, 0, N, N]) {
  const [bx0, by0, bx1, by1] = bounds.map(Math.floor)
  for (let y = Math.max(0, by0 - 2); y < Math.min(N, by1 + 2); y++)
    for (let x = Math.max(0, bx0 - 2); x < Math.min(N, bx1 + 2); x++) blend(x, y, rgb, coverage(fn, x, y))
}

// 背景
const M = 64
paint((x, y) => inRoundRect(x, y, M, M, N - M, N - M, 180), BG)

// 3x3 の格子（ブロック）
const G0 = 184
const step = 224
const size = 196
for (let i = 0; i < 3; i++)
  for (let j = 0; j < 3; j++) {
    const x0 = G0 + i * step
    const y0 = G0 + j * step
    paint((x, y) => inRoundRect(x, y, x0, y0, x0 + size, y0 + size, 28), CELL, [x0, y0, x0 + size, y0 + size])
  }

// 回路の線：セルの中心を通る折れ線
const c = (i) => G0 + i * step + size / 2
const W = 30
const path = [
  [c(0), c(2)],
  [c(0), c(0)],
  [c(1), c(0)],
  [c(1), c(2)],
  [c(2), c(2)],
  [c(2), c(1)],
]
function onSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= (W / 2) ** 2
}
for (let k = 0; k + 1 < path.length; k++) {
  const a = path[k]
  const b = path[k + 1]
  paint((x, y) => onSegment(x, y, a, b), LINE, [
    Math.min(a[0], b[0]) - W,
    Math.min(a[1], b[1]) - W,
    Math.max(a[0], b[0]) + W,
    Math.max(a[1], b[1]) + W,
  ])
}
// 端の点
for (const [px0, py0] of [path[0], path[path.length - 1]]) {
  const r = 52
  paint((x, y) => (x - px0) ** 2 + (y - py0) ** 2 <= r * r, LINE, [px0 - r, py0 - r, px0 + r, py0 + r])
  const r2 = 26
  paint((x, y) => (x - px0) ** 2 + (y - py0) ** 2 <= r2 * r2, DOT, [px0 - r2, py0 - r2, px0 + r2, py0 + r2])
}

// PNG に書く
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8
ihdr[9] = 6
const raw = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0
  Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(process.argv[2], png)
