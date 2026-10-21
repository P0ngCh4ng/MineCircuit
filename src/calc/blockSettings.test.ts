import { describe, expect, it } from 'vitest'
import { blueprintFixture, state } from '../../tests/fixtures/blueprintFixture'
import { nbt } from '../domain/nbt'
import type { Vec3 } from '../domain/vec3'
import { setBlockEntityTag } from '../edit/editCommand'
import { EditHistory } from '../edit/editHistory'
import { blockSettingsFor, parseSettingInput, settingTag, settingValue } from './blockSettings'
import { runCreateStress } from './create/createStressPlugin'

describe('blockSettingsFor（変えられる設定の説明）', () => {
  it('クリエイティブモーターと速度コントローラーは ScrollValue（−256〜256、初期値 16）', () => {
    for (const id of ['create:creative_motor', 'create:rotation_speed_controller']) {
      const s = blockSettingsFor(state(id))
      expect(s?.fields.map((f) => [f.key, f.min, f.max, f.defaultValue, f.unit])).toEqual([['ScrollValue', -256, 256, 16, 'RPM']])
    }
    expect(blockSettingsFor(state('create:creative_motor'))?.fields[0].label).toBe('回転数')
    expect(blockSettingsFor(state('create:creative_motor'))?.initialBlockEntity()).toEqual(
      nbt.compound({ id: nbt.string('create:motor') }),
    )
  })

  it('ゲームが決め直す値しかないブロックや、Create 以外のブロックは null', () => {
    expect(blockSettingsFor(state('create:water_wheel'))).toBeNull()
    expect(blockSettingsFor(state('create:shaft'))).toBeNull()
    expect(blockSettingsFor(state('minecraft:creative_motor'))).toBeNull()
    expect(blockSettingsFor(state('create:constructor'))).toBeNull()
  })

  it('入力は整数で範囲の中だけを受け付ける', () => {
    const field = blockSettingsFor(state('create:creative_motor'))!.fields[0]
    expect(parseSettingInput(field, ' 64 ')).toEqual({ value: 64 })
    expect(parseSettingInput(field, '-256')).toEqual({ value: -256 })
    expect(parseSettingInput(field, '+8')).toEqual({ value: 8 })
    expect(parseSettingInput(field, '257')).toEqual({ error: '回転数は -256〜256 の範囲で入れてください。' })
    expect(parseSettingInput(field, '1.5')).toEqual({ error: '回転数は整数で入れてください（-256〜256）。' })
    expect(parseSettingInput(field, '')).toHaveProperty('error')
    expect(settingTag(field, 64)).toEqual(nbt.int(64))
  })

  it('今の値は生データにあれば設計図、なければ内蔵の初期値', () => {
    const field = blockSettingsFor(state('create:creative_motor'))!.fields[0]
    expect(settingValue(field, null)).toEqual({ value: 16, source: 'builtin' })
    expect(settingValue(field, nbt.compound({ ScrollValue: nbt.int(-32) }))).toEqual({ value: -32, source: 'blueprint' })
  })
})

describe('設定を変えると計算が変わる', () => {
  const MOTOR: Vec3 = [0, 0, 0]

  async function pressProbe(bp: Parameters<typeof runCreateStress>[0]) {
    const result = await runCreateStress(bp, { pack: null, ports: [] })
    return result.probes?.find((p) => p.pos.join() === '1,0,0')?.values[0].value
  }

  it('アプリで置いたモーター（生データなし）を 64 RPM にすると、回転数と出どころが変わり、元に戻すと戻る', async () => {
    const bp = blueprintFixture({ size: [2, 1, 1] })
      .place([0, 0, 0], 'create:creative_motor', { facing: 'east' })
      .place([1, 0, 0], 'create:mechanical_press', { facing: 'east' })
      .toBlueprint()
    const history = new EditHistory(bp)
    const motorSettings = blockSettingsFor(bp.get(MOTOR)!)!
    const field = motorSettings.fields[0]

    expect(await pressProbe(bp)).toEqual({ value: '16 RPM', source: 'builtin' })

    history.apply(setBlockEntityTag(bp, MOTOR, field.key, settingTag(field, 64), motorSettings.initialBlockEntity())!)
    expect(await pressProbe(bp)).toEqual({ value: '64 RPM', source: 'blueprint' })
    expect(settingValue(field, bp.blockEntityAt(MOTOR))).toEqual({ value: 64, source: 'blueprint' })

    history.undo()
    expect(bp.blockEntityAt(MOTOR)).toBeNull()
    expect(await pressProbe(bp)).toEqual({ value: '16 RPM', source: 'builtin' })

    history.redo()
    expect(await pressProbe(bp)).toEqual({ value: '64 RPM', source: 'blueprint' })
  })
})
