/** 圖片輸入節點: 從素材庫選圖(新圖在挑選視窗裡匯入)。 */
import { api } from '../../api';
import { pickAsset } from '../../library/picker';
import { el, showBanner } from '../../pages/ui';
import type { EditorContext, NodeEditor, OutputSource } from './types';

export function mountInputEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const pickBtn = el('button', { text: '從素材庫選圖', className: 'primary' });
  const preview = el('div', { className: 'fe-preview checker' });
  const label = el('div', { className: 'muted small' });
  body.append(el('div', { className: 'fe-scroll' }, [
    el('div', { className: 'toolbar' }, [pickBtn]),
    label, preview,
  ]));

  function show(url: string | null, text: string) {
    preview.replaceChildren();
    if (url) {
      const img = el('img');
      img.src = url;
      preview.append(img);
    } else {
      preview.append(el('div', { className: 'muted', text: '從素材庫選一張圖, 選好會立刻成為這個節點的輸出; 新圖可以在挑選視窗裡直接匯入' }));
    }
    label.textContent = text;
  }

  async function apply(source: OutputSource, params: Record<string, unknown>, text: string) {
    ctx.status.textContent = '讀取中…';
    showBanner(ctx.banner, null);
    try {
      const meta = await ctx.save(source, { params });
      const rev = meta.nodes.find((n) => n.id === ctx.node.id)?.rev ?? 0;
      show(api.flows.fileUrl(ctx.flowName, `out/${ctx.node.id}.png`, rev), text);
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
    }
  }

  pickBtn.addEventListener('click', async () => {
    const a = await pickAsset();
    if (a) void apply({ asset: a.id }, { source: a.name, asset: a.id }, `素材庫: ${a.name}`);
  });

  show(ctx.outputUrl, `${ctx.node.params.asset ? '素材庫: ' : ''}${String(ctx.node.params.source ?? '')}`);
  return { unsaved: () => null, dispose() {} };
}
