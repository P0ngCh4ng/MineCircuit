// 置くときの向きと、置けるか（#119・#121。docs/ui.md「編集」）。
// Mod ごとの規則は計算プラグインが持つので、画面は計算プラグインの一覧に聞くだけにする。
// 計算そのものは Worker で行うので、ここの一覧は向きと規則を聞くためだけに使う。

import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import type { BlockState } from '../../domain/blockState'
import type { Blueprint } from '../../domain/blueprint'
import type { Direction } from '../../domain/direction'
import type { Vec3 } from '../../domain/vec3'

const registry = createBuiltinRegistry()

/** pos に state を置くときの向き。隣とつながる向きに合わせた状態。変えないなら state のまま */
export function orientForPlacement(bp: Blueprint, pos: Vec3, state: BlockState, from: Direction | null): BlockState {
  return registry.orientForPlacement(bp, pos, state, from)
}

/** pos に state を置けるか。ゲームで置けないなら理由、置けるなら null */
export function placementProblem(bp: Blueprint, pos: Vec3, state: BlockState): string | null {
  return registry.placementProblem(bp, pos, state)
}
