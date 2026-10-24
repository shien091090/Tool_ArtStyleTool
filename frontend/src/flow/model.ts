/** 節點流程: 型別與純函式(狀態推導、連線規則)。 */

export type FlowNodeType = 'input' | 'cutout' | 'workshop' | 'style' | 'pixel';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  x: number;
  y: number;
  params: Record<string, unknown>;
  /** 輸出版本, 0 = 沒有輸出 */
  rev: number;
  /** 產生輸出時用的上游版本 */
  inputRev: number | null;
  /** 產生輸出時接的上游節點(舊資料沒有) */
  inputFrom?: string | null;
  error: string | null;
}

export type PortKind = 'main' | 'material';

export interface FlowLink {
  from: string;
  to: string;
  /** 省略 = 主圖; 'material' = 改部位節點的素材 */
  port?: 'material';
}

export interface FlowMeta {
  name: string;
  nodes: FlowNode[];
  links: FlowLink[];
}

export type NodeStatus = 'idle' | 'running' | 'done' | 'stale' | 'error';

export const NODE_INFO: Record<FlowNodeType, { label: string; hasInput: boolean; free: boolean; materials?: boolean }> = {
  input: { label: '圖片輸入', hasInput: false, free: true },
  cutout: { label: '去除區塊', hasInput: true, free: true },
  workshop: { label: '改部位', hasInput: true, free: false, materials: true },
  style: { label: '改風格', hasInput: true, free: false },
  pixel: { label: '像素化', hasInput: true, free: false },
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: '未執行',
  running: '執行中',
  done: '完成',
  stale: '過期: 上游改過',
  error: '失敗',
};

export const isMaterial = (l: FlowLink) => l.port === 'material';

/** 主圖輸入的上游 */
export function upstreamOf(flow: FlowMeta, id: string): FlowNode | null {
  const link = flow.links.find((l) => l.to === id && !isMaterial(l));
  return link ? flow.nodes.find((n) => n.id === link.from) ?? null : null;
}

/** 接到素材接點的上游, 依連線順序 */
export function materialsOf(flow: FlowMeta, id: string): FlowNode[] {
  return flow.links.filter((l) => l.to === id && isMaterial(l))
    .map((l) => flow.nodes.find((n) => n.id === l.from))
    .filter((n): n is FlowNode => !!n);
}

/** 素材的顯示名稱: 節點種類名, 同種類多個時加編號 */
export function materialNames(flow: FlowMeta, id: string): Record<string, string> {
  const ups = materialsOf(flow, id);
  const count: Partial<Record<FlowNodeType, number>> = {};
  const out: Record<string, string> = {};
  for (const n of ups) {
    const k = (count[n.type] ?? 0) + 1;
    count[n.type] = k;
    const total = ups.filter((m) => m.type === n.type).length;
    out[n.id] = total > 1 ? `${NODE_INFO[n.type].label} ${k}` : NODE_INFO[n.type].label;
  }
  return out;
}

export function downstreamOf(flow: FlowMeta, id: string): FlowNode[] {
  const ids = new Set(flow.links.filter((l) => l.from === id).map((l) => l.to));
  return flow.nodes.filter((n) => ids.has(n.id));
}

export function nodeStatus(flow: FlowMeta, node: FlowNode): NodeStatus {
  if (node.error) return 'error';
  if (!node.rev) return 'idle';
  if (NODE_INFO[node.type].hasInput) {
    const up = upstreamOf(flow, node.id);
    if (!up || node.inputRev !== up.rev) return 'stale';
  }
  const used = node.params.materials as Record<string, number> | undefined;
  if (materialsOf(flow, node.id).some((m) => (used?.[m.id] ?? 0) !== m.rev)) return 'stale';
  return 'done';
}

/** 主圖輸入鏈上有沒有節點沒輸出或用的是舊版上游(存到素材庫前檢查, 規則同後端 chain_stale) */
export function chainStale(flow: FlowMeta, id: string): boolean {
  let cur = flow.nodes.find((n) => n.id === id) ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (!cur.rev) return true;
    const up = upstreamOf(flow, cur.id);
    if (cur.type !== 'input') {
      if (!up || cur.inputRev !== up.rev) return true;
      if (cur.inputFrom && cur.inputFrom !== up.id) return true;
    }
    cur = up;
  }
  return false;
}

/** 主圖輸入鏈最上游的節點 */
export function chainTop(flow: FlowMeta, id: string): FlowNode | null {
  let cur = flow.nodes.find((n) => n.id === id) ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const up = upstreamOf(flow, cur.id);
    if (!up) return cur;
    cur = up;
  }
  return cur;
}

/** 加上 from → to 會不會繞成迴圈 */
export function wouldCycle(links: FlowLink[], from: string, to: string): boolean {
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const l of links) if (l.from === n) stack.push(l.to);
  }
  return false;
}

/** 接上 from → to 的某個接點: 同一對節點原本的線會被取代; 接主圖時 to 原本的主圖線也會被取代 */
export function connect(links: FlowLink[], from: string, to: string, port: PortKind = 'main'): FlowLink[] {
  const kept = links.filter((l) => !(l.from === from && l.to === to) && !(port === 'main' && l.to === to && !isMaterial(l)));
  return [...kept, port === 'material' ? { from, to, port } : { from, to }];
}

/** 節點上進行中 AI 工作的識別 */
export const flowJobKey = (flow: string, nid: string) => `flow:${flow}:${nid}`;

export function newNodeId(nodes: FlowNode[]): string {
  const max = nodes.reduce((m, n) => Math.max(m, Number(n.id.slice(1)) || 0), 0);
  return `n${max + 1}`;
}
