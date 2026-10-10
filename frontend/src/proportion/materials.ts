/** 換材質的快捷選項。縮圖在 public/materials/<key>.png(由 backend/scripts/make_material_swatches.py 生成)。 */
export const MATERIALS: { key: string; label: string }[] = [
  { key: 'metal', label: '金屬' },
  { key: 'rusty_metal', label: '生鏽金屬' },
  { key: 'gold', label: '黃金' },
  { key: 'wood', label: '木頭' },
  { key: 'stone', label: '石頭' },
  { key: 'crystal', label: '水晶' },
  { key: 'ice', label: '冰' },
  { key: 'lava', label: '熔岩' },
  { key: 'scales', label: '鱗片' },
  { key: 'fur', label: '毛皮' },
  { key: 'feathers', label: '羽毛' },
  { key: 'leather', label: '皮革' },
  { key: 'cloth', label: '布料' },
  { key: 'ceramic', label: '陶瓷' },
  { key: 'moss', label: '苔蘚植物' },
];

export const swatchUrl = (key: string) => `/materials/${key}.png`;
