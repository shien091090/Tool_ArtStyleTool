/**
 * 渲染各層的 fragment shader。
 * 座標慣例: 中間結果(FBO)用 gl_FragCoord 直接讀; 分層包貼圖第 0 列是圖片最上方, 用 imgPx() 換算。
 * 每層輸出的 alpha 傳「受光度」(1 = 亮面), 給後面的線條與質感使用; 最後一層輸出 alpha = 1。
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
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
/** 距離場貼圖: 128 為邊界, 每 8 階 1px; 255 視為「很遠」。 */
float sdfAt(sampler2D t, ivec2 ip) {
  float raw = texelFetch(t, ip, 0).r * 255.0;
  return raw > 254.5 ? 99.0 : (raw - 128.0) / 8.0;
}

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

const NORMALS = `
uniform sampler2D uNormal;
uniform sampler2D uDetail;
uniform float uNormalStrength;
uniform float uDetailStrength;
/** 大形(深度)與細部(原圖明暗)分開調強度後疊加。 */
vec3 surfaceNormal(ivec2 ip) {
  vec3 n = texelFetch(uNormal, ip, 0).rgb * 2.0 - 1.0;
  vec3 d = texelFetch(uDetail, ip, 0).rgb * 2.0 - 1.0;
  return normalize(vec3(n.xy * uNormalStrength + d.xy * uDetailStrength, n.z));
}
`;

export const COLOR_FS = HEADER + REGION + `
void main() {
  outColor = vec4(regionColor(imgPx(gl_FragCoord.xy)), 1.0);
}`;

export const LIGHTING_FS = HEADER + NORMALS + `
uniform sampler2D uPrev;
uniform sampler2D uAo;
uniform sampler2D uSil;
uniform bool uHasSil;
uniform bool uEnabled;
uniform vec3 uLight;
uniform float uBands;
uniform int uShadowMode;
uniform vec3 uShadowColor;
uniform float uShadowStrength;
uniform vec3 uLitColor;
uniform float uLitStrength;
uniform float uSoftness;
uniform float uEdgeJitter;
uniform float uAmbient;
uniform float uAoStrength;
uniform bool uRim;
uniform float uRimStrength;
uniform vec3 uRimColor;
uniform bool uSpecular;
uniform float uSpecSize;
uniform float uSpecSharpness;
uniform vec3 uSpecColor;
uniform float uSpecStrength;
uniform bool uFill;
uniform vec3 uFillLight;
uniform vec3 uFillColor;
uniform float uFillStrength;

void main() {
  vec3 c = prevAt(uPrev, gl_FragCoord.xy).rgb;
  if (!uEnabled) { outColor = vec4(c, 1.0); return; }
  ivec2 ip = imgPx(gl_FragCoord.xy);
  // 只照亮主體, 背景保持原色(避免剪影外出現陰影暈)
  if (uHasSil && sdfAt(uSil, ip) > 0.5) { outColor = vec4(c, 1.0); return; }
  vec3 n = surfaceNormal(ip);
  // 以「正對畫面」的受光為基準: 平塗原色就是亮面的顏色
  float t = clamp(dot(n, uLight) / max(uLight.z, 0.2), 0.0, 1.0);
  if (uEdgeJitter > 0.0) t = clamp(t + (fbm(gl_FragCoord.xy * 0.03 / uScale) - 0.5) * 0.35 * uEdgeJitter, 0.0, 1.0);
  float q = 1.0;
  if (uBands > 1.5) {
    float x = t * uBands;
    float k = min(floor(x), uBands - 1.0);
    float f = x - k;
    float w = max(uSoftness, 0.001);
    q = clamp((k + smoothstep(1.0 - w, 1.0, f)) / (uBands - 1.0), 0.0, 1.0);
  }
  q = uAmbient + (1.0 - uAmbient) * q;

  float s = uShadowStrength;
  vec3 shadowCol = uShadowMode == 0 ? c * (1.0 - s)
    : uShadowMode == 1 ? mix(c, c * vec3(0.55, 0.62, 0.95) * (1.0 - 0.3 * s), s)
    : mix(c, uShadowColor, s);
  vec3 litCol = mix(c, min(c * uLitColor * 1.15, vec3(1.0)), uLitStrength);
  vec3 o = mix(shadowCol, litCol, q);
  o *= 1.0 - uAoStrength * texelFetch(uAo, ip, 0).r;

  if (uRim) {
    float facing = max(dot(normalize(n.xy + 1e-4), normalize(uLight.xy + 1e-4)), 0.0);
    o += uRimColor * uRimStrength * smoothstep(0.55, 0.95, 1.0 - n.z) * facing;
  }
  if (uSpecular) {
    vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
    float sp = pow(max(dot(n, h), 0.0), mix(8.0, 128.0, uSpecSharpness));
    float thr = 1.0 - uSpecSize * 0.9;
    o += uSpecColor * uSpecStrength * smoothstep(thr - 0.02, thr + 0.02, sp);
  }
  if (uFill) o += c * uFillColor * uFillStrength * max(dot(n, uFillLight), 0.0);
  outColor = vec4(clamp(o, 0.0, 1.0), q);
}`;

