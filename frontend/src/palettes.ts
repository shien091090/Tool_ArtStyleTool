/** 預設色票。名稱是配方裡 color.preset 的值。 */
export const PRESET_PALETTES: Record<string, string[]> = {
  pico8: [
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  ],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  pastel: ['#fbf8cc', '#fde4cf', '#ffcfd2', '#f1c0e8', '#cfbaf0', '#a3c4f3', '#90dbf4', '#8eecf5'],
};

export const PRESET_LABELS: Record<string, string> = {
  pico8: 'PICO-8(16 色)',
  gameboy: 'Game Boy(4 色)',
  pastel: '粉彩(8 色)',
};
