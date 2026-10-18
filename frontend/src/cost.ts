/** fal.ai 每次呼叫的大約價錢(美元), 依 fal 公布的單價; 依算力計費的取常見耗時估算。 */
export const COST = {
  /** SAM 3 切部位: 每次 */
  segment: 0.005,
  /** Gemini 看圖(列部位、建議尺寸) */
  vision: 0.01,
  /** Nano Banana 改圖: 每張 */
  nanoBanana: 0.04,
  /** Qwen 改圖: 每百萬像素, 送出的圖約 1 百萬像素 */
  qwen: 0.03,
  /** FLUX Kontext(AI 去光影): 每張 */
  kontext: 0.04,
  /** Marigold 深度: 依算力, 約 10 秒 */
  depth: 0.01,
  /** 線稿: 依算力, 約幾秒 */
  line: 0.01,
  /** BiRefNet 去背: 依算力, 約幾秒 */
  matte: 0.005,
} as const;

/** 「約 X 美元」 */
export function usd(v: number): string {
  return `約 ${v < 0.01 ? v.toFixed(3) : v.toFixed(2)} 美元`;
}
