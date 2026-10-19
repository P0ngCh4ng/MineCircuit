// Java の Modified UTF-8（DataInput.readUTF / DataOutput.writeUTF）の変換。
// 通常の UTF-8 との違いは2つ。
// - U+0000 を 0xC0 0x80 の2バイトで表す
// - U+10000 以上の文字はサロゲートペアの各半分を3バイトずつで表す
// TextDecoder ではこの2つを正しく読めないので自前で変換する。

/** 文字列を Modified UTF-8 のバイト列にする */
export function encodeMutf8(s: string): Uint8Array {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    n += c >= 0x01 && c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3
  }
  const out = new Uint8Array(n)
  let p = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0x01 && c <= 0x7f) {
      out[p++] = c
    } else if (c <= 0x7ff) {
      out[p++] = 0xc0 | (c >> 6)
      out[p++] = 0x80 | (c & 0x3f)
    } else {
      out[p++] = 0xe0 | (c >> 12)
      out[p++] = 0x80 | ((c >> 6) & 0x3f)
      out[p++] = 0x80 | (c & 0x3f)
    }
  }
  return out
}

/** Modified UTF-8 のバイト列を文字列にする。形が正しくなければ例外を投げる */
export function decodeMutf8(bytes: Uint8Array): string {
  const units: number[] = []
  let i = 0
  const cont = (k: number): number => {
    const b = bytes[k]
    if (b === undefined || (b & 0xc0) !== 0x80) throw new Error('文字列の符号化が正しくありません')
    return b & 0x3f
  }
  while (i < bytes.length) {
    const b = bytes[i] as number
    if (b < 0x80) {
      units.push(b)
      i += 1
    } else if ((b & 0xe0) === 0xc0) {
      units.push(((b & 0x1f) << 6) | cont(i + 1))
      i += 2
    } else if ((b & 0xf0) === 0xe0) {
      units.push(((b & 0x0f) << 12) | (cont(i + 1) << 6) | cont(i + 2))
      i += 3
    } else {
      throw new Error('文字列の符号化が正しくありません')
    }
  }
  // 長い文字列で引数の数の上限を超えないよう、区切って変換する
  let s = ''
  for (let k = 0; k < units.length; k += 8192) {
    s += String.fromCharCode(...units.slice(k, k + 8192))
  }
  return s
}
