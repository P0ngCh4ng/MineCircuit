// 規則の一覧（docs/verification.md「3. 規則の一覧」）。書類の規則 ID ごとに、出典と確かめた段階を持つ。
// rules.test.ts が、書類の ID・テストの名前に出てくる ID・この一覧が一致することを調べる。
// ソースのパスは Create の src/main/java/com/simibubi/create/ から。0.5.1（Fabric）と 6.0 で同じなら1つだけ書く。

/** A：ソースとの照合、B：固定のテスト、C：実在の設計図、D：ゲームで測る（docs/verification.md「確かめる段階」） */
export type Stage = 'A' | 'B' | 'C' | 'D'

export interface Rule {
  /** 規則を書いた書類（docs/ から） */
  readonly doc: string
  readonly source: string
  readonly stages: readonly Stage[]
}

const STRESS = 'create-stress.md'
const AB: readonly Stage[] = ['A', 'B']

function stress(source: string, stages: readonly Stage[] = AB): Rule {
  return { doc: STRESS, source, stages }
}

/** Create にない、このアプリが決めた規則。ソースと見比べるもの（A）がない */
function app(source: string): Rule {
  return { doc: STRESS, source, stages: ['B'] }
}

const KINETIC_BLOCK = 'content/kinetics/**/*Block.java の getRotationAxis・hasShaftTowards'

