/** 改過名的頁籤: 舊路徑 → 新路徑(保留 query, 舊連結照樣能開)。 */
const RENAMED: Record<string, string> = { proportion: 'workshop' };

export function canonicalPath(path: string): string {
  return RENAMED[path] ?? path;
}
