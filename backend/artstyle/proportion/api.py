"""部位比例 API(前綴 /api/proportion)。單一作品的路由抽成 add_work_routes, 流程的改部位節點也掛同一份。"""
import json
from pathlib import Path
from typing import Callable

import numpy as np
from fastapi import APIRouter, Body, File, Form, Request, UploadFile
from fastapi.responses import Response

from .. import recipes as recipe_files
from ..decompose import NoClientError
from ..fal import EDIT_MODELS, FalClient
from ..imaging import decode_any, limit_size, load_rgb, to_gray
from ..names import validate_name
from ..pack import Pack
from . import compose, material as materials, parts, recipes, suggest
from .work import Work, rebase_transform

MAX_EXTRA = 500


def _points(raw, w: int, h: int) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > 50:
        raise ValueError("修正點格式錯誤")
    out = []
    for p in raw:
        if not isinstance(p, dict):
            raise ValueError("修正點格式錯誤")
        x, y, label = p.get("x"), p.get("y"), p.get("label")
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in (x, y)) or label not in (0, 1):
            raise ValueError("修正點必須是整數座標與 0/1 標記")
        if not (0 <= x < w and 0 <= y < h):
            raise ValueError("修正點超出圖片範圍")
        out.append({"x": x, "y": y, "label": label})
    return out


def _box(raw, w: int, h: int):
    if raw is None:
        return None
    keys = ("x_min", "y_min", "x_max", "y_max")
    if not isinstance(raw, dict) or not all(isinstance(raw.get(k), int) and not isinstance(raw.get(k), bool) for k in keys):
        raise ValueError("框選範圍格式錯誤")
    b = {k: raw[k] for k in keys}
    b["x_min"], b["x_max"] = max(0, b["x_min"]), min(w - 1, b["x_max"])
    b["y_min"], b["y_max"] = max(0, b["y_min"]), min(h - 1, b["y_max"])
    if b["x_max"] - b["x_min"] < 2 or b["y_max"] - b["y_min"] < 2:
        raise ValueError("框選範圍太小")
    return b


def client_getter(client_factory: Callable[[], FalClient | None]) -> Callable[[], FalClient]:
    def client() -> FalClient:
        c = client_factory()
        if c is None:
            raise NoClientError("沒有設定 FAL_KEY 環境變數, 無法呼叫 fal.ai(本機調整仍可使用)")
        return c
    return client


async def read_source(packs_dir: Path, file: UploadFile | None, pack: str | None) -> tuple[bytes, str]:
    if pack:
        return Pack.open(packs_dir, pack).path("source").read_bytes(), pack
    if file is None:
        raise ValueError("請上傳圖片或選擇分層包")
    return await file.read(), Path(file.filename or "圖片").stem


