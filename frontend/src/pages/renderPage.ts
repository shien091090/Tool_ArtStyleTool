import { Pane } from 'tweakpane';
import { api, isRenderable, type PackMeta } from '../api';
import { Renderer } from '../gl/renderer';
import { PRESET_LABELS, PRESET_PALETTES } from '../palettes';
import { GRADE_LABELS } from '../grade';
import { DEFAULT_RECIPE, GRADE_PRESET_NAMES, LIMITS, normalizeRecipe, SECTIONS, type Recipe, type Section } from '../recipe';
import { isVisible } from '../visibility';
import { createPaletteEditor } from './paletteEditor';
import { fillRecipeSelect, isStarter, loadRecipeValue, STARTER_PREFIX } from './recipeOptions';
import { confirmDelete, el, option, showBanner } from './ui';

const range = (path: string, step?: number) => {
  const [min, max, integer] = LIMITS[path];
  return { min, max, step: step ?? (integer ? 1 : (max - min) / 100) };
};

export function mountRenderPage(root: HTMLElement, params: URLSearchParams): () => void {
  const recipe: Recipe = structuredClone(DEFAULT_RECIPE);
  let currentRecipeName = '';
  let startedFromStarter = false;
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
  const deleteRecipeBtn = el('button', { text: '刪除配方' });
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
      el('label', {}, ['配方', recipeSel]), loadBtn, saveBtn, saveAsBtn, deleteRecipeBtn,
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
    gradientEditor.element.classList.toggle('hidden', !isVisible('grade.gradientStops', recipe));
  };
  const syncUiFromRecipe = () => {
    const az = (recipe.lighting.azimuth * Math.PI) / 180;
    ui.light.x = +(Math.cos(az) * 0.8).toFixed(3);
    ui.light.y = +(Math.sin(az) * 0.8).toFixed(3);
    paletteEditor.setColors(recipe.color.custom);
    gradientEditor.setColors(recipe.grade.gradientStops);
  };

  // 都是 1 = 原圖; 往下拉才換成工具算的光影與乾淨色塊
  const fKeep = pane.addFolder({ title: '保留原圖' });
  track('keep.enabled', fKeep.addBinding(recipe.keep, 'enabled', { label: '啟用' }));
  track('keep.shade', fKeep.addBinding(recipe.keep, 'shade', { label: '保留原圖光影', ...range('keep.shade') }));
  track('keep.texture', fKeep.addBinding(recipe.keep, 'texture', { label: '保留原圖紋理', ...range('keep.texture') }));

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

  type Folder = ReturnType<typeof pane.addFolder>;
  /** 加一個參數到面板並納入顯示規則。 */
  const add = <S extends Section>(folder: Folder, section: S, key: keyof Recipe[S] & string, label: string, opts: Record<string, unknown> = {}) => {
    const path = `${section}.${key}`;
    const numeric = typeof recipe[section][key] === 'number';
    track(path, folder.addBinding(recipe[section] as Record<string, unknown>, key, { label, ...(numeric && LIMITS[path] ? range(path) : {}), ...opts }));
  };

  const fLight = pane.addFolder({ title: '光照' });
  add(fLight, 'lighting', 'enabled', '啟用');
  track('lighting.azimuth', fLight.addBinding(ui, 'light', { label: '光源方向', x: { min: -1, max: 1 }, y: { min: -1, max: 1, inverted: true } }));
  add(fLight, 'lighting', 'elevation', '仰角', { step: 1 });
  add(fLight, 'lighting', 'bands', '色階數');
  add(fLight, 'lighting', 'shadowMode', '陰影上色', { options: { 壓暗: 'darken', 偏冷色: 'cool', 指定顏色: 'custom' } });
  add(fLight, 'lighting', 'shadowColor', '陰影顏色');
  add(fLight, 'lighting', 'shadowStrength', '陰影強度');
  add(fLight, 'lighting', 'softness', '陰影邊緣柔和');
  add(fLight, 'lighting', 'edgeJitter', '陰影邊緣抖動');
  add(fLight, 'lighting', 'litColor', '亮面顏色');
  add(fLight, 'lighting', 'litStrength', '亮面染色');
  add(fLight, 'lighting', 'ambient', '環境光');
  add(fLight, 'lighting', 'ao', '環境遮蔽');
  add(fLight, 'lighting', 'normalStrength', '大形立體感');
  add(fLight, 'lighting', 'detailStrength', '細部立體感');
  add(fLight, 'lighting', 'rim', '邊緣光');
  add(fLight, 'lighting', 'rimStrength', '邊緣光強度');
  add(fLight, 'lighting', 'rimColor', '邊緣光顏色');
  add(fLight, 'lighting', 'specular', '高光');
  add(fLight, 'lighting', 'specSize', '高光大小');
  add(fLight, 'lighting', 'specSharpness', '高光銳利');
  add(fLight, 'lighting', 'specColor', '高光顏色');
  add(fLight, 'lighting', 'specStrength', '高光強度');
  add(fLight, 'lighting', 'fill', '補光');
  add(fLight, 'lighting', 'fillAzimuth', '補光方位', { step: 1 });
  add(fLight, 'lighting', 'fillElevation', '補光仰角', { step: 1 });
  add(fLight, 'lighting', 'fillColor', '補光顏色');
  add(fLight, 'lighting', 'fillStrength', '補光強度');

  const fLines = pane.addFolder({ title: '線條', expanded: false });
  add(fLines, 'lines', 'enabled', '啟用');
  add(fLines, 'lines', 'thickness', '粗細', { step: 0.1 });
  add(fLines, 'lines', 'outerThickness', '外輪廓加粗', { step: 0.1 });
  add(fLines, 'lines', 'innerLines', '顯示內線');
  add(fLines, 'lines', 'variation', '粗細變化', { options: { 均勻: 'uniform', 背光側加粗: 'shadow' } });
  add(fLines, 'lines', 'variationAmount', '加粗量', { step: 0.1 });
  add(fLines, 'lines', 'pressure', '筆壓起伏');
  add(fLines, 'lines', 'pressureScale', '起伏尺度');
  add(fLines, 'lines', 'breaks', '斷續');
  add(fLines, 'lines', 'colorMode', '線色', { options: { 純黑: 'black', 色線: 'region' } });
  add(fLines, 'lines', 'colorDarken', '色線加深');
  add(fLines, 'lines', 'texture', '質感', { options: { 乾淨: 'clean', 鉛筆: 'pencil', 蠟筆: 'crayon' } });
  add(fLines, 'lines', 'jitter', '抖動', { step: 0.1 });
  add(fLines, 'lines', 'doubleLine', '雙線錯位');
  add(fLines, 'lines', 'doubleOffset', '錯位距離', { step: 0.5 });
  add(fLines, 'lines', 'doubleAngle', '錯位角度', { step: 1 });
  add(fLines, 'lines', 'doubleColor', '第二條線顏色');

  const fFx = pane.addFolder({ title: '質感', expanded: false });
  add(fFx, 'effects', 'enabled', '啟用');
  add(fFx, 'effects', 'halftone', '網點');
  add(fFx, 'effects', 'halftoneShadowOnly', '只在陰影區');
  add(fFx, 'effects', 'halftoneSize', '網點大小', { step: 0.5 });
  add(fFx, 'effects', 'halftoneAngle', '網點角度', { step: 1 });
  add(fFx, 'effects', 'halftoneStrength', '網點濃度');
  add(fFx, 'effects', 'hatch', '排線');
  add(fFx, 'effects', 'hatchSpacing', '排線間距', { step: 0.5 });
  add(fFx, 'effects', 'hatchAngle', '排線角度', { step: 1 });
  add(fFx, 'effects', 'hatchWidth', '排線粗細', { step: 0.1 });
  add(fFx, 'effects', 'crossHatch', '交叉排線');
  add(fFx, 'effects', 'hatchStrength', '排線濃度');
  add(fFx, 'effects', 'stipple', '點描');
  add(fFx, 'effects', 'stippleSize', '點大小', { step: 0.5 });
  add(fFx, 'effects', 'stippleDensity', '點密度');
  add(fFx, 'effects', 'wcEdge', '水彩邊緣加深');
  add(fFx, 'effects', 'wcBleed', '水彩暈染');
  add(fFx, 'effects', 'wcGranule', '水彩顆粒');
  add(fFx, 'effects', 'brush', '筆觸');
  add(fFx, 'effects', 'brushScale', '筆觸尺度');
  add(fFx, 'effects', 'riso', '套色錯位', { step: 0.5 });
  add(fFx, 'effects', 'risoAngle', '錯位角度', { step: 1 });
  add(fFx, 'effects', 'paper', '紙紋');
  add(fFx, 'effects', 'grain', '顆粒');

  const fFilter = pane.addFolder({ title: '濾鏡', expanded: false });
  add(fFilter, 'filter', 'enabled', '啟用');
  add(fFilter, 'filter', 'kuwahara', '油畫平滑');
  add(fFilter, 'filter', 'pixelSize', '像素化');
  add(fFilter, 'filter', 'dither', '抖色');
  add(fFilter, 'filter', 'ditherLevels', '抖色階數');
  add(fFilter, 'filter', 'outlineWidth', '外框描邊', { step: 0.5 });
  add(fFilter, 'filter', 'outlineColor', '描邊顏色');
  add(fFilter, 'filter', 'bloom', '泛光');
  add(fFilter, 'filter', 'bloomThreshold', '泛光門檻');
  add(fFilter, 'filter', 'bloomRadius', '泛光半徑');
  add(fFilter, 'filter', 'chroma', '色差', { step: 0.1 });
  add(fFilter, 'filter', 'scan', '掃描線');
  add(fFilter, 'filter', 'scanSpacing', '掃描線間距', { step: 0.5 });
  add(fFilter, 'filter', 'contrast', '對比');
  add(fFilter, 'filter', 'tint', '染色');
  add(fFilter, 'filter', 'tintStrength', '染色強度');
  add(fFilter, 'filter', 'vignette', '暗角');

  const fGrade = pane.addFolder({ title: '調色', expanded: false });
  add(fGrade, 'grade', 'enabled', '啟用');
  add(fGrade, 'grade', 'preset', '調色預設', { options: Object.fromEntries(GRADE_PRESET_NAMES.map((n) => [GRADE_LABELS[n], n])) });
  add(fGrade, 'grade', 'presetStrength', '調色強度');
  add(fGrade, 'grade', 'gradientMap', '漸層映射');
  const gradientEditor = createPaletteEditor((colors) => {
    recipe.grade.gradientStops = colors;
    scheduleRender();
  }, { min: 2, max: 6 });
  fGrade.element.querySelector('.tp-fldv_c')!.append(gradientEditor.element);
  add(fGrade, 'grade', 'gradientStrength', '漸層強度');
  add(fGrade, 'grade', 'satShadow', '暗部飽和度');
  add(fGrade, 'grade', 'satHighlight', '亮部飽和度');

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
    for (const section of SECTIONS) {
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
    await fillRecipeSelect(recipeSel, select);
  }

  async function saveAs(name: string) {
    try {
      await api.saveRecipe(name, recipe);
      currentRecipeName = name;
      startedFromStarter = false;
      await refreshRecipes(name);
      showBanner(banner, 'info', `已存成配方「${name}」`);
    } catch (e) {
      showBanner(banner, 'error', (e as Error).message);
    }
  }

  packSel.addEventListener('change', () => selectPack(packSel.value));
  loadBtn.addEventListener('click', async () => {
    const value = recipeSel.value;
    if (!value) { applyRecipe(DEFAULT_RECIPE, '預設值'); return; }
    try {
      applyRecipe(await loadRecipeValue(value), isStarter(value) ? value.slice(STARTER_PREFIX.length) : value);
      startedFromStarter = isStarter(value);
    } catch (e) { showBanner(banner, 'error', (e as Error).message); }
  });
  saveBtn.addEventListener('click', () => {
    // 起始配方唯讀: 改過之後要另存新名稱
    const reuse = currentRecipeName && currentRecipeName !== '預設值' && !startedFromStarter;
    const name = reuse ? currentRecipeName : prompt(startedFromStarter ? '起始配方不能覆蓋, 請輸入新配方名稱' : '配方名稱')?.trim();
    if (name) saveAs(name);
  });
  saveAsBtn.addEventListener('click', () => {
    const name = prompt('另存新配方名稱', currentRecipeName)?.trim();
    if (name) saveAs(name);
  });
  deleteRecipeBtn.addEventListener('click', async () => {
    const name = recipeSel.value;
    if (!name || isStarter(name)) { showBanner(banner, 'warn', '請在「我的配方」選一份要刪除的配方(起始配方不能刪)'); return; }
    if (!confirmDelete(`配方「${name}」`)) return;
    try {
      await api.deleteRecipe(name);
      if (currentRecipeName === name) currentRecipeName = '';
      await refreshRecipes();
      showBanner(banner, 'info', `已刪除配方「${name}」, 畫面上的參數保留著, 要的話可以另存`);
    } catch (e) { showBanner(banner, 'error', (e as Error).message); }
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
      if (wantRecipe && recipeSel.value === wantRecipe) {
        applyRecipe(await loadRecipeValue(wantRecipe), isStarter(wantRecipe) ? wantRecipe.slice(STARTER_PREFIX.length) : wantRecipe);
        startedFromStarter = isStarter(wantRecipe);
      }
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
