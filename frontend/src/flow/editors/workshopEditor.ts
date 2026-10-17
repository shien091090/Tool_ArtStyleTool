/** 改部位節點: 嵌入部位工坊, 作品的主圖取自上游輸出, 生成結果「設為輸出」。 */
import { api } from '../../api';
import { mountProportionPage } from '../../pages/proportionPage';
import { confirmDelete, el, showBanner } from '../../pages/ui';
import type { EditorContext, NodeEditor } from './types';

export function mountWorkshopEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const wapi = api.flows.workshop(ctx.flowName, ctx.node.id);
  const notice = el('div', { className: 'fe-notice hidden' });
  const host = el('div', { className: 'fe-embed' });
  body.append(notice, host);
  let unmount: (() => void) | null = null;
  /** 作品主圖取自上游第幾版 */
  let workRev: number | null = null;
  let outputResult = typeof ctx.node.params.result === 'string' ? ctx.node.params.result : null;
  let alive = true;

  async function setAsOutput(rid: string) {
    ctx.status.textContent = '設定中…';
    try {
      const blob = await (await fetch(wapi.fileUrl('', `results/${rid}.png`))).blob();
      await ctx.save({ file: blob }, { inputRev: workRev, params: { result: rid } });
      outputResult = rid;
      showBanner(ctx.banner, 'info', `已把 ${rid} 設為這個節點的輸出`);
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
    }
  }

  function mount() {
    unmount?.();
    host.replaceChildren();
    unmount = mountProportionPage(host, new URLSearchParams(), {
      api: wapi,
      load: () => wapi.getWork(''),
      banner: ctx.banner,
      status: ctx.status,
      compareActions: (rid) => {
        const b = el('button', { text: '設為輸出', className: 'primary' });
        b.addEventListener('click', () => void setAsOutput(rid));
        return [b];
      },
      resultTag: (rid) => (rid === outputResult ? '輸出' : null),
    });
  }

  function showStale() {
    const up = ctx.upstream;
    const stale = up !== null && workRev !== null && workRev !== up.rev;
    notice.classList.toggle('hidden', !stale);
    if (!stale || !up) return;
    const btn = el('button', { text: '改用新的上游圖' });
    btn.addEventListener('click', () => void rebuild());
    notice.replaceChildren(el('span', { text: `上游已更新(作品用的是第 ${workRev} 版, 上游現在是第 ${up.rev} 版)` }), btn);
  }

  async function rebuild() {
    if (!confirmDelete('這個節點的部位、材質候選與生成結果(改用新的上游圖重新開始)')) return;
    ctx.status.textContent = '重建中…';
    try {
      workRev = (await wapi.init()).inputRev ?? null;
      outputResult = null;
      showStale();
      mount();
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
    }
  }

  void (async () => {
    if (!ctx.upstreamUrl) {
      host.append(el('div', { className: 'muted fe-empty', text: '上游還沒有輸出: 先接上有輸出的節點' }));
      return;
    }
    try {
      const st = await wapi.status();
      if (!alive) return;
      workRev = st.exists ? st.inputRev : ((await wapi.init()).inputRev ?? null);
      if (!alive) return;
      showStale();
      mount();
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    }
  })();

  return {
    unsaved: () => null,
    dispose: () => {
      alive = false;
      unmount?.();
    },
  };
}
