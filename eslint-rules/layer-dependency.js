// 層と依存の向きを守らせる ESLint のルール。
// 依存は上の層から下の層への一方向だけ（CLAUDE.md「フォルダ構成」、docs/design.md「層と依存の向き」）。
// 下の層から上の層を import したら止める。あわせて、view 以外で Vue / Three.js / Pinia を import したら止める。
import path from 'node:path'

// 下の層から順に並べる。各層は、自分と自分より前（下）の層だけを import してよい
const CORE_LAYERS = ['domain', 'io', 'edit', 'analysis', 'calc']

// 一番上の層。どちらも CORE_LAYERS をすべて使ってよい
// view は Worker を作るため workers を import してよい。workers は view を import しない
const ALLOWED = {
  ...Object.fromEntries(CORE_LAYERS.map((layer, i) => [layer, CORE_LAYERS.slice(0, i + 1)])),
  workers: [...CORE_LAYERS, 'workers'],
  view: [...CORE_LAYERS, 'workers', 'view'],
}

const LAYERS = Object.keys(ALLOWED)

// view の中だけで使ってよいパッケージ
const VIEW_ONLY_PACKAGES = ['vue', 'three', 'pinia', '@vue/']

/**
 * src からの相対パスの最初のフォルダ名を層として返す。層の外なら null
 * @param {string} srcDir
 * @param {string} file
 * @returns {string | null}
 */
function layerOf(srcDir, file) {
  const rel = path.relative(srcDir, file)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const first = rel.split(/[\\/]/)[0]
  return LAYERS.includes(first) ? first : null
}

/**
 * import 先の文字列を、ファイルの絶対パスに直す。パッケージなら null
 * @param {string} srcDir
 * @param {string} fromFile
 * @param {string} spec
 * @returns {string | null}
 */
function resolveSpecifier(srcDir, fromFile, spec) {
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    return path.resolve(path.dirname(fromFile), spec)
  }
  if (spec.startsWith('@/')) return path.resolve(srcDir, spec.slice(2))
  return null
}

/**
 * @param {string} spec
 * @returns {boolean}
 */
function isViewOnlyPackage(spec) {
  return VIEW_ONLY_PACKAGES.some((name) =>
    name.endsWith('/') ? spec.startsWith(name) : spec === name || spec.startsWith(`${name}/`),
  )
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: '層と依存の向きを守る（下の層から上の層を import しない）' },
    schema: [
      {
        type: 'object',
        properties: { srcDir: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      upward:
        '{{from}} から {{to}} は import できません。依存は上の層から下の層への一方向だけです（{{from}} が使えるのは {{allowed}}）。',
      viewOnly:
        '{{from}} から "{{spec}}" は import できません。Vue・Three.js・Pinia は src/view の中だけで使います。',
    },
  },
  create(context) {
    const option = context.options[0]
    const srcDir = path.resolve(context.cwd, option?.srcDir ?? 'src')
    const fromLayer = layerOf(srcDir, context.filename)
    if (fromLayer === null) return {}

    /** @param {import('estree').Node | null | undefined} source */
    function check(source) {
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return
      const spec = source.value

      const target = resolveSpecifier(srcDir, context.filename, spec)
      if (target === null) {
        if (fromLayer !== 'view' && isViewOnlyPackage(spec)) {
          context.report({ node: source, messageId: 'viewOnly', data: { from: fromLayer, spec } })
        }
        return
      }

      const toLayer = layerOf(srcDir, target)
      if (toLayer === null) return
      const allowed = ALLOWED[fromLayer]
      if (!allowed.includes(toLayer)) {
        context.report({
          node: source,
          messageId: 'upward',
          data: { from: fromLayer, to: toLayer, allowed: allowed.join(', ') },
        })
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    }
  },
}

export default rule