def add_work_routes(r: APIRouter, base: str, resolve: Callable[[dict], Work], pack_base: Callable[[dict], str],
                    client: Callable[[], FalClient], packs_dir: Path) -> None:
    """單一作品的路由; resolve 以路徑參數開啟作品, pack_base 是送到拆解檢查時分層包名稱的開頭。"""

    def segment(c: FalClient, img: np.ndarray, name: str, points: list, box, aliases: dict) -> np.ndarray:
        boxes = [box] if box else []
        merged = parts.merge_masks(c.segment(img, parts.to_prompt(name, aliases), points, boxes), img.shape[:2])
        if not merged.any() and (points or boxes):
            # 細部位名稱 SAM 常認不得: 有點選或框選時改成只靠位置再試一次
            merged = parts.merge_masks(c.segment(img, "", points, boxes), img.shape[:2])
        return merged

    @r.get(base)
    def get_work(request: Request):
        return resolve(request.path_params).meta

    @r.get(base + "/files/{folder}/{filename}")
    def get_file(request: Request, folder: str, filename: str):
        path = resolve(request.path_params).file_path(f"{folder}/{filename}")
        media = "application/json" if path.suffix == ".json" else "image/png"
        return Response(path.read_bytes(), media_type=media, headers={"Cache-Control": "no-store"})

    @r.post(base + "/images")
    async def add_image(request: Request, file: UploadFile | None = File(None), pack: str | None = Form(None)):
        work = resolve(request.path_params)
        data, label = await read_source(packs_dir, file, pack)
        work.add_image(data, label)
        return work.meta

    @r.post(base + "/parts")
    def add_parts(request: Request, body: dict = Body(...)):
        work = resolve(request.path_params)
        image_id = body.get("image", "main")
        img = work.image_rgb(image_id)
        names = []
        for n in body.get("names") or []:
            if not isinstance(n, str):
                raise ValueError("部位名稱必須是文字")
            names += [x for x in parts.split_names(n) if x not in names]
        if not names:
            raise ValueError("請輸入至少一個部位名稱")
        h, w = img.shape[:2]
        points = _points(body.get("points"), w, h)
        box = _box(body.get("box"), w, h)
        if (points or box) and len(names) != 1:
            raise ValueError("用點選或框選新增部位時一次只能一個名稱")
        c = client()
        missing = []
        for n in names:
            mask = segment(c, img, n, points, box, work.aliases())
            if mask.any():
                work.add_part(n, image_id, mask, points, box)
            else:
                missing.append(n)
        return {"meta": work.meta, "missing": missing}

    @r.post(base + "/parts/{part_id}/refine")
    def refine_part(request: Request, part_id: str, body: dict = Body(...)):
        work = resolve(request.path_params)
        part = work.part(part_id)
        info = work.image_info(part["image"])
        points = _points(body.get("points"), info["w"], info["h"])
        box = _box(body.get("box"), info["w"], info["h"])
        img = work.image_rgb(part["image"])
        c = client()
        if box != part["box"] or not points:
            # 換框(或清掉點)= 以名稱 + 框重切, 之前的點作廢
            mask = segment(c, img, part["name"], [], box, work.aliases())
            points = []
        else:
            # 點選是集合運算: 實測 SAM 帶名稱時會忽略名稱以外的點, 所以每個新點單獨切出點到的物件再加/減
            mask = work.mask(part_id)
            new_points = [p for p in points if p not in part["points"]]
            if not new_points:
                raise ValueError("沒有新的修正點")
            for p in new_points:
                hit = parts.merge_masks(c.segment(img, "", [{**p, "label": 1}], []), img.shape[:2])
                if not hit.any():
                    raise ValueError(f"點 ({p['x']}, {p['y']}) 沒有切到任何東西, 已保留上一版")
                mask = mask | hit if p["label"] == 1 else np.where(hit > 0, 0, mask).astype(np.uint8)
        if not mask.any():
            raise ValueError("修正後沒有切到任何範圍, 已保留上一版")
        work.update_part_mask(part_id, mask, points, box)
        return work.meta

    @r.post(base + "/parts/{part_id}/undo-mask")
    def undo_mask(request: Request, part_id: str):
        work = resolve(request.path_params)
        work.undo_mask(part_id)
        return work.meta

    @r.post(base + "/parts/{part_id}/split")
    def split_part(request: Request, part_id: str):
        work = resolve(request.path_params)
        part = work.part(part_id)
        left, right = parts.split_left_right(work.mask(part_id))
        name = parts.to_display_name(part["name"])
        old_bbox, old_transform = part["bbox"], dict(part["transform"])
        work.update_part_mask(part_id, left, [], None, record=False)  # 內部會重算 dx/dy, 位置不跳; 拆開後不能單獨復原
        part["name"] = f"{name}(左)"
        new = work.add_part(f"{name}(右)", part["image"], right, [], None)
        new.update(placed=part["placed"], place=part["place"],
                   transform={**rebase_transform(old_transform, part["place"], old_bbox, new["bbox"]), "z": new["transform"]["z"]})
        work.copy_materials(part_id, new["id"])  # 內部會存檔
        return work.meta

    @r.post(base + "/suggest-parts")
    def suggest_parts(request: Request, body: dict = Body(...)):
        work = resolve(request.path_params)
        img = work.image_rgb(body.get("image", "main"))
        items = suggest.parse(client().vision(img, suggest.PROMPT))
        for it in items:
            if it["name"] not in parts.NAMES:
                work.set_alias(it["name"], it["en"])
        return {"parts": items, "meta": work.meta}

    @r.post(base + "/parts/{part_id}/materials")
    async def add_materials(request: Request, part_id: str, material: str = Form(...), count: str = Form(...),
                            reference: UploadFile | None = File(None)):
        work = resolve(request.path_params)
        part = work.part(part_id)
        material = material.strip()
        if not 1 <= len(material) <= materials.MAX_MATERIAL:
            raise ValueError(f"材質描述必須是 1~{materials.MAX_MATERIAL} 字")
        if not count.isdigit() or not 1 <= int(count) <= materials.MAX_COUNT:
            raise ValueError(f"候選張數必須是 1~{materials.MAX_COUNT}")
        ref = None
        if reference is not None:
            try:
                ref = limit_size(load_rgb(await reference.read()), 1024)  # 參考圖只看質感, 不用大圖
            except ValueError:
                raise ValueError("參考圖無法讀取, 請換一張圖")
        src = work.image_rgb(part["image"])
        mask = work.mask(part_id)
        box = materials.crop_box(mask)
        x0, y0, x1, y1 = box
        prompt = materials.build_prompt(parts.to_prompt(part["name"], work.aliases()), material, ref is not None)
        images = client().edit("nano-banana", src[y0:y1, x0:x1], prompt, int(count), [ref] if ref is not None else [])
        for ai in images:
            work.add_material_variant(part_id, materials.paste(src, ai, mask, box), material, ref)
        errors = [] if len(images) >= int(count) else [f"要求 {count} 張, AI 只回傳 {len(images)} 張"]
        return {"meta": work.meta, "errors": errors}

    @r.put(base + "/parts/{part_id}/material")
    def set_material(request: Request, part_id: str, body: dict = Body(...)):
        work = resolve(request.path_params)
        vid = body.get("variant")
        if vid is not None and not isinstance(vid, str):
            raise ValueError("材質候選格式錯誤")
        work.set_material(part_id, vid)
        return work.meta

    @r.delete(base + "/parts/{part_id}/materials/{variant_id}")
    def delete_material(request: Request, part_id: str, variant_id: str):
        work = resolve(request.path_params)
        work.delete_material(part_id, variant_id)
        return work.meta

    @r.delete(base + "/parts/{part_id}")
    def delete_part(request: Request, part_id: str):
        work = resolve(request.path_params)
        work.delete_part(part_id)
        return work.meta

    @r.put(base + "/layout")
    def put_layout(request: Request, body: dict = Body(...)):
        work = resolve(request.path_params)
        work.set_layout(body.get("parts"), body.get("pad"))
        return work.meta

    @r.post(base + "/generate")
    async def generate(request: Request, collage: UploadFile = File(...), region: UploadFile = File(...),
                       options: str = Form(...), behind: UploadFile | None = File(None),
                       protect: UploadFile | None = File(None)):
        work = resolve(request.path_params)
        try:
            opts = json.loads(options)
        except ValueError:
            raise ValueError("生成選項格式錯誤")
        model = opts.get("model")
        count = opts.get("count")
        extra = opts.get("extra") or ""
        if model not in EDIT_MODELS:
            raise ValueError(f"不支援的修圖模型: {model}")
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 4:
            raise ValueError("張數必須是 1~4")
        if not isinstance(extra, str) or len(extra) > MAX_EXTRA:
            raise ValueError(f"補充描述最多 {MAX_EXTRA} 字")
        col = decode_any(await collage.read())
        reg = decode_any(await region.read())
        if col.ndim == 2:
            raise ValueError("拼貼圖格式錯誤")
        if col.shape[2] == 3:
            col = np.dstack([col, np.full(col.shape[:2], 255, np.uint8)])
        reg = to_gray(reg) if reg.ndim == 3 else reg

        async def mask(f: UploadFile | None) -> np.ndarray | None:
            if f is None:
                return None
            m = decode_any(await f.read())
            return to_gray(m) if m.ndim == 3 else m

        beh = await mask(behind)
        prot = await mask(protect)
        main = work.image_info("main")
        pad = work.meta["pad"]
        expect = (main["h"] + pad["top"] + pad["bottom"], main["w"] + pad["left"] + pad["right"])
        if col.shape[:2] != expect or any(m is not None and m.shape[:2] != expect for m in (reg, beh, prot)):
            raise ValueError(f"拼貼尺寸與作品不符(應為 {expect[1]}x{expect[0]})")
        # 只有改動範圍交給 AI; 透明處(主圖背景、擴大的畫布)鋪背景色就好,
        # 整圈交給 AI 會讓主體邊緣混到 AI 重畫的版本而糊掉
        reg = np.where(reg > 127, 255, 0).astype(np.uint8)
        if not reg.any() and not (beh is not None and (beh > 127).any()):
            raise ValueError("沒有任何改動, 不需要生成")
        has_foreign = any(p["placed"] and p["image"] != "main" for p in work.meta["parts"])
        prompt = compose.build_prompt(has_foreign, extra)
        filled = compose.fill_holes(col, compose.background_color(work.image("main")))
        images = client().edit(model, filled, prompt, count)
        params = {"model": model, "count": count, "extra": extra, "prompt": prompt,
                  "parts": work.meta["parts"], "pad": pad}
        results = [work.add_result(compose.paste_back(ai, filled, reg, beh, prot), params) for ai in images]
        errors = []
        if len(results) < count:
            errors.append(f"要求 {count} 張, AI 只回傳 {len(results)} 張")
        return {"meta": work.meta, "results": results, "errors": errors}

    @r.post(base + "/results/{result_id}/to-pack")
    def to_pack(request: Request, result_id: str):
        work = resolve(request.path_params)
        data = work.file_path(f"results/{result_id}.png").read_bytes()
        name = f"{pack_base(request.path_params)[:50]}-{result_id}"
        candidate, n = name, 1
        while (packs_dir / candidate).exists():
            n += 1
            candidate = f"{name}-{n}"
        validate_name(candidate)
        Pack.create(packs_dir, candidate, data)
        return {"pack": candidate}


