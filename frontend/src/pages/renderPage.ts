import { Pane } from 'tweakpane';
import { api, isRenderable, type PackMeta } from '../api';
import { Renderer } from '../gl/renderer';
import { PRESET_LABELS, PRESET_PALETTES } from '../palettes';
import { DEFAULT_RECIPE, LIMITS, normalizeRecipe, type Recipe } from '../recipe';
import { isVisible } from '../visibility';
import { createPaletteEditor } from './paletteEditor';
import { el, option, showBanner } from './ui';

const range = (path: string, step?: number) => {
  const [min, max, integer] = LIMITS[path];
  return { min, max, step: step ?? (integer ? 1 : (max - min) / 100) };
};

export function mountRenderPage(root: HTMLElement, params: URLSearchParams): () => void {
  const recipe: Recipe = structuredClone(DEFAULT_RECIPE);
  let currentRecipeName = '';
  let packs: PackMeta[] = [];
  let renderer: Renderer | null = null;
  let frame = 0;
  let showingSource = false;
  let disposed = false;

  const packSel = el('select');
  const recipeSel = el('select');
  const loadBtn = el('button', { text: '讀取' });
  const saveBtn = el('button', { text: '存檔' });
  const saveAsBtn = el('button', { text: '另存新檔' });
  const compareBtn = el('button', { text: '按住看原圖' });
  const exportBtn = el('button', { text: '匯出 PNG', className: 'primary' });
  const banner = el('div');
  const canvas = el('canvas');
  const message = el('div', { className: 'muted' });
  const canvasWrap = el('div', { className: 'canvas-wrap' }, [canvas, message]);
  const panelWrap = el('div', { className: 'panel-wrap' });

  root.append(
    el('div', { className: 'toolbar' }, [
      el('label', {}, ['分層包', packSel]),
      el('label', {}, ['配方', recipeSel]), loadBtn, saveBtn, saveAsBtn,
      el('span', { className: 'spacer' }), compareBtn, exportBtn,
    ]),
    banner,
    el('div', { className: 'render-layout' }, [canvasWrap, panelWrap]),
  );

  try {
    renderer = new Renderer(canvas);
  } catch (e) {
    showBanner(banner, 'error', (e as Error).message);
  }

  // ---- 參數面板 ----
  const pane = new Pane({ container: panelWrap });
  const ui = { light: { x: 0, y: 0 } };
  const tracked: [string, { hidden: boolean }][] = [];
  const track = (key: string, binding: { hidden: boolean }) => { tracked.push([key, binding]); };
  const updateVisibility = () => {
    for (const [key, b] of tracked) b.hidden = !isVisible(key, recipe);
    paletteEditor.element.classList.toggle('hidden', !isVisible('color.custom', recipe));
  };
  const syncUiFromRecipe = () => {
    const az = (recipe.lighting.azimuth * Math.PI) / 180;
    ui.light.x = +(Math.cos(az) * 0.8).toFixed(3);
    ui.light.y = +(Math.sin(az) * 0.8).toFixed(3);
    paletteEditor.setColors(recipe.color.custom);
  };

  const fColor = pane.addFolder({ title: '色彩' });
  track('color.enabled', fColor.addBinding(recipe.color, 'enabled', { label: '啟用' }));
  track('color.paletteMode', fColor.addBinding(recipe.color, 'paletteMode', {
    label: '色票', options: { 沿用原色: 'source', 自動抽色: 'auto', 預設色票: 'preset', 自訂色票: 'custom' },
  }));
  track('color.autoCount', fColor.addBinding(recipe.color, 'autoCount', { label: '自動色數', ...range('color.autoCount') }));
  track('color.preset', fColor.addBinding(recipe.color, 'preset', {
    label: '預設色票', options: Object.fromEntries(Object.keys(PRESET_PALETTES).map((k) => [PRESET_LABELS[k] ?? k, k])),
  }));
  const paletteEditor = createPaletteEditor((colors) => {
    recipe.color.custom = colors;
    scheduleRender();
  });
  fColor.element.querySelector('.tp-fldv_c')!.append(paletteEditor.element);
  track('color.hue', fColor.addBinding(recipe.color, 'hue', { label: '色相', ...range('color.hue', 1) }));
  track('color.saturation', fColor.addBinding(recipe.color, 'saturation', { label: '飽和', ...range('color.saturation') }));
  track('color.temperature', fColor.addBinding(recipe.color, 'temperature', { label: '色溫', ...range('color.temperature') }));

  const fLight = pane.addFolder({ title: '光照' });
  track('lighting.enabled', fLight.addBinding(recipe.lighting, 'enabled', { label: '啟用' }));
  track('lighting.azimuth', fLight.addBinding(ui, 'light', { label: '光源方向', x: { min: -1, max: 1 }, y: { min: -1, max: 1, inverted: true } }));
  track('lighting.elevation', fLight.addBinding(recipe.lighting, 'elevation', { label: '仰角', ...range('lighting.elevation', 1) }));
  track('lighting.bands', fLight.addBinding(recipe.lighting, 'bands', { label: '色階數', ...range('lighting.bands') }));
  track('lighting.shadowMode', fLight.addBinding(recipe.lighting, 'shadowMode', { label: '陰影上色', options: { 壓暗: 'darken', 偏冷色: 'cool' } }));
  track('lighting.shadowStrength', fLight.addBinding(recipe.lighting, 'shadowStrength', { label: '陰影強度', ...range('lighting.shadowStrength') }));
  track('lighting.ambient', fLight.addBinding(recipe.lighting, 'ambient', { label: '環境光', ...range('lighting.ambient') }));
  track('lighting.normalStrength', fLight.addBinding(recipe.lighting, 'normalStrength', { label: '立體感', ...range('lighting.normalStrength') }));
  track('lighting.rim', fLight.addBinding(recipe.lighting, 'rim', { label: '邊緣光' }));
  track('lighting.rimStrength', fLight.addBinding(recipe.lighting, 'rimStrength', { label: '邊緣光強度', ...range('lighting.rimStrength') }));
  track('lighting.rimColor', fLight.addBinding(recipe.lighting, 'rimColor', { label: '邊緣光顏色' }));

  const fLines = pane.addFolder({ title: '線條' });
  track('lines.enabled', fLines.addBinding(recipe.lines, 'enabled', { label: '啟用' }));
  track('lines.thickness', fLines.addBinding(recipe.lines, 'thickness', { label: '粗細', ...range('lines.thickness', 0.1) }));
  track('lines.variation', fLines.addBinding(recipe.lines, 'variation', { label: '粗細變化', options: { 均勻: 'uniform', 背光側加粗: 'shadow' } }));
  track('lines.variationAmount', fLines.addBinding(recipe.lines, 'variationAmount', { label: '加粗量', ...range('lines.variationAmount', 0.1) }));
  track('lines.colorMode', fLines.addBinding(recipe.lines, 'colorMode', { label: '線色', options: { 純黑: 'black', 色線: 'region' } }));
  track('lines.colorDarken', fLines.addBinding(recipe.lines, 'colorDarken', { label: '色線加深', ...range('lines.colorDarken') }));
  track('lines.texture', fLines.addBinding(recipe.lines, 'texture', { label: '質感', options: { 乾淨: 'clean', 鉛筆: 'pencil', 蠟筆: 'crayon' } }));
  track('lines.jitter', fLines.addBinding(recipe.lines, 'jitter', { label: '抖動', ...range('lines.jitter', 0.1) }));

  const fFx = pane.addFolder({ title: '特效' });
  track('effects.enabled', fFx.addBinding(recipe.effects, 'enabled', { label: '啟用' }));
  track('effects.halftone', fFx.addBinding(recipe.effects, 'halftone', { label: '網點' }));
  track('effects.halftoneShadowOnly', fFx.addBinding(recipe.effects, 'halftoneShadowOnly', { label: '只在陰影區' }));
  track('effects.halftoneSize', fFx.addBinding(recipe.effects, 'halftoneSize', { label: '網點大小', ...range('effects.halftoneSize', 0.5) }));
  track('effects.halftoneAngle', fFx.addBinding(recipe.effects, 'halftoneAngle', { label: '網點角度', ...range('effects.halftoneAngle', 1) }));
  track('effects.halftoneStrength', fFx.addBinding(recipe.effects, 'halftoneStrength', { label: '網點濃度', ...range('effects.halftoneStrength') }));
  track('effects.paper', fFx.addBinding(recipe.effects, 'paper', { label: '紙紋', ...range('effects.paper') }));
  track('effects.grain', fFx.addBinding(recipe.effects, 'grain', { label: '顆粒', ...range('effects.grain') }));

  const fFilter = pane.addFolder({ title: '濾鏡' });
  track('filter.enabled', fFilter.addBinding(recipe.filter, 'enabled', { label: '啟用' }));
  track('filter.kuwahara', fFilter.addBinding(recipe.filter, 'kuwahara', { label: '油畫平滑', ...range('filter.kuwahara') }));
  track('filter.pixelSize', fFilter.addBinding(recipe.filter, 'pixelSize', { label: '像素化', ...range('filter.pixelSize') }));
  track('filter.dither', fFilter.addBinding(recipe.filter, 'dither', { label: '抖色' }));
  track('filter.ditherLevels', fFilter.addBinding(recipe.filter, 'ditherLevels', { label: '抖色階數', ...range('filter.ditherLevels') }));
  track('filter.contrast', fFilter.addBinding(recipe.filter, 'contrast', { label: '對比', ...range('filter.contrast') }));
  track('filter.tint', fFilter.addBinding(recipe.filter, 'tint', { label: '染色' }));
  track('filter.tintStrength', fFilter.addBinding(recipe.filter, 'tintStrength', { label: '染色強度', ...range('filter.tintStrength') }));
  track('filter.vignette', fFilter.addBinding(recipe.filter, 'vignette', { label: '暗角', ...range('filter.vignette') }));

  syncUiFromRecipe();
  pane.refresh();
  updateVisibility();

  pane.on('change', () => {
    recipe.lighting.azimuth = ((Math.atan2(ui.light.y, ui.light.x) * 180) / Math.PI + 360) % 360;
    updateVisibility();
    scheduleRender();
  });

  // ---- 渲染 ----
  function scheduleRender() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!renderer?.loadedPack) return;
      if (showingSource) renderer.renderSource();
      else renderer.render(recipe);
    });
  }

  function applyRecipe(raw: unknown, name: string) {
    const { recipe: loaded, fixed } = normalizeRecipe(raw);
    for (const section of ['color', 'lighting', 'lines', 'effects', 'filter'] as const) {
      Object.assign(recipe[section], loaded[section]);
    }
    currentRecipeName = name;
    syncUiFromRecipe();
    pane.refresh();
    updateVisibility();
    if (fixed.length) showBanner(banner, 'warn', `配方「${name}」有欄位已補預設值或修正: ${fixed.join(', ')}`);
    else showBanner(banner, null);
    scheduleRender();
  }

  async function selectPack(name: string) {
    const meta = packs.find((p) => p.name === name);
    canvas.classList.add('hidden');
    if (!meta) { message.textContent = '還沒有分層包, 請先到「拆解檢查」頁建立'; return; }
    if (!isRenderable(meta)) {
      message.textContent = `「${name}」還沒拆解完成, 請到「拆解檢查」頁完成拆解`;
      return;
    }
    message.textContent = '載入中…';
    try {
      await renderer?.loadPack(meta);
      message.textContent = '';
      canvas.classList.remove('hidden');
      scheduleRender();
    } catch (e) {
      message.textContent = '';
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  async function refreshRecipes(select?: string) {
    const names = await api.listRecipes();
    recipeSel.replaceChildren(option('', '(預設值)'), ...names.map((n) => option(n, n)));
    recipeSel.value = select && names.includes(select) ? select : '';
  }

  async function saveAs(name: string) {
    try {
      await api.saveRecipe(name, recipe);
      currentRecipeName = name;
      await refreshRecipes(name);
      showBanner(banner, 'info', `已存成配方「${name}」`);
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  packSel.addEventListener('change', () => selectPack(packSel.value));
  loadBtn.addEventListener('click', async () => {
    const name = recipeSel.value;
    if (!name) { applyRecipe(DEFAULT_RECIPE, '預設值'); return; }
    try { applyRecipe(await api.getRecipe(name), name); } catch (e) { showBanner(banner, 'error', (e as Error).message); }
  });
  saveBtn.addEventListener('click', () => {
    const name = currentRecipeName && currentRecipeName !== '預設值' ? currentRecipeName : prompt('配方名稱')?.trim();
    if (name) saveAs(name);
  });
  saveAsBtn.addEventListener('click', () => {
    const name = prompt('另存新配方名稱', currentRecipeName)?.trim();
    if (name) saveAs(name);
  });
  const setSource = (on: boolean) => { showingSource = on; scheduleRender(); };
  compareBtn.addEventListener('pointerdown', () => setSource(true));
  for (const ev of ['pointerup', 'pointerleave'] as const) compareBtn.addEventListener(ev, () => setSource(false));
  exportBtn.addEventListener('click', () => {
    const pack = renderer?.loadedPack;
    if (!pack) return;
    renderer!.render(recipe);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = el('a', { href: URL.createObjectURL(blob) });
      a.download = `${pack.name}_${currentRecipeName || '未命名'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });

  (async () => {
    try {
      packs = await api.listPacks();
      packSel.replaceChildren(...packs.map((p) => option(p.name, p.name + (isRenderable(p) ? '' : '(未完成)'))));
      const wantPack = params.get('pack');
      const first = packs.find((p) => p.name === wantPack) ?? packs.find(isRenderable) ?? packs[0];
      if (first) packSel.value = first.name;
      const wantRecipe = params.get('recipe') ?? '';
      await refreshRecipes(wantRecipe);
      if (wantRecipe && recipeSel.value === wantRecipe) applyRecipe(await api.getRecipe(wantRecipe), wantRecipe);
      await selectPack(first?.name ?? '');
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  })();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    pane.dispose();
    renderer?.dispose();
  };
}
