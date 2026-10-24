"""FastAPI 本機伺服器。啟動: uvicorn artstyle.server:app --host 127.0.0.1 --port 8765"""
from pathlib import Path
from typing import Callable

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse

from . import config, decompose, lospec, recipes
from .fal import FalClient, FalError, HttpFalClient
from .flow.api import create_router as create_flow_router
from .library.api import create_router as create_library_router


APP_HEADER = "X-ArtStyle"


def _default_client() -> FalClient | None:
    return HttpFalClient(config.FAL_KEY) if config.FAL_KEY else None


def create_app(data_dir: Path, client_factory: Callable[[], FalClient | None] = _default_client) -> FastAPI:
    recipes_dir = Path(data_dir) / "recipes"
    app = FastAPI(title="美術風格探索工具")

    def error(status: int):
        def handler(_: Request, exc: Exception):
            return JSONResponse(status_code=status, content={"detail": str(exc)})
        return handler

    @app.middleware("http")
    async def require_app_header(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(APP_HEADER) != "1":
            return JSONResponse(status_code=403, content={"detail": f"缺少 {APP_HEADER} 標頭, 只接受本工具前端的請求"})
        return await call_next(request)

    app.add_exception_handler(ValueError, error(400))
    app.add_exception_handler(FileNotFoundError, error(404))
    app.add_exception_handler(FileExistsError, error(409))
    app.add_exception_handler(FalError, error(502))
    app.add_exception_handler(decompose.NoClientError, error(503))
    app.add_exception_handler(lospec.LospecError, error(502))

    @app.get("/api/status")
    def status():
        return {"fal": client_factory() is not None}

    @app.get("/api/fal/balance")
    def fal_balance():
        c = client_factory()
        if c is None:
            raise decompose.NoClientError("沒有設定 FAL_KEY 環境變數")
        return c.balance()

    @app.get("/api/lospec")
    def get_lospec(url: str):
        return lospec.fetch_palette(url)

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

    @app.delete("/api/recipes/{name}")
    def delete_recipe(name: str):
        recipes.delete_recipe(recipes_dir, name)
        return {"ok": True}

    app.include_router(create_flow_router(data_dir, client_factory))
    app.include_router(create_library_router(data_dir))
    return app


app = create_app(config.DATA_DIR)
