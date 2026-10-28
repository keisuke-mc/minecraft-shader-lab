// builtin_vanilla.js — 内蔵「バニラ風」パック（素の Minecraft っぽい描画・比較用）
(function () {
  'use strict';
  window.SL = window.SL || {};
  const files = {};

  files['shaders/gbuffers_terrain.vsh'] = `#version 120

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying float dist;

attribute vec4 mc_Entity;

uniform vec3 cameraPosition;

void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
  lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
  color = gl_Color;
  vec4 wp = gl_ModelViewMatrix * gl_Vertex;
  dist = length(wp.xyz);
}
`;

  files['shaders/gbuffers_terrain.fsh'] = `#version 120

uniform sampler2D gtexture;
uniform sampler2D lightmap;
uniform vec3 sunPosition;
uniform vec3 upPosition;
uniform vec3 fogColor;
uniform float rainStrength;

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying float dist;

void main() {
  vec4 albedo = texture2D(gtexture, texcoord) * color;
  if (albedo.a < 0.1) discard;

  vec3 sunDir = normalize(sunPosition);
  float dayF = smoothstep(-0.14, 0.22, sunDir.y);
  float skyBr = mix(0.22, 1.0, dayF) * (1.0 - rainStrength * 0.4);
  float torchBr = pow(clamp((lmcoord.x - 0.03125) / 0.9375, 0.0, 1.0), 2.0);
  float skyLm = clamp((lmcoord.y - 0.03125) / 0.9375, 0.0, 1.0);

  vec3 light = vec3(1.0, 0.6, 0.3) * torchBr * 1.1;
  light += vec3(0.8, 0.9, 1.0) * skyLm * skyBr;

  vec3 col = albedo.rgb * light;

  float fogF = 1.0 - exp(-dist * (1.0 / 110.0) * (1.0 + rainStrength * 2.0));
  col = mix(col, fogColor, clamp(fogF, 0.0, 1.0));

  gl_FragData[0] = vec4(col, albedo.a);
}
`;

  files['shaders/gbuffers_water.vsh'] = `#version 120

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying float dist;

void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
  lmcoord = (gl_TextureMatrix[1] * gl_MultiTexCoord1).xy;
  color = gl_Color;
  vec4 wp = gl_ModelViewMatrix * gl_Vertex;
  dist = length(wp.xyz);
}
`;

  files['shaders/gbuffers_water.fsh'] = `#version 120

uniform sampler2D gtexture;
uniform vec3 fogColor;
uniform float rainStrength;

varying vec2 texcoord;
varying vec2 lmcoord;
varying vec4 color;
varying float dist;

void main() {
  vec4 albedo = texture2D(gtexture, texcoord) * color;
  vec3 col = albedo.rgb * vec3(0.7, 0.85, 1.05);
  float fogF = 1.0 - exp(-dist * (1.0 / 110.0) * (1.0 + rainStrength * 2.0));
  col = mix(col, fogColor, clamp(fogF, 0.0, 1.0));
  gl_FragData[0] = vec4(col, albedo.a);
}
`;

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
uniform float rainStrength;

void main() {
  vec4 ndc = vec4(texcoord * 2.0 - 1.0, 1.0, 1.0);
  vec4 v = gbufferProjectionInverse * ndc;
  vec3 dir = normalize(mat3(gbufferModelViewInverse) * normalize(v.xyz / v.w));
  vec3 sunDir = normalize(mat3(gbufferModelViewInverse) * normalize(sunPosition));
  float dayF = smoothstep(-0.14, 0.22, sunDir.y);
  float sunsetF = exp(-abs(sunDir.y) * 9.0);
  vec3 zen = mix(vec3(0.008, 0.012, 0.030), vec3(0.29, 0.48, 0.80), dayF);
  vec3 hor = mix(vec3(0.03, 0.04, 0.08), vec3(0.68, 0.80, 0.92), dayF);
  vec3 col = mix(hor, zen, pow(clamp(dir.y * 0.5 + 0.5, 0.0, 1.0), 0.6));
  vec2 sxz = normalize(sunDir.xz + vec2(0.00001));
  vec2 dxz = normalize(dir.xz + vec2(0.00001));
  float az = dot(sxz, dxz) * 0.5 + 0.5;
  col += vec3(1.0, 0.5, 0.2) * sunsetF * pow(az, 3.0) * pow(1.0 - abs(dir.y), 4.0);
  float lum = dot(col, vec3(0.3, 0.6, 0.1));
  col = mix(col, vec3(lum) * 0.5, rainStrength * 0.8);
  gl_FragData[0] = vec4(col, 1.0);
}
`;

  files['shaders/composite.vsh'] = `#version 120

varying vec2 texcoord;

void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
}
`;

  files['shaders/final.fsh'] = `#version 120

uniform sampler2D colortex0;

varying vec2 texcoord;

void main() {
  gl_FragData[0] = vec4(texture2D(colortex0, texcoord).rgb, 1.0);
}
`;

  window.SL.VANILLA_PACK = {
    name: '内蔵: バニラ風',
    builtin: true,
    files
  };
})();
