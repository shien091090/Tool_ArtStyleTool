"""單一分層包的路由: 拆解檢查(/api/packs/{name})與流程改風格節點共用。"""
from typing import Callable

from fastapi import Body, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from . import decompose
from .fal import FalClient
from .pack import LAYERS, Pack


def add_pack_routes(r, base: str, resolve: Callable[[dict], Pack], client_factory: Callable[[], FalClient | None]) -> None:
    """r 是 FastAPI 或 APIRouter; resolve 由路徑參數找出分層包。"""

    @r.get(base)
    def get_pack(request: Request):
        return resolve(request.path_params).meta

    @r.get(base + "/files/{filename}")
    def get_file(request: Request, filename: str):
        layer = filename.removesuffix(".png")
        if not filename.endswith(".png") or layer not in LAYERS:
            raise HTTPException(404, "找不到檔案")
        pack = resolve(request.path_params)
        if not pack.has(layer):
            raise HTTPException(404, f"分層包還沒有「{layer}」層")
        return Response(pack.path(layer).read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "no-store"})

    @r.post(base + "/steps/{step}")
    def run_step(request: Request, step: str, params: dict | None = Body(default=None)):
        pack = resolve(request.path_params)
        if step not in decompose.STEPS and step not in decompose.EXTRA_STEPS:
            raise ValueError(f"未知的步驟: {step}")
        decompose.run_step(pack, step, client_factory(), **(params or {}))
        return pack.meta

    @r.post(base + "/decompose")
    def run_all(request: Request):
        pack = resolve(request.path_params)
        decompose.run_all(pack, client_factory())
        return pack.meta

    @r.put(base + "/layers/{layer}")
    async def replace_layer(request: Request, layer: str, file: UploadFile = File(...)):
        pack = resolve(request.path_params)
        decompose.replace_layer(pack, layer, await file.read())
        return pack.meta

    @r.get(base + "/region")
    def region(request: Request, x: int, y: int):
        pack = resolve(request.path_params)
        rid = decompose.region_at(pack, y, x)
        return {"id": rid, "color": pack.meta["regions"]["colors"].get(str(rid))}

    @r.put(base + "/regions/{region_id}")
    def set_region(request: Request, region_id: int, body: dict = Body(...)):
        pack = resolve(request.path_params)
        decompose.set_region_color(pack, region_id, body.get("color", []))
        return pack.meta
