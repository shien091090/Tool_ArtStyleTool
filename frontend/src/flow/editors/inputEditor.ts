/** 圖片輸入節點: 上傳圖片。 */
import { api } from '../../api';
import { el, showBanner } from '../../pages/ui';
import type { EditorContext, NodeEditor } from './types';

export function mountInputEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  const preview = el('div', { className: 'fe-preview checker' });
  const label = el('div', { className: 'muted small' });
  body.append(el('div', { className: 'fe-scroll' }, [
    el('div', { className: 'toolbar' }, [el('label', {}, ['上傳圖片', fileInput])]),
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

  async function apply(file: File) {
    ctx.status.textContent = '讀取中…';
    showBanner(ctx.banner, null);
    try {
      const meta = await ctx.save({ file }, { params: { source: file.name } });
      const rev = meta.nodes.find((n) => n.id === ctx.node.id)?.rev ?? 0;
      show(api.flows.fileUrl(ctx.flowName, `out/${ctx.node.id}.png`, rev), file.name);
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
      fileInput.value = '';
    }
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void apply(f);
  });

  show(ctx.outputUrl, String(ctx.node.params.source ?? ''));
  return { unsaved: () => null, dispose() {} };
}
