"""素材庫 API(前綴 /api/library)。"""
import json
from pathlib import Path, PurePath

from fastapi import APIRouter, Body, File, Form, UploadFile
from fastapi.responses import Response

from ..imaging import load_rgba
from .store import Library, check_tags


def create_router(data_dir: Path) -> APIRouter:
    lib = Library(Path(data_dir) / "library")
    r = APIRouter(prefix="/api/library")

    @r.get("")
    def list_assets():
        return lib.list()

    @r.post("")
    async def import_assets(files: list[UploadFile] = File(...), tags: str | None = Form(None)):
        try:
            t = check_tags(json.loads(tags) if tags else None)
        except json.JSONDecodeError:
            raise ValueError("標籤格式錯誤") from None
        added, errors = [], []
        for f in files:
            fname = f.filename or "image.png"
            data = await f.read()
            try:
                if not data:
                    raise ValueError("空檔案")
                img = load_rgba(data)
            except ValueError as e:
                errors.append({"file": fname, "detail": str(e)})
                continue
            added.append(lib.add(img, PurePath(fname).stem or "未命名", {"kind": "import", "file": fname}, tags=t))
        return {"added": added, "errors": errors}

    @r.get("/{aid}/image")
    def get_image(aid: str):
        # 素材圖建立後不會變
        return Response(lib.image_path(aid).read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "max-age=31536000, immutable"})

    @r.patch("/{aid}")
    def patch_asset(aid: str, body: dict = Body(...)):
        return lib.update(aid, body.get("name"), body.get("tags"))

    @r.delete("/{aid}")
    def delete_asset(aid: str):
        lib.delete(aid)
        return {"ok": True}

    return r
