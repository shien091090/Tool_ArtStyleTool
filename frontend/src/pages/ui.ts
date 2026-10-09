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
