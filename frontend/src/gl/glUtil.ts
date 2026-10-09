/** WebGL2 小工具: 編譯程式、貼圖、FBO。全螢幕三角形用 gl_VertexID 產生, 不需要頂點緩衝。 */

export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export interface Program {
  name: string;
  prog: WebGLProgram;
  loc: (uniform: string) => WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(`[${name}] shader 編譯失敗:\n${log}\n${src}`);
    throw new Error(`「${name}」層的 shader 編譯失敗: ${log}`);
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, fs: string, name: string): Program {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS, name));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs, name));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    console.error(`[${name}] 連結失敗: ${log}`);
    throw new Error(`「${name}」層的 shader 連結失敗: ${log}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    name,
    prog,
    loc: (u) => {
      if (!cache.has(u)) cache.set(u, gl.getUniformLocation(prog, u));
      return cache.get(u)!;
    },
  };
}

function setupTexture(gl: WebGL2RenderingContext, tex: WebGLTexture) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** 分層包的圖是資料不是顏色: 不做色彩空間轉換、不 premultiply、不翻轉。 */
export function textureFromBitmap(gl: WebGL2RenderingContext, bitmap: ImageBitmap): WebGLTexture {
  const tex = gl.createTexture()!;
  setupTexture(gl, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  return tex;
}

export function textureFromBytes(gl: WebGL2RenderingContext, w: number, h: number, data: Uint8Array | null, tex?: WebGLTexture): WebGLTexture {
  const t = tex ?? gl.createTexture()!;
  setupTexture(gl, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return t;
}

export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = textureFromBytes(gl, w, h, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex };
}

export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`讀取圖層失敗: ${url}(HTTP ${res.status})`);
  return createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
    imageOrientation: 'none',
  });
}
