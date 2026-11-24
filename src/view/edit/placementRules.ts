// 置くときの向きと、置けるか（#119・#121。docs/ui.md「編集」）。範囲の回転・反転の規則（#132）も。
// 画面から変えられる設定と、つなぐツール（#266）も。
// Mod ごとの規則は計算プラグインが持つので、画面は計算プラグインの一覧に聞くだけにする
// （docs/design.md「Mod ごとのものを足す口」）。
// 計算そのものは Worker で行うので、ここの一覧は向きと規則を聞くためだけに使う。

import type { BlockSettings } from '../../calc/blockSettings'
import { createBuiltinRegistry } from '../../calc/builtinPlugins'
import type { ConnectToolDef } from '../../calc/connectTool'
import type { BlockState } from '../../domain/blockState'
import type { BlockTransform } from '../../domain/blockTransform'
import type { Blueprint } from '../../domain/blueprint'
import type { Box } from '../../domain/box'
import type { Direction } from '../../domain/direction'
import type { RawNbt } from '../../domain/nbt'
import type { Vec3 } from '../../domain/vec3'
import type { BlockEntityTransform } from '../../edit/regionTransform'

const registry = createBuiltinRegistry()

/** pos に state を置くときの向き。隣とつながる向きに合わせた状態。変えないなら state のまま */
export function orientForPlacement(bp: Blueprint, pos: Vec3, state: BlockState, from: Direction | null): BlockState {
  return registry.orientForPlacement(bp, pos, state, from)
}

/** 置き方の補助（3D で面をクリックしたとき）。置く位置と状態。使わないなら null */
export function placementHelper(
  bp: Blueprint,
  hit: { readonly pos: Vec3; readonly face: Direction; readonly point: Vec3 },
  state: BlockState,
): { pos: Vec3; state: BlockState } | null {
  return registry.placementHelper(bp, hit, state)
}

/** pos に state を置けるか。ゲームで置けないなら理由、置けるなら null */
export function placementProblem(bp: Blueprint, pos: Vec3, state: BlockState): string | null {
  return registry.placementProblem(bp, pos, state)
}

/**
 * ID だけで選んだブロックの足りない状態を補う（#149）。補った状態と、補えなかったときの理由。
 * 補えなかったときも、置くブロックにはそのまま使える（置いた時点でお知らせに理由を出す）
 */
export function completeBlockState(state: BlockState): { state: BlockState; problem: string | null } {
  return registry.completeState(state)
}

/** state のブロックで画面から変えられる設定。なければ null（#266） */
export function blockSettingsFor(state: BlockState): BlockSettings | null {
  return registry.blockSettings(state)
}

/** 計算プラグインのつなぐツール（#266）。ツールバーに足す */
export function connectTools(): ConnectToolDef[] {
  return registry.connectTools()
}

/** Modpack がないときの棚に出す基本の部品（#162） */
export function basicBlocks(): { state: BlockState; name: string }[] {
  return registry.basicBlocks()
}

/** 範囲の回転・反転でのブロック状態（Mod 独自のプロパティは計算プラグインの規則、それ以外はバニラの規則） */
export function transformBlockState(state: BlockState, t: BlockTransform): BlockState {
  return registry.transformState(state, t)
}

/** 範囲の操作での生データの中の座標の書き直し。知らないブロックなら null */
export function transformBlockEntity(
  state: BlockState,
  nbt: RawNbt,
  t: BlockTransform,
  from: Vec3,
  to: Vec3,
  source: Box,
): BlockEntityTransform | null {
  return registry.transformBlockEntity(state, nbt, t, from, to, source)
}