def create_router(data_dir: Path, client_factory: Callable[[], FalClient | None]) -> APIRouter:
    works_dir = Path(data_dir) / "proportion"
    recipes_dir = Path(data_dir) / "proportion_recipes"
    packs_dir = Path(data_dir) / "packs"
    r = APIRouter(prefix="/api/proportion")
    client = client_getter(client_factory)

    def open_work(name: str) -> Work:
        return Work.open(works_dir, name)

    @r.get("/works")
    def list_works():
        return Work.list(works_dir)

    @r.post("/works")
    async def create_work(name: str = Form(...), file: UploadFile | None = File(None), pack: str | None = Form(None)):
        data, label = await read_source(packs_dir, file, pack)
        return Work.create(works_dir, name, data, label).meta

    @r.delete("/works/{name}")
    def delete_work(name: str):
        open_work(name).delete()
        return {"ok": True}

    add_work_routes(r, "/works/{name}", lambda p: open_work(p["name"]), lambda p: p["name"], client, packs_dir)

    @r.get("/recipes")
    def list_recipes():
        return recipe_files.list_recipes(recipes_dir)

    @r.get("/recipes/{name}")
    def get_recipe(name: str):
        return recipes.validate(recipe_files.load_recipe(recipes_dir, name))

    @r.put("/recipes/{name}")
    def put_recipe(name: str, data=Body(...)):
        recipe_files.save_recipe(recipes_dir, name, recipes.validate(data))
        return {"ok": True}

    @r.delete("/recipes/{name}")
    def delete_recipe(name: str):
        recipe_files.delete_recipe(recipes_dir, name)
        return {"ok": True}

    return r
