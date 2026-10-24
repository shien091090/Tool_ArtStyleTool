/** 遊戲示意右側與左側面板: 物件屬性、背景、地面調色盤、新場景表單。 */
import { COST, usd } from '../cost';
import { KINDS, VIEW_LABEL, VIEWS, type ViewKey } from '../library/model';
import { costNote, el, markPaid, option } from '../pages/ui';
import { terrains, type MockObject, type Scene } from './model';

/** edit(fn): 存復原點 → fn 改場景 → 重畫並排程存檔 */
export type Edit = (fn: (s: Scene) => void, rebuild?: boolean) => void;

function row(label: string, input: HTMLElement): HTMLElement {
  return el('label', { className: 'mk-row' }, [el('span', { className: 'muted small', text: label }), input]);
}

function num(value: number, onSet: (v: number) => void, opts: { step?: number; min?: number } = {}): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.step = String(opts.step ?? 1);
  i.value = String(Math.round(value * 100) / 100);
  i.addEventListener('change', () => {
    const v = Number(i.value);
    if (!Number.isFinite(v) || (opts.min !== undefined && v < opts.min)) {
      i.value = String(Math.round(value * 100) / 100);
      return;
    }
    onSet(v);
  });
  return i;
}

function typeSelect(value: string | null, onSet: (v: string | null) => void): HTMLSelectElement {
  const sel = el('select');
  sel.append(option('', '不指定'), ...KINDS.map((k) => option(k, k)));
  sel.value = value ?? '';
  sel.addEventListener('change', () => onSet(sel.value || null));
  return sel;
}

function colorInput(value: string, onSet: (v: string) => void): HTMLInputElement {
  const c = el('input');
  c.type = 'color';
  c.value = value;
  c.addEventListener('change', () => onSet(c.value));
  return c;
}

/** 選到物件時的屬性面板 */
export function objectPanel(s: Scene, o: MockObject, edit: Edit, onDelete: () => void): HTMLElement {
  const find = (sc: Scene) => sc.objects.find((x) => x.id === o.id)!;
  const set = (fn: (x: MockObject) => void) => edit((sc) => fn(find(sc)));
  const rows: HTMLElement[] = [];
  if (o.kind === 'asset') {
    rows.push(el('b', { text: `素材: ${o.name}` }));
    rows.push(row('寬', num(o.w, (v) => edit((sc) => {
      const x = find(sc);
      if (x.kind !== 'asset') return;
      x.h = (x.h * v) / x.w;
      x.w = v;
    }, true), { min: 8 })));
    const flip = el('input');
    flip.type = 'checkbox';
    flip.checked = o.flip;
    flip.addEventListener('change', () => set((x) => {
      if (x.kind === 'asset') x.flip = flip.checked;
    }));
    rows.push(el('label', { className: 'mk-row' }, [flip, '左右翻轉']));
  } else {
    const label = el('textarea');
    label.rows = 2;
    label.value = o.label;
    label.addEventListener('change', () => {
      const v = label.value.trim();
      if (!v || v.length > 60) {
        label.value = o.label;
        return;
      }
      set((x) => {
        if (x.kind !== 'asset') x.label = v;
      });
    });
    rows.push(el('b', { text: o.kind === 'block' ? '立體灰盒' : '灰盒' }));
    rows.push(row('標籤(可換行)', label));
    rows.push(row('顏色', colorInput(o.color, (v) => set((x) => {
      if (x.kind !== 'asset') x.color = v;
    }))));
    rows.push(row('類型', typeSelect(o.type, (v) => set((x) => {
      if (x.kind !== 'asset') x.type = v;
    }))));
  }
  if (o.kind === 'block') {
    const f = (key: 'i' | 'j' | 'w' | 'l' | 'h', name: string, step: number, min?: number) =>
      row(name, num(o[key], (v) => set((x) => {
        if (x.kind === 'block') x[key] = v;
      }), { step, min }));
    rows.push(el('div', { className: 'mk-grid2' }, [f('i', '格 i', 0.5), f('j', '格 j', 0.5), f('w', '佔地寬(格)', 0.5, 0.1),
      f('l', '佔地深(格)', 0.5, 0.1), f('h', '高度(px)', 10, 1)]));
  } else {
    const f = (key: 'x' | 'y' | 'w' | 'h', min?: number) => row(key, num(o[key], (v) => edit((sc) => {
      const x = find(sc);
      if (x.kind !== 'block') {
        if (x.kind === 'asset' && (key === 'w' || key === 'h')) {
          const k = v / x[key];
          x.w *= k;
          x.h *= k;
        } else x[key] = v;
      }
    }, o.kind === 'asset'), { min }));
    rows.push(el('div', { className: 'mk-grid2' }, [f('x'), f('y'), f('w', 8), f('h', 8)]));
  }
  if (s.view !== 'iso') {
    const move = (text: string, to: (n: number, len: number) => number) => {
      const b = el('button', { text, className: 'small' });
      b.addEventListener('click', () => edit((sc) => {
        const n = sc.objects.findIndex((x) => x.id === o.id);
        const t = Math.max(0, Math.min(sc.objects.length - 1, to(n, sc.objects.length)));
        const [it] = sc.objects.splice(n, 1);
        sc.objects.splice(t, 0, it);
      }));
      return b;
    };
    rows.push(el('div', { className: 'mk-btns' }, [
      move('往前一層', (n) => n + 1), move('往後一層', (n) => n - 1), move('最前', (_n, len) => len - 1), move('最後', () => 0),
    ]));
  } else {
    rows.push(el('div', { className: 'muted small', text: '斜角俯瞰依腳底位置自動排前後' }));
  }
  const del = el('button', { text: '刪除(Delete)', className: 'danger' });
  del.addEventListener('click', onDelete);
  rows.push(del);
  return el('div', { className: 'mk-pad' }, rows);
}

