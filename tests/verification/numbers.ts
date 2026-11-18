// 数値の一覧（docs/verification.md「5. 数値」）。src/calc/create/ のテスト以外のファイルにある数を、
// それを含む宣言（`ファイル名#宣言の名前`）ごとに、種類で分けて持つ。0・1・配列の添字は数えない。
// numbers.test.ts が、コードの数とこの一覧が一致することを調べる。

/** game：Create・Minecraft のソースから読んだ値、app：このアプリが決めた値、math：規則によらない値 */
export type NumberKind = 'game' | 'app' | 'math'

export interface NumberGroup {
  readonly kind: NumberKind
  readonly values: readonly number[]
  /** 規則 ID（tests/verification/rules.ts）。game は1つ以上 */
  readonly rules: readonly string[]
  /** app・math は理由。game は補足（なくてよい） */
  readonly note: string
}

function game(values: readonly number[], rules: readonly string[], note = ''): NumberGroup {
  return { kind: 'game', values, rules, note }
}

function app(values: readonly number[], note: string, rules: readonly string[] = []): NumberGroup {
  return { kind: 'app', values, rules, note }
}

function math(values: readonly number[], note: string): NumberGroup {
  return { kind: 'math', values, rules: [], note }
}

const PER_MINUTE = '1分 = 60 秒'
const PERCENT = '百分率'
const CENTER = 'ブロックの真ん中（座標 + 0.5）'
const TOLERANCE = '浮動小数の誤差の許し'

