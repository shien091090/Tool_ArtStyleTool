"""像素素材 API(前綴 /api/pixel)。"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Body, File, Form, UploadFile
from fastapi.responses import Response

from ..decompose import NoClientError
from ..fal import KONTEXT_MODEL, FalClient, FalError
from ..imaging import to_data_uri
from ..pack import Pack
from ..proportion.work import Work
from . import downscale, prompts
from .work import PixelWork

MODELS = ("kontext", "nano-banana-pro")
MAX_NOTE = 200


def _int(v, lo: int, hi: int, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"{what}必須是 {lo}~{hi} 的整數")
    return v


def check_settings(body) -> dict:
    if not isinstance(body, dict):
        raise ValueError("設定格式錯誤")
    mode = body.get("mode")
    if mode not in ("auto", "grid"):
        raise ValueError("尺寸模式必須是 auto 或 grid")
    if mode == "grid":
        model = "nano-banana-pro"  # 只有 Pro 會照格數畫
        cols = _int(body.get("cols"), 1, prompts.MAX_CELLS, "寬格數")
        rows = _int(body.get("rows"), 1, prompts.MAX_CELLS, "高格數")
    else:
        model, cols, rows = body.get("model"), 0, 0
        if model not in MODELS:
            raise ValueError(f"不支援的模型: {model!r}")
    colors = body.get("colors")
    colors = prompts.default_colors(mode, cols, rows) if colors is None else _int(colors, 2, 64, "色數")
    note = body.get("note") or ""
    if not isinstance(note, str) or len(note) > MAX_NOTE:
        raise ValueError(f"補充描述必須是 {MAX_NOTE} 字以內的文字")
    count = _int(body.get("count", 1), 1, 4, "候選張數")
    return {"mode": mode, "model": model, "cols": cols, "rows": rows, "colors": colors, "note": note.strip(), "count": count}


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
        work = open_work(name)
        s = check_settings(body)
        src = work.source()
        img = prompts.prepare(src, s["mode"], s["cols"], s["rows"])
        prompt = prompts.build_prompt(src, s["mode"], s["colors"], s["note"], s["cols"], s["rows"])
        c = client()
        errors: list[str] = []
        if s["model"] == "kontext":
            # Kontext 一次一張, 平行呼叫
            with ThreadPoolExecutor(s["count"]) as pool:
                futures = [pool.submit(c.run_image, KONTEXT_MODEL, img, prompt=prompt) for _ in range(s["count"])]
            images = []
            for f in futures:
                try:
                    images.append(f.result())
                except FalError as e:
                    errors.append(str(e))
            if not images:
                raise FalError(errors[0])
        else:
            images = c.edit("nano-banana-pro", img, prompt, s["count"])
        settings = {k: s[k] for k in ("mode", "model", "cols", "rows", "colors", "note")}
        added = [work.add_candidate(im, settings) for im in images[:s["count"]]]
        if len(added) < s["count"] and not errors:
            errors.append(f"要求 {s['count']} 張, AI 只回傳 {len(added)} 張")
        return {"meta": work.meta, "candidates": added, "errors": errors}

    @r.delete("/works/{name}/candidates/{cid}")
    def delete_candidate(name: str, cid: str):
        work = open_work(name)
        work.delete_candidate(cid)
        return work.meta

    @r.post("/works/{name}/candidates/{cid}/pixelate")
    def pixelate(name: str, cid: str, body: dict | None = Body(default=None)):
        work = open_work(name)
        cand = work.candidate(cid)
        img = work.candidate_image(cid)
        colors = (body or {}).get("colors")
        colors = cand["colors"] if colors is None else _int(colors, 2, 64, "色數")
        methods = ["auto"] if cand["mode"] == "auto" else ["dominant", "contrast", "adaptive"]
        results = []
        for m in methods:
            entry = {"method": m, "label": downscale.METHODS[m]}
            try:
                out = downscale.run(m, img, colors, cand["cols"], cand["rows"])
                entry.update(png=to_data_uri(out), w=int(out.shape[1]), h=int(out.shape[0]),
                             palette=downscale.palette(out))
            except Exception as e:  # 單一方法失敗不影響其他方法
                entry["error"] = f"縮小失敗: {e}"
            results.append(entry)
        return {"results": results, "colors": colors}

    return r
