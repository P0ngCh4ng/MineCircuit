import path from 'node:path'
import { describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import rule from '../../eslint-rules/layer-dependency.js'

// RuleTester に Vitest の describe / it を使わせる
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const srcDir = path.resolve('/project/src')
const file = (rel: string) => path.join(srcDir, rel)
const options = [{ srcDir }]

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

ruleTester.run('layer-dependency', rule, {
  valid: [
    // 下の層を import する
    { filename: file('io/nbt/reader.ts'), code: "import { a } from '../../domain/a'", options },
    { filename: file('calc/plugin.ts'), code: "import { a } from '../io/modpack/a'", options },
    { filename: file('view/App.ts'), code: "import { a } from '../calc/a'", options },
    { filename: file('view/App.ts'), code: "import { a } from '@/edit/a'", options },
    { filename: file('workers/calc.ts'), code: "import { a } from '../calc/a'", options },
    // 同じ層の中
    { filename: file('io/readers/a.ts'), code: "import { a } from '../nbt/a'", options },
    // view は Vue / Three.js / Pinia を使ってよい
    { filename: file('view/App.ts'), code: "import { ref } from 'vue'", options },
    { filename: file('view/scene.ts'), code: "import * as THREE from 'three'", options },
    // view 以外でも、それ以外のパッケージは使ってよい
    { filename: file('io/jar.ts'), code: "import { unzip } from 'fflate'", options },
    // src の外（入り口の main.ts）は対象外
    { filename: file('main.ts'), code: "import App from './view/App.vue'", options },
    // Tauri の API は src/io/tauri/ と src/view/platform/ で使ってよい
    { filename: file('io/tauri/tauriFileSource.ts'), code: "import { readFile } from '@tauri-apps/plugin-fs'", options },
    { filename: file('view/platform/platform.ts'), code: "import { isTauri } from '@tauri-apps/api/core'", options },
    { filename: file('view/platform/platform.ts'), code: "const m = import('@tauri-apps/plugin-dialog')", options },
    // src/io/tauri/ の中は、ほかの io を使ってよい
    { filename: file('io/tauri/tauriFileSource.ts'), code: "import { a } from '../fileSource'", options },
    // Tauri 用の実装を選ぶのは view/platform/
    { filename: file('view/platform/platform.ts'), code: "import { a } from '../../io/tauri/tauriFileSource'", options },
    { filename: file('view/platform/platform.ts'), code: "const m = import('@/io/tauri/tauriFileSink')", options },
    // 名前が似ているだけのフォルダは対象外
    { filename: file('io/tauriLike.ts'), code: "import { a } from './fileSource'", options },
    // Mod の場所（#266）：同じ Mod の場所の中と、登録の場所からは使ってよい
    { filename: file('calc/create/createStressPlugin.ts'), code: "import { a } from './createBeltTool'", options },
    { filename: file('calc/create/createStressPlugin.ts'), code: "import { a } from '../../io/assets/create/createPartialModels'", options },
    { filename: file('calc/builtinPlugins.ts'), code: "import { a } from './create/createStressPlugin'", options },
    { filename: file('io/assets/builtinPartialModels.ts'), code: "import { a } from './create/createPartialModels'", options },
    // 登録の場所は、ほかの Mod の場所（Crafts & Additions）も使ってよい（#276）
    { filename: file('calc/builtinPlugins.ts'), code: "import { a } from './createaddition/createAdditionBlocks'", options },
    { filename: file('calc/createaddition/a.ts'), code: "import { a } from './powerNetwork'", options },
    // Mod の場所から共通の層を使うのはよい
    { filename: file('calc/create/a.ts'), code: "import { a } from '../calcPlugin'", options },
    // テストは対象外
    { filename: file('calc/blockSettings.test.ts'), code: "import { a } from './create/createStressPlugin'", options },
    // 名前に create を含むだけのファイルは対象外
    { filename: file('view/a.ts'), code: "import { a } from '../calc/createLike'", options },
  ],
  invalid: [
    // Mod の場所を共通の層から直接使う（#266）
    // Mod の場所どうしも互いに使わない。アドオンの表は登録の場所でつなぐ（#276）
    {
      filename: file('calc/createaddition/createAdditionBlocks.ts'),
      code: "import { a } from '../create/createAddons'",
      options,
      errors: [{ messageId: 'modDir' }],
    },
    {
      filename: file('calc/create/kineticGraph.ts'),
      code: "import { a } from '../createaddition/createAdditionBlocks'",
      options,
      errors: [{ messageId: 'modDir' }],
    },
    {
      filename: file('calc/pluginRegistry.ts'),
      code: "import { a } from './createaddition/createAdditionPowerPlugin'",
      options,
      errors: [{ messageId: 'modDir' }],
    },
    {
      filename: file('view/tools/beltTool.ts'),
      code: "import { a } from '../../calc/create/createBeltConnector'",
      options,
      errors: [{ messageId: 'modDir' }],
    },
    {
      filename: file('calc/blockSettings.ts'),
      code: "import { a } from './create/createBlockSettings'",
      options,
      errors: [{ messageId: 'modDir' }],
    },
    {
      filename: file('io/assets/partialModels.ts'),
      code: "export { a } from './create/createPartialModels'",
      options,
      errors: [{ messageId: 'modDir' }],
    },
    {
      filename: file('io/fileSource.ts'),
      code: "import { readFile } from '@tauri-apps/plugin-fs'",
      options,
      errors: [{ messageId: 'tauriOnly' }],
    },
    {
      filename: file('view/App.ts'),
      code: "import { isTauri } from '@tauri-apps/api/core'",
      options,
      errors: [{ messageId: 'tauriOnly' }],
    },
    {
      filename: file('view/platformHelper.ts'),
      code: "const m = import('@tauri-apps/plugin-dialog')",
      options,
      errors: [{ messageId: 'tauriOnly' }],
    },
    {
      filename: file('workers/a.ts'),
      code: "export { invoke } from '@tauri-apps/api/core'",
      options,
      errors: [{ messageId: 'tauriOnly' }],
    },
    {
      // 層の外（入り口の main.ts）でも使わない
      filename: file('main.ts'),
      code: "import { isTauri } from '@tauri-apps/api/core'",
      options,
      errors: [{ messageId: 'tauriOnly' }],
    },
    {
      filename: file('io/modpack/modpackRegistry.ts'),
      code: "import { a } from '../tauri/tauriFileSource'",
      options,
      errors: [{ messageId: 'tauriImpl' }],
    },
    {
      filename: file('view/stores/modpackStore.ts'),
      code: "import { a } from '@/io/tauri/tauriFileSource'",
      options,
      errors: [{ messageId: 'tauriImpl' }],
    },
    {
      filename: file('domain/a.ts'),
      code: "import { a } from '../io/a'",
      options,
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: file('io/nbt/reader.ts'),
      code: "import { a } from '../../edit/a'",
      options,
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: file('edit/a.ts'),
      code: "import { a } from '@/view/a'",
      options,
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: file('calc/a.ts'),
      code: "export { a } from '../view/a'",
      options,
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: file('analysis/a.ts'),
      code: "const m = import('../calc/a')",
      options,
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: file('workers/a.ts'),
      code: "import { a } from '../view/a'",
      options,
      errors: [{ messageId: 'upward' }],
    },
    {
      filename: file('domain/a.ts'),
      code: "import { ref } from 'vue'",
      options,
      errors: [{ messageId: 'viewOnly' }],
    },
    {
      filename: file('calc/a.ts'),
      code: "import { Vector3 } from 'three/webgpu'",
      options,
      errors: [{ messageId: 'viewOnly' }],
    },
    {
      filename: file('workers/a.ts'),
      code: "import { defineStore } from 'pinia'",
      options,
      errors: [{ messageId: 'viewOnly' }],
    },
  ],
})
