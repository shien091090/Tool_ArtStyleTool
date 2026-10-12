/** 像素化節點: 沿用像素素材的面板, 來源是上游輸出, 多一顆「設為輸出」。 */
import { api } from '../../api';
import { confirmDelete, el, showBanner } from '../../pages/ui';
import { createPixelPanel, type PixelBackend } from '../../pixel/pixelPanel';
import type { EditorContext, NodeEditor } from './types';

export function mountPixelEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const { flowName: flow, node } = ctx;
  const backend: PixelBackend = {
    name: `${flow}_${node.id}`,
    fileUrl: (path) => api.flows.fileUrl(flow, `nodes/${node.id}/${path}`, ''),
    generate: (s) => api.flows.addCandidates(flow, node.id, s),
    deleteCandidate: (cid) => api.flows.deleteCandidate(flow, node.id, cid),
    pixelate: (cid, colors) => api.flows.pixelate(flow, node.id, cid, colors),
  };
  const panel = createPixelPanel({
    banner: ctx.banner,
    status: ctx.status,
    confirmDelete,
    resultAction: {
      label: '設為輸出',
      async run(r, cand) {
        if (!r.png) return;
        const blob = await (await fetch(r.png)).blob();
        await ctx.save({ file: blob }, { inputRev: cand.inputRev ?? null, params: { candidate: cand.id, method: r.method } });
        showBanner(ctx.banner, 'info', `已把 ${cand.id}「${r.label}」設為這個節點的輸出`);
      },
    },
  });
  body.append(el('div', { className: 'prop-layout' }, [panel.main, panel.side]));

  panel.setFal(ctx.falOk);
  panel.setBlocked(ctx.upstreamUrl ? null : '上游還沒有輸出: 先接上有輸出的節點');
  void (async () => {
    try {
      const meta = await api.flows.getPixel(flow, node.id);
      const up = ctx.upstream;
      panel.setWork(backend, meta, ctx.upstreamUrl && up
        ? { url: ctx.upstreamUrl, label: `上游 ${up.id} 第 ${up.rev} 版(AI 重畫用這張)` } : null);
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    }
  })();

  return { unsaved: () => null, dispose: () => panel.destroy() };
}
