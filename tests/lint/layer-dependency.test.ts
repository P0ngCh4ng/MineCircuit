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
  ],
  invalid: [
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