export const LINES_FS = HEADER + REGION + `
uniform sampler2D uPrev;
uniform sampler2D uSdf;
uniform sampler2D uSil;
uniform bool uHasSil;
uniform bool uEnabled;
uniform float uThickness;
uniform float uOuter;
uniform bool uInner;
uniform int uVariation;
uniform float uVarAmount;
uniform float uPressure;
uniform float uPressureScale;
uniform float uBreaks;
uniform int uColorMode;
uniform float uColorDarken;
uniform int uTexture;
uniform float uJitter;
uniform bool uDouble;
uniform vec2 uDoubleOffset;
uniform vec3 uDoubleColor;

float coverage(ivec2 ip, float w) {
  float sd = sdfAt(uSdf, ip);
  return 1.0 - smoothstep(w - 0.75, w + 0.75, sd);
}

void main() {
  vec4 prev = prevAt(uPrev, gl_FragCoord.xy);
  if (!uEnabled) { outColor = prev; return; }
  vec2 frag = gl_FragCoord.xy;
  if (uJitter > 0.0) {
    vec2 q = frag * 0.02 / uScale;
    frag += (vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * 2.0 * uJitter * uScale;
  }
  ivec2 ip = imgPx(frag);
  float w = uThickness;
  if (uVariation == 1) w += uVarAmount * (1.0 - prev.a);
  // 外輪廓: 落在主體剪影邊界附近的線
  bool outer = uHasSil && abs(sdfAt(uSil, ip)) < (max(w + uOuter, 0.0) + 3.0) * uScale + 2.0;
  if (outer) w += uOuter;
  if (uPressure > 0.0) w += uPressure * 2.0 * (vnoise(gl_FragCoord.xy * 0.05 / (uPressureScale * uScale)) * 2.0 - 1.0);
  // 距離場只記到約 ±16px, 粗細夾在可表示範圍內
  w = min(w * uScale, 14.5);
  float a = coverage(ip, w);
  if (!uInner && uHasSil && !outer) a = 0.0;
  if (uBreaks > 0.0) a *= smoothstep(uBreaks - 0.06, uBreaks + 0.06, vnoise(gl_FragCoord.xy * 0.06 / uScale));
  if (uTexture == 1) a *= 0.55 + 0.45 * hash(floor(gl_FragCoord.xy));
  else if (uTexture == 2) a *= smoothstep(0.32, 0.5, fbm(gl_FragCoord.xy * 0.35 / uScale));
  vec3 lc = uColorMode == 0 ? vec3(0.08) : regionColor(ip) * (1.0 - uColorDarken);
  vec3 base = prev.rgb;
  if (uDouble) {
    float a2 = coverage(imgPx(frag - uDoubleOffset), w);
    if (!uInner && uHasSil && !outer) a2 = 0.0;
    base = mix(base, uDoubleColor, a2 * 0.85);
  }
  outColor = vec4(mix(base, lc, a), prev.a);
}`;

