/** fal.ai 每次呼叫的大約價錢(美元), 依 fal 公布的單價; 依算力計費的取常見耗時估算。 */
export const COST = {
  /** SAM 3 切部位: 每次 */
  segment: 0.005,
  /** Gemini 看圖(列部位、建議尺寸) */
  vision: 0.01,
  /** Nano Banana 改圖: 每張 */
  nanoBanana: 0.04,
  /** GPT Image 2 改圖(medium 畫質): 每張, 依實測 */
  gptImage: 0.06,
  /** Qwen 改圖: 每百萬像素, 送出的圖約 1 百萬像素 */
  qwen: 0.03,
  /** Marigold 深度: 依算力, 約 10 秒 */
  depth: 0.01,
  /** 線稿: 依算力, 約幾秒 */
  line: 0.01,
} as const;

/** 「約 X 美元」 */
export function usd(v: number): string {
  // 0.015 這種要三位小數才不會四捨五入成 0.01
  const fine = v < 0.01 || (v < 0.1 && Math.round(v * 1000) % 10 !== 0);
  return `約 ${fine ? v.toFixed(3) : v.toFixed(2)} 美元`;
}
