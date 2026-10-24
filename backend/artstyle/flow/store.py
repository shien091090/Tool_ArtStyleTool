"""節點流程: flow.json 存節點與連線, out/ 放各節點輸出, nodes/ 放需要自己資料夾的節點(像素化)。"""
import json
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path

import numpy as np

from ..imaging import read_png, write_png
from ..names import validate_name

TYPES = ("input", "cutout", "pixel", "workshop", "style")
_ID = re.compile(r"n[0-9]{1,6}")
_FILE = re.compile(r"out/n[0-9]{1,6}\.png|nodes/n[0-9]{1,6}/(source\.png|ai/c[0-9]+(_[a-z_]+)?\.png)")

# 移動節點存檔與輸出存檔可能同時進來, flow.json 的讀改寫一律在這把鎖裡
_lock = threading.RLock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _has_cycle(ids: list[str], links: list[dict]) -> bool:
    nxt: dict[str, list[str]] = {i: [] for i in ids}
    for l in links:
        nxt[l["from"]].append(l["to"])
    state: dict[str, int] = {}  # 1 走訪中, 2 完成

    def visit(n: str) -> bool:
        state[n] = 1
        for m in nxt[n]:
            if state.get(m) == 1 or (m not in state and visit(m)):
                return True
        state[n] = 2
        return False

    return any(n not in state and visit(n) for n in ids)


def check_graph(body) -> tuple[list[dict], list[dict]]:
    """驗證前端送來的圖結構, 回傳整理過的 (nodes, links)。"""
    if not isinstance(body, dict) or not isinstance(body.get("nodes"), list) or not isinstance(body.get("links"), list):
        raise ValueError("流程格式錯誤")
    nodes, seen = [], set()
    for n in body["nodes"]:
        if not isinstance(n, dict):
            raise ValueError("節點格式錯誤")
        nid = n.get("id")
        if not isinstance(nid, str) or not _ID.fullmatch(nid):
            raise ValueError(f"節點編號不合法: {nid!r}")
        if nid in seen:
            raise ValueError(f"節點編號重複: {nid}")
        seen.add(nid)
        if n.get("type") not in TYPES:
            raise ValueError(f"未知的節點種類: {n.get('type')!r}")
        x, y = n.get("x"), n.get("y")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, y)):
            raise ValueError("節點座標必須是數字")
        params = n.get("params", {})
        if not isinstance(params, dict):
            raise ValueError("節點參數格式錯誤")
        nodes.append({"id": nid, "type": n["type"], "x": x, "y": y, "params": params})
    types = {n["id"]: n["type"] for n in nodes}
    links, targets, pairs = [], set(), set()
    for l in body["links"]:
        if not isinstance(l, dict) or l.get("from") not in types or l.get("to") not in types:
            raise ValueError("連線指到不存在的節點")
        if types[l["to"]] == "input":
            raise ValueError("圖片輸入節點不能接輸入")
        port = l.get("port")
        if port not in (None, "main", "material"):
            raise ValueError(f"未知的接點: {port!r}")
        if (l["from"], l["to"]) in pairs:
            raise ValueError("同一對節點之間只能有一條連線")
        pairs.add((l["from"], l["to"]))
        if port == "material":
            if types[l["to"]] != "workshop":
                raise ValueError("只有改部位節點有素材接點")
            links.append({"from": l["from"], "to": l["to"], "port": "material"})
            continue
        if l["to"] in targets:
            raise ValueError(f"節點 {l['to']} 只能接一條輸入")
        targets.add(l["to"])
        links.append({"from": l["from"], "to": l["to"]})
    if _has_cycle(list(types), links):
        raise ValueError("連線不能繞成迴圈")
    return nodes, links


