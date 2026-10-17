/** 頁面共用的小工具。 */

type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { text?: string; className?: string; href?: string; title?: string } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.text !== undefined) node.textContent = props.text;
  if (props.className) node.className = props.className;
  if (props.href && node instanceof HTMLAnchorElement) node.href = props.href;
  if (props.title) node.title = props.title;
  node.append(...children);
  return node;
}

/** 會花錢(呼叫 fal.ai)的按鈕: 加錢的圖示、換顏色 */
export function markPaid<T extends HTMLElement>(b: T): T {
  b.classList.add('paid');
  return b;
}

/** 付費按鈕旁的「約 X 美元」 */
export function costNote(text = ''): HTMLSpanElement {
  return el('span', { className: 'cost-note', text });
}

export function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

export function showBanner(node: HTMLElement, kind: 'error' | 'warn' | 'info' | null, text = '') {
  node.className = kind ? `banner ${kind}` : '';
  node.textContent = kind ? text : '';
}

/** 刪除前確認; 會直接從硬碟刪掉, 無法復原。 */
export function confirmDelete(what: string): boolean {
  return confirm(`確定要刪除${what}嗎?
會直接從硬碟刪掉, 無法復原。`);
}
