/** 節點流程: 型別與純函式(狀態推導、連線規則)。 */

export type FlowNodeType = 'input' | 'cutout' | 'workshop' | 'pixel';

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
  error: string | null;
}

export interface FlowLink {
  from: string;
  to: string;
}

export interface FlowMeta {
  name: string;
  nodes: FlowNode[];
  links: FlowLink[];
}

export type NodeStatus = 'idle' | 'running' | 'done' | 'stale' | 'error';

export const NODE_INFO: Record<FlowNodeType, { label: string; hasInput: boolean; free: boolean }> = {
  input: { label: '圖片輸入', hasInput: false, free: true },
  cutout: { label: '去除區塊', hasInput: true, free: true },
  workshop: { label: '改部位', hasInput: true, free: false },
  pixel: { label: '像素化', hasInput: true, free: false },
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: '未執行',
  running: '執行中',
  done: '完成',
  stale: '過期: 上游改過',
  error: '失敗',
};

export function upstreamOf(flow: FlowMeta, id: string): FlowNode | null {
  const link = flow.links.find((l) => l.to === id);
  return link ? flow.nodes.find((n) => n.id === link.from) ?? null : null;
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
  return 'done';
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

/** 接上 from → to; to 原本的輸入線會被取代 */
export function connect(links: FlowLink[], from: string, to: string): FlowLink[] {
  return [...links.filter((l) => l.to !== to), { from, to }];
}

export function newNodeId(nodes: FlowNode[]): string {
  const max = nodes.reduce((m, n) => Math.max(m, Number(n.id.slice(1)) || 0), 0);
  return `n${max + 1}`;
}