/** 背景標籤與顏色 */
export function backgroundPanel(s: Scene, edit: Edit): HTMLElement {
  const label = el('input');
  label.value = s.background.label;
  label.addEventListener('change', () => {
    const v = label.value.trim();
    if (!v || v.length > 60) {
      label.value = s.background.label;
      return;
    }
    edit((sc) => {
      sc.background.label = v;
    });
  });
  return el('div', { className: 'mk-pad' }, [
    el('b', { text: '背景' }),
    row('標籤', label),
    row('顏色', colorInput(s.background.color, (v) => edit((sc) => {
      sc.background.color = v;
    }))),
  ]);
}

/** 風格設定與「AI 畫整張」 */
export function stylePanel(s: Scene, edit: Edit, opts: {
  count: number;
  busy: boolean;
  refUrl(aid: string): string;
  onCount(n: number): void;
  addRef(): void;
  render(): void;
}): HTMLElement {
  const genre = el('input');
  genre.value = s.style.genre;
  genre.addEventListener('change', () => edit((sc) => {
    sc.style.genre = genre.value.trim();
  }));
  const text = el('textarea');
  text.rows = 3;
  text.placeholder = '例: 16-bit 像素風、手繪水彩、低多邊形…(可空)';
  text.value = s.style.text;
  text.addEventListener('change', () => edit((sc) => {
    sc.style.text = text.value;
  }));
  const refs = s.style.refs.map((aid) => {
    const img = el('img');
    img.src = opts.refUrl(aid);
    const x = el('button', { text: '×', className: 'mk-ref-x', title: '移除這張參考圖' });
    x.addEventListener('click', () => edit((sc) => {
      sc.style.refs = sc.style.refs.filter((r) => r !== aid);
    }, true));
    return el('div', { className: 'mk-ref checker' }, [img, x]);
  });
  const addRef = el('button', { text: '+ 參考圖', className: 'small' });
  addRef.disabled = s.style.refs.length >= 4;
  addRef.addEventListener('click', opts.addRef);
  const count = el('select');
  count.append(...[1, 2, 3, 4].map((n) => option(String(n), `${n} 張`)));
  count.value = String(opts.count);
  const note = costNote(usd(opts.count * COST.gptImage));
  count.addEventListener('change', () => opts.onCount(Number(count.value)));
  const go = markPaid(el('button', { text: opts.busy ? 'AI 畫圖中…' : 'AI 畫整張' }));
  go.disabled = opts.busy;
  go.addEventListener('click', opts.render);
  return el('div', { className: 'mk-pad' }, [
    el('b', { text: '風格' }),
    row('遊戲類型描述(給 AI 看, 英文較準)', genre),
    row('風格描述', text),
    el('div', { className: 'muted small', text: '參考圖(最多 4 張, 只參考畫風)' }),
    el('div', { className: 'mk-refs' }, [...refs, addRef]),
    el('div', { className: 'mk-btns' }, [count, go, note]),
  ]);
}

