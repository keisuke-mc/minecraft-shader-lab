// packloader.js — OptiFine/Iris 形式パックの解析（#include 解決・プログラム検出・const 設定解析）
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  const PROGRAM_NAMES = [];
  (function () {
    const g = ['gbuffers_terrain', 'gbuffers_water', 'gbuffers_textured', 'gbuffers_textured_lit',
      'gbuffers_basic', 'gbuffers_skybasic', 'gbuffers_skytextured', 'gbuffers_clouds',
      'gbuffers_entities', 'gbuffers_hand', 'gbuffers_weather', 'gbuffers_block', 'gbuffers_beaconbeam',
      'gbuffers_spidereyes', 'gbuffers_armor_glint', 'gbuffers_damagedblock', 'gbuffers_particles',
      'gbuffers_particles_translucent', 'gbuffers_lit_particles', 'gbuffers_entities_glowing',
      'gbuffers_textured_glowing', 'gbuffers_basic_glowing', 'gbuffers_block_translucent', 'shadow'];
    for (let i = 0; i < 32; i++) {
      g.push('deferred' + (i === 0 ? '' : i));
      g.push('composite' + (i === 0 ? '' : i));
    }
    g.push('prepare'); g.push('final');
    PROGRAM_NAMES.push(...g);
  })();

  // 合成用デフォルト vertex shader
  const DEFAULT_VS = `#version 120
varying vec2 texcoord;
void main() {
  gl_Position = ftransform();
  texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
}
`;

  const FORMAT_MAP = {
    R8: 'R8', RG8: 'RG8', RGB8: 'RGB8', RGBA8: 'RGBA8',
    R16: 'R16', RG16: 'RG16', RGB16: 'RGB16', RGBA16: 'RGBA16',
    R16F: 'R16F', RG16F: 'RG16F', RGB16F: 'RGB16F', RGBA16F: 'RGBA16F',
    R32F: 'R32F', RG32F: 'RG32F', RGB32F: 'RGB32F', RGBA32F: 'RGBA32F',
    R11F_G11F_B10F: 'R11F_G11F_B10F', RGB10_A2: 'RGB10_A2',
    R3_G3_B2: 'RGB8', RGB5_A1: 'RGBA8', RGBA4: 'RGBA8', SRGB8_ALPHA8: 'RGBA8',
    RGB565: 'RGB8', RGB9_E5: 'RGB16F'
  };

  function decodeText(u8) {
    if (typeof u8 === 'string') return u8;
    return new TextDecoder('utf-8', { fatal: false }).decode(u8);
  }

  // files: { path: Uint8Array|string }
  function parsePack(files, packName) {
    const norm = {};
    for (const [k, v] of Object.entries(files)) norm[SL.normZipPath(k)] = v;

    // shaders ルートを特定
    let prefix = '';
    const keys = Object.keys(norm);
    const withShaders = keys.find(k => k.includes('shaders/'));
    if (withShaders) {
      prefix = withShaders.slice(0, withShaders.indexOf('shaders/') + 'shaders/'.length);
    }

    const root = {};
    for (const [k, v] of Object.entries(norm)) {
      if (!k.startsWith(prefix)) continue;
      const rel = k.slice(prefix.length);
      if (!/\.(vsh|fsh|gsh|glsl|program|txt|properties)$/i.test(rel)) continue;
      root[rel] = decodeText(v);
    }
    const shaderKeys = Object.keys(root).filter(k => /\.(vsh|fsh|gsh|glsl)$/i.test(k));
    if (!shaderKeys.length) throw new Error('shaders フォルダ / .vsh・.fsh が見つかりません（OptiFine 形式の zip ですか？）');

    // #include 解決
    const diag = [];
    const resolveIncludes = (path, seen) => {
      let src = root[path];
      if (src === undefined) return null;
      if (seen.includes(path)) { diag.push('警告: #include 循環: ' + path); return ''; }
      seen.push(path);
      src = src.replace(/^[ \t]*#[ \t]*include[ \t]*[<"]([^>"]+)[>"][ \t]*$/gm, (m, inc) => {
        let target = inc.replace(/\\/g, '/').toLowerCase();
        if (target.startsWith('/')) target = target.slice(1);
        else target = path.slice(0, path.lastIndexOf('/') + 1) + target;
        const resolved = resolveIncludes(target, seen);
        if (resolved === null) { diag.push('警告: include が見つかりません: ' + inc + ' (' + path + ')'); return ''; }
        return resolved;
      });
      seen.pop();
      return src;
    };
    const resolved = {};
    for (const k of shaderKeys) {
      const r = resolveIncludes(k, []);
      if (r !== null) resolved[k] = r;
    }

    // プログラム検出
    const programs = {};
    for (const name of PROGRAM_NAMES) {
      const vsh = resolved[name + '.vsh'];
      let fsh = resolved[name + '.fsh'];
      if (vsh && fsh) programs[name] = { vsh, fsh };
      else if (!vsh && fsh && (name.startsWith('composite') || name.startsWith('deferred') || name === 'final' || name === 'prepare')) {
        // .fsh のみ → 既定頂点シェーダを合成して寛容に処理
        programs[name] = { vsh: DEFAULT_VS, fsh };
        diag.push(name + ': .vsh がないため既定の頂点シェーダを使用');
      }
    }

    // const 設定の解析（include 解決後の全文から）
    const allSrc = Object.values(resolved).join('\n');
    const consts = { formats: {}, clear: {} };
    let m;
    const fmtRe = /const\s+int\s+colortex(\d)Format\s*=\s*(\w+)\s*;/g;
    while ((m = fmtRe.exec(allSrc))) consts.formats[+m[1]] = FORMAT_MAP[m[2]] || 'RGBA8';
    const clrRe = /const\s+bool\s+colortex(\d)Clear\s*=\s*(true|false)\s*;/g;
    while ((m = clrRe.exec(allSrc))) consts.clear[+m[1]] = m[2] === 'true';
    const grab = (re, def) => { const r = allSrc.match(re); return r ? parseFloat(r[1]) : def; };
    consts.shadowMapResolution = grab(/const\s+int\s+shadowMapResolution\s*=\s*(\d+)\s*;/, 2048);
    consts.shadowDistance = grab(/const\s+float\s+shadowDistance\s*=\s*(-?[\d.]+)\s*;/, 110);
    consts.shadowDistanceRenderMul = grab(/const\s+float\s+shadowDistanceRenderMul\s*=\s*(-?[\d.]+)\s*;/, -1);
    consts.sunPathRotation = grab(/const\s+float\s+sunPathRotation\s*=\s*(-?[\d.]+)\s*;/, 0);
    consts.shadowHardwareFiltering = /const\s+bool\s+shadowHardwareFiltering\s*=\s*true/.test(allSrc);

    // 使用されている uniform 名の収集（未対応 uniform の報告用）
    return { name: packName, programs, consts, diag, fileCount: shaderKeys.length };
  }

  SL.parsePack = parsePack;
  SL.PACK_DEFAULT_VS = DEFAULT_VS;
})();
