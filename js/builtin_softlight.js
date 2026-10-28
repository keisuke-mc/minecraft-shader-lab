// builtin_softlight.js — 内蔵シェーダー「Soft Light」(前半: 共通空関数・シャドウ・GBuffers・空)
// ※ GLSL 120 (OptiFine 互換記法) で書き、パイプラインの GLSL→ES3 変換器を通す
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  // ---- 共通: 空の見た目 (skybasic と composite で共用) ----
  const SKY_COMMON = `
const vec3 SL_DAY_ZEN = vec3(0.13, 0.31, 0.71);
const vec3 SL_DAY_HOR = vec3(0.61, 0.75, 0.92);
const vec3 SL_NGT_ZEN = vec3(0.006, 0.010, 0.028);
const vec3 SL_NGT_HOR = vec3(0.028, 0.045, 0.095);
const vec3 SL_SUNSET  = vec3(1.00, 0.40, 0.14);

float slDayF(vec3 sunDir) { return smoothstep(-0.07, 0.16, sunDir.y); }

vec3 slSky(vec3 dir, vec3 sunDir, float rain) {
  float d = slDayF(sunDir);
  float sunsetF = exp(-abs(sunDir.y) * 11.0);
  float upness = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 zen = mix(SL_NGT_ZEN, SL_DAY_ZEN, d);
  vec3 hor = mix(SL_NGT_HOR, SL_DAY_HOR, d);
  vec3 col = mix(hor, zen, pow(upness, 0.55));
  vec2 sxz = normalize(sunDir.xz + vec2(0.00001));
  vec2 dxz = normalize(dir.xz + vec2(0.00001));
  float az = dot(sxz, dxz) * 0.5 + 0.5;
  col += SL_SUNSET * sunsetF * pow(az, 3.0) * pow(1.0 - abs(dir.y), 4.0) * 1.4;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum) * 0.42, rain * 0.85);
  col *= 1.0 - rain * 0.35;
  return col;
}

vec3 slStars(vec3 dir, float time) {
  vec3 p = dir * 180.0;
  vec3 c = floor(p);
  float h = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 f = fract(p) - 0.5;
  float star = smoothstep(0.30, 0.05, length(f)) * step(0.996, h);
  float tw = 0.6 + 0.4 * sin(time * 2.0 + h * 40.0);
  return vec3(star * tw);
}

vec3 slSunDisc(vec3 dir, vec3 sunDir) {
  float c = dot(dir, sunDir);
  float disc = smoothstep(0.99935, 0.99965, c);
  vec3 tint = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.92, 0.78), smoothstep(0.0, 0.35, sunDir.y));
  float glow = pow(max(c, 0.0), 200.0) * 0.5 + pow(max(c, 0.0), 12.0) * 0.05;
  return tint * (disc * 6.0 + glow) * smoothstep(-0.06, 0.02, sunDir.y);
}

vec3 slMoonDisc(vec3 dir, vec3 sunDir, float nightD) {
  vec3 md = -sunDir;
  float c = dot(dir, md);
  float disc = smoothstep(0.99955, 0.99975, c);
  return vec3(0.85, 0.90, 1.0) * (disc * 1.6 + pow(max(c, 0.0), 280.0) * 0.25) * nightD * smoothstep(-0.06, 0.02, md.y);
}

vec4 slClouds(vec3 dir, vec3 camPos, vec3 sunDir, float time, float rain, float d) {
  float ch = 176.0 - camPos.y;
  if (dir.y < 0.02 || ch <= 0.0) return vec4(0.0);
  float t = ch / dir.y;
  vec2 uv = (camPos.xz + dir.xz * t) * 0.0035 + vec2(time * 0.006, time * 0.002);
  float f = texture2D(noisetex, uv).r * 0.5;
  f += texture2D(noisetex, uv * 2.7 + vec2(0.31, 0.17)).r * 0.25;
  f += texture2D(noisetex, uv * 6.1 + vec2(0.77, 0.53)).r * 0.15;
  f += texture2D(noisetex, uv * 13.9).r * 0.10;
  float cov = smoothstep(0.52 - rain * 0.24, 0.78, f);
  float fade = smoothstep(9000.0, 1500.0, t) * smoothstep(0.02, 0.09, dir.y);
  vec3 cc = mix(vec3(0.03, 0.04, 0.06), vec3(0.90, 0.93, 0.97), d);
  float sunsetF = exp(-abs(sunDir.y) * 11.0);
  cc = mix(cc, SL_SUNSET * 1.15, sunsetF * 0.45);
  cc *= 1.0 - rain * 0.55;
  return vec4(cc, cov * fade * 0.9);
}
`;

  const files = {};

  // ---- シャドウパス ----
  files['shaders/shadow.vsh'] = `#version 120

varying vec2 texcoord;
varying vec4 color;
varying float matId;

attribute vec4 mc_Entity;

void main() {
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
  color = gl_Color;
  matId = mc_Entity.x;
  gl_Position = ftransform();
  gl_Position.xy /= mix(1.0, length(gl_Position.xy), 0.85);
}
`;

  files['shaders/shadow.fsh'] = `#version 120

uniform sampler2D gtexture;

varying vec2 texcoord;
varying vec4 color;
varying float matId;

void main() {
  vec4 albedo = texture2D(gtexture, texcoord) * color;
  if (albedo.a < 0.1) discard;
  gl_FragData[0] = albedo;
  gl_FragData[1] = vec4(1.0);
}
`;

  // ---- 地形 G-Buffer ----
  files['shaders/gbuffers_terrain.vsh'] = `#version 120

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying vec3 normal;
varying float matId;

attribute vec4 mc_Entity;

void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
  lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
  color = gl_Color;
  normal = gl_NormalMatrix * gl_Normal;
  matId = mc_Entity.x;
}
`;

  files['shaders/gbuffers_terrain.fsh'] = `#version 120

uniform sampler2D gtexture;

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying vec3 normal;
varying float matId;

void main() {
  vec4 albedo = texture2D(gtexture, texcoord) * color;
  if (albedo.a < 0.1) discard;

  float mat = 0.0;
  float smoothness = 0.05;
  float metallic = 0.0;
  float emissive = 0.0;

  if (matId > 5.5 && matId < 6.5) { mat = 160.0; smoothness = 0.08; }
  if (matId > 7.5 && matId < 8.5) { mat = 220.0; emissive = 1.0; }
  if (matId > 9.5) { mat = 140.0; smoothness = 0.10; }

  gl_FragData[0] = vec4(albedo.rgb, 1.0);
  gl_FragData[1] = vec4(normal * 0.5 + 0.5, mat / 255.0);
  gl_FragData[2] = vec4(lmcoord, 0.0, 1.0);
  gl_FragData[3] = vec4(smoothness, metallic, emissive, 1.0);
}
`;

  // ---- 水 G-Buffer (頂点波 + 波紋法線) ----
  files['shaders/gbuffers_water.vsh'] = `#version 120

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying vec3 normal;
varying vec3 worldPos;

attribute vec4 mc_Entity;

uniform mat4 gbufferModelViewInverse;
uniform vec3 cameraPosition;
uniform float frameTimeCounter;

void main() {
  vec4 pos = gl_Vertex;
  worldPos = (gbufferModelViewInverse * (gl_ModelViewMatrix * pos)).xyz + cameraPosition;
  float wave = sin(worldPos.x * 0.9 + frameTimeCounter * 2.1) * cos(worldPos.z * 0.8 + frameTimeCounter * 1.7) * 0.045;
  pos.y += wave;
  gl_Position = gl_ProjectionMatrix * gl_ModelViewMatrix * pos;
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
  lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
  color = gl_Color;
  normal = gl_NormalMatrix * gl_Normal;
}
`;

  files['shaders/gbuffers_water.fsh'] = `#version 120

uniform sampler2D gtexture;
uniform float frameTimeCounter;

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying vec3 normal;
varying vec3 worldPos;

void main() {
  vec4 albedo = texture2D(gtexture, texcoord) * color;
  vec3 n = normalize(normal);
  float rip1 = sin(worldPos.x * 2.3 + frameTimeCounter * 2.4 + sin(worldPos.z * 1.4 + frameTimeCounter * 1.3) * 1.5);
  float rip2 = cos(worldPos.z * 2.6 + frameTimeCounter * 1.9 + sin(worldPos.x * 1.7 + frameTimeCounter * 0.9) * 1.3);
  n = normalize(n + vec3(rip1, 0.0, rip2) * 0.12);
  gl_FragData[0] = vec4(albedo.rgb, albedo.a);
  gl_FragData[1] = vec4(n * 0.5 + 0.5, 200.0 / 255.0);
  gl_FragData[2] = vec4(lmcoord, 0.0, 1.0);
  gl_FragData[3] = vec4(0.9, 0.0, 0.0, 1.0);
}
`;

  // ---- 空 (skybasic) ----
  files['shaders/gbuffers_skybasic.vsh'] = `#version 120

varying vec2 texcoord;

void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
}
`;

  files['shaders/gbuffers_skybasic.fsh'] = `#version 120

varying vec2 texcoord;

uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferModelViewInverse;
uniform vec3 sunPosition;
uniform float frameTimeCounter;
uniform float rainStrength;
uniform vec3 cameraPosition;
uniform sampler2D noisetex;

${SKY_COMMON}

void main() {
  vec4 ndc = vec4(texcoord * 2.0 - 1.0, 1.0, 1.0);
  vec4 v = gbufferProjectionInverse * ndc;
  vec3 viewDir = normalize(v.xyz / v.w);
  vec3 dir = normalize(mat3(gbufferModelViewInverse) * viewDir);
  vec3 sunDir = normalize(mat3(gbufferModelViewInverse) * normalize(sunPosition));
  float d = slDayF(sunDir);
  float nightD = 1.0 - d;
  vec3 col = slSky(dir, sunDir, rainStrength);
  col += slStars(dir, frameTimeCounter) * nightD * (1.0 - rainStrength);
  col += slSunDisc(dir, sunDir);
  col += slMoonDisc(dir, sunDir, nightD);
  vec4 cl = slClouds(dir, cameraPosition, sunDir, frameTimeCounter, rainStrength, d);
  col = mix(col, cl.rgb, cl.a);
  gl_FragData[0] = vec4(col, 1.0);
}
`;

  // ---- コンポジット用 頂点シェーダ (フルスクリーン四角形) ----
  files['shaders/composite.vsh'] = `#version 120

varying vec2 texcoord;

void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
}
`;

  SL.SOFTLIGHT_COMMON = { files, SKY_COMMON };
})();

