// 層と依存の向きを守らせる ESLint のルール。
// 依存は上の層から下の層への一方向だけ（CLAUDE.md「フォルダ構成」、docs/design.md「層と依存の向き」）。
// 下の層から上の層を import したら止める。あわせて、view 以外で Vue / Three.js / Pinia を import したら止める。
// Tauri の API（@tauri-apps/*）と src/io/tauri/ は、src/io/tauri/ と src/view/platform/ の中だけで使う（CLAUDE.md「フォルダ構成」）。
// Mod ごとの場所（calc/create/ など）は、同じ Mod の場所の中と登録の場所からだけ使う（docs/design.md「Mod ごとのものを足す口」）。
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

// Tauri の API のパッケージ
const TAURI_PACKAGE_PREFIX = '@tauri-apps/'

// Tauri の API を使ってよいフォルダ（src からの相対パス）。どちらで動いているかを知るのはここだけ
const TAURI_DIRS = ['io/tauri', 'view/platform']

// Tauri 用の実装（TauriFileSource など）を置くフォルダ。使ってよいのは TAURI_DIRS だけ
const TAURI_IMPL_DIR = 'io/tauri'

// Mod ごとの場所のフォルダ名（Mod の namespace）。どの層の中にあっても、このフォルダは Mod の場所とみなす
const MOD_DIRS = ['create']

// Mod の場所を import してよい登録の場所（src からの相対パス）
const MOD_REGISTRATION_FILES = ['calc/builtinPlugins.ts', 'io/assets/builtinPartialModels.ts']

/**
 * file が入っている Mod の場所の名前の一覧（src からの相対パスのフォルダのうち MOD_DIRS にあるもの）
 * @param {string} srcDir
 * @param {string} file
 * @returns {string[]}
 */
function modDirsOf(srcDir, file) {
  const rel = path.relative(srcDir, file)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return []
  const dirs = rel.split(/[\\/]/).slice(0, -1)
  return dirs.filter((d) => MOD_DIRS.includes(d))
}

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
 * file が src からの相対パス dir の中（dir そのものを含む）にあれば true
 * @param {string} srcDir
 * @param {string} file
 * @param {string} dir
 * @returns {boolean}
 */
function isInside(srcDir, file, dir) {
  const rel = path.relative(path.resolve(srcDir, dir), file)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * file が Tauri の API を使ってよいフォルダの中なら true
 * @param {string} srcDir
 * @param {string} file
 * @returns {boolean}
 */
function canUseTauri(srcDir, file) {
  return TAURI_DIRS.some((dir) => isInside(srcDir, file, dir))
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
      tauriOnly:
        '"{{spec}}" はここでは import できません。Tauri の API は src/io/tauri/ と src/view/platform/ の中だけで使います。',
      tauriImpl:
        'src/io/tauri/ はここでは import できません。Tauri 用の実装を選ぶのは src/view/platform/ だけです。',
      modDir:
        'Mod の場所（{{mod}}/）はここでは import できません。共通の層は計算プラグインや Mod ごとの表の口から使い、Mod の場所を足すのは登録の場所（{{registration}}）だけです。',
    },
  },
  create(context) {
    const option = context.options[0]
    const srcDir = path.resolve(context.cwd, option?.srcDir ?? 'src')
    if (!isInside(srcDir, context.filename, '.')) return {}
    const fromLayer = layerOf(srcDir, context.filename)
    const tauriAllowed = canUseTauri(srcDir, context.filename)
    const fromMods = modDirsOf(srcDir, context.filename)
    const isTest = /\.test\.[cm]?[jt]s$/.test(context.filename)
    const isRegistration = MOD_REGISTRATION_FILES.some((f) => path.resolve(srcDir, f) === path.resolve(context.filename))

    /** @param {import('estree').Node | null | undefined} source */
    function check(source) {
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return
      const spec = source.value

      const target = resolveSpecifier(srcDir, context.filename, spec)
      if (target === null) {
        if (spec.startsWith(TAURI_PACKAGE_PREFIX) && !tauriAllowed) {
          context.report({ node: source, messageId: 'tauriOnly', data: { spec } })
          return
        }
        if (fromLayer === null) return
        if (fromLayer !== 'view' && isViewOnlyPackage(spec)) {
          context.report({ node: source, messageId: 'viewOnly', data: { from: fromLayer, spec } })
        }
        return
      }

      if (isInside(srcDir, target, TAURI_IMPL_DIR) && !tauriAllowed) {
        context.report({ node: source, messageId: 'tauriImpl' })
        return
      }

      if (!isTest && !isRegistration) {
        // 拡張子のない import 先（'./create/x'）は、最後の部分をファイル名とみなす
        const mod = modDirsOf(srcDir, target).find((m) => !fromMods.includes(m))
        if (mod) {
          context.report({ node: source, messageId: 'modDir', data: { mod, registration: MOD_REGISTRATION_FILES.join('、') } })
          return
        }
      }

      if (fromLayer === null) return
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
