"""FastAPI 本機伺服器。啟動: uvicorn artstyle.server:app --host 127.0.0.1 --port 8765"""
from pathlib import Path
from typing import Callable

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from . import config, decompose, recipes
from .fal import FalClient, FalError, HttpFalClient
from .pack import LAYERS, Pack


def _default_client() -> FalClient | None:
    return HttpFalClient(config.FAL_KEY) if config.FAL_KEY else None


def create_app(data_dir: Path, client_factory: Callable[[], FalClient | None] = _default_client) -> FastAPI:
    packs_dir = Path(data_dir) / "packs"
    recipes_dir = Path(data_dir) / "recipes"
    app = FastAPI(title="美術風格探索工具")

    def error(status: int):
        def handler(_: Request, exc: Exception):
            return JSONResponse(status_code=status, content={"detail": str(exc)})
        return handler

    app.add_exception_handler(ValueError, error(400))
    app.add_exception_handler(FileNotFoundError, error(404))
    app.add_exception_handler(FileExistsError, error(409))
    app.add_exception_handler(FalError, error(502))
    app.add_exception_handler(decompose.NoClientError, error(503))

    def open_pack(name: str) -> Pack:
        return Pack.open(packs_dir, name)

    @app.get("/api/status")
    def status():
        return {"fal": client_factory() is not None}

    @app.get("/api/packs")
    def list_packs():
        return Pack.list(packs_dir)

    @app.post("/api/packs")
    async def create_pack(name: str = Form(...), file: UploadFile = File(...)):
        return Pack.create(packs_dir, name, await file.read()).meta

    @app.get("/api/packs/{name}")
    def get_pack(name: str):
        return open_pack(name).meta

    @app.get("/api/packs/{name}/files/{filename}")
    def get_file(name: str, filename: str):
        layer = filename.removesuffix(".png")
        if not filename.endswith(".png") or layer not in LAYERS:
            raise HTTPException(404, "找不到檔案")
        pack = open_pack(name)
        if not pack.has(layer):
            raise HTTPException(404, f"分層包還沒有「{layer}」層")
        return Response(pack.path(layer).read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "no-store"})

    @app.post("/api/packs/{name}/steps/{step}")
    def run_step(name: str, step: str, params: dict | None = Body(default=None)):
        pack = open_pack(name)
        if step not in decompose.STEPS:
            raise ValueError(f"未知的步驟: {step}")
        decompose.run_step(pack, step, client_factory(), **(params or {}))
        return pack.meta

    @app.post("/api/packs/{name}/decompose")
    def run_all(name: str):
        pack = open_pack(name)
        decompose.run_all(pack, client_factory())
        return pack.meta

    @app.put("/api/packs/{name}/layers/{layer}")
    async def replace_layer(name: str, layer: str, file: UploadFile = File(...)):
        pack = open_pack(name)
        decompose.replace_layer(pack, layer, await file.read())
        return pack.meta

    @app.get("/api/packs/{name}/region")
    def region(name: str, x: int, y: int):
        pack = open_pack(name)
        rid = decompose.region_at(pack, y, x)
        return {"id": rid, "color": pack.meta["regions"]["colors"].get(str(rid))}

    @app.put("/api/packs/{name}/regions/{region_id}")
    def set_region(name: str, region_id: int, body: dict = Body(...)):
        pack = open_pack(name)
        decompose.set_region_color(pack, region_id, body.get("color", []))
        return pack.meta

    @app.get("/api/recipes")
    def list_recipes():
        return recipes.list_recipes(recipes_dir)

    @app.get("/api/recipes/{name}")
    def get_recipe(name: str):
        return recipes.load_recipe(recipes_dir, name)

    @app.put("/api/recipes/{name}")
    def put_recipe(name: str, data=Body(...)):
        recipes.save_recipe(recipes_dir, name, data)
        return {"ok": True}

    return app


app = create_app(config.DATA_DIR)