// ---- 継続: コンポジット & ファイナル ----
(function () {
  'use strict';
  const files = window.SL.SOFTLIGHT_COMMON.files;
  const SKY_COMMON = window.SL.SOFTLIGHT_COMMON.SKY_COMMON;

  // ---- composite: ライティング + 霧 + 水 ----
  files['shaders/composite.fsh'] = `#version 120

uniform sampler2D colortex0;
uniform sampler2D colortex1;
uniform sampler2D colortex2;
uniform sampler2D colortex3;
uniform sampler2D depthtex0;
uniform sampler2D shadowtex0;
uniform sampler2D noisetex;

uniform mat4 gbufferProjectionInverse;
uniform mat4 gbufferModelViewInverse;
uniform mat4 gbufferModelView;
uniform mat4 shadowModelView;
uniform mat4 shadowProjection;
uniform vec3 sunPosition;
uniform vec3 shadowLightPosition;
uniform vec3 cameraPosition;
uniform float frameTimeCounter;
uniform float rainStrength;
uniform float isEyeInWater;
uniform float SL_shadowRes;

varying vec2 texcoord;

${SKY_COMMON}

float slShadow(vec3 worldPos, vec3 cameraPosition, float NdotL) {
  vec4 shc = shadowProjection * shadowModelView * vec4(worldPos - cameraPosition, 1.0);
  shc.xy /= mix(1.0, length(shc.xy), 0.85);
  vec3 suv = shc.xyz * 0.5 + 0.5;
  if (suv.x <= 0.002 || suv.x >= 0.998 || suv.y <= 0.002 || suv.y >= 0.998 || suv.z >= 1.0) return 1.0;
  float bias = 0.00055 + clamp(tan(acos(clamp(NdotL, 0.0, 1.0))), 0.0, 2.5) * 0.0007;
  float texel = 1.0 / SL_shadowRes;
  float sum = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float d = texture2D(shadowtex0, suv.xy + vec2(float(x), float(y)) * texel).r;
      sum += step(suv.z - bias, d);
    }
  }
  return sum / 9.0;
}

void main() {
  vec2 uv = texcoord;
  float depth = texture2D(depthtex0, uv).x;
  vec4 col0 = texture2D(colortex0, uv);

  if (depth >= 1.0) {
    gl_FragData[0] = col0;
    return;
  }

  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp4 = gbufferProjectionInverse * ndc;
  vec3 viewPos = vp4.xyz / vp4.w;
  vec3 worldPos = (gbufferModelViewInverse * vec4(viewPos, 1.0)).xyz + cameraPosition;

  vec4 nrmData = texture2D(colortex1, uv);
  vec3 nW = normalize(mat3(gbufferModelViewInverse) * (normalize(nrmData.xyz * 2.0 - 1.0)));
  float material = nrmData.a * 255.0;
  vec2 lmRaw = texture2D(colortex2, uv).xy;
  vec2 lm = clamp((lmRaw - 0.03125) / 0.9375, 0.0, 1.0);
  vec3 matP = texture2D(colortex3, uv).rgb;

  vec3 sunDirW = normalize(mat3(gbufferModelViewInverse) * normalize(sunPosition));
  float dayF = slDayF(sunDirW);
  float nightF = 1.0 - dayF;
  vec3 lightDirW = normalize(mat3(gbufferModelViewInverse) * normalize(shadowLightPosition));

  vec3 albedo = pow(col0.rgb, vec3(2.2));
  vec3 viewDirW = normalize(worldPos - cameraPosition);
  float NdotL = dot(nW, lightDirW);

  // 太陽光
  vec3 sunTint = mix(vec3(1.0, 0.42, 0.16), vec3(1.0, 0.94, 0.86), smoothstep(0.02, 0.33, sunDirW.y));
  vec3 sunCol = sunTint * dayF * 2.0 * (1.0 - rainStrength * 0.85);
  vec3 moonCol = vec3(0.10, 0.13, 0.22) * nightF * (1.0 - rainStrength * 0.8);

  float shadow = material > 215.0 ? 1.0 : slShadow(worldPos, cameraPosition, max(NdotL, 0.0));
  shadow *= 1.0 - rainStrength * 0.35;

  // 環境光 (半球)
  vec3 skyAmb = mix(vec3(0.016, 0.022, 0.045), vec3(0.34, 0.42, 0.54), dayF) * (1.0 - rainStrength * 0.55);
  vec3 gndAmb = vec3(0.06, 0.05, 0.04) * dayF;
  vec3 ambient = mix(gndAmb, skyAmb, nW.y * 0.5 + 0.5) * (0.25 + 0.75 * lm.y);
  vec3 torch = vec3(1.0, 0.55, 0.24) * pow(lm.x, 2.4) * 1.5;

  vec3 direct = sunCol * max(NdotL, 0.0) * shadow;
  direct += moonCol * max(NdotL, 0.0) * shadow;

  vec3 color = albedo * (ambient + torch) + albedo * direct;

  // 草花は少し明るく (トゥーン補正)
  if (material > 130.0 && material < 150.0) color += albedo * skyAmb * 0.25 * lm.y;

  // 発光ブロック
  if (material > 215.0) color = albedo * 4.5 + albedo * ambient * 0.3;

  // 鏡面反射
  float smoothness = matP.r;
  if (smoothness > 0.2 && dayF * max(NdotL, 0.0) * shadow > 0.0) {
    vec3 h = normalize(lightDirW - viewDirW);
    float spec = pow(max(dot(nW, h), 0.0), 40.0) * smoothness;
    color += sunTint * dayF * spec * shadow * 0.7;
  }

  // 水: フレネル反射
  if (material > 190.0 && material < 210.0) {
    vec3 refl = reflect(viewDirW, nW);
    refl.y = abs(refl.y) * 0.98 + 0.02;
    vec3 skyRef = slSky(normalize(refl), sunDirW, rainStrength);
    skyRef += slSunDisc(normalize(refl), sunDirW) * 0.08;
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(-viewDirW, nW), 0.0), 5.0);
    vec3 deep = albedo * (ambient + torch) * 0.8 + moonCol * 0.2 * max(NdotL, 0.0);
    color = mix(deep, skyRef, fres * 0.92);
    vec3 hw = normalize(lightDirW - viewDirW);
    color += sunTint * dayF * pow(max(dot(nW, hw), 0.0), 180.0) * shadow * 1.2;
    color += vec3(0.10, 0.13, 0.22) * nightF * pow(max(dot(nW, normalize(-sunDirW - viewDirW)), 0.0), 160.0);
  }

  // 雨: 濡れた地面
  float wet = rainStrength * step(0.5, 1.0 - material * 0.004);
  color *= 1.0 - wet * 0.22;

  // 霧
  float dist = length(viewPos);
  vec3 fogDir = viewDirW;
  vec3 fogCol = slSky(normalize(vec3(fogDir.x, max(fogDir.y, -0.03), fogDir.z)), sunDirW, rainStrength);
  float fogDensity = (1.0 / 115.0) * (1.0 + rainStrength * 2.2);
  float fogF = 1.0 - exp(-dist * fogDensity);
  fogF = pow(fogF, 1.4);
  color = mix(color, fogCol, clamp(fogF, 0.0, 1.0));

  // 水中
  if (isEyeInWater > 0.5) {
    float wf = exp(-dist * 0.10);
    color = mix(vec3(0.02, 0.10, 0.16), color, wf);
  }

  gl_FragData[0] = vec4(color, 1.0);
}
`;

  // ---- composite1: ブルーム用輝度抽出 → colortex5 ----
  files['shaders/composite1.fsh'] = `#version 120

uniform sampler2D colortex0;
uniform vec2 texelSize;

varying vec2 texcoord;

void main() {
  vec3 c = vec3(0.0);
  c += texture2D(colortex0, texcoord + texelSize * vec2(-1.0, -1.0)).rgb;
  c += texture2D(colortex0, texcoord + texelSize * vec2( 1.0, -1.0)).rgb;
  c += texture2D(colortex0, texcoord + texelSize * vec2(-1.0,  1.0)).rgb;
  c += texture2D(colortex0, texcoord + texelSize * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  gl_FragData[5] = vec4(max(c - 0.62, 0.0) * 1.5, 1.0);
}
`;

  // ---- composite2: 横ブラー → colortex6 ----
  files['shaders/composite2.fsh'] = `#version 120

uniform sampler2D colortex5;
uniform vec2 texelSize;

varying vec2 texcoord;

void main() {
  vec2 off = vec2(texelSize.x * 2.2, 0.0);
  vec3 sum = texture2D(colortex5, texcoord).rgb * 0.196;
  float w[3]; w[0] = 0.174; w[1] = 0.121; w[2] = 0.054;
  for (int i = 1; i <= 2; i++) {
    float fi = float(i);
    sum += texture2D(colortex5, texcoord + off * fi).rgb * w[i];
    sum += texture2D(colortex5, texcoord - off * fi).rgb * w[i];
  }
  gl_FragData[6] = vec4(sum, 1.0);
}
`;

  // ---- composite3: 縦ブラー → colortex5 ----
  files['shaders/composite3.fsh'] = `#version 120

uniform sampler2D colortex6;
uniform vec2 texelSize;

varying vec2 texcoord;

void main() {
  vec2 off = vec2(0.0, texelSize.y * 2.2);
  vec3 sum = texture2D(colortex6, texcoord).rgb * 0.196;
  float w[3]; w[0] = 0.174; w[1] = 0.121; w[2] = 0.054;
  for (int i = 1; i <= 2; i++) {
    float fi = float(i);
    sum += texture2D(colortex6, texcoord + off * fi).rgb * w[i];
    sum += texture2D(colortex6, texcoord - off * fi).rgb * w[i];
  }
  gl_FragData[5] = vec4(sum, 1.0);
}
`;

  // ---- final: トーンマップ + ビネット + 雨の筋 + 雷のフラッシュ ----
  files['shaders/final.fsh'] = `#version 120

uniform sampler2D colortex0;
uniform sampler2D colortex5;
uniform sampler2D noisetex;
uniform vec3 sunPosition;
uniform mat4 gbufferModelViewInverse;
uniform float rainStrength;
uniform float frameTimeCounter;
uniform float viewWidth;
uniform float viewHeight;
uniform float SL_lightningFlash;

varying vec2 texcoord;

vec3 slToneMap(vec3 x) {
  x *= 1.05;
  vec3 a = x * (2.51 * x + 0.03);
  vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b, 0.0, 1.0);
}

void main() {
  vec3 color = texture2D(colortex0, texcoord).rgb;
  vec3 sunDirW = normalize(mat3(gbufferModelViewInverse) * normalize(sunPosition));
  float dayF = smoothstep(-0.07, 0.16, sunDirW.y);

  // ブルーム加算
  color += texture2D(colortex5, texcoord).rgb * 0.08;

  // 露光 (夜は少し持ち上げ)
  float exposure = mix(1.45, 1.0, dayF);
  color = slToneMap(color * exposure);

  // 雨の筋
  if (rainStrength > 0.01) {
    float aspect = viewWidth / max(viewHeight, 1.0);
    vec2 suv = vec2(texcoord.x * aspect, texcoord.y);
    float ca = 0.22, sa = 0.975;
    vec2 ruv = vec2(suv.x * ca - suv.y * sa, suv.x * sa + suv.y * ca);
    float line = fract(ruv.x * 110.0 + texture2D(noisetex, vec2(ruv.x * 1.5, ruv.y * 0.25 - frameTimeCounter * 0.7)).r * 7.0);
    float streak = smoothstep(0.965, 1.0, line) * texture2D(noisetex, vec2(ruv.x * 110.0, ruv.y * 0.9 - frameTimeCounter * 2.6)).r;
    float verticalMask = smoothstep(1.05, 0.25, suv.y);
    color += streak * verticalMask * rainStrength * 0.30 * vec3(0.65, 0.75, 0.95);
  }

  // 雷
  color += vec3(0.85, 0.92, 1.10) * SL_lightningFlash * 0.75;

  // ビネット
  vec2 vc = texcoord - 0.5;
  color *= 1.0 - dot(vc, vc) * 0.55 * (1.0 - dayF * 0.35);

  color = pow(clamp(color, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragData[0] = vec4(color, 1.0);
}
`;

  window.SL.SOFTLIGHT_PACK = {
    name: '内蔵: Soft Light',
    builtin: true,
    files
  };
})();
