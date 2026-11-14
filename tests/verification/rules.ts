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

const THROUGHPUT = 'create-throughput.md'

function tp(source: string, stages: readonly Stage[] = AB): Rule {
  return { doc: THROUGHPUT, source, stages }
}

/** 物の通り道・輸送量の、このアプリが決めた規則。ソースと見比べるもの（A）がない */
function tpApp(source: string): Rule {
  return { doc: THROUGHPUT, source, stages: ['B'] }
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
  // ---- 物の通り道・輸送量（create-throughput.md）。パスは Create の content/ から ----
  // 設定
  'TP-CONFIG': tp('infrastructure/config/CLogistics.java（defaultExtractionTimer）・CRecipes.java（bulkPressing）'),
  // 輸送
  'TP-BELT-RATE': tp('kinetics/belt/BeltBlockEntity.java の getBeltMovementSpeed、belt/transport/BeltInventory.java（間隔）'),
  'TP-ARM-RATE': tp('kinetics/mechanicalArm/ArmBlockEntity.java の chasedPointProgress、ArmInteractionPoint.java の extract'),
  'TP-FUNNEL-RATE': tp('logistics/funnel/FunnelBlockEntity.java の getAmountToExtract・extractionCooldown、FilteringBehaviour の FilterAmount'),
  'TP-CHUTE-RATE': tp('logistics/chute/ChuteBlockEntity.java の getItemMotion'),
  // 機械の処理時間
  'TP-PRESS-TIME': tp('kinetics/press/PressingBehaviour.java の CYCLE・getRunningTickSpeed'),
  'TP-MIXER-TIME': tp('kinetics/mixer/MechanicalMixerBlockEntity.java の tick'),
  'TP-MILLSTONE-TIME': tp('kinetics/millstone/MillstoneBlockEntity.java'),
  'TP-CRUSHING-TIME': tp('kinetics/crusher/CrushingWheelControllerBlockEntity.java'),
  'TP-SAW-TIME': tp('kinetics/saw/SawBlockEntity.java の start・tick'),
  'TP-DEPLOYER-TIME': tp('kinetics/deployer/DeployerBlockEntity.java'),
  // レシピの読む場所
  'TP-RECIPE-SOURCES': tp('Minecraft のデータパックの読み込み（data/<ns>/recipes/、1.21 は recipe/）と KubeJS の kubejs/data/'),
  'TP-RECIPE-TIME-FIELD': tp('foundation/recipe（0.5.1 は ProcessingRecipeSerializer の processingTime、6.0 は processing_time）'),
  'TP-RECIPE-INGREDIENTS': tp('foundation/recipe の材料の読み方、NeoForge の CompoundIngredient（6.0）'),
  'TP-RECIPE-TYPES': tp('AllRecipeTypes.java（milling・crushing・cutting・mixing・pressing・compacting）'),
  // どのレシピか
  'TP-RECIPE-BY-PATH': tpApp('このアプリの決め方（物の通り道で届く物）'),
  'TP-RECIPE-BY-CONTENTS': tpApp('このアプリの決め方（生データの入れ物の中身）'),
  'TP-RECIPE-TAGS': tp('Minecraft のタグの読み込み（入れ子のタグ・replace）'),
  'TP-RECIPE-TIE': tpApp('このアプリの決め方（ID の名前順）'),
  'TP-RECIPE-FALLBACK': tpApp('このアプリの仮定（初期値は MillstoneBlockEntity・CrushingWheelControllerBlockEntity・SawBlockEntity・MechanicalMixerBlockEntity）'),
  'TP-RECIPE-NO-PACK': tpApp('このアプリの仮定（Modpack なし）'),
  // KubeJS のスクリプト
  'TP-KJS-ORDER': tpApp('このアプリの作り物の KubeJS（KubeJS の priority の決まり）'),
  'TP-KJS-EVENTS': tpApp('このアプリの作り物の KubeJS（onEvent・ServerEvents）'),
  'TP-KJS-RECIPE-CALLS': tpApp('このアプリの作り物の KubeJS（KubeJS Create の呼び出し）'),
  'TP-KJS-ITEMS': tpApp('このアプリの作り物の KubeJS（物の書き方）'),
  'TP-KJS-UNKNOWN-ITEM': tpApp('このアプリの作り物の KubeJS（知らない項目）'),
  'TP-KJS-FILTERS': tpApp('このアプリの作り物の KubeJS（レシピの条件）'),
  'TP-KJS-IDS': tpApp('このアプリの作り物の KubeJS（足したレシピの ID）'),
  'TP-KJS-REPLACE': tpApp('このアプリの作り物の KubeJS（replaceInput・replaceOutput）'),
  'TP-KJS-FOR-EACH': tpApp('このアプリの作り物の KubeJS（forEachRecipe・findRecipes）'),
  'TP-KJS-TAGS': tpApp('このアプリの作り物の KubeJS（タグのイベント）'),
  'TP-KJS-GLOBALS': tpApp('このアプリの作り物の KubeJS（大域）'),
  'TP-KJS-ERRORS': tpApp('このアプリの作り物の KubeJS（エラーの扱い）'),
  'TP-KJS-TIMEOUT': tpApp('このアプリの作り物の KubeJS（時間の上限）'),
  'TP-KJS-ASSUMPTION': tpApp('このアプリの作り物の KubeJS（仮定）'),
  // 物の通り道（たどり方）
  'TP-PATH-INPUT': tpApp('このアプリの仮の入出力（物の入口、#127・#195）'),
  'TP-PATH-LOOP': tpApp('このアプリのたどり方（輪）'),
  'TP-PATH-RECIPE': tpApp('このアプリのたどり方（個数 × 確率）'),
  'TP-PATH-NO-RECIPE': tpApp('このアプリのたどり方（レシピのない物）'),
  'TP-PATH-SPLIT': tpApp('このアプリのたどり方（等しく分ける）'),
  'TP-PATH-MERGE': tpApp('このアプリのたどり方（同じ物をまとめる）'),
  'TP-PATH-MULTI-INGREDIENT': tpApp('このアプリの仮定（材料が2つ以上のレシピ）'),
  'TP-PATH-STOPPED': tp('kinetics/base/KineticBlockEntity の getSpeed（回転数 0 で動かない）'),
  'TP-PATH-BATCH': tpApp('このアプリの仮定（64 個まとめて入れたときの処理時間）'),
  'TP-PATH-OVERFLOW': tpApp('このアプリの検査（処理が追いつかない）'),
  'TP-PATH-PROBE': tpApp('このアプリの表示（プローブ）'),
  'TP-PATH-MOTIONS': tpApp('このアプリの表示（物の流れ、#231）'),
  // ブロックごとの規則
  'TP-BLOCK-BELT': tp('kinetics/belt/BeltBlock.java、BeltHelper・transport/BeltInventory（進む向き）'),
  'TP-BLOCK-BELT-MACHINE': tp('kinetics/belt/behaviour/BeltProcessingBehaviour.java、press/PressingBehaviour、deployer/BeltDeployerCallbacks'),
  'TP-BLOCK-BELT-FUNNEL': tp('kinetics/belt/transport/BeltFunnelInteractionHandler.java'),
  'TP-BLOCK-DEPOT': tp('logistics/depot/DepotBehaviour.java'),
  'TP-BLOCK-CHUTE': tp('logistics/chute/ChuteBlockEntity.java・ChuteBlock（斜めの shape）'),
  'TP-BLOCK-MILLSTONE': tp('kinetics/millstone/MillstoneBlockEntity.java'),
  'TP-BLOCK-CRUSHING': tp('kinetics/crusher/CrushingWheelControllerBlockEntity.java'),
  'TP-BLOCK-SAW': tp('kinetics/saw/SawBlockEntity.java（出す向き）'),
  'TP-BLOCK-BASIN': tp('processing/basin/BasinBlockEntity.java・BasinOperatingBlockEntity'),
  'TP-BLOCK-FUNNEL-INSERT': tp('logistics/funnel/FunnelBlockEntity.java・FunnelBlock'),
  'TP-BLOCK-FUNNEL-EXTRACT': tp('logistics/funnel/FunnelBlockEntity.java の activeExtract'),
  'TP-BLOCK-ARM': tp('kinetics/mechanicalArm/ArmBlockEntity.java の InteractionPoints'),
  'TP-BLOCK-INVENTORY': tpApp('このアプリの仮定（ほかのブロックは入れ物）'),
  'TP-BLOCK-BLAZE-BURNER': tp('processing/burner/BlazeBurnerBlock・BlazeBurnerBlockEntity（燃料）'),
  'TP-BLOCK-UNKNOWN': tpApp('このアプリの仮定（表にないブロック）'),
  // 物の動き
  'TP-MOTION-SHAPE': tpApp('このアプリの表示（道の形）'),
  'TP-MOTION-WAIT': tpApp('このアプリの表示（処理の間とどまる）'),
  'TP-MOTION-INSTANT': tpApp('このアプリの表示（時間 0 の受け渡し）'),
  'TP-MOTION-INVENTORY': tpApp('このアプリの表示（入れ物の中は描かない）'),
  'TP-MOTION-THROWN': tp('Minecraft の ItemEntity.tick（重力 0.04、空気抵抗 0.98）'),
  'TP-MOTION-STOPPED': tp('kinetics/base/KineticBlockEntity の getSpeed（回転数 0 で動かない）'),
  'TP-MOTION-FUNNEL-INSERT': tp('logistics/funnel/FunnelBlockEntity.java'),
  'TP-MOTION-FUNNEL-EXTRACT': tp('logistics/funnel/FunnelBlockEntity.java（defaultExtractionTimer）'),
  'TP-MOTION-BELT-FUNNEL': tp('kinetics/belt/transport/BeltFunnelInteractionHandler.java の funnelEntry'),
  'TP-MOTION-CHUTE': tp('logistics/chute/ChuteBlockEntity.java の getItemMotion・getExtractionAmount、SmartChuteBlockEntity'),
  'TP-MOTION-ARM': tp('kinetics/mechanicalArm/ArmBlockEntity.java の chasedPointProgress'),
  'TP-MOTION-DEPOT': tp('logistics/depot/DepotBehaviour.java'),
  'TP-MOTION-BELT-MACHINE': tp('kinetics/belt/behaviour/BeltProcessingBehaviour.java'),
  'TP-MOTION-MILLSTONE': tp('kinetics/millstone/MillstoneBlockEntity.java'),
  'TP-MOTION-CRUSHING': tp('kinetics/crusher/CrushingWheelControllerBlockEntity.java'),
  'TP-MOTION-SAW': tp('kinetics/saw/SawBlockEntity.java（出す動き）'),
  'TP-MOTION-BASIN': tp('processing/basin/BasinBlockEntity.java'),
  // 足すブロック
  'TP-EJECTOR': tp('logistics/depot/EjectorBlockEntity.java の getWindUpSpeed・tick、EntityLauncher.java'),
  'TP-ANDESITE-TUNNEL': tp('kinetics/belt/transport/BeltTunnelInteractionHandler.java の flapTunnelsAndCheckIfStuck'),
  'TP-BRASS-TUNNEL': tp('logistics/tunnel/BrassTunnelBlockEntity.java の SelectionMode・distributionProgress'),
  'TP-HOPPER': tp('Minecraft の HopperBlockEntity（8 tick の間隔）'),
  'TP-FAN': tp('kinetics/fan/AirCurrent.java・IAirCurrentSource.java・processing/FanProcessing.java'),
  'TP-SPOUT': tp('fluids/spout/SpoutBlockEntity.java、kinetics/belt/behaviour/BeltProcessingBehaviour.java'),
  'TP-ITEM-DRAIN': tp('fluids/drain/ItemDrainBlockEntity.java の itemMovementPerTick・FILLING_TIME'),
  'TP-CRAFTER': tp('kinetics/crafter/MechanicalCrafterBlockEntity.java の Phase・getCountDownSpeed'),
  // 律速
  'TP-BOTTLENECK-USAGE': tpApp('このアプリの計算（使用率、#168）'),
  'TP-BOTTLENECK-CHOOSE': tpApp('このアプリの計算（律速の選び方）'),
  'TP-BOTTLENECK-IO': tpApp('このアプリの計算（入る数・出る数）'),
  'TP-BOTTLENECK-HEADROOM': tpApp('このアプリの計算（増やせる数）'),
  'TP-BOTTLENECK-OVER': tpApp('このアプリの計算（追いつかないとき）'),
  'TP-BOTTLENECK-MACHINES': tpApp('このアプリの計算（律速に入れる機械）'),
  'TP-BOTTLENECK-NO-PACK': tpApp('このアプリの仮定（Modpack なし）'),
  'TP-BOTTLENECK-NONE': tpApp('このアプリの計算（処理する機械がないとき）'),
  'TP-BOTTLENECK-OUTPUT': tpApp('このアプリの表示（生産ライン、#168）'),

  // 回転・反転（create-stress.md「回転・反転」）
  'TF-ORDER': stress('Minecraft の StructureTemplate.placeInWorld（state.mirror(m).rotate(r)）'),
  'TF-VANILLA': stress('Minecraft の RotatedPillarBlock・DirectionalBlock・HorizontalDirectionalBlock・PipeBlock の rotate・mirror'),
  'TF-AXIS-ALONG-FIRST': stress('content/kinetics/base/DirectionalAxisKineticBlock.java の rotate・mirror'),
  'TF-SAW-FLIPPED': stress('content/kinetics/saw/SawBlock.java の rotate・mirror'),
  'TF-HORIZONTAL-AXIS': stress('content/logistics/vault/ItemVaultBlock.java・content/logistics/tunnel/BeltTunnelBlock.java の rotate'),
  'TF-BELT-VERTICAL': stress('content/kinetics/belt/BeltBlock.java の rotate'),
  'TF-ENCASED-COG-SHAFTS': stress('content/kinetics/simpleRelays/encased/EncasedCogwheelBlock.java の swapShaftsForRotation・mirror'),
  'TF-CHAIN-DRIVE': stress('content/kinetics/transmission/ChainDriveBlock.java（0.5.1 は relays/encased）の rotate・getConnectionAxis'),
  'TF-TANK-WINDOW': stress('content/fluids/tank/FluidTankBlock.java の rotateOnce・mirror'),
  'TF-CHASSIS-STICKY': stress('content/contraptions/chassis/LinearChassisBlock.java・RadialChassisBlock.java の rotate・mirror'),
  'TF-CONTROLLER-RAIL': stress('content/redstone/rail/ControllerRailBlock.java の rotate・mirror・getPointingTowards'),
  'TF-UNHANDLED': app('このアプリの決めごと（Create 独自の規則を写さないブロック）'),
  'TF-NBT-ARM': stress('content/kinetics/mechanicalArm/ArmBlockEntity.java の transform'),
  'TF-NBT-DISPLAY-LINK': stress('content/redstone/displayLink/DisplayLinkBlockEntity.java の transform（6.0）'),
  'TF-NBT-CRAFTER': stress('content/kinetics/crafter/MechanicalCrafterBlockEntity.java の transform（6.0）'),
  'TF-NBT-CHAIN-CONVEYOR': stress('content/kinetics/chainConveyor/ChainConveyorBlockEntity.java の transform（6.0）'),
  'TF-NBT-BELT-CONTROLLER': stress('content/kinetics/belt/item/BeltConnectorItem.java の createBelts（スキーマティキャノンがベルトを組み直す）'),
  'TF-NBT-CONTROLLER': stress('content/fluids/tank/FluidTankBlockEntity.java・content/logistics/vault/ItemVaultBlockEntity.java（置くときにコントローラーを決め直す）'),
  'TF-NBT-SOURCE': stress('content/kinetics/base/KineticBlockEntity.java（Source は置いたあとに決め直す）'),
  'TF-NBT-ENGINE-POS': stress('content/kinetics/steamEngine/PoweredShaftBlockEntity.java（エンジンが毎 tick 入れ直す）'),
  'TF-NBT-POS-FORM': stress('Minecraft の NbtUtils.writeBlockPos（1.20.5 から int 配列）'),
  'TF-NBT-OUTSIDE': app('このアプリの決めごと（範囲の外を指す位置の警告）'),
  'TF-NBT-UNHANDLED': app('このアプリの決めごと（書き直さない位置の項目）'),

  // 置き方・初期状態（create-stress.md「置き方・初期状態」）
  'PL-COG-NEXT-TO-LARGE': stress('content/kinetics/simpleRelays/CogWheelBlock.java の isValidCogwheelPosition'),
  'PL-COG-LARGE-NEXT-TO-SMALL': stress('content/kinetics/simpleRelays/CogWheelBlock.java の isValidCogwheelPosition'),
  'PL-COG-EXEMPT': stress('content/kinetics/simpleRelays/CogWheelBlock.java の isValidCogwheelPosition'),
  'PL-ORIENT-LINK': app('このアプリの決めごと（置くときの向き、#119）'),
  'PL-ORIENT-FROM': app('このアプリの決めごと（クリックした面を優先、#119）'),
  'PL-ORIENT-KEEP': app('このアプリの決めごと（向きを変えないとき、#119）'),
  'PL-ORIENT-VALID': app('このアプリの決めごと（置けない向きを外す、#121）'),
  'PL-HELPER-ORDER': stress('foundation/placement/IPlacementHelper.java（6.0 は catnip）の orderedByDistance'),
  'PL-HELPER-SMALL': stress('content/kinetics/simpleRelays/CogwheelBlockItem.java の SmallCogHelper'),
  'PL-HELPER-LARGE': stress('content/kinetics/simpleRelays/CogwheelBlockItem.java の LargeCogHelper'),
  'PL-HELPER-MIXED': stress('content/kinetics/simpleRelays/CogwheelBlockItem.java の DiagonalCogHelper'),
  'PL-HELPER-SKIP': stress('content/kinetics/simpleRelays/CogwheelBlockItem.java（hitOnShaft・getMatchingPredicate）'),
  'PL-DEFAULT-FILL': app('このアプリの決めごと（足りない状態を補う、#149）'),
  'PL-DEFAULT-KEEP': app('このアプリの決めごと（書いた値は変えない、#149）'),
  'PL-DEFAULT-PROBLEM': app('このアプリの決めごと（補えないとき、#149）'),
  'PL-DEFAULT-SCOPE': app('このアプリの決めごと（補うブロック、#149）'),
  'PL-BASIC-BLOCKS': app('このアプリの決めごと（基本の部品、#162）'),
}
