"""遊戲示意 API(前綴 /api/mockups)。"""
import copy
import json
import re
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Body, File, Form, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from ..decompose import NoClientError
from ..fal import FalClient
from ..imaging import decode_any, read_png, write_png
from ..library.store import Library
from .compose import cut_object, fit_to_canvas, overlap_suggest, paste_layer
from .geometry import canvas_size
from .prompt import build_prompt
from .store import Scene

MODEL = "gpt-image-2"
COUNT_MAX = 4
_ASCII_WORDS = re.compile(r"[A-Za-z][A-Za-z '\-]*")


def sam_prompt(label: str | None) -> str:
    """灰盒標籤裡的英文部分給 SAM 當提示; 沒有就用 object。"""
    words = " ".join(w.strip() for w in _ASCII_WORDS.findall(label or "")).strip()
    return words or "object"


def _box(v) -> list[float]:
    if not isinstance(v, list) or len(v) != 4 or any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in v):
        raise ValueError("框選範圍格式錯誤")
    x0, y0, x1, y1 = v
    return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]


def create_router(data_dir: Path, client_factory: Callable[[], FalClient | None]) -> APIRouter:
    root = Path(data_dir) / "mockups"
    library = Library(Path(data_dir) / "library")
    r = APIRouter(prefix="/api/mockups")

    def client() -> FalClient:
        c = client_factory()
        if c is None:
            raise NoClientError("沒有設定 FAL_KEY 環境變數, 無法呼叫 fal.ai")
        return c

    def scene(name: str) -> Scene:
        return Scene.open(root, name)

    @r.get("")
    def list_scenes():
        return Scene.list(root)

    @r.post("")
    def create_scene(body: dict = Body(...)):
        return Scene.create(root, body.get("name"), body.get("view"), bool(body.get("empty", False)),
                            bool(body.get("pixel", False)), body.get("camera")).meta

    @r.get("/{name}")
    def get_scene(name: str):
        return scene(name).meta

    @r.put("/{name}")
    def put_scene(name: str, body: dict = Body(...)):
        return scene(name).save(body)

    @r.post("/{name}/rename")
    def rename_scene(name: str, body: dict = Body(...)):
        s = scene(name)
        s.rename(body.get("name"))
        library.rename_source("mockup", "scene", name, s.name)
        return s.meta

    @r.delete("/{name}")
    def delete_scene(name: str):
        scene(name).delete()
        return {"ok": True}

    @r.get("/{name}/files/{path:path}")
    def get_file(name: str, path: str):
        return Response(scene(name).file_path(path).read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "no-store"})

    @r.post("/{name}/assets")
    def add_asset(name: str, body: dict = Body(...)):
        """從素材庫複製一張進場景; 那組的根沒有視角就掛上這個場景的視角。"""
        s = scene(name)
        aid = body.get("asset")
        library.get(aid)
        s.add_asset(aid, read_png(library.image_path(aid)))
        rid = library.root_of(aid)
        rmeta = library.get(rid)
        if not rmeta["tags"]["views"]:
            library.update(rid, None, {"views": [s.meta["view"]], "type": rmeta["tags"]["type"]})
        return {"scene": s.meta, "asset": library.get(aid)}

    @r.post("/{name}/render")
    async def render(name: str, greybox: UploadFile = File(...), layer: UploadFile = File(...),
                     count: int = Form(1)):
        s = scene(name)
        if not 1 <= count <= COUNT_MAX:
            raise ValueError(f"一次畫 1~{COUNT_MAX} 張")
        w, h = canvas_size(s.meta["view"])
        grey = decode_any(await greybox.read())
        lay = decode_any(await layer.read())
        for img in (grey, lay):
            if img.shape[:2] != (h, w):
                raise ValueError(f"送來的圖尺寸應為 {w}×{h}")
        if lay.ndim != 3 or lay.shape[2] != 4:
            raise ValueError("素材層要有透明通道")
        refs = [read_png(s.dir / "assets" / f"{a}.png")[..., :3] for a in s.meta["style"]["refs"]]
        prompt = build_prompt(s.meta)
        objects, style = copy.deepcopy(s.meta["objects"]), copy.deepcopy(s.meta["style"])
        c = client()
        outs = await run_in_threadpool(c.edit, MODEL, grey[..., :3], prompt, count, refs)
        for out in outs:
            s.add_candidate(paste_layer(fit_to_canvas(out, w, h), lay), prompt, objects, style)
        return s.meta

    @r.delete("/{name}/candidates/{cid}")
    def delete_candidate(name: str, cid: str):
        return scene(name).delete_candidate(cid)

    @r.post("/{name}/candidates/{cid}/cut")
    async def cut(name: str, cid: str, body: dict = Body(...)):
        """框選去背預覽, 存成 cut.png; 預設名稱與類型取框到最多的灰盒(用候選當時的配置)。"""
        s = scene(name)
        box = _box(body.get("box"))
        img = s.candidate_image(cid)
        hit = overlap_suggest(s.candidate(cid)["objects"], s.meta["view"], box)
        rgba = await run_in_threadpool(cut_object, client(), img, box, sam_prompt(hit["label"] if hit else None))
        write_png(s.dir / "cut.png", rgba)
        info = {"candidate": cid, "box": box, "name": hit["label"] if hit else f"{name} 截圖",
                "type": hit.get("type") if hit else None}
        (s.dir / "cut.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
        return {"file": "cut.png", "name": info["name"], "type": info["type"]}

    @r.post("/{name}/candidates/{cid}/cut/save")
    def save_cut(name: str, cid: str, body: dict = Body(...)):
        s = scene(name)
        p = s.dir / "cut.json"
        info = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None
        if not info or info["candidate"] != cid or not (s.dir / "cut.png").is_file():
            raise ValueError("先做去背預覽再存")
        source = {"kind": "mockup", "scene": name, "candidate": cid}
        return library.add(read_png(s.dir / "cut.png"), body.get("name"), source, tags=body.get("tags"))

    return r
