// Create のベルトのツール（L。#248）。ゲームでベルトをシャフトに使うときと同じく、シャフトを2本順にクリックすると、
// その間にベルトを敷く。規則は createBeltConnector（docs/create-stress.md「ベルトをつなぐ」）。
// 計算プラグインのつなぐツール（calc/connectTool.ts）として出し、画面の共通のツールが動かす（#266）。

import type { Vec3 } from '../../domain/vec3'
import type { ConnectToolDef } from '../connectTool'
import { beltShaftAxis, planBeltConnection } from './createBeltConnector'

export const CREATE_BELT_TOOL: ConnectToolDef = {
  id: 'belt',
  label: 'ベルト',
  key: 'L',
  description: 'シャフトを2本順にクリックして、その間にベルトを敷く',
  icon: [
    'M5 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M15 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
    'M5 7.5h10M5 12.5h10',
  ],
  messages: {
    pickStart: 'ベルトはシャフトに掛けます。1本目のシャフトをクリックしてください。',
    cancelled: '1本目の選択をやめました。',
    first: (pos: Vec3) =>
      `1本目：(${pos[0]}, ${pos[1]}, ${pos[2]})。2本目のシャフトをクリックしてください。Shift+クリックか同じシャフトでやめます。`,
    done: (count: number) => `ベルトを敷きました（${count} 区間）。`,
    command: (count: number) => `ベルトをつなぐ（${count} 区間）`,
  },
  canStart: (state) => beltShaftAxis(state) !== null,
  plan(bp, first, second, options) {
    const plan = planBeltConnection(bp, first, second, { speedAt: options.speedAt })
    if (plan === null || typeof plan === 'string') return plan
    return { cells: plan.segments }
  },
}