export const NUMBERS: Readonly<Record<string, readonly NumberGroup[]>> = {
  // 初期値（createDefaults.ts）
  'createDefaults.ts#DEFAULT_IMPACT': [game([8, 8, ...Array<number>(16).fill(4), 2, 2, 2, 2], ['ST-IMPACT'])],
  'createDefaults.ts#DEFAULT_CAPACITY': [game([16384, 32, 128, 512, 8, 8, 1024], ['ST-CAPACITY', 'ST-CAPACITY-VALVE-HANDLE'])],
  'createDefaults.ts#DEFAULT_KINETICS': [
    game([256], ['ST-STEP-MAX-SPEED'], 'maxRotationSpeed'),
    game([30, 100], ['ST-MIN-SPEED'], 'mediumSpeed・fastSpeed'),
    game([8, 8], ['ST-RUN-WINDMILL-SAILS', 'ST-RUN-WINDMILL-SPEED'], 'minimumWindmillSails・windmillSailsPerRPM'),
  ],
  'createDefaults.ts#PASSIVE_ENGINE_EFFICIENCY': [game([8], ['ST-RUN-BOILER-EFFICIENCY'])],
  'createDefaults.ts#MAX_BOILER_LEVEL': [game([18], ['ST-RUN-BOILER-LEVEL', 'ST-RUN-BOILER-WATER'])],
  'createDefaults.ts#DEFAULT_SCROLL_SPEED': [game([16], ['ST-SETTING-SCROLL'])],
  'createDefaults.ts#WATER_WHEEL_SPEED': [game([8], ['ST-SOURCE-WATER-WHEEL'])],
  'createDefaults.ts#HAND_CRANK_SPEED': [game([32], ['ST-SOURCE-CRANK'])],
  'createDefaults.ts#STEAM_ENGINE_BASE_SPEED': [game([16], ['ST-SOURCE-STEAM-ENGINE'])],
  'createDefaults.ts#DEFAULT_LOGISTICS': [game([8], ['TP-CONFIG', 'TP-FUNNEL-RATE'], 'defaultExtractionTimer')],

  // 回転のつながりと応力（kineticGraph.ts・kineticBlocks.ts・createRunning.ts）
  'kineticGraph.ts#SPEED_TOLERANCE': [app([65536], '回転数の比の相対誤差の許し（1/65536）', ['ST-STEP-RATIOS'])],
  'kineticGraph.ts#HIGH_STRESS_USAGE': [app([0.9], '応力の使用率がこれを超えたら警告する（#159）', ['ST-RESULT-ISSUES'])],
  'kineticGraph.ts#NEIGHBOR_OFFSETS': [math([2], '斜めの隣は差の2乗の和が 2')],
  'kineticGraph.ts#chainModifier': [game([16], ['ST-LINK-CHAIN'], '可変チェーンギアシフトの倍率 1 + (Signal + 1) / 16')],
  'kineticGraph.ts#KineticGraph.evaluate': [math([100], PERCENT)],
  'kineticGraph.ts#formatNumber': [app([2], '画面に出す小数の桁')],
  'kineticGraph.ts#connection': [
    math([3, 2], '軸の番号（0・1・2）の残りの1つ'),
    game([2, 0.5], ['ST-LINK-LARGE-SMALL'], '大きい歯車と小さい歯車の比 −2・−1/2'),
  ],
  'kineticGraph.ts#chainConveyorConnections': [math([3], '位置は数が3つ')],
  'kineticGraph.ts#makeSource': [game([2], ['ST-SOURCE-WATER-WHEEL'], '大きい水車は1段で2倍の大きさ')],
  'kineticGraph.ts#steamSource': [game([4, 2, 4], ['ST-SOURCE-STEAM-ENGINE'], '効率から回転数の段階を決める式')],
  'kineticBlocks.ts#axisIndex': [math([2, 2], '軸の番号（x・y・z = 0・1・2）')],
  'createRunning.ts#heatOf': [game([2], ['ST-RUN-BOILER-HEAT'], '燃料ありのブレイズバーナーの熱')],
  'createRunning.ts#runningSteamEngines': [
    game([4], ['ST-RUN-BOILER-LEVEL'], '大きさの段階 floor(大きさ / 4)'),
    game([2, 2, 2], ['ST-RUN-STEAM-SHAFT'], '蒸気エンジンが回すシャフトは2つ先'),
  ],
  'createRunning.ts#doubles': [math([3], '位置は数が3つ')],
  'createRunning.ts#boxContains': [math([2], '軸の番号（0・1・2）'), math([0.5, 0.5], CENTER)],
  'createRunning.ts#runningWindmillSpeed': [game([16], ['ST-RUN-WINDMILL-SPEED'], '風車の回転数の上限')],

  // 計算プラグイン（createStressPlugin.ts）
  'createStressPlugin.ts#createStressPlugin': [
    app([16, 256, 256, 4096], '仮の動力源の初期値と入力の範囲（範囲は maxRotationSpeed の初期値に合わせる）', ['ST-PORT-SOURCE']),
    app([256, 4], '仮の負荷の初期値', ['ST-PORT-LOAD']),
  ],
  'createStressPlugin.ts#LISTED': [app([8], '仮定の一覧に1つずつ出す数。残りはまとめて数だけ出す')],

  // 輸送量と処理時間（createThroughput.ts）
  'createThroughput.ts#TICKS_PER_SECOND': [game([20], ['TP-BELT-RATE'], 'Minecraft の1秒の tick 数')],
  'createThroughput.ts#STACK_SIZE': [game([64], ['TP-PATH-BATCH'], 'Minecraft の1つの山の最大の個数')],
  'createThroughput.ts#CHUTE_GRAVITY_SPEED': [game([4], ['TP-CHUTE-RATE'])],
  'createThroughput.ts#PRESS_CYCLE': [game([240], ['TP-PRESS-TIME'])],
  'createThroughput.ts#MIXER_MOVE_TICKS': [game([20], ['TP-MIXER-TIME'])],
  'createThroughput.ts#DEPLOYER_EXTEND': [game([1000], ['TP-DEPLOYER-TIME'])],
  'createThroughput.ts#DEPLOYER_WAIT': [game([500], ['TP-DEPLOYER-TIME'])],
  'createThroughput.ts#ARM_MOVE': [game([1024], ['TP-ARM-RATE'])],
  'createThroughput.ts#DEFAULT_RECIPE_DURATION': [game([100, 100, 50, 100], ['TP-RECIPE-FALLBACK'])],
  'createThroughput.ts#beltSpeed': [game([24], ['TP-BELT-RATE'])],
  'createThroughput.ts#armRoundTripTicks': [game([4], ['TP-ARM-RATE'])],
  'createThroughput.ts#armMoveTicks': [game([256], ['TP-ARM-RATE'])],
  'createThroughput.ts#pressTickSpeed': [game([60, 512], ['TP-PRESS-TIME'])],
  'createThroughput.ts#mixerMixingTicks': [game([100, 512, 15, 512], ['TP-MIXER-TIME'])],
  'createThroughput.ts#millstoneTicks': [game([16, 512], ['TP-MILLSTONE-TIME'])],
  'createThroughput.ts#crushingTicks': [game([50, 4, 0.25, 20, 0.25, 20, 20], ['TP-CRUSHING-TIME'])],
  'createThroughput.ts#sawTicks': [game([24, 128, 5, 5, 20], ['TP-SAW-TIME'])],
  'createThroughput.ts#deployerCycleTicks': [game([2, 8, 512, 2], ['TP-DEPLOYER-TIME'])],
  'createThroughput.ts#effectiveDuration': [game([100], ['TP-MIXER-TIME'], 'ミキサーの時間が 0 以下のレシピは 100 として扱う')],
  'createThroughput.ts#kineticThroughputValues': [game([2, 2], ['TP-MIXER-TIME'], 'ミキサーのレシピは2つ下のバサンの中身で決まる')],
  'createThroughput.ts#perMinuteOf': [math([60], PER_MINUTE)],
  'createThroughput.ts#formatRate': [app([10], '10 以上は整数に丸めて出す（見た目）')],
  'createThroughput.ts#ceil': [app([1e-9], TOLERANCE)],

  // 物の通り道（createItemPath.ts・fanCurrent.ts・itemFilter.ts・mechanicalCrafter.ts・spoutDrain.ts）
  'createItemPath.ts#MAX_PATH_STEPS': [app([256], 'たどる場所の数の上限（止まらない道を打ち切る）', ['TP-PATH-LOOP'])],
  'createItemPath.ts#FALL_DEPTH': [app([3], '空気の先へ落ちる物を探す深さ', ['TP-MOTION-THROWN'])],
  'createItemPath.ts#EPSILON': [app([1e-9], 'これより少ない数は届かないものとする（確率を掛けて小さくなった数など）')],
  'createItemPath.ts#lineFlow': [math([60, 60, 60], PER_MINUTE), app([1e-9], TOLERANCE, ['TP-BOTTLENECK-CHOOSE'])],
  'createItemPath.ts#lineSummary': [math([100], PERCENT), app([1e-9], TOLERANCE, ['TP-BOTTLENECK-OVER'])],
  'createItemPath.ts#bottleneckValue': [math([100], PERCENT), app([1e-9], TOLERANCE, ['TP-BOTTLENECK-OVER'])],
  'createItemPath.ts#ItemTracer.result': [math([60], PER_MINUTE), app([1e-9], TOLERANCE, ['TP-PATH-OVERFLOW'])],
  'createItemPath.ts#ItemTracer.ejector': [math([0.5], 'イジェクターの上の面（座標 + 0.5）')],
  'createItemPath.ts#ItemTracer.processAbove': [game([2], ['TP-BLOCK-BELT-MACHINE'], 'ベルト・デポの2段上の機械')],
  'createItemPath.ts#ItemTracer.saw': [math([0.5], 'ソーの上の面（座標 + 0.5）')],
  'createItemPath.ts#ItemTracer.basin': [game([2], ['TP-BLOCK-BASIN'], 'バサンの2段上のミキサー・プレス')],
  'createItemPath.ts#ItemTracer.deployerHand': [game([2, 2, 2], ['TP-BLOCK-DEPLOYER-HAND'], 'デプロイヤーの手は2つ先')],
  'createItemPath.ts#ItemTracer.process': [math([60], PER_MINUTE)],
  'createItemPath.ts#FAN_PROCESSING_TICKS': [game([151], ['TP-FAN-RECIPE'])],
  'createItemPath.ts#BRASS_TUNNEL_TICKS': [game([10], ['TP-BRASS-TUNNEL'])],
  'createItemPath.ts#MAX_TUNNEL_GROUP': [app([8], '真鍮のトンネルの組を探す、横の数の上限', ['TP-BRASS-TUNNEL'])],
  'createItemPath.ts#PREFER_NEAREST': [game([4], ['TP-BRASS-TUNNEL'], '分け方「近い方」の ScrollValue')],
  'createItemPath.ts#DRAIN_SPEED': [game([8], ['TP-ITEM-DRAIN'])],
  'createItemPath.ts#HOPPER_TICKS': [game([8], ['TP-HOPPER'])],
  'createItemPath.ts#CHUTE_DROP_VY': [game([0.25], ['TP-MOTION-CHUTE'])],
  'createItemPath.ts#SAW_THROW_VY': [game([0.125], ['TP-MOTION-SAW'])],
  'createItemPath.ts#ARM_ARC_HEIGHT': [app([1.5], '機械アームが運ぶ弧の高さ（見た目）', ['TP-MOTION-ARM'])],
  'fanCurrent.ts#FAN_DISTANCE': [game([20], ['TP-FAN'])],
  'fanCurrent.ts#FAN_ROTATION_ARGMAX': [game([256], ['TP-FAN'])],
  'fanCurrent.ts#fanMaxDistance': [game([3, 3], ['TP-FAN'], '風の届く距離の下限')],
  'itemFilter.ts#MAX_DEPTH': [app([4], 'フィルターの中のフィルターを読む深さの上限', ['TP-FILTER'])],
  'mechanicalCrafter.ts#crafterSpeed': [game([4, 250], ['TP-CRAFTER'])],
  'mechanicalCrafter.ts#crafterPassTicks': [game([1000], ['TP-CRAFTER', 'TP-MOTION-CRAFTER'])],
  'mechanicalCrafter.ts#crafterCraftTicks': [game([2000], ['TP-CRAFTER', 'TP-MOTION-CRAFTER'])],
  'spoutDrain.ts#FILLING_TICKS': [game([20], ['TP-SPOUT'])],
  'spoutDrain.ts#dripstoneFluid': [game([16], ['TP-SPOUT-FLUID'], '鍾乳石が液体を探す深さ')],

  // 物の動きの表示（itemMotion.ts）
  'itemMotion.ts#ITEM_GRAVITY': [game([0.04], ['TP-MOTION-THROWN'])],
  'itemMotion.ts#ITEM_DRAG': [game([0.98], ['TP-MOTION-THROWN'])],
  'itemMotion.ts#MAX_FALL_TICKS': [app([200], '落ちる動きを数える上限（tick）', ['TP-MOTION-THROWN'])],
  'itemMotion.ts#blockCenter': [math([0.5, 0.5, 0.5], CENTER)],
  'itemMotion.ts#arcPath': [app([12], '弧を描く点の数（見た目）', ['TP-MOTION-ARM']), math([2], '2次のベジェ曲線の係数')],
  'itemMotion.ts#ejectorPath': [
    game(
      [
        0.5, 8, 4, 2, 13, 0.015, 98, 25, 98, 2, 7, 2, 5, 2, 3, 4.87, 0.115, 0.0007, 0.5, 2, 0.484, 5, 5, 0.076, 0.0014, 0.5,
        10.6033, 0.91, 10.6033, 0.91, 0.98, 49.4983, 49.4983, 194.033, 3.92, 194.033, 3,
      ],
      ['TP-EJECTOR', 'TP-MOTION-THROWN'],
      'EntityLauncher の投げる道の式と、終わりに近いほど行き先へ寄せる補正',
    ),
  ],

  // 回転と反転・置き方（createTransform.ts・createPlacement.ts・createBeltConnector.ts）
  'createTransform.ts#rotateCreate': [math([2, 2, 2, 3, 2, 3], '90° 回す回数（奇数・180°・270°）')],
  'createTransform.ts#moveSticky': [math([7, 7], "'sticky_' の文字数")],
  'createTransform.ts#readPos': [math([3], '位置は数が3つ')],
  'createPlacement.ts#orderedByDistance': [math([0.5, 0.5, 0.5], CENTER)],
  'createPlacement.ts#hitOnShaft': [
    math([2, 3], '軸の番号（0・1・2）と、3つの軸'),
    app([0.001], TOLERANCE),
    game([5, 16, 11, 16], ['PL-HELPER-SKIP'], '歯車の真ん中の軸（5/16〜11/16）'),
  ],
  'createPlacement.ts#linkStrength': [app([2], '軸の口どうしでつながる強さ', ['PL-ORIENT-LINK'])],
  'createPlacement.ts#orientForPlacement': [app([4], 'クリックした面の側でつながるときに足す強さ', ['PL-ORIENT-FROM'])],
  'createBeltConnector.ts#DEFAULT_MAX_BELT_LENGTH': [game([20], ['PL-BELT-LENGTH'])],
  'createBeltConnector.ts#INT_ARRAY_POS_DATA_VERSION': [game([3837], ['TF-NBT-POS-FORM', 'PL-BELT-NBT'], 'Minecraft 1.20.5 のデータの版')],
  'createBeltConnector.ts#beltConnectionProblem': [math([2, 2, 2], '距離の2乗')],
  'createBeltConnector.ts#chainBetween': [app([1000], '止まらない輪を打ち切る数の上限')],
}