class Flow:
    def __init__(self, root: Path, name: str, meta: dict):
        self.root = Path(root)
        self.name = name
        self.dir = self.root / name
        self.meta = meta

    # ---- 流程本身 ----

    @classmethod
    def create(cls, root, name: str) -> "Flow":
        validate_name(name)
        d = Path(root) / name
        if d.exists():
            raise FileExistsError(f"流程「{name}」已存在")
        now = _now()
        flow = cls(root, name, {"version": 1, "name": name, "created": now, "updated": now, "nodes": [], "links": []})
        (d / "out").mkdir(parents=True)
        flow._save()
        return flow

    @classmethod
    def open(cls, root, name: str) -> "Flow":
        validate_name(name)
        p = Path(root) / name / "flow.json"
        if not p.is_file():
            raise FileNotFoundError(f"找不到流程「{name}」")
        return cls(root, name, json.loads(p.read_text(encoding="utf-8")))

    @classmethod
    def list(cls, root) -> list[dict]:
        root = Path(root)
        if not root.is_dir():
            return []
        out = []
        for d in sorted(root.iterdir()):
            p = d / "flow.json"
            if not p.is_file():
                continue
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
                out.append({"name": m["name"], "updated": m.get("updated"), "nodes": len(m.get("nodes", []))})
            except (ValueError, KeyError, TypeError):
                continue
        return out

    def delete(self) -> None:
        shutil.rmtree(self.dir)

    def _save(self) -> None:
        self.meta["updated"] = _now()
        tmp = self.dir / "flow.json.tmp"
        tmp.write_text(json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.dir / "flow.json")

    def _reload(self) -> None:
        self.meta = json.loads((self.dir / "flow.json").read_text(encoding="utf-8"))

    # ---- 圖結構 ----

    def node(self, nid: str) -> dict:
        for n in self.meta["nodes"]:
            if n["id"] == nid:
                return n
        raise FileNotFoundError(f"找不到節點 {nid}")

    def upstream(self, nid: str) -> dict | None:
        """主圖輸入的上游節點。"""
        for l in self.meta["links"]:
            if l["to"] == nid and l.get("port") != "material":
                return self.node(l["from"])
        return None

    def main_chain(self, nid: str) -> list[dict]:
        """從 nid 沿主圖輸入一路往上: [nid 節點, 上游, 上上游, ...]。"""
        chain = [self.node(nid)]
        while (up := self.upstream(chain[-1]["id"])) is not None:
            chain.append(up)
        return chain

    def chain_stale(self, nid: str) -> bool:
        """鏈上任一節點沒輸出、沒接上游, 或用的不是上游目前的版本(含改接到別的上游)。"""
        chain = self.main_chain(nid)
        if any(not n.get("rev") for n in chain) or chain[-1]["type"] != "input":
            return True
        return any(n["type"] != "input" and (n.get("inputRev") != up.get("rev")
                                             or n.get("inputFrom", up["id"]) not in (None, up["id"]))
                   for n, up in zip(chain, chain[1:]))

    def materials(self, nid: str) -> list[dict]:
        """接到素材接點的上游節點。"""
        return [self.node(l["from"]) for l in self.meta["links"] if l["to"] == nid and l.get("port") == "material"]

    def set_graph(self, body) -> dict:
        nodes, links = check_graph(body)
        with _lock:
            self._reload()
            old = {n["id"]: n for n in self.meta["nodes"]}
            for n in nodes:  # 輸出版本與錯誤只由後端改
                o = old.get(n["id"])
                same = o is not None and o["type"] == n["type"]
                n.update(rev=o["rev"] if same else 0, inputRev=o["inputRev"] if same else None,
                         inputFrom=o.get("inputFrom") if same else None,
                         error=o.get("error") if same else None)
                if o is not None and not same:
                    self._remove_files(n["id"])
            for nid in old.keys() - {n["id"] for n in nodes}:
                self._remove_files(nid)
            self.meta["nodes"], self.meta["links"] = nodes, links
            self._save()
            return self.meta

    def _remove_files(self, nid: str) -> None:
        (self.dir / "out" / f"{nid}.png").unlink(missing_ok=True)
        shutil.rmtree(self.dir / "nodes" / nid, ignore_errors=True)

    # ---- 輸出 ----

    def set_output(self, nid: str, img: np.ndarray, input_rev: int | None, params: dict | None = None) -> dict:
        with _lock:
            self._reload()
            n = self.node(nid)
            write_png(self.dir / "out" / f"{nid}.png", img)
            n["rev"] = n.get("rev", 0) + 1
            n["inputRev"] = input_rev
            # 記下用的是哪個上游: 改接線後版本號可能碰巧相同, 只比版本會誤判成最新
            up = self.upstream(nid) if input_rev is not None else None
            n["inputFrom"] = up["id"] if up else None
            n["error"] = None
            if params is not None:
                n["params"] = params
            self._save()
            return self.meta

    def link_asset(self, nid: str, aid: str, name: str) -> dict:
        """圖片輸入改記成來自素材庫的某張(圖不變, 不加版本, 下游不會變過期)。"""
        with _lock:
            self._reload()
            n = self.node(nid)
            n["params"] = {**n["params"], "source": name, "asset": aid}
            self._save()
            return self.meta

    def output(self, nid: str) -> np.ndarray:
        n = self.node(nid)
        p = self.dir / "out" / f"{nid}.png"
        if not n.get("rev") or not p.is_file():
            raise ValueError(f"節點 {nid} 還沒有輸出")
        return read_png(p)

    def file_path(self, rel: str) -> Path:
        if not _FILE.fullmatch(rel):
            raise FileNotFoundError("找不到檔案")
        p = self.dir / rel
        if not p.is_file():
            raise FileNotFoundError("找不到檔案")
        return p
