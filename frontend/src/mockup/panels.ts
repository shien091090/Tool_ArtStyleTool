/** 遊戲示意右側與左側面板: 物件屬性、背景、地面調色盤、新場景表單。 */
import { COST, usd } from '../cost';
import { KINDS, VIEW_LABEL, VIEWS, type ViewKey } from '../library/model';
import { costNote, el, markPaid, option } from '../pages/ui';
import { COLOR_CHOICES, drawOrder, LEVEL_LABEL, LEVELS, nativeRes, terrains, type CameraLevel, type MockObject, type Scene } from './model';

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
  /** 像素場景的數字以「格」(遊戲像素)為單位 */
  const unit = s.pixel ? '(格)' : '';
  const minSize = s.pixel ? 1 : 8;
  if (o.kind === 'asset') {
    rows.push(el('b', { text: `素材: ${o.name}` }));
    rows.push(row(`寬${unit}`, num(o.w, (v) => edit((sc) => {
      const x = find(sc);
      if (x.kind !== 'asset') return;
      x.h = (x.h * v) / x.w;
      x.w = v;
      if (s.pixel) x.h = Math.max(1, Math.round(x.h));
    }, true), { min: minSize })));
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
    rows.push(el('div', { className: 'mk-grid2' }, [f('i', '格 i', 0.5), f('j', '格 j', 0.5), f('w', '佔地寬(格)', 0.5, s.pixel ? 0.5 : 0.1),
      f('l', '佔地深(格)', 0.5, s.pixel ? 0.5 : 0.1), f('h', s.pixel ? '高度(遊戲像素)' : '高度(px)', s.pixel ? 1 : 10, 1)]));
  } else {
    const f = (key: 'x' | 'y' | 'w' | 'h', min?: number) => row(`${key}${unit}`, num(o[key], (v) => edit((sc) => {
      const x = find(sc);
      if (x.kind !== 'block') {
        const val = s.pixel ? Math.round(v) : v;
        if (x.kind === 'asset' && (key === 'w' || key === 'h')) {
          const k = val / x[key];
          x.w *= k;
          x.h *= k;
          if (s.pixel) [x.w, x.h] = [Math.max(1, Math.round(x.w)), Math.max(1, Math.round(x.h))];
        } else x[key] = val;
      }
    }, o.kind === 'asset'), { min }));
    rows.push(el('div', { className: 'mk-grid2' }, [f('x'), f('y'), f('w', minSize), f('h', minSize)]));
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
  const colors = el('select');
  colors.append(...COLOR_CHOICES.map((n) => option(String(n), `${n} 色`)));
  colors.value = String(s.style.colors);
  colors.addEventListener('change', () => edit((sc) => {
    sc.style.colors = Number(colors.value);
  }));
  const go = markPaid(el('button', { text: opts.busy ? 'AI 畫圖中…' : 'AI 畫整張' }));
  go.disabled = opts.busy;
  go.addEventListener('click', opts.render);
  return el('div', { className: 'mk-pad' }, [
    el('b', { text: '風格' }),
    row('遊戲類型描述(給 AI 看, 英文較準)', genre),
    row('風格描述', text),
    el('div', { className: 'muted small', text: '參考圖(最多 4 張, 只參考畫風)' }),
    el('div', { className: 'mk-refs' }, [...refs, addRef]),
    ...(s.pixel ? [row('色數(AI 畫完對齊格子時限制)', colors)] : []),
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
      const [maxC, maxR] = s.pixel ? [40, 22] : [20, 11];
      items.push(el('div', { className: 'mk-grid2' }, [
        row('行數', num(s.ground.cols, (v) => resize(Math.round(Math.min(maxC, Math.max(2, v))), s.ground!.rows), { min: 2 })),
        row('列數', num(s.ground.rows, (v) => resize(s.ground!.cols, Math.round(Math.min(maxR, Math.max(2, v)))), { min: 2 })),
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
export function newSceneForm(onCreate: (name: string, view: ViewKey, empty: boolean, pixel: boolean, camera?: CameraLevel) => void,
  onCancel: () => void): HTMLElement {
  const name = el('input');
  name.placeholder = '場景名稱';
  const view = el('select');
  view.append(...VIEWS.map((v) => option(v, VIEW_LABEL[v])));
  const preset = el('select');
  preset.append(option('preset', '預設擺設'), option('empty', '空白'));
  const pixel = el('input');
  pixel.type = 'checkbox';
  const res = el('select');
  const fillRes = () => {
    const keep = res.value || 'far';
    res.replaceChildren(...LEVELS.map((lv) =>
      option(lv, `${LEVEL_LABEL[lv]} ${nativeRes({ view: view.value as ViewKey, pixel: true }, lv).join('×')}`)));
    res.value = keep;
  };
  fillRes();
  const resRow = row('解析度(就是鏡頭遠近, 之後可換)', res);
  resRow.classList.add('hidden');
  pixel.addEventListener('change', () => resRow.classList.toggle('hidden', !pixel.checked));
  view.addEventListener('change', fillRes);
  const ok = el('button', { text: '建立', className: 'primary' });
  ok.addEventListener('click', () => {
    if (name.value.trim()) {
      onCreate(name.value.trim(), view.value as ViewKey, preset.value === 'empty', pixel.checked,
        pixel.checked ? (res.value as CameraLevel) : undefined);
    }
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
    el('label', { className: 'mk-row' }, [pixel, '像素場景(建立後不能改)']),
    resRow,
    row('內容', preset),
    el('div', { className: 'mk-btns' }, [ok, cancel]),
  ]);
}

/** 圖層清單: 由前到後列出所有物件, 點一下選取, 拖拉調整前後(斜角俯瞰自動排序, 不能拖) */
export function layerPanel(s: Scene, selected: string | null, opts: {
  thumb: (asset: string) => string;
  onSelect: (id: string) => void;
  onMove: (id: string, gap: number) => void;
}): HTMLElement {
  const order = [...drawOrder(s)].reverse();
  const canDrag = s.view !== 'iso';
  const list = el('div', { className: 'mk-layer-list' });
  let dragging: string | null = null;
  const clearMarks = () => list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  order.forEach((o, n) => {
    const icon = o.kind === 'asset'
      ? Object.assign(el('img', { className: 'mk-layer-thumb' }), { src: opts.thumb(o.asset), draggable: false })
      : el('span', { className: 'mk-chip' });
    if (o.kind !== 'asset') icon.style.background = o.color;
    const name = o.kind === 'asset' ? o.name || '素材' : o.label || '灰盒';
    const item = el('div', { className: `mk-layer${o.id === selected ? ' on' : ''}`, title: name }, [icon, el('span', { className: 'mk-layer-name', text: name })]);
    item.addEventListener('click', () => opts.onSelect(o.id));
    if (canDrag) {
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        dragging = o.id;
        e.dataTransfer?.setData('text/plain', o.id);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        dragging = null;
        item.classList.remove('dragging');
        clearMarks();
      });
      const after = (e: DragEvent) => e.offsetY > item.clientHeight / 2;
      item.addEventListener('dragover', (e) => {
        if (!dragging) return;
        e.preventDefault();
        clearMarks();
        item.classList.add(after(e) ? 'drop-after' : 'drop-before');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = dragging;
        clearMarks();
        if (id) opts.onMove(id, n + (after(e) ? 1 : 0));
      });
    }
    list.append(item);
  });
  const head = el('div', { className: 'mk-layer-head' }, [
    el('b', { text: '圖層' }),
    ...(canDrag ? [] : [el('span', { className: 'muted small', text: '依腳底位置自動排前後' })]),
  ]);
  return el('div', { className: 'mk-pad' }, [head, order.length ? list : el('div', { className: 'muted small', text: '還沒有物件' })]);
}
