"""節點流程 API(前綴 /api/flows)。"""
import json
import shutil
from pathlib import Path
from typing import Callable

import numpy as np
from fastapi import APIRouter, Body, File, Form, UploadFile
from fastapi.responses import Response

from .. import config
from ..decompose import NoClientError
from ..fal import FalClient
from ..imaging import encode_png, limit_size, load_rgba
from ..pack import Pack
from ..pack_api import add_pack_routes
from ..pixel import service
from ..pixel.work import PixelWork
from ..proportion.api import add_work_routes
from ..proportion.work import Work
from .store import Flow


def to_ai_source(img: np.ndarray) -> np.ndarray:
    """節點輸出(RGBA) → 送像素化 AI 的 RGB: 有透明先裁到不透明範圍, 再鋪白底。"""
    if img.ndim == 2:
        img = np.repeat(img[..., None], 3, axis=2)
    if img.shape[2] == 3:
        return img
    a = img[..., 3]
    ys, xs = np.nonzero(a > 0)
    if not len(xs):
        raise ValueError("上游輸出整張都是透明的")
    img = img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    alpha = img[..., 3:4].astype(np.float32) / 255
    return (img[..., :3] * alpha + 255 * (1 - alpha)).round().astype(np.uint8)


def create_router(data_dir: Path, client_factory: Callable[[], FalClient | None]) -> APIRouter:
    flows_dir = Path(data_dir) / "flows"
    packs_dir = Path(data_dir) / "packs"
    workshop_dir = Path(data_dir) / "proportion"
    r = APIRouter(prefix="/api/flows")

    def client() -> FalClient:
        c = client_factory()
        if c is None:
            raise NoClientError("沒有設定 FAL_KEY 環境變數, 無法呼叫 fal.ai")
        return c

    def open_flow(name: str) -> Flow:
        return Flow.open(flows_dir, name)

    def pixel_node(flow: Flow, nid: str) -> dict:
        n = flow.node(nid)
        if n["type"] != "pixel":
            raise ValueError(f"節點 {nid} 不是像素化節點")
        return n

    def pixel_work(flow: Flow, nid: str) -> PixelWork | None:
        try:
            return PixelWork.open(flow.dir / "nodes", nid)
        except FileNotFoundError:
            return None

    @r.get("")
    def list_flows():
        return Flow.list(flows_dir)

    @r.post("")
    def create_flow(body: dict = Body(...)):
        return Flow.create(flows_dir, body.get("name")).meta

    @r.get("/{name}")
    def get_flow(name: str):
        return open_flow(name).meta

    @r.delete("/{name}")
    def delete_flow(name: str):
        open_flow(name).delete()
        return {"ok": True}

    @r.put("/{name}/graph")
    def put_graph(name: str, body: dict = Body(...)):
        return open_flow(name).set_graph(body)

    @r.get("/{name}/files/{path:path}")
    def get_file(name: str, path: str):
        return Response(open_flow(name).file_path(path).read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "no-store"})

    @r.post("/{name}/nodes/{nid}/output")
    async def set_output(name: str, nid: str, file: UploadFile | None = File(None), pack: str | None = Form(None),
                         workshop: str | None = Form(None), inputRev: int | None = Form(None),
                         params: str | None = Form(None)):
        flow = open_flow(name)
        node = flow.node(nid)
        p = None
        if params is not None:
            try:
                p = json.loads(params)
            except ValueError:
                raise ValueError("節點參數格式錯誤") from None
            if not isinstance(p, dict):
                raise ValueError("節點參數格式錯誤")
        if (pack or workshop) and node["type"] != "input":
            raise ValueError("只有圖片輸入節點能選分層包或部位工坊結果")
        if pack:
            data = Pack.open(packs_dir, pack).path("source").read_bytes()
        elif workshop:
            wname, _, rid = workshop.rpartition("/")
            data = Work.open(workshop_dir, wname).file_path(f"results/{rid}.png").read_bytes()
        elif file is not None:
            data = await file.read()
        else:
            raise ValueError("請上傳圖片、選擇分層包或部位工坊結果")
        img = limit_size(load_rgba(data), config.MAX_SIDE)
        return flow.set_output(nid, img, inputRev if node["type"] != "input" else None, p)

    # ---- 像素化節點 ----

    @r.get("/{name}/nodes/{nid}/pixel")
    def get_pixel(name: str, nid: str):
        flow = open_flow(name)
        pixel_node(flow, nid)
        work = pixel_work(flow, nid)
        return work.meta if work else {"name": nid, "source": "", "candidates": []}

    @r.post("/{name}/nodes/{nid}/pixel/candidates")
    def add_candidates(name: str, nid: str, body: dict = Body(...)):
        flow = open_flow(name)
        pixel_node(flow, nid)
        service.check_settings(body)  # 先驗證, 參數錯就不動來源
        up = flow.upstream(nid)
        if up is None or not up.get("rev"):
            raise ValueError("上游還沒有輸出")
        src = to_ai_source(flow.output(up["id"]))
        label = f"上游 {up['id']} 第 {up['rev']} 版"
        work = pixel_work(flow, nid)
        if work is None:
            work = PixelWork.create_from_image(flow.dir / "nodes", nid, src, label)
        else:
            work.set_source(src, label)
        return service.generate(work, body, client(), extra={"inputRev": up["rev"]})

    @r.post("/{name}/nodes/{nid}/pixel/suggest")
    def suggest_sizes(name: str, nid: str):
        flow = open_flow(name)
        pixel_node(flow, nid)
        up = flow.upstream(nid)
        if up is None or not up.get("rev"):
            raise ValueError("上游還沒有輸出")
        return service.suggest_sizes(to_ai_source(flow.output(up["id"])), client())

    @r.post("/{name}/nodes/{nid}/pixel/convert")
    def convert(name: str, nid: str, body: dict = Body(...)):
        flow = open_flow(name)
        pixel_node(flow, nid)
        service.check_convert(body)
        up = flow.upstream(nid)
        if up is None or not up.get("rev"):
            raise ValueError("上游還沒有輸出")
        src = flow.output(up["id"])
        work = pixel_work(flow, nid)
        if work is None:
            work = PixelWork.create_from_image(flow.dir / "nodes", nid, to_ai_source(src), f"上游 {up['id']} 第 {up['rev']} 版")
        return service.convert(work, body, src, extra={"inputRev": up["rev"]})

    # ---- 改部位節點: 節點資料夾就是一個部位工坊作品 ----

    def workshop_node(flow: Flow, nid: str) -> dict:
        n = flow.node(nid)
        if n["type"] != "workshop":
            raise ValueError(f"節點 {nid} 不是改部位節點")
        return n

    def open_workshop(p: dict) -> Work:
        flow = open_flow(p["name"])
        workshop_node(flow, p["nid"])
        try:
            return Work.open(flow.dir / "nodes", p["nid"])
        except FileNotFoundError:
            raise FileNotFoundError("這個節點還沒有建立作品") from None

    @r.get("/{name}/nodes/{nid}/workshop/status")
    def workshop_status(name: str, nid: str):
        flow = open_flow(name)
        workshop_node(flow, nid)
        try:
            work = Work.open(flow.dir / "nodes", nid)
        except FileNotFoundError:
            return {"exists": False, "inputRev": None}
        return {"exists": True, "inputRev": work.meta.get("inputRev")}

    @r.post("/{name}/nodes/{nid}/workshop/init")
    def workshop_init(name: str, nid: str):
        """以上游輸出建立作品(已存在就整個重建)。"""
        flow = open_flow(name)
        workshop_node(flow, nid)
        up = flow.upstream(nid)
        if up is None or not up.get("rev"):
            raise ValueError("上游還沒有輸出")
        data = encode_png(to_ai_source(flow.output(up["id"])))
        root = flow.dir / "nodes"
        shutil.rmtree(root / nid, ignore_errors=True)
        work = Work.create(root, nid, data, f"上游 第 {up['rev']} 版")
        work.meta["inputRev"] = up["rev"]
        work.save_meta()
        return work.meta

    def material_source(flow: Flow, src: dict) -> np.ndarray:
        return to_ai_source(flow.output(src["id"]))

    @r.post("/{name}/nodes/{nid}/workshop/materials/sync")
    def workshop_sync_materials(name: str, nid: str, body: dict | None = Body(default=None)):
        """作品的素材圖對齊素材線: 新接的加入、拔掉的刪除、來源換圖且還沒切部位的直接換新圖。"""
        names = (body or {}).get("names") or {}
        if not isinstance(names, dict):
            raise ValueError("素材名稱格式錯誤")
        flow = open_flow(name)
        work = open_workshop({"name": name, "nid": nid})
        srcs = {n["id"]: n for n in flow.materials(nid)}
        for im in [im for im in work.meta["images"] if im.get("source")]:
            src = srcs.get(im["source"])
            used = any(p["image"] == im["id"] for p in work.meta["parts"])
            if src is None or (src.get("rev") and im.get("inputRev") != src["rev"] and not used):
                work.remove_image(im["id"])
        have = {im.get("source") for im in work.meta["images"]}
        for sid, src in srcs.items():
            if sid in have or not src.get("rev"):
                continue
            label = names.get(sid) if isinstance(names.get(sid), str) else sid
            work.add_image_rgb(material_source(flow, src), label, source=sid, inputRev=src["rev"])
        return work.meta

    @r.post("/{name}/nodes/{nid}/workshop/materials/{src}/refresh")
    def workshop_refresh_material(name: str, nid: str, src: str):
        """素材改用來源的新輸出, 從舊素材切出的部位一起清掉。"""
        flow = open_flow(name)
        work = open_workshop({"name": name, "nid": nid})
        node = next((n for n in flow.materials(nid) if n["id"] == src), None)
        if node is None:
            raise FileNotFoundError("這個節點沒有接上那張素材")
        img = material_source(flow, node)
        old = next((im for im in work.meta["images"] if im.get("source") == src), None)
        label = old["name"] if old else src
        if old:
            work.remove_image(old["id"])
        work.add_image_rgb(img, label, source=src, inputRev=node["rev"])
        return work.meta

    add_work_routes(r, "/{name}/nodes/{nid}/workshop", open_workshop, lambda p: f"{p['name']}-{p['nid']}", client,
                    packs_dir)

    # ---- 改風格節點: 節點資料夾就是一個分層包 ----

    def style_node(flow: Flow, nid: str) -> dict:
        n = flow.node(nid)
        if n["type"] != "style":
            raise ValueError(f"節點 {nid} 不是改風格節點")
        return n

    def open_style(p: dict) -> Pack:
        flow = open_flow(p["name"])
        style_node(flow, p["nid"])
        try:
            return Pack.open(flow.dir / "nodes", p["nid"])
        except FileNotFoundError:
            raise FileNotFoundError("這個節點還沒有建立分層包") from None

    @r.get("/{name}/nodes/{nid}/style/status")
    def style_status(name: str, nid: str):
        flow = open_flow(name)
        style_node(flow, nid)
        try:
            pack = Pack.open(flow.dir / "nodes", nid)
        except FileNotFoundError:
            return {"exists": False, "inputRev": None}
        return {"exists": True, "inputRev": pack.meta.get("inputRev")}

    @r.post("/{name}/nodes/{nid}/style/init")
    def style_init(name: str, nid: str):
        """以上游輸出建立分層包(已存在就整個重建)。"""
        flow = open_flow(name)
        style_node(flow, nid)
        up = flow.upstream(nid)
        if up is None or not up.get("rev"):
            raise ValueError("上游還沒有輸出")
        data = encode_png(to_ai_source(flow.output(up["id"])))
        root = flow.dir / "nodes"
        shutil.rmtree(root / nid, ignore_errors=True)
        pack = Pack.create(root, nid, data)
        pack.meta["inputRev"] = up["rev"]
        pack.save_meta()
        return pack.meta

    add_pack_routes(r, "/{name}/nodes/{nid}/style", open_style, client_factory)

    def existing_work(flow: Flow, nid: str) -> PixelWork:
        pixel_node(flow, nid)
        work = pixel_work(flow, nid)
        if work is None:
            raise FileNotFoundError("這個節點還沒有候選")
        return work

    @r.delete("/{name}/nodes/{nid}/pixel/candidates/{cid}")
    def delete_candidate(name: str, nid: str, cid: str):
        work = existing_work(open_flow(name), nid)
        work.delete_candidate(cid)
        return work.meta

    @r.post("/{name}/nodes/{nid}/pixel/candidates/{cid}/pixelate")
    def pixelate(name: str, nid: str, cid: str, body: dict | None = Body(default=None)):
        return service.pixelate(existing_work(open_flow(name), nid), cid, body)

    return r
