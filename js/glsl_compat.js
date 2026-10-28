// glsl_compat.js — GLSL 120 (旧 OpenGL) → GLSL ES 3.00 (WebGL2) 自動変換器
// OptiFine 形式のシェーダーソースを、ブラウザで動く形に正規表現ベースで変換する
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  // 長い名前から先に置換（接頭の衝突を防ぐ）
  const VS_REPL = [
    [/ftransform\s*\(\s*\)/g, '(SL_ProjectionMatrix * SL_ModelViewMatrix * vec4(SL_aPosition, 1.0))'],
    [/\bgl_ModelViewProjectionMatrix\b/g, '(SL_ProjectionMatrix * SL_ModelViewMatrix)'],
    [/\bgl_ModelViewMatrixInverse\b/g, 'SL_ModelViewMatrixInverse'],
    [/\bgl_ProjectionMatrixInverse\b/g, 'SL_ProjectionMatrixInverse'],
    [/\bgl_ModelViewMatrix\b/g, 'SL_ModelViewMatrix'],
    [/\bgl_ProjectionMatrix\b/g, 'SL_ProjectionMatrix'],
    [/\bgl_NormalMatrix\b/g, 'SL_NormalMatrix'],
    [/\bgl_MultiTexCoord0\b/g, 'vec4(SL_aUV, 0.0, 1.0)'],
    [/\bgl_MultiTexCoord1\b/g, 'vec4(SL_aLight, 0.0, 1.0)'],
    [/\bgl_Vertex\b/g, 'vec4(SL_aPosition, 1.0)'],
    [/\bgl_Normal\b/g, 'SL_aNormal'],
    [/\bgl_FrontColor\b/g, 'SL_frontColor'],
    [/\bgl_BackColor\b/g, 'SL_frontColor'],
    [/\bgl_Color\b/g, 'SL_aColor'],
    [/\bgl_TextureMatrix\s*\[\s*1\s*\]/g, 'SL_tm1'],
    [/\bgl_TextureMatrix\s*\[\s*0\s*\]/g, 'SL_tm0'],
    [/\battribute\b/g, 'in'],
    [/\bvarying\b/g, 'out']
  ];

  const FS_REPL = [
    [/\bgl_ModelViewMatrixInverse\b/g, 'SL_ModelViewMatrixInverse'],
    [/\bgl_ProjectionMatrixInverse\b/g, 'SL_ProjectionMatrixInverse'],
    [/\bgl_FrontColor\b/g, 'SL_frontColor'],
    [/\bgl_Color\b/g, 'SL_frontColor'],
    [/\bgl_FogFragCoord\b/g, '0.0'],
    [/\bvarying\b/g, 'in']
  ];

  const FUNC_REPL = [
    [/\btexture2DLod\b/g, 'textureLod'],
    [/\btexture2DProj\b/g, 'textureProj'],
    [/\btexture2D\b/g, 'texture'],
    [/\btexture3DLod\b/g, 'textureLod'],
    [/\btexture3D\b/g, 'texture'],
    [/\btextureCube\b/g, 'texture'],
    [/\bshadow2DGrad\b/g, 'SL_shadow2DGrad'],
    [/\bshadow2DLod\b/g, 'SL_shadow2DLod'],
    [/\bshadow2D\b/g, 'SL_shadow2D']
  ];

  const LEGACY_TEST = /\b(gl_Vertex|gl_ModelViewMatrix|gl_ProjectionMatrix|gl_NormalMatrix|gl_MultiTexCoord\d|gl_TexCoord|gl_FrontColor|gl_BackColor|gl_Color|gl_TextureMatrix|ftransform|attribute|varying|texture2D|texture3D|textureCube|shadow2D|gl_FragColor|gl_FragData)\b/;

  const PRELUDE = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp sampler2DShadow;',
    'precision highp sampler3D;'
  ].join('\n');

  const SHADOW_OVERLOADS = [
    'vec4 SL_shadow2D(sampler2DShadow s, vec3 c) { return vec4(texture(s, c)); }',
    'vec4 SL_shadow2D(sampler2D s, vec3 c) { return vec4(texture(s, c.xy)); }',
    'vec4 SL_shadow2DLod(sampler2DShadow s, vec3 c, float l) { return vec4(textureLod(s, c, l)); }',
    'vec4 SL_shadow2DLod(sampler2D s, vec3 c, float l) { return vec4(textureLod(s, c.xy, l)); }',
    'vec4 SL_shadow2DGrad(sampler2DShadow s, vec3 c, vec2 dx, vec2 dy) { return vec4(textureGrad(s, c, dx, dy)); }',
    'vec4 SL_shadow2DGrad(sampler2D s, vec3 c, vec2 dx, vec2 dy) { return vec4(textureGrad(s, c.xy, dx, dy)); }'
  ].join('\n');

  const VS_COMPAT_DECLS = [
    'uniform mat4 SL_ModelViewMatrix;',
    'uniform mat4 SL_ProjectionMatrix;',
    'uniform mat4 SL_ModelViewMatrixInverse;',
    'uniform mat4 SL_ProjectionMatrixInverse;',
    'uniform mat3 SL_NormalMatrix;',
    'uniform vec3 SL_aPosition;',
    'uniform vec3 SL_aNormal;',
    'uniform vec4 SL_aColor;',
    'uniform vec2 SL_aUV;',
    'uniform vec2 SL_aLight;'
  ].join('\n');

  // 属性を attribute として宣言するバージョン（bindAttribLocation で固定スロットに結合）
  const VS_COMPAT_ATTRS = [
    'layout(location = 0) in vec3 SL_aPosition;',
    'layout(location = 2) in vec3 SL_aNormal;',
    'layout(location = 3) in vec4 SL_aColor;',
    'layout(location = 1) in vec2 SL_aUV;',
    'layout(location = 4) in vec2 SL_aLight;'
  ].join('\n');

  // 変換メイン。stage: 'vs' | 'fs'
  // 戻り値: { code, written: [colortex idx...], legacy, log: string[] }
  function convertGLSL(src, stage) {
    const log = [];
    let body = String(src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

    // #version / #extension を除去（記録のみ）
    const exts = [];
    body = body.replace(/^[ \t]*#[ \t]*version[^\n]*\n?/m, '');
    body = body.replace(/^[ \t]*#[ \t]*extension[^\n]*$/gm, (m) => { exts.push(m.trim()); return ''; });
    if (exts.length) log.push('拡張指令を除去: ' + exts.length + ' 行 (ES3 では不要)');

    const legacy = LEGACY_TEST.test(body);

    // sampler2D texture; の名前衝突を回避
    body = body.replace(/\b(uniform\s+sampler2D(?:Array)?|uniform\s+sampler3D)\s+texture\s*;/g, '$1 gtexture;');

    // 関数名の置換
    for (const [re, to] of FUNC_REPL) body = body.replace(re, to);
    // texture(texture, ...) / textureLod(texture, ...) などの自己参照を修正
    body = body.replace(/\b(texture|textureLod|textureProj|textureOffset|textureGrad)\s*\(\s*texture\s*,/g, '$1(gtexture,');

    const written = new Set();

    if (stage === 'vs') {
      // gl_TexCoord[n] の検出
      const tcIdx = new Set();
      body.replace(/\bgl_TexCoord\s*\[\s*(\d+)\s*\]/g, (m, n) => { tcIdx.add(+n); return m; });
      for (const [re, to] of VS_REPL) body = body.replace(re, to);
      let decls = '';
      if (legacy) {
        decls += VS_COMPAT_ATTRS + '\n';
        decls += 'uniform mat4 SL_ModelViewMatrix;\nuniform mat4 SL_ProjectionMatrix;\n';
        decls += 'uniform mat4 SL_ModelViewMatrixInverse;\nuniform mat4 SL_ProjectionMatrixInverse;\nuniform mat3 SL_NormalMatrix;\n';
      }
      if (/SL_tm0/.test(body)) decls += 'const mat4 SL_tm0 = mat4(1.0);\n';
      if (/SL_tm1/.test(body)) decls += 'const mat4 SL_tm1 = mat4(0.9375,0.0,0.0,0.0, 0.0,0.9375,0.0,0.0, 0.0,0.0,1.0,0.0, 0.03125,0.03125,0.0,1.0);\n';
      if (tcIdx.size) {
        decls += [...tcIdx].sort().map(i => 'out vec4 SL_texcoord' + i + ';').join('\n') + '\n';
        for (const i of tcIdx) body = body.replace(new RegExp('\\bgl_TexCoord\\s*\\[\\s*' + i + '\\s*\\]', 'g'), 'SL_texcoord' + i);
      }
      if (/SL_frontColor/.test(body)) decls += 'out vec4 SL_frontColor;\n';
      if (legacy) log.push('レガシーGLSL互換コードを注入 (vertex)');
      const code = PRELUDE + '\n' + decls + '\n' + body;
      return { code, written: [], legacy, log };
    }

    // ---- fragment ----
    // 書き込みターゲット検出
    const rt = body.match(/\/\*\s*RENDERTARGETS\s*:\s*([\d,\s]+?)\s*\*\//);
    if (rt) rt[1].split(',').forEach(s => { const n = parseInt(s.trim()); if (n >= 0) written.add(n); });

    const fragIdx = new Set();
    body = body.replace(/\bgl_FragData\s*\[\s*(\d+)\s*\]/g, (m, n) => { fragIdx.add(+n); written.add(+n); return 'SL_fragData_' + n; });
    body = body.replace(/\bgl_FragData\s*\[\s*\w+\s*\]/g, (m) => { log.push('警告: gl_FragData の可変添字は変換できません: ' + m); return m; });

    for (const [re, to] of FS_REPL) body = body.replace(re, to);

    let hasFragColor = /\bSL_fragData_0\b/.test(body);
    if (/gl_FragColor/.test(body)) {
      body = body.replace(/\bgl_FragColor\b/g, 'SL_fragData_0');
      hasFragColor = true; written.add(0);
    }

    // モダン (330+) ソースの out 検出
    const outRe = /^[ \t]*(?:layout\s*\(\s*location\s*=\s*(\d+)\s*\)[ \t]*)?out[ \t]+(?:lowp|mediump|highp)?[ \t]*(\w+)[ \t]+(\w+)[ \t]*(?:=[^;]*)?;/gm;
    let m;
    const bareOuts = [];
    while ((m = outRe.exec(body)) !== null) {
      const loc = m[1] !== undefined ? +m[1] : null;
      const name = m[3];
      if (loc !== null) { written.add(loc); continue; }
      bareOuts.push(name);
    }
    for (const name of bareOuts) {
      const assignRe = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\s*=(?!=)');
      if (assignRe.test(body)) {
        // 宣言順に 0,1,2,... を割り当てる標準挙動を想定
        const before = body.slice(0, body.indexOf(name));
        let cnt = 0;
        const re2 = /^[ \t]*(?:layout\s*\(\s*location\s*=\s*(\d+)\s*\)[ \t]*)?out[ \t]+(?:lowp|mediump|highp)?[ \t]*(\w+)[ \t]+(\w+)[ \t]*(?:=[^;]*)?;/gm;
        let m2;
        while ((m2 = re2.exec(before)) !== null) {
          if (m2[1] === undefined && new RegExp('\\b' + m2[3] + '\\s*=(?!=)').test(body)) cnt++;
          else if (m2[1] !== undefined) cnt = +m2[1] + 1;
        }
        written.add(cnt);
      }
    }

    // in/out 宣言の組立
    let decls = '';
    const tcIdx = new Set();
    body.replace(/\bSL_texcoord(\d)\b/g, (mm, n) => { tcIdx.add(+n); return mm; });
    for (const i of tcIdx) decls += 'in vec4 SL_texcoord' + i + ';\n';
    if (/SL_frontColor/.test(body)) decls += 'in vec4 SL_frontColor;\n';

    const fragTargets = [...(fragIdx.size ? fragIdx : (hasFragColor ? new Set([0]) : new Set()))];
    const anyLegacyOut = fragTargets.length > 0;
    if (anyLegacyOut) {
      decls += fragTargets.sort((a, b) => a - b).map(i => 'layout(location = ' + i + ') out vec4 SL_fragData_' + i + ';').join('\n') + '\n';
    } else if (written.size === 0) {
      // 書き込みが全く検出できない → location 0 にフォールバック
      log.push('フラグメント出力が未検出のため location 0 を仮定');
    }

    let code = PRELUDE + '\n';
    if (/SL_shadow2D|SL_shadow2DLod|SL_shadow2DGrad/.test(body) || /\bsampler2DShadow\b/.test(body)) code += SHADOW_OVERLOADS + '\n';
    if (legacy) { code += 'uniform mat4 SL_ModelViewMatrixInverse;\nuniform mat4 SL_ProjectionMatrixInverse;\n'; log.push('レガシーGLSL互換コードを注入 (fragment)'); }
    code += decls + '\n' + body;

    return { code, written: [...written], legacy, log };
  }

  SL.convertGLSL = convertGLSL;
})();
