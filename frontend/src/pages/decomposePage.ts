export function mountDecomposePage(el: HTMLElement, _params: URLSearchParams): () => void {
  el.textContent = '建置中';
  return () => {};
}
