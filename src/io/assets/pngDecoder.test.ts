import { describe, expect, it } from 'vitest'
import { decodePng, PngDecodeError } from './pngDecoder'
import { encodePng, pixelAt, rgbaPng } from '../../../tests/fixtures/pngFixture'

describe('decodePng', () => {
  it('RGBA 8 ビットを、全フィルターで正しく戻す', () => {
    const color = (x: number, y: number) => [x * 30, y * 20, (x * y * 7) % 256, 255 - x * 10] as const
    const png = rgbaPng(5, 5, color, [0, 1, 2, 3, 4])
    const img = decodePng(png)
    expect(img.width).toBe(5)
    expect(img.height).toBe(5)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) expect(pixelAt(img.pixels, 5, x, y)).toEqual([...color(x, y)])
  })

  it('RGB 8 ビットは不透明になり、tRNS の色は透明になる', () => {
    const png = encodePng({ width: 2, height: 1, colorType: 2, samples: [10, 20, 30, 1, 2, 3], trns: [0, 1, 0, 2, 0, 3], filters: [4] })
    const img = decodePng(png)
    expect(pixelAt(img.pixels, 2, 0, 0)).toEqual([10, 20, 30, 255])
    expect(pixelAt(img.pixels, 2, 1, 0)).toEqual([1, 2, 3, 0])
  })

  it('パレット（4 ビット）と tRNS の透明度', () => {
    const png = encodePng({
      width: 3,
      height: 2,
      colorType: 3,
      bitDepth: 4,
      samples: [0, 1, 2, 2, 1, 0],
      palette: [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ],
      trns: [128],
    })
    const img = decodePng(png)
    expect(pixelAt(img.pixels, 3, 0, 0)).toEqual([255, 0, 0, 128])
    expect(pixelAt(img.pixels, 3, 1, 0)).toEqual([0, 255, 0, 255])
    expect(pixelAt(img.pixels, 3, 2, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(img.pixels, 3, 0, 1)).toEqual([0, 0, 255, 255])
  })

  it('パレット 1 ビット（幅が 8 で割り切れない）', () => {
    const samples = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1]
    const png = encodePng({ width: 10, height: 1, colorType: 3, bitDepth: 1, samples, palette: [[0, 0, 0], [255, 255, 255]] })
    const img = decodePng(png)
    samples.forEach((s, x) => expect(pixelAt(img.pixels, 10, x, 0)[0]).toBe(s * 255))
  })

  it('グレー 8 ビット・2 ビット、グレー+α', () => {
    const g8 = decodePng(encodePng({ width: 2, height: 1, colorType: 0, samples: [0, 200] }))
    expect(pixelAt(g8.pixels, 2, 1, 0)).toEqual([200, 200, 200, 255])
    const g2 = decodePng(encodePng({ width: 4, height: 1, colorType: 0, bitDepth: 2, samples: [0, 1, 2, 3] }))
    expect([0, 1, 2, 3].map((x) => pixelAt(g2.pixels, 4, x, 0)[0])).toEqual([0, 85, 170, 255])
    const ga = decodePng(encodePng({ width: 1, height: 2, colorType: 4, samples: [50, 60, 70, 80], filters: [3] }))
    expect(pixelAt(ga.pixels, 1, 0, 0)).toEqual([50, 50, 50, 60])
    expect(pixelAt(ga.pixels, 1, 0, 1)).toEqual([70, 70, 70, 80])
  })

  it('RGBA 16 ビットは上位 8 ビットを使う', () => {
    const img = decodePng(encodePng({ width: 1, height: 1, colorType: 6, bitDepth: 16, samples: [0x1234, 0xabcd, 0xff00, 0xffff] }))
    expect(pixelAt(img.pixels, 1, 0, 0)).toEqual([0x12, 0xab, 0xff, 0xff])
  })

  it('Adam7 のインターレースを読む。インターレースなしと同じ画素になる', () => {
    // 7つの縮小画像がすべて出てくる大きさと、空の縮小画像が出る小さな大きさ。フィルターも混ぜる
    for (const [w, h] of [
      [11, 9],
      [3, 2],
      [1, 1],
    ] as const) {
      const samples: number[] = []
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) samples.push(x * 20, y * 25, (x + y) * 7, 255 - x)
      const plain = decodePng(encodePng({ width: w, height: h, samples, filters: [0, 1, 2, 3, 4] }))
      const interlaced = decodePng(encodePng({ width: w, height: h, samples, filters: [0, 1, 2, 3, 4], interlace: 1 }))
      expect(interlaced).toEqual(plain)
    }
    // パレットの 2 ビット（1 バイトに4画素）も
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]] as const
    const idx = Array.from({ length: 5 * 4 }, (_, i) => i % 4)
    const p1 = decodePng(encodePng({ width: 5, height: 4, colorType: 3, bitDepth: 2, palette, samples: idx }))
    const p2 = decodePng(encodePng({ width: 5, height: 4, colorType: 3, bitDepth: 2, palette, samples: idx, interlace: 1 }))
    expect(p2).toEqual(p1)
  })

  it('知らないインターレース・PNG でないもの・壊れたものは PngDecodeError', () => {
    expect(() => decodePng(encodePng({ width: 1, height: 1, samples: [0, 0, 0, 0], interlace: 2 }))).toThrow(PngDecodeError)
    expect(() => decodePng(new TextEncoder().encode('not a png'))).toThrow(PngDecodeError)
    const broken = rgbaPng(2, 2, () => [1, 2, 3, 4])
    broken[40] = broken[40]! ^ 0xff
    expect(() => decodePng(broken)).toThrow(PngDecodeError)
    expect(() => decodePng(rgbaPng(2, 2, () => [1, 2, 3, 4]).subarray(0, 30))).toThrow(PngDecodeError)
  })

  it('対応しないビット深度は PngDecodeError', () => {
    expect(() => decodePng(encodePng({ width: 1, height: 1, colorType: 2, bitDepth: 4, samples: [0, 0, 0] }))).toThrow(
      /対応していない/,
    )
  })
})
