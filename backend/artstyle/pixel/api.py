"""像素素材 API(前綴 /api/pixel)。"""
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Body, File, Form, UploadFile
from fastapi.responses import Response

from ..decompose import NoClientError
from ..fal import FalClient
from ..pack import Pack
from ..proportion.work import Work
from . import service
from .work import PixelWork

def create_router(data_dir: Path, client_factory: Callable[[], FalClient | None]) -> APIRouter:
    works_dir = Path(data_dir) / "pixel"
    packs_dir = Path(data_dir) / "packs"
    workshop_dir = Path(data_dir) / "proportion"
    r = APIRouter(prefix="/api/pixel")

    def client() -> FalClient:
        c = client_factory()
        if c is None:
            raise NoClientError("沒有設定 FAL_KEY 環境變數, 無法呼叫 fal.ai")
        return c

    def open_work(name: str) -> PixelWork:
        return PixelWork.open(works_dir, name)

    @r.get("/works")
    def list_works():
        return PixelWork.list(works_dir)

    @r.get("/workshop-results")
    def workshop_results():
        out = []
        for w in Work.list(workshop_dir):
            try:
                out += [{"work": w["name"], "id": res["id"]} for res in Work.open(workshop_dir, w["name"]).meta["results"]]
            except (ValueError, KeyError, TypeError, FileNotFoundError):
                continue
        return out

    @r.post("/works")
    async def create_work(name: str = Form(...), file: UploadFile | None = File(None), pack: str | None = Form(None),
                          workshop: str | None = Form(None)):
        if pack:
            data, label = Pack.open(packs_dir, pack).path("source").read_bytes(), f"分層包 {pack}"
        elif workshop:
            wname, _, rid = workshop.rpartition("/")
            data = Work.open(workshop_dir, wname).file_path(f"results/{rid}.png").read_bytes()
            label = f"部位工坊 {wname} {rid}"
        elif file is not None:
            data, label = await file.read(), Path(file.filename or "圖片").stem
        else:
            raise ValueError("請上傳圖片、選擇分層包或部位工坊結果")
        return PixelWork.create(works_dir, name, data, label).meta

    @r.get("/works/{name}")
    def get_work(name: str):
        return open_work(name).meta

    @r.delete("/works/{name}")
    def delete_work(name: str):
        open_work(name).delete()
        return {"ok": True}

    @r.get("/works/{name}/files/{path:path}")
    def get_file(name: str, path: str):
        return Response(open_work(name).file_path(path).read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "no-store"})

    @r.post("/works/{name}/candidates")
    def add_candidates(name: str, body: dict = Body(...)):
        return service.generate(open_work(name), body, client())

    @r.post("/works/{name}/convert")
    def convert(name: str, body: dict = Body(...)):
        work = open_work(name)
        return service.convert(work, body, work.source())

    @r.delete("/works/{name}/candidates/{cid}")
    def delete_candidate(name: str, cid: str):
        work = open_work(name)
        work.delete_candidate(cid)
        return work.meta

    @r.post("/works/{name}/candidates/{cid}/pixelate")
    def pixelate(name: str, cid: str, body: dict | None = Body(default=None)):
        return service.pixelate(open_work(name), cid, body)

    return r
