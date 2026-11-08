// 物の流れの印の色（#231）。物の ID から決める。同じ物はいつも同じ色、違う物はたいてい違う色になる。

/** 物の ID の色 */
export function itemDotColor(item: string): string {
  let hash = 0
  for (let i = 0; i < item.length; i++) hash = (hash * 31 + item.charCodeAt(i)) % 3600
  return `hsl(${hash / 10}, 90%, 60%)`
}
