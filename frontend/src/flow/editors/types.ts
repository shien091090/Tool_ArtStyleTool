import type { FlowMeta, FlowNode } from '../model';

export type OutputSource = { file: Blob } | { pack: string } | { workshop: string };

export interface EditorContext {
  flowName: string;
  node: FlowNode;
  upstream: FlowNode | null;
  /** 上游輸出圖網址; 上游沒有輸出時為 null */
  upstreamUrl: string | null;
  outputUrl: string | null;
  falOk: boolean;
  banner: HTMLElement;
  status: HTMLElement;
  /** 存成節點輸出, 之後由頁面往下游自動重跑 */
  save(source: OutputSource, opts?: { inputRev?: number | null; params?: Record<string, unknown> }): Promise<FlowMeta>;
}

export interface NodeEditor {
  /** 有未套用的修改時回傳提示文字 */
  unsaved(): string | null;
  dispose(): void;
}
