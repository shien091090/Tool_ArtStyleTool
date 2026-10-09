/** 自訂色票編輯區: 色塊編輯、貼 Lospec 網址或色碼、從參考圖吸色。 */
import { api } from '../api';
import { isLospecUrl, paletteFromImageFile, parseHexList } from '../paletteTools';
import { el } from './ui';

export interface PaletteEditor {
  element: HTMLElement;
  setColors(colors: string[]): void;
}

export function createPaletteEditor(
  onChange: (colors: string[]) => void,
  limits: { min?: number; max?: number } = {},
): PaletteEditor {
  const min = limits.min ?? 0;
  const max = limits.max ?? 256;
  let colors: string[] = [];

  const swatches = el('div', { className: 'pal-swatches' });
  const message = el('div', { className: 'pal-msg' });
  const say = (text: string, error = false) => {
    message.textContent = text;
    message.classList.toggle('error-text', error);
  };
  const commit = (next: string[]) => {
    if (next.length < min) { say(`至少要 ${min} 色`, true); return; }
    if (next.length > max) say(`最多 ${max} 色, 只保留前 ${max} 色`);
    colors = next.slice(0, max);
    renderSwatches();
    onChange([...colors]);
  };

  function renderSwatches() {
    swatches.replaceChildren();
    colors.forEach((hex, i) => {
      const picker = el('input');
      picker.type = 'color';
      picker.value = hex;
      picker.title = hex;
      picker.addEventListener('input', () => {
        colors[i] = picker.value;
        picker.title = picker.value;
        onChange([...colors]);
      });
      const del = el('button', { text: '×', className: 'pal-del', title: '刪除這個顏色' });
      del.disabled = colors.length <= min;
      del.addEventListener('click', () => commit(colors.filter((_, j) => j !== i)));
      swatches.append(el('div', { className: 'pal-swatch' }, [picker, del]));
    });
    const add = el('button', { text: '+', className: 'pal-add', title: '新增一個顏色' });
    add.addEventListener('click', () => commit([...colors, colors.at(-1) ?? '#808080']));
    if (colors.length < max) swatches.append(add);
    if (!colors.length) say('色票是空的, 會沿用原圖顏色');
  }

  // 貼 Lospec 網址或色碼
  const pasteInput = el('input');
  pasteInput.placeholder = 'Lospec 網址或色碼';
  const pasteBtn = el('button', { text: '套用' });
  pasteBtn.addEventListener('click', async () => {
    const text = pasteInput.value.trim();
    if (!text) return;
    if (isLospecUrl(text)) {
      pasteBtn.disabled = true;
      say('從 Lospec 抓取中…');
      try {
        const pal = await api.lospec(text);
        commit(pal.colors);
        say(`已套用「${pal.name}」(${pal.colors.length} 色)`);
        pasteInput.value = '';
      } catch (e) {
        say((e as Error).message, true);
      } finally {
        pasteBtn.disabled = false;
      }
      return;
    }
    const parsed = parseHexList(text);
    if (!parsed.length) { say('找不到色碼, 請貼 6 碼色碼(例如 be4a2f 或 #be4a2f)或 Lospec 色票網址', true); return; }
    commit(parsed);
    say(`已套用 ${parsed.length} 色`);
    pasteInput.value = '';
  });

  // 從參考圖吸色
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';
  const countInput = el('input');
  countInput.type = 'number';
  countInput.min = '2';
  countInput.max = '32';
  countInput.value = '8';
  const pickBtn = el('button', { text: '從參考圖吸色' });
  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const count = Math.min(32, Math.max(2, Math.round(Number(countInput.value) || 8)));
    try {
      const pal = await paletteFromImageFile(file, count);
      commit(pal);
      say(`從「${file.name}」抽出 ${pal.length} 色`);
    } catch {
      say('這個檔案讀不出圖片', true);
    }
  });

  const element = el('div', { className: 'pal-editor' }, [
    swatches,
    el('div', { className: 'pal-row' }, [pasteInput, pasteBtn]),
    el('div', { className: 'pal-row' }, [pickBtn, el('label', {}, ['色數', countInput]), fileInput]),
    message,
  ]);

  return {
    element,
    setColors(next) {
      colors = [...next];
      say('');
      renderSwatches();
    },
  };
}
