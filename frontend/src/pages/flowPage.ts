/** 節點流程頁: 畫布 + 節點編輯面板, 免費節點自動往下游重跑。 */
import { api } from '../api';
import { createFlowCanvas, type Selection } from '../flow/canvas';
import { mountCutoutEditor, imgToBlob, loadImageData, readOps } from '../flow/editors/cutoutEditor';
import { mountInputEditor } from '../flow/editors/inputEditor';
import { mountPixelEditor } from '../flow/editors/pixelEditor';
import type { EditorContext, NodeEditor, OutputSource } from '../flow/editors/types';
import { applyOps } from '../flow/magicWand';
import {
  connect, downstreamOf, NODE_INFO, newNodeId, nodeStatus, STATUS_LABEL, upstreamOf, wouldCycle,
  type FlowMeta, type FlowNode, type FlowNodeType,
} from '../flow/model';
import { download } from '../pixel/pixelPanel';
import { confirmDelete, el, option, showBanner } from './ui';

const MOVE_SAVE_DELAY = 500;
const TYPES = Object.keys(NODE_INFO) as FlowNodeType[];

export function mountFlowPage(root: HTMLElement, params: URLSearchParams): () => void {
  let flow: FlowMeta | null = null;
  let falOk = false;
  let alive = true;
  let moveTimer = 0;
  let editor: { node: string; ed: NodeEditor; root: HTMLElement } | null = null;
  const running = new Set<string>();

  // ---- 工具列 ----
  const banner = el('div');
  const flowSel = el('select');
  const deleteBtn = el('button', { text: '刪除' });
  const nameInput = el('input');
  nameInput.placeholder = '新流程名稱';
  const createBtn = el('button', { text: '新流程' });
  const status = el('span', { className: 'muted' });
  const toolbar = el('div', { className: 'toolbar' }, [
    el('label', {}, ['流程', flowSel]), deleteBtn, status, el('span', { className: 'spacer' }),
    el('span', { className: 'muted small', text: '拖空白處平移、滾輪縮放、右鍵新增、雙擊節點開啟、Delete 刪除' }),
    nameInput, createBtn,
  ]);
  const menu = el('div', { className: 'fc-menu hidden' });

  const canvas = createFlowCanvas({
    onMove: () => scheduleSave(),
    onConnect: (from, to) => void link(from, to),
    onDelete: (sel) => void remove(sel),
    onOpen: (id) => openEditor(id),
    onContextMenu: (x, y, cx, cy) => showMenu(x, y, cx, cy),
    thumbUrl: (n) => (flow && n.rev ? api.flows.fileUrl(flow.name, `out/${n.id}.png`, n.rev) : null),
    status: (n) => (running.has(n.id) ? 'running' : flow ? nodeStatus(flow, n) : 'idle'),
  });
  const area = el('div', { className: 'fc-area' }, [canvas.root, menu]);
  root.append(toolbar, banner, area);

  function sync() {
    deleteBtn.disabled = !flow;
  }

  function error(e: unknown) {
    showBanner(banner, 'error', (e as Error).message);
  }

  /** 後端回來的流程: 節點位置以前端為準(可能有還沒存的拖拉) */
  function adopt(next: FlowMeta) {
    if (flow && flow.name === next.name) {
      for (const n of next.nodes) {
        const local = flow.nodes.find((m) => m.id === n.id);
        if (local) {
          n.x = local.x;
          n.y = local.y;
        }
      }
    }
    flow = next;
    canvas.render(flow);
    sync();
  }

  async function saveGraph(next: FlowMeta) {
    window.clearTimeout(moveTimer);
    const nodes = next.nodes.map(({ id, type, x, y, params }) => ({ id, type, x, y, params }));
    adopt(await api.flows.saveGraph(next.name, nodes, next.links));
  }

  function scheduleSave() {
    window.clearTimeout(moveTimer);
    moveTimer = window.setTimeout(() => {
      if (flow) saveGraph(flow).catch(error);
    }, MOVE_SAVE_DELAY);
  }

  // ---- 執行 ----
  async function setOutput(nid: string, source: OutputSource, opts: Parameters<EditorContext['save']>[1] = {}) {
    if (!flow) throw new Error('沒有開啟流程');
    running.add(nid);
    canvas.render(flow);
    try {
      adopt(await api.flows.setOutput(flow.name, nid, source, opts));
    } finally {
      running.delete(nid);
      if (flow) canvas.render(flow);
    }
    await propagate(nid);
    return flow!;
  }

  /** 免費節點(去除區塊)以新的上游輸出重跑, 一路往下 */
  async function propagate(nid: string) {
    if (!flow) return;
    for (const child of downstreamOf(flow, nid)) {
      if (child.type === 'cutout') await rerunCutout(child.id);
    }
  }

  async function rerunCutout(nid: string) {
    if (!flow) return;
    const node = flow.nodes.find((n) => n.id === nid);
    const up = node && upstreamOf(flow, nid);
    if (!node || !up?.rev || node.inputRev === up.rev) return;
    if (editor?.node === nid) return; // 正在編輯的節點交給使用者按套用
    try {
      const src = await loadImageData(api.flows.fileUrl(flow.name, `out/${up.id}.png`, up.rev));
      const ops = readOps(node.params);
      await setOutput(nid, { file: await imgToBlob(applyOps(src, ops)) }, { inputRev: up.rev, params: { ...node.params, ops } });
    } catch (e) {
      error(e);
    }
  }

  // ---- 編輯圖結構 ----
  async function addNode(type: FlowNodeType, x: number, y: number) {
    if (!flow) return;
    const n: FlowNode = { id: newNodeId(flow.nodes), type, x, y, params: {}, rev: 0, inputRev: null, error: null };
    try {
      await saveGraph({ ...flow, nodes: [...flow.nodes, n] });
    } catch (e) {
      error(e);
    }
  }

  async function link(from: string, to: string) {
    if (!flow) return;
    if (wouldCycle(flow.links, from, to)) {
      showBanner(banner, 'warn', '連線不能繞成迴圈');
      return;
    }
    try {
      await saveGraph({ ...flow, links: connect(flow.links, from, to) });
      showBanner(banner, null);
      await rerunCutout(to);
    } catch (e) {
      error(e);
    }
  }

  async function remove(sel: NonNullable<Selection>) {
    if (!flow) return;
    try {
      if (sel.kind === 'link') {
        await saveGraph({ ...flow, links: flow.links.filter((l) => !(l.from === sel.link.from && l.to === sel.link.to)) });
        return;
      }
      const n = flow.nodes.find((m) => m.id === sel.id);
      if (!n) return;
      const extra = n.type === 'pixel' ? '(含輸出與所有 AI 候選)' : '(含輸出)';
      if (n.rev || n.type === 'pixel') {
        if (!confirmDelete(`節點「${NODE_INFO[n.type].label}」${extra}`)) return;
      }
      await saveGraph({
        ...flow,
        nodes: flow.nodes.filter((m) => m.id !== n.id),
        links: flow.links.filter((l) => l.from !== n.id && l.to !== n.id),
      });
    } catch (e) {
      error(e);
    }
  }

  function showMenu(x: number, y: number, cx: number, cy: number) {
    if (!flow) return;
    const r = area.getBoundingClientRect();
    menu.style.left = `${cx - r.left}px`;
    menu.style.top = `${cy - r.top}px`;
    menu.replaceChildren(...TYPES.map((t) => {
      const b = el('button', { text: NODE_INFO[t].label });
      b.addEventListener('click', () => {
        hideMenu();
        void addNode(t, x, y);
      });
      return b;
    }));
    menu.classList.remove('hidden');
  }
  const hideMenu = () => menu.classList.add('hidden');

  // ---- 編輯面板 ----
  function openEditor(nid: string) {
    if (!flow) return;
    const node = flow.nodes.find((n) => n.id === nid);
    if (!node) return;
    closeEditor(true);
    const up = upstreamOf(flow, nid);
    const fname = flow.name;
    const edBanner = el('div');
    const edStatus = el('span', { className: 'muted' });
    const back = el('button', { text: '← 返回流程' });
    const dl = el('button', { text: '下載輸出 PNG' });
    const stateText = el('span', { className: 'muted small' });
    const body = el('div', { className: 'fe-body' });
    const shell = el('div', { className: 'fe-shell' }, [
      el('div', { className: 'toolbar' }, [back, el('b', { text: `${NODE_INFO[node.type].label}(${node.id})` }), stateText,
        edStatus, el('span', { className: 'spacer' }), dl]),
      edBanner, body,
    ]);
    const refreshHeader = () => {
      const cur = flow?.nodes.find((n) => n.id === nid);
      dl.disabled = !cur?.rev;
      stateText.textContent = cur && flow ? STATUS_LABEL[nodeStatus(flow, cur)] : '';
    };
    const ctx: EditorContext = {
      flowName: fname,
      node,
      upstream: up,
      upstreamUrl: up?.rev ? api.flows.fileUrl(fname, `out/${up.id}.png`, up.rev) : null,
      outputUrl: node.rev ? api.flows.fileUrl(fname, `out/${node.id}.png`, node.rev) : null,
      falOk,
      banner: edBanner,
      status: edStatus,
      save: async (source, opts) => {
        const m = await setOutput(nid, source, opts);
        refreshHeader();
        return m;
      },
    };
    const mount = { input: mountInputEditor, cutout: mountCutoutEditor, pixel: mountPixelEditor }[node.type];
    const ed = mount(body, ctx);
    back.addEventListener('click', () => closeEditor(false));
    dl.addEventListener('click', () => {
      const cur = flow?.nodes.find((n) => n.id === nid);
      if (cur?.rev) download(api.flows.fileUrl(fname, `out/${nid}.png`, cur.rev), `${fname}_${nid}.png`);
    });
    editor = { node: nid, ed, root: shell };
    area.append(shell);
    refreshHeader();
  }

  function closeEditor(force: boolean) {
    if (!editor) return;
    const msg = editor.ed.unsaved();
    if (!force && msg && !confirm(`${msg}, 要放棄嗎?`)) return;
    editor.ed.dispose();
    editor.root.remove();
    const nid = editor.node;
    editor = null;
    canvas.root.focus({ preventScroll: true });
    if (flow?.nodes.find((n) => n.id === nid)?.type === 'cutout') void rerunCutout(nid);
  }

  // ---- 流程 ----
  async function refreshFlows(want = '') {
    const list = await api.flows.list();
    flowSel.replaceChildren(option('', list.length ? '— 選擇流程 —' : '— 尚無流程 —'), ...list.map((f) => option(f.name, f.name)));
    flowSel.value = want;
  }

  async function openFlow(name: string) {
    closeEditor(true);
    hideMenu();
    window.clearTimeout(moveTimer);
    flow = null;
    canvas.render(null);
    sync();
    if (!name) {
      history.replaceState(null, '', '#/flow');
      return;
    }
    try {
      adopt(await api.flows.get(name));
      flowSel.value = name;
      history.replaceState(null, '', `#/flow?flow=${encodeURIComponent(name)}`);
    } catch (e) {
      error(e);
    }
  }

  flowSel.addEventListener('change', () => void openFlow(flowSel.value));
  createBtn.addEventListener('click', () => void (async () => {
    try {
      const name = nameInput.value.trim();
      if (!name) throw new Error('請輸入流程名稱');
      const m = await api.flows.create(name);
      nameInput.value = '';
      await refreshFlows(m.name);
      await openFlow(m.name);
    } catch (e) {
      error(e);
    }
  })());
  deleteBtn.addEventListener('click', () => void (async () => {
    if (!flow) return;
    const name = flow.name;
    if (!confirmDelete(`流程「${name}」(含所有節點輸出與 AI 候選)`)) return;
    try {
      await api.flows.delete(name);
      await openFlow('');
      await refreshFlows('');
      showBanner(banner, 'info', `已刪除流程「${name}」`);
    } catch (e) {
      error(e);
    }
  })());
  const onDocDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) hideMenu();
  };
  document.addEventListener('pointerdown', onDocDown);

  sync();
  void (async () => {
    try {
      falOk = (await api.getStatus()).fal;
      await refreshFlows();
      if (!falOk) showBanner(banner, 'warn', '沒有設定 FAL_KEY: 免費節點照常可用, 但像素化不能 AI 重畫');
      const want = params.get('flow');
      if (want && alive) await openFlow(want);
    } catch (e) {
      error(e);
    }
  })();

  return () => {
    alive = false;
    window.clearTimeout(moveTimer);
    if (flow) {
      const f = flow;
      void api.flows.saveGraph(f.name, f.nodes.map(({ id, type, x, y, params: p }) => ({ id, type, x, y, params: p })), f.links)
        .catch(() => undefined);
    }
    editor?.ed.dispose();
    document.removeEventListener('pointerdown', onDocDown);
    canvas.destroy();
  };
}
