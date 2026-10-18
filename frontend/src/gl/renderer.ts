/** 把分層包依風格配方渲染到畫布: 色彩 → 光照 → 線條 → 質感 → 油畫平滑 → 濾鏡 → 泛光 → 調色。 */
import { api, type PackMeta } from '../api';
import { buildRegionTable, hexToRgb, TABLE_SIZE } from '../colorMath';
import { gradePresetUniforms, gradientTable } from '../grade';
import type { Recipe } from '../recipe';
import { createProgram, createTarget, loadBitmap, textureFromBitmap, textureFromBytes, type Program, type Target } from './glUtil';
import {
  BLOOM_FS, COLOR_FS, EFFECTS_FS, FILTER_FS, GRADE_FS, KUWAHARA_FS, LIGHTING_FS, LINES_FS, SOURCE_FS,
} from './shaders';

const PACK_TEXTURES = ['regions', 'normal', 'line_sdf', 'source'] as const;
type PackTexture = (typeof PACK_TEXTURES)[number];

/** 舊分層包可能缺的圖層, 缺就用 1x1 的替代值, 讓相關效果自然不作用。 */
const OPTIONAL_TEXTURES = {
  normal_detail: new Uint8Array([128, 128, 255, 255]), // 正對畫面的平面法線
  ao: new Uint8Array([0, 0, 0, 255]),                  // 沒有凹處
  silhouette_sdf: new Uint8Array([0, 0, 0, 255]),      // 整張都是主體
  shade: new Uint8Array([128, 128, 128, 255]),         // 沒有原圖光影(細節全部算進紋理)
} as const;
type OptionalTexture = keyof typeof OPTIONAL_TEXTURES;