/** 左側地面調色盤: 內建 + 自訂地形、橡皮擦、全部填滿; 平面架構可開關棋盤格 */
export function groundPanel(s: Scene, brush: string | null, onBrush: (b: string | null) => void, edit: Edit): HTMLElement {
  const items: HTMLElement[] = [el('b', { text: '地面' })];
  if (s.view === 'flat') {
    const on = el('input');
    on.type = 'checkbox';
    on.checked = !!s.ground;
    on.addEventListener('change', () => edit((sc) => {
      sc.ground = on.checked ? { cols: 8, rows: 8, cells: Array(64).fill(null), custom: [] } : null;
    }, true));
    items.push(el('label', { className: 'mk-row' }, [on, '棋盤格']));
    if (s.ground) {
      const resize = (cols: number, rows: number) => edit((sc) => {
        const g = sc.ground!;
        const cells: (string | null)[] = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(c < g.cols && r < g.rows ? g.cells[r * g.cols + c] : null);
        sc.ground = { ...g, cols, rows, cells };
      }, true);
      items.push(el('div', { className: 'mk-grid2' }, [
        row('行數', num(s.ground.cols, (v) => resize(Math.round(Math.min(20, Math.max(2, v))), s.ground!.rows), { min: 2 })),
        row('列數', num(s.ground.rows, (v) => resize(s.ground!.cols, Math.round(Math.min(11, Math.max(2, v)))), { min: 2 })),
      ]));
    }
  }
  if (!s.ground) return el('div', { className: 'mk-pad' }, items);
  const swatch = (label: string | null, text: string, color: string) => {
    const b = el('button', { className: `mk-swatch${brush === label ? ' on' : ''}` }, [
      el('span', { className: 'mk-chip' }), text,
    ]);
    (b.firstChild as HTMLElement).style.background = color;
    b.addEventListener('click', () => onBrush(label));
    return b;
  };
  items.push(el('div', { className: 'muted small', text: '選「地面筆刷」後點或拖曳塗格' }));
  items.push(...terrains(s).map((t) => swatch(t.label, t.label, t.color)));
  items.push(swatch(null, '橡皮擦', 'transparent'));
  const fill = el('button', { text: '用目前地形填滿', className: 'small' });
  fill.addEventListener('click', () => edit((sc) => {
    sc.ground!.cells = sc.ground!.cells.map(() => brush);
  }));
  const name = el('input');
  name.placeholder = '自訂地形, 例: 岩漿 lava';
  const color = el('input');
  color.type = 'color';
  color.value = '#cc6633';
  const add = el('button', { text: '加入', className: 'small' });
  add.addEventListener('click', () => {
    const v = name.value.trim();
    if (!v || v.length > 60 || terrains(s).some((t) => t.label === v)) return;
    edit((sc) => {
      sc.ground!.custom.push({ label: v, color: color.value });
    }, true);
    onBrush(v);
  });
  items.push(fill, el('div', { className: 'mk-custom' }, [name, color, add]));
  return el('div', { className: 'mk-pad' }, items);
}

/** 新場景表單 */
export function newSceneForm(onCreate: (name: string, view: ViewKey, empty: boolean) => void, onCancel: () => void): HTMLElement {
  const name = el('input');
  name.placeholder = '場景名稱';
  const view = el('select');
  view.append(...VIEWS.map((v) => option(v, VIEW_LABEL[v])));
  const preset = el('select');
  preset.append(option('preset', '預設擺設'), option('empty', '空白'));
  const ok = el('button', { text: '建立', className: 'primary' });
  ok.addEventListener('click', () => {
    if (name.value.trim()) onCreate(name.value.trim(), view.value as ViewKey, preset.value === 'empty');
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ok.click();
  });
  const cancel = el('button', { text: '取消' });
  cancel.addEventListener('click', onCancel);
  return el('div', { className: 'mk-pad' }, [
    el('b', { text: '新場景' }),
    row('名稱', name),
    row('畫面架構(建立後不能改)', view),
    row('內容', preset),
    el('div', { className: 'mk-btns' }, [ok, cancel]),
  ]);
}