export const RULES: Readonly<Record<string, Rule>> = {
  // 値の出どころ
  'ST-CONFIG-SEARCH': stress('infrastructure/config/AllConfigs.java（SERVER の設定）。場所は Create Astral の実物で確かめた'),
  'ST-CONFIG-FALLBACK': stress('foundation/config/ConfigBase（足りない項目を初期値で補う）。Create Astral の実物で確かめた'),
  'ST-CONFIG-TOML': stress('infrastructure/config/CKinetics.java・CStress.java。見出しは Create Astral の実物で確かめた'),
  'ST-IMPACT': stress('AllBlocks.java の setImpact・setNoImpact、foundation/data/BuilderTransformers.java'),
  'ST-MIN-SPEED': stress('IRotate.getMinimumRequiredSpeedLevel を上書きするブロック（MixerBlock・DisplayBoardBlock）'),
  'ST-CAPACITY': stress('AllBlocks.java の setCapacity'),
  'ST-CAPACITY-VALVE-HANDLE': stress('content/kinetics/crank/HandCrankBlockEntity.java の getStressConfigKey'),
  // 回転軸と軸の口
  'ST-AXIS-SHAFT': stress(`${KINETIC_BLOCK}（ShaftBlock・PoweredShaftBlock・EncasedShaftBlock・FlywheelBlock・CrushingWheelBlock・ClutchBlock・GearshiftBlock）`),
  'ST-AXIS-COGWHEEL': stress(`${KINETIC_BLOCK}（CogWheelBlock）`),
  'ST-AXIS-LARGE-COGWHEEL': stress(`${KINETIC_BLOCK}（CogWheelBlock）`),
  'ST-AXIS-ENCASED-COG': stress(`${KINETIC_BLOCK}（EncasedCogwheelBlock の TOP_SHAFT・BOTTOM_SHAFT）`),
  'ST-AXIS-GEARBOX': stress(`${KINETIC_BLOCK}（GearboxBlock）`),
  'ST-AXIS-CHAIN-DRIVE': stress(`${KINETIC_BLOCK}（ChainDriveBlock）`),
  'ST-AXIS-SPEED-CONTROLLER': stress(`${KINETIC_BLOCK}（SpeedControllerBlock。HorizontalAxisKineticBlock）`),
  'ST-AXIS-SEQUENCED-GEARSHIFT': stress(`${KINETIC_BLOCK}（SequencedGearshiftBlock の VERTICAL）`),
  'ST-AXIS-CREATIVE-MOTOR': stress(`${KINETIC_BLOCK}（CreativeMotorBlock）`),
  'ST-AXIS-WATER-WHEEL': stress(`${KINETIC_BLOCK}（WaterWheelBlock）`),
  'ST-AXIS-LARGE-WATER-WHEEL': stress(`${KINETIC_BLOCK}（LargeWaterWheelBlock）`),
  'ST-AXIS-CRANK': stress(`${KINETIC_BLOCK}（HandCrankBlock・ValveHandleBlock・EncasedFanBlock・DrillBlock）`),
  'ST-AXIS-BEARING': stress(`${KINETIC_BLOCK}（BearingBlock）`),
  'ST-AXIS-SAW': stress(`${KINETIC_BLOCK}（SawBlock）`),
  'ST-AXIS-DIRECTIONAL': stress('content/kinetics/base/DirectionalAxisKineticBlock.java の getRotationAxis・hasShaftTowards'),
  'ST-AXIS-PRESS': stress(`${KINETIC_BLOCK}（MechanicalPressBlock）`),
  'ST-AXIS-CUCKOO-CLOCK': stress(`${KINETIC_BLOCK}（CuckooClockBlock）`),
  'ST-AXIS-EJECTOR': stress(`${KINETIC_BLOCK}（EjectorBlock・ElevatorPulleyBlock。HorizontalKineticBlock の時計回り）`),
  'ST-AXIS-HOSE-PULLEY': stress(`${KINETIC_BLOCK}（HosePulleyBlock）`),
  'ST-AXIS-ROPE-PULLEY': stress(`${KINETIC_BLOCK}（PulleyBlock）`),
  'ST-AXIS-GANTRY-SHAFT': stress(`${KINETIC_BLOCK}（GantryShaftBlock）`),
  'ST-AXIS-BELT': stress(`${KINETIC_BLOCK}（BeltBlock）`),
  'ST-AXIS-MILLSTONE': stress(`${KINETIC_BLOCK}（MillstoneBlock）`),
  'ST-AXIS-TURNTABLE': stress(`${KINETIC_BLOCK}（TurntableBlock）`),
  'ST-AXIS-MIXER': stress(`${KINETIC_BLOCK}（MechanicalMixerBlock・ArmBlock・ChainConveyorBlock）`),
  'ST-AXIS-CRAFTER': stress(`${KINETIC_BLOCK}（MechanicalCrafterBlock・DisplayBoardBlock）`),
  'ST-AXIS-PUMP': stress(`${KINETIC_BLOCK}（PumpBlock）`),
  'ST-AXIS-BACKTANK': stress(`${KINETIC_BLOCK}（BacktankBlock）`),
  // つながりの規則
  'ST-LINK-NEIGHBORS': stress('content/kinetics/RotationPropagator.java の getPotentialNeighbourLocations'),
  'ST-LINK-SHAFT': stress('content/kinetics/RotationPropagator.java の getRotationSpeedModifier（Axis <-> Axis）'),
  'ST-LINK-CHAIN': stress('content/kinetics/chainDrive/ChainDriveBlock.java の areBlocksConnected・getRotationSpeedModifier、ChainGearshiftBlockEntity'),
  'ST-LINK-LARGE-LARGE': stress('content/kinetics/RotationPropagator.java（Large Gear <-> Large Gear）'),
  'ST-LINK-LARGE-SMALL': stress('content/kinetics/RotationPropagator.java（Gear <-> Large Gear）'),
  'ST-LINK-COG': stress('content/kinetics/RotationPropagator.java（Gear <-> Gear）'),
  'ST-LINK-CONTROLLER': stress('content/kinetics/speedController/SpeedControllerBlockEntity.java、RotationPropagator.isLargeCogToSpeedController'),
  'ST-LINK-BELT': stress('content/kinetics/belt/BeltBlockEntity.java の propagateRotationTo、BeltBlock.nextSegmentPosition'),
  'ST-LINK-CHAIN-CONVEYOR': stress('content/kinetics/chainConveyor/ChainConveyorBlockEntity.java の propagateRotationTo・connections（6.0 のみ）'),
  'ST-LINK-GANTRY': stress('content/kinetics/gantry/GantryShaftBlockEntity.java・content/contraptions/gantry/GantryCarriageBlockEntity.java の propagateRotationTo'),
  // 面の係数
  'ST-FACE-GEARBOX': stress('content/kinetics/RotationPropagator.java の getAxisModifier、transmission/GearboxBlockEntity'),
  'ST-FACE-GEARSHIFT': stress('content/kinetics/transmission/GearshiftBlockEntity.java の getRotationSpeedModifier'),
  'ST-FACE-CLUTCH': stress('content/kinetics/transmission/ClutchBlockEntity.java の getRotationSpeedModifier'),
  'ST-FACE-SEQUENCED-GEARSHIFT': stress('content/kinetics/transmission/sequencer/SequencedGearshiftBlockEntity.java の getRotationSpeedModifier'),
  // 動力源
  'ST-SOURCE-CREATIVE-MOTOR': stress('content/kinetics/motor/CreativeMotorBlockEntity.java の getGeneratedSpeed'),
  'ST-SOURCE-WATER-WHEEL': stress('content/kinetics/waterwheel/WaterWheelBlockEntity.java の getGeneratedSpeed'),
  'ST-SOURCE-WINDMILL': stress('content/contraptions/bearing/WindmillBearingBlockEntity.java の getGeneratedSpeed'),
  'ST-SOURCE-CRANK': stress('content/kinetics/crank/HandCrankBlockEntity.java の getGeneratedSpeed'),
  'ST-SOURCE-STEAM-ENGINE': stress('content/kinetics/steamEngine/PoweredShaftBlockEntity.java の getGeneratedSpeed・calculateAddedStressCapacity'),
  // 計算の手順
  'ST-STEP-NODES': app('このアプリの組み立て（ブロック状態の不足は #148）'),
  'ST-STEP-EDGES': stress('content/kinetics/RotationPropagator.java の isConnected（両向き）'),
  'ST-STEP-OUT-OF-RANGE': app('このアプリの仮定（設計図の外は空気）'),
  'ST-STEP-GROUPS': app('このアプリの組み立て（比の決まったまとまり）'),
  'ST-STEP-RATIOS': stress('content/kinetics/RotationPropagator.java の propagateNewSource（向き・速度の衝突で壊す）'),
  'ST-STEP-SPEED': stress('content/kinetics/RotationPropagator.java の propagateNewSource（速いほうが押し切る）'),
  'ST-STEP-CONTROLLER': stress('content/kinetics/speedController/SpeedControllerBlockEntity.java の getConveyedSpeed'),
  'ST-STEP-MAX-SPEED': stress('content/kinetics/RotationPropagator.java（maxRotationSpeed を超えると壊す）'),
  'ST-STEP-NETWORKS': stress('content/kinetics/KineticNetwork.java（速度コントローラーの先も同じネットワーク）'),
  'ST-STEP-STRESS': stress('content/kinetics/KineticNetwork.java の calculateStress'),
  'ST-STEP-OVERLOAD': stress('content/kinetics/KineticNetwork.java の updateStress（容量 < 応力で過負荷）'),
  'ST-STEP-STOPPED': app('このアプリの検査（#148）'),
  'ST-CAPACITY-GENERATED': stress('content/kinetics/KineticNetwork.java の calculateCapacity'),
  // 結果
  'ST-RESULT-SUMMARY': app('このアプリの表示（#152）'),
  'ST-RESULT-ISSUES': app('このアプリの表示（#153・#159）'),
  'ST-RESULT-PROBE': app('このアプリの表示（#31）'),
  // 仮の入出力・画面の設定・生データ
  'ST-PORT-SOURCE': app('このアプリの仮の入出力'),
  'ST-PORT-LOAD': app('このアプリの仮の入出力'),
  'ST-PORT-ATTACH': app('このアプリの仮の入出力（#195）'),
  'ST-PORT-SIGN': app('このアプリの仮の入出力'),
  'ST-PORT-OUT-OF-RANGE': app('このアプリの仮の入出力'),
  'ST-SETTING-SCROLL': stress('content/kinetics/motor/CreativeMotorBlockEntity.java・speedController/SpeedControllerBlockEntity.java の ScrollValue と範囲'),
  'ST-NBT-POS': stress('Minecraft の NbtUtils.writeBlockPos（1.20.5 から int 配列）'),
}
