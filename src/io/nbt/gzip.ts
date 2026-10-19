// gzip の展開と圧縮。ブラウザ（と Node 18 以降）にある
// DecompressionStream / CompressionStream を使う。

/** gzip の先頭2バイト（0x1f 0x8b）で始まるか */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('gzip'))
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('gzip'))
}

async function pipe(bytes: Uint8Array, transform: ReadableWritablePair<Uint8Array, BufferSource>): Promise<Uint8Array> {
  // 呼び出し元の配列を変えないよう、コピーを流す
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
