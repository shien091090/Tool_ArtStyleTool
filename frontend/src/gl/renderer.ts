/** 把分層包依風格配方渲染到畫布: 色彩 → 光照 → 線條 → 特效 → 油畫平滑 → 濾鏡。 */
import { api, type PackMeta } from '../api';
import { buildRegionTable, hexToRgb, TABLE_SIZE } from '../colorMath';
import type { Recipe } from '../recipe';
import { createProgram, createTarget, loadBitmap, textureFromBitmap, textureFromBytes, type Program, type Target } from './glUtil';
import { COLOR_FS, EFFECTS_FS, FINAL_FS, KUWAHARA_FS, LIGHTING_FS, LINES_FS, SOURCE_FS } from './shaders';

const PACK_TEXTURES = ['regions', 'normal', 'line_sdf', 'source'] as const;
/** 舊的分層包可能沒有細部法線, 沒有就用「正對畫面」的平面法線代替。 */
const FLAT_NORMAL = new Uint8Array([128, 128, 255, 255]);
type PackTexture = (typeof PACK_TEXTURES)[number];

const rgb01 = (hex: string): [number, number, number] => hexToRgb(hex).map((v) => v / 255) as [number, number, number];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private programs: Record<string, Program>;
  private vao: WebGLVertexArrayObject;
  private packTex: Partial<Record<PackTexture, WebGLTexture>> = {};
  private tableTex: WebGLTexture;
  private detailTex: WebGLTexture | null = null;
  private targets: Target[] = [];
  private meta: PackMeta | null = null;
  private tableKey = '';
  private w = 0;
  private h = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('這個瀏覽器不支援 WebGL2');
    this.gl = gl;
    this.programs = {
      color: createProgram(gl, COLOR_FS, '色彩'),
      lighting: createProgram(gl, LIGHTING_FS, '光照'),
      lines: createProgram(gl, LINES_FS, '線條'),
      effects: createProgram(gl, EFFECTS_FS, '特效'),
      kuwahara: createProgram(gl, KUWAHARA_FS, '油畫平滑'),
      final: createProgram(gl, FINAL_FS, '濾鏡'),
      source: createProgram(gl, SOURCE_FS, '原圖'),
    };
    this.vao = gl.createVertexArray()!;
    this.tableTex = textureFromBytes(gl, TABLE_SIZE, TABLE_SIZE, new Uint8Array(TABLE_SIZE * TABLE_SIZE * 4));
  }

  get loadedPack(): PackMeta | null {
    return this.meta;
  }

  /** 載入分層包的四張圖。version 用來避開瀏覽器快取(通常帶 meta 的更新時間)。 */
  async loadPack(meta: PackMeta): Promise<void> {
    const version = PACK_TEXTURES.map((l) => meta.layers[l]?.updated ?? '').join('|');
    const bitmaps = await Promise.all(PACK_TEXTURES.map((l) => loadBitmap(api.fileUrl(meta.name, l, version))));
    const detail = meta.layers.normal_detail
      ? await loadBitmap(api.fileUrl(meta.name, 'normal_detail', meta.layers.normal_detail.updated))
      : null;
    const gl = this.gl;
    if (this.detailTex) gl.deleteTexture(this.detailTex);
    this.detailTex = detail ? textureFromBitmap(gl, detail) : textureFromBytes(gl, 1, 1, FLAT_NORMAL);
    detail?.close();
    for (const t of Object.values(this.packTex)) gl.deleteTexture(t);
    this.packTex = {};
    PACK_TEXTURES.forEach((l, i) => {
      this.packTex[l] = textureFromBitmap(gl, bitmaps[i]);
      bitmaps[i].close();
    });
    if (meta.width !== this.w || meta.height !== this.h) {
      for (const t of this.targets) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
      this.w = meta.width;
      this.h = meta.height;
      this.targets = [createTarget(gl, this.w, this.h), createTarget(gl, this.w, this.h)];
      this.canvas.width = this.w;
      this.canvas.height = this.h;
    }
    this.meta = meta;
    this.tableKey = '';
  }

  /** 區塊顏色被改過(檢查點改色)時呼叫, 不需重新載入貼圖。 */
  setRegionColors(meta: PackMeta): void {
    this.meta = meta;
    this.tableKey = '';
  }

  render(recipe: Recipe): void {
    if (!this.meta) return;
    this.updateTable(recipe);
    const scale = Math.max(this.w, this.h) / 1024;
    const t = this.packTex;
    const [A, B] = this.targets;
    const L = recipe.lighting, N = recipe.lines, E = recipe.effects, F = recipe.filter;
    const az = (L.azimuth * Math.PI) / 180, el = (L.elevation * Math.PI) / 180;

    this.pass('color', A, scale, (u) => {
      u.tex('uRegions', t.regions!, 0);
      u.tex('uTable', this.tableTex, 1);
    });
    this.pass('lighting', B, scale, (u) => {
      u.tex('uPrev', A.tex, 0);
      u.tex('uNormal', t.normal!, 1);
      u.tex('uDetail', this.detailTex!, 2);
      u.f('uDetailStrength', L.detailStrength);
      u.bool('uEnabled', L.enabled);
      u.v3('uLight', [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)]);
      u.f('uBands', L.bands);
      u.i('uShadowMode', L.shadowMode === 'darken' ? 0 : 1);
      u.f('uShadowStrength', L.shadowStrength);
      u.f('uAmbient', L.ambient);
      u.f('uNormalStrength', L.normalStrength);
      u.bool('uRim', L.rim);
      u.f('uRimStrength', L.rimStrength);
      u.v3('uRimColor', rgb01(L.rimColor));
    });
    this.pass('lines', A, scale, (u) => {
      u.tex('uPrev', B.tex, 0);
      u.tex('uSdf', t.line_sdf!, 1);
      u.tex('uRegions', t.regions!, 2);
      u.tex('uTable', this.tableTex, 3);
      u.bool('uEnabled', N.enabled);
      u.f('uThickness', N.thickness);
      u.i('uVariation', N.variation === 'shadow' ? 1 : 0);
      u.f('uVarAmount', N.variationAmount);
      u.i('uColorMode', N.colorMode === 'black' ? 0 : 1);
      u.f('uColorDarken', N.colorDarken);
      u.i('uTexture', ['clean', 'pencil', 'crayon'].indexOf(N.texture));
      u.f('uJitter', N.jitter);
    });
    this.pass('effects', B, scale, (u) => {
      u.tex('uPrev', A.tex, 0);
      u.bool('uEnabled', E.enabled);
      u.bool('uHalftone', E.halftone);
      u.f('uHtSize', E.halftoneSize);
      u.f('uHtAngle', E.halftoneAngle);
      u.bool('uShadowOnly', E.halftoneShadowOnly);
      u.f('uHtStrength', E.halftoneStrength);
      u.f('uPaper', E.paper);
      u.f('uGrain', E.grain);
    });
    this.pass('kuwahara', A, scale, (u) => {
      u.tex('uPrev', B.tex, 0);
      u.i('uRadius', F.enabled ? Math.min(12, Math.round(F.kuwahara * scale)) : 0);
    });
    this.pass('final', null, scale, (u) => {
      u.tex('uPrev', A.tex, 0);
      u.bool('uEnabled', F.enabled);
      u.f('uPixelSize', Math.max(1, Math.round(F.pixelSize * scale)));
      u.f('uContrast', F.contrast);
      u.v3('uTint', rgb01(F.tint));
      u.f('uTintStrength', F.tintStrength);
      u.bool('uDither', F.dither);
      u.f('uLevels', F.ditherLevels);
      u.f('uVignette', F.vignette);
    });
  }

  renderSource(): void {
    if (!this.meta) return;
    this.pass('source', null, 1, (u) => u.tex('uSource', this.packTex.source!, 0));
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private updateTable(recipe: Recipe) {
    const meta = this.meta!;
    const key = JSON.stringify(recipe.color);
    if (key === this.tableKey) return;
    const table = buildRegionTable(meta.regions.colors, meta.regions.areas, recipe.color);
    textureFromBytes(this.gl, TABLE_SIZE, TABLE_SIZE, table, this.tableTex);
    this.tableKey = key;
  }

  private pass(name: string, target: Target | null, scale: number, setup: (u: Uniforms) => void) {
    const gl = this.gl;
    const p = this.programs[name];
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, this.w, this.h);
    gl.bindVertexArray(this.vao);
    const u = new Uniforms(gl, p);
    u.v2('uSize', [this.w, this.h]);
    u.f('uScale', scale);
    setup(u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

class Uniforms {
  constructor(private gl: WebGL2RenderingContext, private p: Program) {}
  f(name: string, v: number) { this.gl.uniform1f(this.p.loc(name), v); }
  i(name: string, v: number) { this.gl.uniform1i(this.p.loc(name), v); }
  bool(name: string, v: boolean) { this.gl.uniform1i(this.p.loc(name), v ? 1 : 0); }
  v2(name: string, v: [number, number]) { this.gl.uniform2f(this.p.loc(name), v[0], v[1]); }
  v3(name: string, v: number[]) { this.gl.uniform3f(this.p.loc(name), v[0], v[1], v[2]); }
  tex(name: string, tex: WebGLTexture, unit: number) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.uniform1i(this.p.loc(name), unit);
  }
}