const rgb01 = (hex: string): [number, number, number] => hexToRgb(hex).map((v) => v / 255) as [number, number, number];
const lightDir = (azDeg: number, elDeg: number) => {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private programs: Record<string, Program>;
  private vao: WebGLVertexArrayObject;
  private packTex: Partial<Record<PackTexture, WebGLTexture>> = {};
  private optTex: Partial<Record<OptionalTexture, WebGLTexture>> = {};
  private hasSil = false;
  private hasShade = false;
  private origTableTex: WebGLTexture;
  private tableTex: WebGLTexture;
  private gradTex: WebGLTexture;
  private targets: Target[] = [];
  private meta: PackMeta | null = null;
  private tableKey = '';
  private gradKey = '';
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
      effects: createProgram(gl, EFFECTS_FS, '質感'),
      kuwahara: createProgram(gl, KUWAHARA_FS, '油畫平滑'),
      filter: createProgram(gl, FILTER_FS, '濾鏡'),
      bloom: createProgram(gl, BLOOM_FS, '泛光'),
      grade: createProgram(gl, GRADE_FS, '調色'),
      source: createProgram(gl, SOURCE_FS, '原圖'),
    };
    this.vao = gl.createVertexArray()!;
    this.tableTex = textureFromBytes(gl, TABLE_SIZE, TABLE_SIZE, new Uint8Array(TABLE_SIZE * TABLE_SIZE * 4));
    this.gradTex = textureFromBytes(gl, 256, 1, new Uint8Array(256 * 4));
    this.origTableTex = textureFromBytes(gl, TABLE_SIZE, TABLE_SIZE, new Uint8Array(TABLE_SIZE * TABLE_SIZE * 4));
  }

  get loadedPack(): PackMeta | null {
    return this.meta;
  }

  /** 載入分層包的圖層。版本字串帶各層的更新時間, 避開瀏覽器快取。 */
  async loadPack(meta: PackMeta, fileUrl: (name: string, layer: string, version: string) => string = api.fileUrl): Promise<void> {
    const version = PACK_TEXTURES.map((l) => meta.layers[l]?.updated ?? '').join('|');
    const optional = Object.keys(OPTIONAL_TEXTURES) as OptionalTexture[];
    const [bitmaps, optBitmaps] = await Promise.all([
      Promise.all(PACK_TEXTURES.map((l) => loadBitmap(fileUrl(meta.name, l, version)))),
      Promise.all(optional.map((l) => (meta.layers[l] ? loadBitmap(fileUrl(meta.name, l, meta.layers[l].updated)) : null))),
    ]);
    const gl = this.gl;
    for (const t of [...Object.values(this.packTex), ...Object.values(this.optTex)]) gl.deleteTexture(t);
    this.packTex = {};
    this.optTex = {};
    PACK_TEXTURES.forEach((l, i) => {
      this.packTex[l] = textureFromBitmap(gl, bitmaps[i]);
      bitmaps[i].close();
    });
    optional.forEach((l, i) => {
      const bm = optBitmaps[i];
      this.optTex[l] = bm ? textureFromBitmap(gl, bm) : textureFromBytes(gl, 1, 1, OPTIONAL_TEXTURES[l]);
      bm?.close();
    });
    this.hasSil = !!meta.layers.silhouette_sdf;
    this.hasShade = !!meta.layers.shade && !meta.layers.shade.stale; // 過期的原圖光影是舊區塊算的, 不用
    if (meta.width !== this.w || meta.height !== this.h) {
      for (const t of this.targets) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
      this.w = meta.width;
      this.h = meta.height;
      this.targets = [0, 1, 2].map(() => createTarget(gl, this.w, this.h));
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
    this.updateTables(recipe);
    const scale = Math.max(this.w, this.h) / 1024;
    const t = this.packTex, o = this.optTex;
    const [A, B, C] = this.targets;
    const L = recipe.lighting, N = recipe.lines, E = recipe.effects, F = recipe.filter, G = recipe.grade, K = recipe.keep;
    const normals = (u: Uniforms, unit: number) => {
      u.tex('uNormal', t.normal!, unit);
      u.tex('uDetail', o.normal_detail!, unit + 1);
      u.f('uNormalStrength', L.normalStrength);
      u.f('uDetailStrength', L.detailStrength);
    };

    this.pass('color', A, scale, (u) => {
      u.tex('uRegions', t.regions!, 0);
      u.tex('uTable', this.tableTex, 1);
    });
    this.pass('lighting', B, scale, (u) => {
      u.tex('uPrev', A.tex, 0);
      normals(u, 1);
      u.tex('uAo', o.ao!, 3);
      u.tex('uSil', o.silhouette_sdf!, 4);
      u.bool('uHasSil', this.hasSil);
      u.tex('uRegions', t.regions!, 5);
      u.tex('uSource', t.source!, 6);
      u.tex('uOrigTable', this.origTableTex, 7);
      u.tex('uShade', o.shade!, 8);
      u.tex('uTable', this.tableTex, 9);
      u.bool('uHasShade', this.hasShade);
      u.bool('uKeepOn', K.enabled && (K.shade > 0 || K.texture > 0));
      u.f('uKeepShade', K.enabled ? K.shade : 0);
      u.f('uKeepTexture', K.enabled ? K.texture : 0);
      u.bool('uEnabled', L.enabled);
      u.v3('uLight', lightDir(L.azimuth, L.elevation));
      u.f('uBands', L.bands);
      u.i('uShadowMode', ['darken', 'cool', 'custom'].indexOf(L.shadowMode));
      u.v3('uShadowColor', rgb01(L.shadowColor));
      u.f('uShadowStrength', L.shadowStrength);
      u.v3('uLitColor', rgb01(L.litColor));
      u.f('uLitStrength', L.litStrength);
      u.f('uSoftness', L.softness);
      u.f('uEdgeJitter', L.edgeJitter);
      u.f('uAmbient', L.ambient);
      u.f('uAoStrength', L.ao);
      u.bool('uRim', L.rim);
      u.f('uRimStrength', L.rimStrength);
      u.v3('uRimColor', rgb01(L.rimColor));
      u.bool('uSpecular', L.specular);
      u.f('uSpecSize', L.specSize);
      u.f('uSpecSharpness', L.specSharpness);
      u.v3('uSpecColor', rgb01(L.specColor));
      u.f('uSpecStrength', L.specStrength);
      u.bool('uFill', L.fill);
      u.v3('uFillLight', lightDir(L.fillAzimuth, L.fillElevation));
      u.v3('uFillColor', rgb01(L.fillColor));
      u.f('uFillStrength', L.fillStrength);
    });
    this.pass('lines', A, scale, (u) => {
      u.tex('uPrev', B.tex, 0);
      u.tex('uSdf', t.line_sdf!, 1);
      u.tex('uRegions', t.regions!, 2);
      u.tex('uTable', this.tableTex, 3);
      u.tex('uSil', o.silhouette_sdf!, 4);
      u.bool('uHasSil', this.hasSil);
      u.bool('uEnabled', N.enabled);
      u.f('uThickness', N.thickness);
      u.f('uOuter', N.outerThickness);
      u.bool('uInner', N.innerLines);
      u.i('uVariation', N.variation === 'shadow' ? 1 : 0);
      u.f('uVarAmount', N.variationAmount);
      u.f('uPressure', N.pressure);
      u.f('uPressureScale', N.pressureScale);
      u.f('uBreaks', N.breaks);
      u.i('uColorMode', N.colorMode === 'black' ? 0 : 1);
      u.f('uColorDarken', N.colorDarken);
      u.i('uTexture', ['clean', 'pencil', 'crayon'].indexOf(N.texture));
      u.f('uJitter', N.jitter);
      u.bool('uDouble', N.doubleLine);
      const a = (N.doubleAngle * Math.PI) / 180;
      u.v2('uDoubleOffset', [Math.cos(a) * N.doubleOffset * scale, Math.sin(a) * N.doubleOffset * scale]);
      u.v3('uDoubleColor', rgb01(N.doubleColor));
    });
    this.pass('effects', B, scale, (u) => {
      u.tex('uPrev', A.tex, 0);
      u.tex('uRegions', t.regions!, 1);
      u.tex('uTable', this.tableTex, 2);
      normals(u, 3);
      u.tex('uSil', o.silhouette_sdf!, 5);
      u.bool('uHasSil', this.hasSil);
      u.bool('uEnabled', E.enabled);
      u.bool('uHalftone', E.halftone);
      u.f('uHtSize', E.halftoneSize);
      u.f('uHtAngle', E.halftoneAngle);
      u.bool('uShadowOnly', E.halftoneShadowOnly);
      u.f('uHtStrength', E.halftoneStrength);
      u.bool('uHatch', E.hatch);
      u.f('uHatchSpacing', E.hatchSpacing);
      u.f('uHatchAngle', E.hatchAngle);
      u.f('uHatchWidth', E.hatchWidth);
      u.bool('uCross', E.crossHatch);
      u.f('uHatchStrength', E.hatchStrength);
      u.bool('uStipple', E.stipple);
      u.f('uStipSize', E.stippleSize);
      u.f('uStipDensity', E.stippleDensity);
      u.f('uWcEdge', E.wcEdge);
      u.f('uWcBleed', E.wcBleed);
      u.f('uWcGranule', E.wcGranule);
      u.f('uBrush', E.brush);
      u.f('uBrushScale', E.brushScale);
      u.f('uRiso', E.riso);
      u.f('uRisoAngle', E.risoAngle);
      u.f('uPaper', E.paper);
      u.f('uGrain', E.grain);
    });
    this.pass('kuwahara', A, scale, (u) => {
      u.tex('uPrev', B.tex, 0);
      u.i('uRadius', F.enabled ? Math.min(12, Math.round(F.kuwahara * scale)) : 0);
    });
    this.pass('filter', B, scale, (u) => {
      u.tex('uPrev', A.tex, 0);
      u.tex('uSil', o.silhouette_sdf!, 1);
      u.bool('uHasSil', this.hasSil);
      u.bool('uEnabled', F.enabled);
      u.f('uPixelSize', Math.max(1, Math.round(F.pixelSize * scale)));
      u.f('uContrast', F.contrast);
      u.v3('uTint', rgb01(F.tint));
      u.f('uTintStrength', F.tintStrength);
      u.bool('uDither', F.dither);
      u.f('uLevels', F.ditherLevels);
      u.f('uVignette', F.vignette);
      u.f('uOutlineWidth', F.outlineWidth);
      u.v3('uOutlineColor', rgb01(F.outlineColor));
      u.f('uChroma', F.chroma);
      u.f('uScan', F.scan);
      u.f('uScanSpacing', F.scanSpacing);
    });
    const bloom = F.enabled ? F.bloom : 0;
    if (bloom > 0) {
      const radius = F.bloomRadius * 12 * scale;
      this.pass('bloom', A, scale, (u) => {
        u.tex('uPrev', B.tex, 0);
        u.v2('uDir', [1, 0]);
        u.bool('uBright', true);
        u.f('uThreshold', F.bloomThreshold);
        u.f('uRadius', radius);
      });
      this.pass('bloom', C, scale, (u) => {
        u.tex('uPrev', A.tex, 0);
        u.v2('uDir', [0, 1]);
        u.bool('uBright', false);
        u.f('uRadius', radius);
      });
    }
    this.pass('grade', null, scale, (u) => {
      u.tex('uPrev', B.tex, 0);
      u.tex('uBloomTex', C.tex, 1);
      u.f('uBloom', bloom);
      u.bool('uEnabled', G.enabled);
      const g = gradePresetUniforms(G.preset, G.presetStrength);
      u.v3('uLift', g.lift);
      u.v3('uGamma', g.gamma);
      u.v3('uGain', g.gain);
      u.f('uSat', g.sat);
      u.f('uContrast', g.contrast);
      u.f('uSatShadow', G.satShadow);
      u.f('uSatHighlight', G.satHighlight);
      u.bool('uGradOn', G.gradientMap);
      u.tex('uGradTex', this.gradTex, 2);
      u.f('uGradStrength', G.gradientStrength);
    });
  }

  renderSource(): void {
    if (!this.meta) return;
    this.pass('source', null, 1, (u) => u.tex('uSource', this.packTex.source!, 0));
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private updateTables(recipe: Recipe) {
    const meta = this.meta!;
    const key = JSON.stringify(recipe.color);
    if (key !== this.tableKey) {
      const table = buildRegionTable(meta.regions.colors, meta.regions.areas, recipe.color);
      textureFromBytes(this.gl, TABLE_SIZE, TABLE_SIZE, table, this.tableTex);
      // 拆解當下取出的顏色(舊分層包沒有就用目前的顏色), 算原圖細節用
      const orig = buildRegionTable(meta.regions.sampled ?? meta.regions.colors, meta.regions.areas, { ...recipe.color, enabled: false });
      textureFromBytes(this.gl, TABLE_SIZE, TABLE_SIZE, orig, this.origTableTex);
      this.tableKey = key;
    }
    const gkey = recipe.grade.gradientStops.join(',');
    if (gkey !== this.gradKey) {
      textureFromBytes(this.gl, 256, 1, gradientTable(recipe.grade.gradientStops), this.gradTex);
      this.gradKey = gkey;
    }
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
