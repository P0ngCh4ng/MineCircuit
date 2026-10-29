// sval が中で使う隠れた名前（`noctor` + 乱数など。sval 0.6.12 の B(…)）。
// 知らない名前を受け止める値（fakeKubeJs.ts の NOOP、runScripts.ts の大域の受け皿）は、この名前には答えない。
// 答えると、sval が「new できない関数」や「strict」の印と取り違える。

const SVAL_INTERNAL =
  /^(?:iterator|asynciterator|window|super|supercall|noctor|clsctor|newtarget|private|noinit|optchain|import|exports|strict)[a-z0-9]{6,}$/

export function isSvalInternalName(key: string | symbol): boolean {
  return typeof key === 'string' && SVAL_INTERNAL.test(key)
}
