/**
 * 五層渲染的 fragment shader。
 * 座標慣例: 中間結果(FBO)用 gl_FragCoord 直接讀; 分層包貼圖第 0 列是圖片最上方, 用 imgPx() 換算。
 * 每層輸出的 alpha 傳「受光度」(1 = 亮面), 給後面的線條與網點使用; 最後一層輸出 alpha = 1。
 * uScale = 長邊 / 1024, 以像素為單位的參數都乘上它, 同一份配方在不同解析度的圖上比例一致。
 */

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
uniform float uScale;
out vec4 outColor;

ivec2 clampPx(ivec2 p) { return clamp(p, ivec2(0), ivec2(uSize) - 1); }
ivec2 imgPx(vec2 frag) { return clampPx(ivec2(int(frag.x), int(uSize.y) - 1 - int(frag.y))); }
vec4 prevAt(sampler2D t, vec2 frag) { return texelFetch(t, clampPx(ivec2(frag)), 0); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

const REGION = `
uniform sampler2D uRegions;
uniform sampler2D uTable;
int regionId(ivec2 ip) {
  vec4 r = texelFetch(uRegions, ip, 0);
  return int(r.r * 255.0 + 0.5) + int(r.g * 255.0 + 0.5) * 256;
}
vec3 regionColor(ivec2 ip) {
  int id = regionId(ip);
  return texelFetch(uTable, ivec2(id % 256, id / 256), 0).rgb;
}
`;

export const COLOR_FS = HEADER + REGION + `
void main() {
  outColor = vec4(regionColor(imgPx(gl_FragCoord.xy)), 1.0);
}`;

export const LIGHTING_FS = HEADER + `
uniform sampler2D uPrev;
uniform sampler2D uNormal;
uniform bool uEnabled;
uniform vec3 uLight;
uniform float uBands;
uniform int uShadowMode;
uniform float uShadowStrength;
uniform float uAmbient;
uniform float uNormalStrength;
uniform bool uRim;
uniform float uRimStrength;
uniform vec3 uRimColor;

void main() {
  vec3 c = prevAt(uPrev, gl_FragCoord.xy).rgb;
  if (!uEnabled) { outColor = vec4(c, 1.0); return; }
  vec3 n = texelFetch(uNormal, imgPx(gl_FragCoord.xy), 0).rgb * 2.0 - 1.0;
  n.xy *= uNormalStrength;
  n = normalize(n);
  // 以「正對畫面」的受光為基準: 平塗原色就是亮面的顏色, 轉向光源的面不會更亮
  float t = clamp(dot(n, uLight) / max(uLight.z, 0.2), 0.0, 1.0);
  float q = uBands < 1.5 ? 1.0 : clamp(floor(t * uBands) / (uBands - 1.0), 0.0, 1.0);
  q = uAmbient + (1.0 - uAmbient) * q;
  vec3 shadowCol = uShadowMode == 0
    ? c * (1.0 - uShadowStrength)
    : mix(c, c * vec3(0.55, 0.62, 0.95) * (1.0 - 0.3 * uShadowStrength), uShadowStrength);
  vec3 o = mix(shadowCol, c, q);
  if (uRim) {
    float facing = max(dot(normalize(n.xy + 1e-4), normalize(uLight.xy + 1e-4)), 0.0);
    o += uRimColor * uRimStrength * smoothstep(0.55, 0.95, 1.0 - n.z) * facing;
  }
  outColor = vec4(clamp(o, 0.0, 1.0), q);
}`;

export const LINES_FS = HEADER + REGION + `
uniform sampler2D uPrev;
uniform sampler2D uSdf;
uniform bool uEnabled;
uniform float uThickness;
uniform int uVariation;
uniform float uVarAmount;
uniform int uColorMode;
uniform float uColorDarken;
uniform int uTexture;
uniform float uJitter;

void main() {
  vec4 prev = prevAt(uPrev, gl_FragCoord.xy);
  if (!uEnabled) { outColor = prev; return; }
  vec2 frag = gl_FragCoord.xy;
  if (uJitter > 0.0) {
    vec2 q = frag * 0.02 / uScale;
    frag += (vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * 2.0 * uJitter * uScale;
  }
  ivec2 ip = imgPx(frag);
  float raw = texelFetch(uSdf, ip, 0).r * 255.0;
  float sd = (raw - 128.0) / 8.0;
  float w = uThickness;
  if (uVariation == 1) w += uVarAmount * (1.0 - prev.a);
  // 距離場只記到約 ±16px: 255 代表「更遠」, 粗細也夾在可表示範圍內, 否則大圖加粗時整張會被塗黑
  w = min(w * uScale, 14.5);
  float a = raw > 254.5 ? 0.0 : 1.0 - smoothstep(w - 0.75, w + 0.75, sd);
  if (uTexture == 1) a *= 0.55 + 0.45 * hash(floor(gl_FragCoord.xy));
  else if (uTexture == 2) a *= smoothstep(0.32, 0.5, fbm(gl_FragCoord.xy * 0.35 / uScale));
  vec3 lc = uColorMode == 0 ? vec3(0.08) : regionColor(ip) * (1.0 - uColorDarken);
  outColor = vec4(mix(prev.rgb, lc, a), prev.a);
}`;

export const EFFECTS_FS = HEADER + `
uniform sampler2D uPrev;
uniform bool uEnabled;
uniform bool uHalftone;
uniform float uHtSize;
uniform float uHtAngle;
uniform bool uShadowOnly;
uniform float uHtStrength;
uniform float uPaper;
uniform float uGrain;

void main() {
  vec4 p = prevAt(uPrev, gl_FragCoord.xy);
  if (!uEnabled) { outColor = p; return; }
  vec3 c = p.rgb;
  if (uHalftone) {
    float size = uHtSize * uScale;
    float ang = radians(uHtAngle);
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 cell = fract(rot * gl_FragCoord.xy / size) - 0.5;
    float dist = length(cell) * size;
    float dark = uShadowOnly ? 1.0 - p.a : 1.0 - dot(c, vec3(0.299, 0.587, 0.114));
    dark = clamp(dark, 0.0, 1.0);
    float r = sqrt(dark) * size * 0.7;
    float mask = dark > 0.001 ? 1.0 - smoothstep(r - 0.75, r + 0.75, dist) : 0.0;
    c *= 1.0 - uHtStrength * mask;
  }
  c *= 1.0 - uPaper * 0.25 * (1.0 - fbm(gl_FragCoord.xy * 0.02 / uScale));
  c += uGrain * 0.15 * (hash(gl_FragCoord.xy) - 0.5);
  outColor = vec4(clamp(c, 0.0, 1.0), p.a);
}`;

/** 油畫感平滑(Kuwahara): 四個象限取平均, 用變異最小的那個。 */
export const KUWAHARA_FS = HEADER + `
uniform sampler2D uPrev;
uniform int uRadius;

void main() {
  ivec2 c0 = ivec2(gl_FragCoord.xy);
  if (uRadius <= 0) { outColor = prevAt(uPrev, gl_FragCoord.xy); return; }
  vec3 bestMean = vec3(0.0);
  float bestVar = 1e9;
  float alpha = prevAt(uPrev, gl_FragCoord.xy).a;
  for (int q = 0; q < 4; q++) {
    ivec2 dir = ivec2(q % 2 == 0 ? -1 : 1, q < 2 ? -1 : 1);
    vec3 sum = vec3(0.0), sum2 = vec3(0.0);
    float n = 0.0;
    for (int j = 0; j <= uRadius; j++) {
      for (int i = 0; i <= uRadius; i++) {
        vec3 s = texelFetch(uPrev, clampPx(c0 + dir * ivec2(i, j)), 0).rgb;
        sum += s; sum2 += s * s; n += 1.0;
      }
    }
    vec3 mean = sum / n;
    vec3 v = sum2 / n - mean * mean;
    float var = v.r + v.g + v.b;
    if (var < bestVar) { bestVar = var; bestMean = mean; }
  }
  outColor = vec4(bestMean, alpha);
}`;

export const FINAL_FS = HEADER + `
uniform sampler2D uPrev;
uniform bool uEnabled;
uniform float uPixelSize;
uniform float uContrast;
uniform vec3 uTint;
uniform float uTintStrength;
uniform bool uDither;
uniform float uLevels;
uniform float uVignette;

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (uEnabled && uPixelSize > 1.0) frag = (floor(frag / uPixelSize) + 0.5) * uPixelSize;
  vec3 c = prevAt(uPrev, frag).rgb;
  if (!uEnabled) { outColor = vec4(c, 1.0); return; }
  c = (c - 0.5) * uContrast + 0.5;
  c = mix(c, c * uTint, uTintStrength);
  if (uDither) {
    ivec2 bp = ivec2(floor(gl_FragCoord.xy / max(uPixelSize, 1.0))) & 3;
    float b = (BAYER[bp.y * 4 + bp.x] + 0.5) / 16.0;
    c = floor(clamp(c, 0.0, 1.0) * (uLevels - 1.0) + b) / (uLevels - 1.0);
  }
  vec2 uv = gl_FragCoord.xy / uSize;
  c *= 1.0 - uVignette * smoothstep(0.4, 0.95, length(uv - 0.5) * 1.4);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export const SOURCE_FS = HEADER + `
uniform sampler2D uSource;
void main() {
  outColor = vec4(texelFetch(uSource, imgPx(gl_FragCoord.xy), 0).rgb, 1.0);
}`;
