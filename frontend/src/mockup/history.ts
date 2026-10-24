/** 復原/重做堆疊: push 存「改之前」的狀態; undo/redo 傳入目前狀態, 回傳要換成的狀態(沒有回 null)。 */
export function createHistory<T>(limit = 100) {
  let past: T[] = [];
  let future: T[] = [];
  return {
    push(s: T) {
      past.push(s);
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(cur: T): T | null {
      const s = past.pop();
      if (s === undefined) return null;
      future.push(cur);
      return s;
    },
    redo(cur: T): T | null {
      const s = future.pop();
      if (s === undefined) return null;
      past.push(cur);
      return s;
    },
    clear() {
      past = [];
      future = [];
    },
  };
}
