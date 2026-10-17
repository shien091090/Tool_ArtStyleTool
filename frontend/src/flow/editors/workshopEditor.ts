/** 改部位節點: 嵌入部位工坊, 作品的主圖取自上游輸出, 素材圖取自素材線, 生成結果「設為輸出」。 */
import { api } from '../../api';
import { mountProportionPage } from '../../pages/proportionPage';
import { confirmDelete, el, showBanner } from '../../pages/ui';
import type { WorkMeta } from '../../proportion/model';
import type { EditorContext, NodeEditor } from './types';

/** 作品裡各素材取自來源節點第幾版 */
function materialRevs(meta: WorkMeta): Record<string, number> {
  const out: Record<string, number> = {};
  for (const im of meta.images) if (im.source && im.inputRev != null) out[im.source] = im.inputRev;
  return out;
}

export function mountWorkshopEditor(body: HTMLElement, ctx: EditorContext): NodeEditor {
  const wapi = api.flows.workshop(ctx.flowName, ctx.node.id);
  const notices = el('div', { className: 'fe-notices' });
  const host = el('div', { className: 'fe-embed' });
  body.append(notices, host);
  let unmount: (() => void) | null = null;
  /** 作品主圖取自上游第幾版 */
  let workRev: number | null = null;
  let meta: WorkMeta | null = null;
  let outputResult = typeof ctx.node.params.result === 'string' ? ctx.node.params.result : null;
  let alive = true;

  async function setAsOutput(rid: string) {
    ctx.status.textContent = '設定中…';
    try {
      const cur = await wapi.getWork('');
      const blob = await (await fetch(wapi.fileUrl('', `results/${rid}.png`))).blob();
      await ctx.save({ file: blob }, { inputRev: workRev, params: { result: rid, materials: materialRevs(cur) } });
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

  function notice(text: string, action?: [string, () => void]) {
    const row = el('div', { className: 'fe-notice' }, [el('span', { text })]);
    if (action) {
      const btn = el('button', { text: action[0] });
      btn.addEventListener('click', action[1]);
      row.append(btn);
    }
    notices.append(row);
  }

  function showNotices() {
    notices.replaceChildren();
    const up = ctx.upstream;
    if (up && workRev !== null && workRev !== up.rev) {
      notice(`上游已更新(作品用的是第 ${workRev} 版, 上游現在是第 ${up.rev} 版)`, ['改用新的上游圖', () => void rebuild()]);
    }
    const revs = meta ? materialRevs(meta) : {};
    for (const m of ctx.materials) {
      const name = ctx.materialNames[m.id] ?? m.id;
      if (!m.rev) notice(`素材「${name}」還沒有輸出`);
      else if (revs[m.id] != null && revs[m.id] !== m.rev) {
        notice(`素材「${name}」已更新(作品用的是第 ${revs[m.id]} 版, 現在是第 ${m.rev} 版)`,
          ['改用新的素材圖', () => void refreshMaterial(m.id, name)]);
      }
    }
  }

  async function syncMaterials() {
    meta = await wapi.syncMaterials(ctx.materialNames);
  }

  async function busy(label: string, fn: () => Promise<void>) {
    ctx.status.textContent = label;
    try {
      await fn();
      showNotices();
      mount();
    } catch (e) {
      showBanner(ctx.banner, 'error', (e as Error).message);
    } finally {
      ctx.status.textContent = '';
    }
  }

  async function rebuild() {
    if (!confirmDelete('這個節點的部位、材質候選與生成結果(改用新的上游圖重新開始)')) return;
    await busy('重建中…', async () => {
      workRev = (await wapi.init()).inputRev ?? null;
      outputResult = null;
      await syncMaterials();
    });
  }

  async function refreshMaterial(src: string, name: string) {
    if (!confirmDelete(`從素材「${name}」切出的部位與它們的材質候選(改用新的素材圖)`)) return;
    await busy('更新素材中…', async () => {
      meta = await wapi.refreshMaterial(src);
    });
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
      await syncMaterials();
      if (!alive) return;
      showNotices();
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
