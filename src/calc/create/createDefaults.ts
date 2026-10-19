// Create の内蔵の初期値（docs/create-stress.md「数値の表」「TOML の形」）。
// 出典：Create（MIT License、Copyright (c) The Create Team / The Creators of Create）の
// AllBlocks.java・BuilderTransformers.java・CKinetics.java、Create Fabric 0.5.1（MIT License、Copyright (c) 2019 simibubi）。
// 値はすべて Create 本体のブロック。キーは `create:` を外したブロック名。README の「注記」に出典を書いてある。

/** 1 RPM あたりの消費（SU/RPM）。ここにないブロックは 0（Create と同じ） */
export const DEFAULT_IMPACT: Readonly<Record<string, number>> = {
  mechanical_press: 8,
  crushing_wheel: 8,
  mechanical_mixer: 4,
  millstone: 4,
  turntable: 4,
  mechanical_drill: 4,
  mechanical_saw: 4,
  deployer: 4,
  mechanical_pump: 4,
  mechanical_bearing: 4,
  clockwork_bearing: 4,
  rope_pulley: 4,
  elevator_pulley: 4,
  hose_pulley: 4,
  mechanical_piston: 4,
  sticky_mechanical_piston: 4,
  copper_backtank: 4,
  netherite_backtank: 4,
  encased_fan: 2,
  weighted_ejector: 2,
  mechanical_crafter: 2,
  mechanical_arm: 2,
  cuckoo_clock: 1,
  mysterious_cuckoo_clock: 1,
  chain_conveyor: 1,
}

/** 1 RPM あたりの供給（SU/RPM） */
export const DEFAULT_CAPACITY: Readonly<Record<string, number>> = {
  creative_motor: 16384,
  water_wheel: 32,
  large_water_wheel: 128,
  windmill_bearing: 512,
  hand_crank: 8,
  copper_valve_handle: 8,
  steam_engine: 1024,
}

/** kinetics の設定の初期値（CKinetics.java） */
export const DEFAULT_KINETICS = {
  maxRotationSpeed: 256,
  disableStress: false,
  mediumSpeed: 30,
  fastSpeed: 100,
} as const

/** 回転数を nbt の設定値で決めるブロックの初期値（CreativeMotorBlockEntity・SpeedControllerBlockEntity の DEFAULT_SPEED） */
export const DEFAULT_SCROLL_SPEED = 16

/** 水車が1段で生む回転数（WaterWheelBlockEntity） */
export const WATER_WHEEL_SPEED = 8

/** ハンドルを回しているときの回転数（HandCrankBlockEntity） */
export const HAND_CRANK_SPEED = 32

/** 蒸気エンジンの回転数の単位（PoweredShaftBlockEntity） */
export const STEAM_ENGINE_BASE_SPEED = 16