export const EFFECTS_FS = HEADER + REGION + NORMALS + `
uniform sampler2D uPrev;
uniform sampler2D uSil;
uniform bool uHasSil;
uniform bool uEnabled;
uniform bool uHalftone;
uniform float uHtSize;
uniform float uHtAngle;
uniform bool uShadowOnly;
uniform float uHtStrength;
uniform bool uHatch;
uniform float uHatchSpacing;
uniform float uHatchAngle;
uniform float uHatchWidth;
uniform bool uCross;
uniform float uHatchStrength;
uniform bool uStipple;
uniform float uStipSize;
uniform float uStipDensity;
uniform float uWcEdge;
uniform float uWcBleed;
uniform float uWcGranule;
uniform float uBrush;
uniform float uBrushScale;
uniform float uRiso;
uniform float uRisoAngle;
uniform float uPaper;
uniform float uGrain;

mat2 rot(float deg) { float a = radians(deg); return mat2(cos(a), -sin(a), sin(a), cos(a)); }
float lineMask(vec2 frag, float angle, float spacing, float width) {
  float y = (rot(angle) * frag).y;
  float d = abs(fract(y / spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(width * 0.5 - 0.5, width * 0.5 + 0.5, d);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec4 p0 = prevAt(uPrev, frag);
  if (!uEnabled) { outColor = p0; return; }
  vec2 sampleAt = frag;
  if (uWcBleed > 0.0) {
    vec2 q = frag * 0.02 / uScale;
    sampleAt += (vec2(fbm(q), fbm(q + 31.7)) - 0.5) * 2.0 * uWcBleed * 6.0 * uScale;
  }
  vec3 c = prevAt(uPrev, sampleAt).rgb;
  if (uRiso > 0.0) {
    vec2 d = rot(uRisoAngle) * vec2(uRiso * uScale, 0.0);
    c.r = prevAt(uPrev, sampleAt + d).r;
    c.b = prevAt(uPrev, sampleAt - d).b;
  }
  // 排線、點描依畫面明暗(含光照陰影)決定疏密, 越暗越密
  float dark = clamp(1.0 - luma(c), 0.0, 1.0);
  ivec2 ip = imgPx(frag);
  bool fg = !uHasSil || sdfAt(uSil, ip) <= 0.5;

  if (uHalftone) {
    float size = uHtSize * uScale;
    vec2 cell = fract(rot(uHtAngle) * frag / size) - 0.5;
    float dist = length(cell) * size;
    float hd = clamp(uShadowOnly ? 1.0 - p0.a : 1.0 - luma(c), 0.0, 1.0);
    hd = clamp((hd - 0.12) / 0.88, 0.0, 1.0); // 很亮的地方(紙白)不出網點
    float r = sqrt(hd) * size * 0.7;
    float mask = hd > 0.001 ? 1.0 - smoothstep(r - 0.75, r + 0.75, dist) : 0.0;
    c *= 1.0 - uHtStrength * mask;
  }
  if (uHatch) {
    float sp = uHatchSpacing * uScale, wd = uHatchWidth * uScale;
    float m = lineMask(frag, uHatchAngle, sp, wd) * smoothstep(0.3, 0.4, dark);
    if (uCross) m = max(m, lineMask(frag, uHatchAngle + 90.0, sp, wd) * smoothstep(0.55, 0.65, dark));
    c = mix(c, c * 0.2, uHatchStrength * m);
  }
  if (uStipple) {
    float cellSize = uStipSize * uScale * 2.0;
    vec2 g = floor(frag / cellSize);
    vec2 center = (g + 0.25 + 0.5 * vec2(hash(g + 3.1), hash(g + 7.7))) * cellSize;
    float on = step(hash(g), pow(dark, 1.5) * uStipDensity * 1.5);
    float dot_ = 1.0 - smoothstep(uStipSize * uScale * 0.5 - 0.5, uStipSize * uScale * 0.5 + 0.5, length(frag - center));
    c = mix(c, c * 0.2, on * dot_);
  }
  if (uWcEdge > 0.0) {
    int id = regionId(ip);
    float r = 3.0 * uScale, diff = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854;
      if (regionId(imgPx(frag + vec2(cos(a), sin(a)) * r)) != id) diff += 1.0;
    }
    c *= 1.0 - uWcEdge * 0.35 * (diff / 8.0);
  }
  if (uWcGranule > 0.0) c *= 1.0 - uWcGranule * 0.25 * (1.0 - fbm(frag * 0.15 / uScale)) * (0.5 + 0.5 * dark);
  if (uBrush > 0.0 && fg) {
    vec3 n = surfaceNormal(ip);
    vec2 t = length(n.xy) > 0.02 ? normalize(vec2(-n.y, n.x)) : vec2(0.7071);
    vec2 uv = vec2(dot(frag, t), dot(frag, vec2(-t.y, t.x))) / (uBrushScale * uScale);
    c *= 1.0 + (vnoise(vec2(uv.x * 0.03, uv.y * 0.5)) - 0.5) * 0.5 * uBrush;
  }
  c *= 1.0 - uPaper * 0.25 * (1.0 - fbm(frag * 0.02 / uScale));
  c += uGrain * 0.15 * (hash(frag) - 0.5);
  outColor = vec4(clamp(c, 0.0, 1.0), p0.a);
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

export const FILTER_FS = HEADER + `
uniform sampler2D uPrev;
uniform sampler2D uSil;
uniform bool uHasSil;
uniform bool uEnabled;
uniform float uPixelSize;
uniform float uContrast;
uniform vec3 uTint;
uniform float uTintStrength;
uniform bool uDither;
uniform float uLevels;
uniform float uVignette;
uniform float uOutlineWidth;
uniform vec3 uOutlineColor;
uniform float uChroma;
uniform float uScan;
uniform float uScanSpacing;

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (uEnabled && uPixelSize > 1.0) frag = (floor(frag / uPixelSize) + 0.5) * uPixelSize;
  vec3 c = prevAt(uPrev, frag).rgb;
  if (!uEnabled) { outColor = vec4(c, 1.0); return; }
  if (uChroma > 0.0) {
    vec2 off = (frag / uSize - 0.5) * uChroma * uScale * 2.0;
    c.r = prevAt(uPrev, frag + off).r;
    c.b = prevAt(uPrev, frag - off).b;
  }
  if (uHasSil && uOutlineWidth > 0.0) {
    float sd = sdfAt(uSil, imgPx(frag));
    float w = min(uOutlineWidth * uScale, 14.5);
    float a = (1.0 - smoothstep(w - 0.75, w + 0.75, sd)) * step(0.0, sd);
    c = mix(c, uOutlineColor, a);
  }
  c = (c - 0.5) * uContrast + 0.5;
  c = mix(c, c * uTint, uTintStrength);
  if (uDither) {
    ivec2 bp = ivec2(floor(gl_FragCoord.xy / max(uPixelSize, 1.0))) & 3;
    float b = (BAYER[bp.y * 4 + bp.x] + 0.5) / 16.0;
    c = floor(clamp(c, 0.0, 1.0) * (uLevels - 1.0) + b) / (uLevels - 1.0);
  }
  vec2 uv = gl_FragCoord.xy / uSize;
  c *= 1.0 - uVignette * smoothstep(0.4, 0.95, length(uv - 0.5) * 1.4);
  if (uScan > 0.0) {
    float s = sin(gl_FragCoord.y * 3.14159 / (uScanSpacing * uScale));
    c *= 1.0 - uScan * 0.5 * s * s;
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** 泛光: 取亮部做分離高斯模糊。uDir = (1,0) 水平(含取亮部)、(0,1) 垂直。 */
export const BLOOM_FS = HEADER + `
uniform sampler2D uPrev;
uniform vec2 uDir;
uniform bool uBright;
uniform float uThreshold;
uniform float uRadius;

vec3 pick(vec2 frag) {
  vec3 c = prevAt(uPrev, frag).rgb;
  if (!uBright) return c;
  return max(c - uThreshold, 0.0) / max(1.0 - uThreshold, 0.05);
}

void main() {
  float step_ = uRadius / 8.0;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-float(i * i) / 18.0);
    sum += pick(gl_FragCoord.xy + uDir * float(i) * step_) * w;
    wsum += w;
  }
  outColor = vec4(sum / wsum, 1.0);
}`;

export const GRADE_FS = HEADER + `
uniform sampler2D uPrev;
uniform sampler2D uBloomTex;
uniform float uBloom;
uniform bool uEnabled;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uSatShadow;
uniform float uSatHighlight;
uniform bool uGradOn;
uniform sampler2D uGradTex;
uniform float uGradStrength;

void main() {
  vec3 c = prevAt(uPrev, gl_FragCoord.xy).rgb;
  if (uBloom > 0.0) c += prevAt(uBloomTex, gl_FragCoord.xy).rgb * uBloom * 1.5;
  if (uEnabled) {
    c = c * uGain + uLift * (1.0 - c);
    c = pow(max(c, 0.0), 1.0 / uGamma);
    float l = luma(c);
    c = mix(vec3(l), c, uSat);
    c = (c - 0.5) * uContrast + 0.5;
    l = luma(c);
    c = mix(vec3(l), c, mix(1.0 + uSatShadow, 1.0 + uSatHighlight, smoothstep(0.2, 0.8, l)));
    if (uGradOn) {
      vec3 g = texelFetch(uGradTex, ivec2(int(clamp(luma(c), 0.0, 1.0) * 255.0), 0), 0).rgb;
      c = mix(c, g, uGradStrength);
    }
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export const SOURCE_FS = HEADER + `
uniform sampler2D uSource;
void main() {
  outColor = vec4(texelFetch(uSource, imgPx(gl_FragCoord.xy), 0).rgb, 1.0);
}`;
