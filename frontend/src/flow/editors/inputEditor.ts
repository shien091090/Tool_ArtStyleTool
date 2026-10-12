/** 圖片輸入節點: 上傳圖片或選分層包原圖、部位工坊結果。 */
import { api } from '../../api';
import { el, option, showBanner } from '../../pages/ui';
import type { EditorContext, NodeEditor } from './types';

export function mountInputEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  const packSel = el('select');
  const shopSel = el('select');
  const preview = el('div', { className: 'fe-preview checker' });
  const label = el('div', { className: 'muted small' });
  body.append(el('div', { className: 'fe-scroll' }, [
    el('div', { className: 'toolbar' }, [
      el('label', {}, ['上傳圖片', fileInput]), el('label', {}, ['或分層包原圖', packSel]),
      el('label', {}, ['或部位工坊結果', shopSel]),
    ]),
    label, preview,
  ]));

  function show(url: string | null, text: string) {
    preview.replaceChildren();
    if (url) {
      const img = el('img');
      img.src = url;
      preview.append(img);
    } else {
      preview.append(el('div', { className: 'muted', text: '選一張圖, 選好會立刻成為這個節點的輸出' }));
    }
    label.textContent = text;
  }

  async function apply(source: Parameters<EditorContext['save']>[0], text: string) {
    ctx.status.textContent = '讀取中…';
    showBanner(ctx.banner, null);
    try {
      const meta = await ctx.save(source, { params: { source: text } });
      const rev = meta.nodes.find((n) => n.id === ctx.node.id)?.rev ?? 0;
      show(api.flows.fileUrl(ctx.flowName, `out/${ctx.node.id}.png`, rev), text);
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
      fileInput.value = '';
      packSel.value = '';
      shopSel.value = '';
    }
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void apply({ file: f }, f.name);
  });
  packSel.addEventListener('change', () => {
    if (packSel.value) void apply({ pack: packSel.value }, `分層包 ${packSel.value}`);
  });
  shopSel.addEventListener('change', () => {
    if (shopSel.value) void apply({ workshop: shopSel.value }, `部位工坊 ${shopSel.value}`);
  });

  show(ctx.outputUrl, String(ctx.node.params.source ?? ''));
  void (async () => {
    try {
      const [packs, shop] = await Promise.all([api.listPacks(), api.pixel.workshopResults()]);
      packSel.replaceChildren(option('', '—'), ...packs.map((p) => option(p.name, p.name)));
      shopSel.replaceChildren(option('', '—'), ...shop.map((r) => option(`${r.work}/${r.id}`, `${r.work} ${r.id}`)));
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    }
  })();

  return { unsaved: () => null, dispose() {} };
}
