// pipeline.js — OptiFine/Iris 風レンダーパイプライン (WebGL2)
// shadow → sky → gbuffers → depthコピー → 水 → composites → final
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  const GLFORMAT = (gl, fmt) => {
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    const map = {
      RGBA8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, true],
      RGB8: [gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, true],
      RG8: [gl.RG8, gl.RG, gl.UNSIGNED_BYTE, true],
      R8: [gl.R8, gl.RED, gl.UNSIGNED_BYTE, true],
      RGBA16: [gl.RGBA16, gl.RGBA, gl.UNSIGNED_SHORT, true],
      RGB16: [gl.RGB16, gl.RGB, gl.UNSIGNED_SHORT, true],
      RG16: [gl.RG16, gl.RG, gl.UNSIGNED_SHORT, true],
      R16: [gl.R16, gl.RED, gl.UNSIGNED_SHORT, true],
      RGBA16F: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, true],
      RGB16F: [gl.RGB16F, gl.RGB, gl.HALF_FLOAT, true],
      RG16F: [gl.RG16F, gl.RG, gl.HALF_FLOAT, true],
      R16F: [gl.R16F, gl.RED, gl.HALF_FLOAT, true],
      R11F_G11F_B10F: [gl.R11F_G11F_B10F, gl.RGB, gl.UNSIGNED_INT_10F_11F_11F_REV, true],
      RGBA32F: [gl.RGBA32F, gl.RGBA, gl.FLOAT, false],
      RGB32F: [gl.RGB32F, gl.RGB, gl.FLOAT, false],
      RG32F: [gl.RG32F, gl.RG, gl.FLOAT, false],
      R32F: [gl.R32F, gl.RED, gl.FLOAT, false]
    };
    let e = map[fmt] || map.RGBA8;
    if (!floatOK && /F$/.test(fmt)) e = map.RGBA8;
    return e; // [internal, format, type, filterable]
  };

  // ---- エンジン内蔵 (ES3 ネイティブ) シェーダ ----
  const QUAD_VS = `#version 300 es
layout(location=0) in vec3 SL_aPosition;
layout(location=1) in vec2 SL_aUV;
out vec2 vUV;
void main() { vUV = SL_aUV; gl_Position = vec4(SL_aPosition, 1.0); }`;

  const PASSTHROUGH_FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D colortex0;
in vec2 vUV;
layout(location=0) out vec4 fragColor;
void main() { fragColor = vec4(texture(colortex0, vUV).rgb, 1.0); }`;

  const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uLinearize;
in vec2 vUV;
layout(location=0) out vec4 fragColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (uLinearize > 0.5) {
    float z = c.r * 2.0 - 1.0;
    float n = 0.15, f = 480.0;
    float lin = 2.0 * n * f / (f + n - z * (f - n));
    fragColor = vec4(vec3(1.0 - clamp(lin / f, 0.0, 1.0)), 1.0);
  } else {
    fragColor = vec4(c.rgb, 1.0);
  }
}`;

  class Pipeline {
    constructor(gl, textures) {
      this.gl = gl;
      this.textures = textures;
      this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
      this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
      this.maxAttach = Math.min(8, gl.getParameter(gl.MAX_COLOR_ATTACHMENTS), gl.getParameter(gl.MAX_DRAW_BUFFERS));

      this.w = 0; this.h = 0;
      this.shadowRes = 2048;
      this.shadowDist = 110;
      this.shadowsOn = true;

      this.uniformTable = SL.buildUniformTable();
      this.samplerTable = SL.buildSamplerTable();

      this.colortex = [[], []];   // [set][slot] → texture
      this.curIs = new Array(8).fill(0);
      this.formats = new Array(8).fill(null);
      this.clearFlags = new Array(8).fill(true);

      this.programs = {};
      this.status = [];
      this.packInfo = null;
      this.usingBuiltinFallback = false;

      // エンジン内蔵プログラム
      this.progPassFinal = SL.linkProgram(gl, QUAD_VS, PASSTHROUGH_FINAL_FS, 'engine.final');
      this.progDisplay = SL.linkProgram(gl, QUAD_VS, DISPLAY_FS, 'engine.display');
      this.uniDisplay = SL.introspectUniforms(gl, this.progDisplay);

      // フルスクリーン四角形 VAO
      const qbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, qbuf);
      const S = 20;
      const quad = new Float32Array([
        -1, -1, 0, 0, 0, 1, -1, 0, 1, 0, 1, 1, 0, 1, 1,
        -1, -1, 0, 0, 0, 1, 1, 0, 1, 1, -1, 1, 0, 0, 1
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      this.quadVao = gl.createVertexArray();
      gl.bindVertexArray(this.quadVao);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
      gl.bindVertexArray(null);

      // FBO 群
      this.fboGbuffer = gl.createFramebuffer();
      this.fboComposite = gl.createFramebuffer();
      this.fboDepthCopy = gl.createFramebuffer();
      this.fboShadowA = gl.createFramebuffer();
      this.fboShadowB = gl.createFramebuffer();
      this.fboBlitRead = gl.createFramebuffer();
      this.fboBlitWrite = gl.createFramebuffer();

      this._makeShadowTargets();
    }

    // ---------- ターゲット生成 ----------
    _makeTex(w, h, fmt) {
      const gl = this.gl;
      const [internal, format, type, filterable] = GLFORMAT(gl, fmt);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      const useLinear = filterable && (internal !== gl.RGBA32F && internal !== gl.RGB32F || this.floatLinear);
      const f = useLinear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    _makeDepthTex(w, h) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    _makeShadowTargets() {
      const gl = this.gl;
      const r = this.shadowRes;
      for (const key of ['shadowTex0', 'shadowTex1', 'shadowHW0', 'shadowHW1']) {
        if (this[key]) { gl.deleteTexture(this[key]); this[key] = null; }
      }
      for (const key of ['shadowColor0', 'shadowColor1']) {
        if (this[key]) { gl.deleteTexture(this[key]); this[key] = null; }
      }
      this.shadowTex0 = this._makeDepthTex(r, r);
      this.shadowTex1 = this._makeDepthTex(r, r);
      this.shadowHW0 = this._makeDepthTex(r, r);
      this.shadowHW1 = this._makeDepthTex(r, r);
      for (const t of [this.shadowHW0, this.shadowHW1]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      }
      this.shadowColor0 = this._makeTex(r, r, 'RGBA8');
      this.shadowColor1 = this._makeTex(r, r, 'RGBA8');

      const bindFB = (fbo, depth, c0, c1) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c0 || null, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, c1 || null, 0);
      };
      bindFB(this.fboShadowA, this.shadowTex1, null, null);
      bindFB(this.fboShadowB, this.shadowTex0, this.shadowColor0, this.shadowColor1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    resize(w, h) {
      const gl = this.gl;
      if (w === this.w && h === this.h && this.depth0) return;
      this.w = w; this.h = h;
      for (const set of this.colortex) {
        for (const t of set) gl.deleteTexture(t);
        set.length = 0;
      }
      gl.deleteTexture(this.depth0); gl.deleteTexture(this.depth1);
      for (let slot = 0; slot < 8; slot++) {
        const fmt = this.formats[slot] || (slot === 0 ? 'RGBA16F' : 'RGBA8');
        this.colortex[0].push(this._makeTex(w, h, fmt));
        this.colortex[1].push(this._makeTex(w, h, fmt));
      }
      this.depth0 = this._makeDepthTex(w, h);
      this.depth1 = this._makeDepthTex(w, h);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboDepthCopy);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth1, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.curIs.fill(0);
    }

    // ---------- プログラム管理 ----------
    compileOne(name, vsh, fsh, fallbackVsh, fallbackFsh) {
      const gl = this.gl;
      const tryPair = (vs, fs, tag) => {
        const cVs = SL.convertGLSL(vs, 'vs');
        const cFs = SL.convertGLSL(fs, 'fs');
        const prog = SL.linkProgram(gl, cVs.code, cFs.code, name + tag);
        const uniforms = SL.introspectUniforms(gl, prog);
        let written = cFs.written && cFs.written.length ? cFs.written : [0];
        written = written.filter(x => x >= 0 && x < 8);
        return { name, prog, uniforms, written, ok: true, error: null, log: [...cVs.log, ...cFs.log] };
      };
      try {
        return tryPair(vsh, fsh, '');
      } catch (e) {
        if (fallbackVsh && fallbackFsh) {
          try {
            const r = tryPair(fallbackVsh, fallbackFsh, '(fallback)');
            r.usedFallback = true;
            r.error = String(e.message || e);
            return r;
          } catch (e2) {
            return { name, ok: false, error: String(e.message || e) + ' / fallback: ' + String(e2.message || e2), log: [] };
          }
        }
        return { name, ok: false, error: String(e.message || e), log: [] };
      }
    }

    setPack(pack) {
      // pack: { name, programs: {name: {vsh,fsh}}, consts, diag }
      const gl = this.gl;
      this.packInfo = pack;
      this.status = [];
      this.usingBuiltinFallback = false;

      const builtinFiles = {};
      for (const [k, v] of Object.entries(SL.SOFTLIGHT_PACK.files)) builtinFiles[k] = v;

      const compiled = {};
      const pushStatus = (s) => this.status.push(s);

      for (const [name, src] of Object.entries(pack.programs)) {
        // sky のみ内蔵フォールバック許可 (それ以外はパック内設計に依存するため危険)
        const isSky = name === 'gbuffers_skybasic' || name === 'gbuffers_skytextured';
        const fbV = isSky ? builtinFiles['shaders/gbuffers_skybasic.vsh'] : null;
        const fbF = isSky ? builtinFiles['shaders/gbuffers_skybasic.fsh'] : null;
        const c = this.compileOne(name, src.vsh, src.fsh, fbV, fbF);
        compiled[name] = c;
        pushStatus(c);
      }

      // クリティカル: terrain が動かないパックは全体を内蔵へフォールバック
      const terrainOk = compiled['gbuffers_terrain'] && compiled['gbuffers_terrain'].ok;
      if (!terrainOk) {
        this.usingBuiltinFallback = true;
        const bf = SL.parsePack({ files: builtinFiles }, 'fallback');
        for (const [name, src] of Object.entries(bf.programs)) {
          const c = this.compileOne(name, src.vsh, src.fsh, null, null);
          compiled[name] = c;
          pushStatus({ ...c, usedFallback: true, error: terrainOk ? null : 'パックの gbuffers_terrain が動作しなかったため内蔵シェーダーで代替' });
        }
      }

      this.programs = compiled;

      // バッファフォーマット
      for (let slot = 0; slot < 8; slot++) {
        const fmt = (pack.consts && pack.consts.formats[slot]) || (slot === 0 ? 'RGBA16F' : 'RGBA8');
        this.formats[slot] = fmt;
        this.clearFlags[slot] = !(pack.consts && pack.consts.clear[slot] === false);
      }
      if (pack.consts) {
        if (pack.consts.shadowMapResolution && pack.consts.shadowMapResolution >= 512) this.shadowRes = Math.min(4096, pack.consts.shadowMapResolution | 0);
        if (pack.consts.shadowDistance && pack.consts.shadowDistance > 16) this.shadowDist = Math.min(180, pack.consts.shadowDistance);
        this.sunPathRotation = pack.consts.sunPathRotation || 0;
      }
      this._makeShadowTargets();
      if (this.w > 0) { // colortex フォーマット更新のため強制再作成
        const w = this.w, h = this.h;
        this.w = -1;
        this.resize(w, h);
      }

      // 使用プログラムの整理
      this.progShadow = (compiled['shadow'] && compiled['shadow'].ok) ? compiled['shadow'] : null;
      this.progTerrain = compiled['gbuffers_terrain']; // ok 保証
      this.progWater = (compiled['gbuffers_water'] && compiled['gbuffers_water'].ok) ? compiled['gbuffers_water'] : this.progTerrain;
      const skyC = compiled['gbuffers_skybasic'];
      this.progSky = (skyC && skyC.ok) ? skyC : null;

      // 合成パス列
      this.deferredChain = [];
      for (let i = 0; i < 32; i++) {
        const c = compiled['deferred' + (i === 0 ? '' : i)];
        if (c && c.ok) this.deferredChain.push(c);
      }
      this.compositeChain = [];
      for (let i = 0; i < 32; i++) {
        const c = compiled['composite' + (i === 0 ? '' : i)];
        if (c && c.ok) this.compositeChain.push(c);
      }
      const prep = compiled['prepare'];
      if (prep && prep.ok) this.deferredChain.unshift(prep);
      this.progFinal = (compiled['final'] && compiled['final'].ok) ? compiled['final'] : null; // null → passThrough

      // sky コンパイル失敗時は内蔵空にフォールバック (色を塗るだけなので概念非依存で安全)
      if (!this.progSky) {
        this.progSky = this.compileOne('sky_fallback', builtinFiles['shaders/gbuffers_skybasic.vsh'], builtinFiles['shaders/gbuffers_skybasic.fsh'], null, null);
        this.status.push(this.progSky);
      }

      return this.status;
    }

    // ---------- uniform 設定 ----------
    setUniforms(compiled, ctx) {
      const gl = this.gl;
      gl.useProgram(compiled.prog);
      let unit = 0;
      let unknown = 0;
      for (const u of compiled.uniforms) {
        const prov = this.uniformTable[u.name];
        if (prov) {
          const val = prov(ctx);
          if (val === undefined || val === null) continue;
          this._setUniformValue(u, val);
          continue;
        }
        if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_2D_SHADOW || u.type === gl.SAMPLER_3D || u.type === gl.SAMPLER_CUBE) {
          const sprov = this.samplerTable[u.name];
          let tex = null;
          if (u.type === gl.SAMPLER_2D_SHADOW) {
            if (/shadowtex0/.test(u.name)) tex = ctx.shadowHW0;
            else if (/shadowtex1/.test(u.name)) tex = ctx.shadowHW1;
          } else if (sprov) {
            tex = sprov(ctx);
          }
          if (!tex) tex = this.textures.noisetex;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1i(u.loc, unit);
          unit++;
          continue;
        }
        unknown++;
      }
      compiled._unknownCount = unknown;
    }

    _setUniformValue(u, val) {
      const gl = this.gl;
      switch (u.type) {
        case gl.FLOAT: gl.uniform1f(u.loc, Array.isArray(val) ? val[0] : val); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, val); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, val); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, val); break;
        case gl.INT: case gl.BOOL: case gl.UNSIGNED_INT:
          gl.uniform1i(u.loc, Array.isArray(val) ? val[0] : val); break;
        case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv(u.loc, val); break;
        case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv(u.loc, val); break;
        case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv(u.loc, val); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, val); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, val); break;
      }
    }

    // ---------- 補助 ----------
    _blitColor(srcTex, dstTex) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fboBlitRead);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, srcTex, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboBlitWrite);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dstTex, 0);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }

    _blitDepth(srcFbo, dstFbo) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    }

    _clearShadowTextures() {
      const gl = this.gl;
      const one = new Float32Array([1.0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShadowA);
      gl.clearBufferfv(gl.DEPTH, 0, one);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShadowB);
      gl.clearBufferfv(gl.DEPTH, 0, one);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---------- メッシュ描画 ----------
    // pass: 'gbuffer_opaque' | 'gbuffer_water' | 'shadow_opaque' | 'shadow_all'
    _drawMeshes(progComp, ctx, pass) {
      const gl = this.gl;
      const W = SL.World;
      const isShadow = pass === 'shadow_opaque' || pass === 'shadow_all';
      gl.disable(gl.CULL_FACE);

      let draws = 0, tris = 0;
      const includeWater = (pass === 'gbuffer_water' || pass === 'shadow_all');

      for (const ch of W.chunks) {
        if (!ch.aabb) continue;
        if (isShadow) {
          const cx = (ch.aabb.min[0] + ch.aabb.max[0]) / 2, cz = (ch.aabb.min[2] + ch.aabb.max[2]) / 2;
          const dx = cx - ctx.shadowCenter[0], dz = cz - ctx.shadowCenter[2];
          if (dx * dx + dz * dz > ctx.shadowCullR2) continue;
        } else {
          if (!SL.mat4.aabbInFrustum(ctx.frustum, ch.aabb.min, ch.aabb.max)) continue;
        }
        if (ch.opaque) {
          gl.bindVertexArray(ch.opaque.vao);
          gl.drawElements(gl.TRIANGLES, ch.opaque.count, gl.UNSIGNED_INT, 0);
          draws++; tris += ch.opaque.tris;
        }
        if (includeWater && ch.water) {
          gl.bindVertexArray(ch.water.vao);
          gl.drawElements(gl.TRIANGLES, ch.water.count, gl.UNSIGNED_INT, 0);
          draws++; tris += ch.water.tris;
        }
      }
      gl.bindVertexArray(null);
      return { draws, tris };
    }

    // ---------- シャドウ行列 ----------
    _shadowMatrices(ctx, sunDirW, eye) {
      const gl = this.gl;
      const d = this.shadowDist;
      const up = Math.abs(sunDirW[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
      const center = [eye[0], eye[1], eye[2]];
      const look = [center[0] + sunDirW[0], center[1] + sunDirW[1], center[2] + sunDirW[2]];
      const view = SL.mat4.lookAt(center, look, up);
      const proj = SL.mat4.ortho(-d, d, -d, d, -200, 320);
      ctx.shadowView = view;
      ctx.shadowViewInv = SL.mat4.invert(view);
      ctx.shadowProj = proj;
      ctx.shadowProjInv = SL.mat4.invert(proj);
      ctx.shadowCenter = center;
      ctx.shadowCullR2 = (d * 1.6 + 40) * (d * 1.6 + 40);
    }

    // ---------- メイン描画 ----------
    // scene: {camera, worldTime, worldDay, frameTimeCounter, frameCounter, rainStrength, wetness,
    //         lightningFlash, isEyeInWater, sunDirW, skyColor, fogColor, canvasW, canvasH, prevView, prevProj, prevEye}
    render(scene) {
      const gl = this.gl;
      const cam = scene.camera;
      const ctx = scene;
      ctx.eye = cam.eye; // uniform プロバイダ (cameraPosition 等) 用
      ctx.width = this.w; ctx.height = this.h;
      ctx.shadowRes = this.shadowRes;

      // GLSL120 互換行列 (デフォルト = カメラビュー。シャドウ/コンポジットで上書き)
      const IDENT = SL.mat4.ident();
      ctx.compatMV = cam.view;
      ctx.compatMVinv = cam.viewInv;
      ctx.compatProj = cam.proj;
      ctx.compatProjInv = cam.projInv;
      const nm = (m) => new Float32Array([
        m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]
      ]);
      ctx.compatNormalMat = nm(cam.view);

      // 現在の colortex テクスチャ
      ctx.curColortex = [];
      for (let i = 0; i < 8; i++) ctx.curColortex.push(this.colortex[this.curIs[i]][i]);

      // 視点空間光源位置
      const v3t = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2]
      ];
      const view = cam.view, viewInv = cam.viewInv;
      const sunD = scene.sunDirW, moonD = [-sunD[0], -sunD[1], -sunD[2]];
      ctx.sunPosView = v3t(view, SL.v3.scale(sunD, 100));
      ctx.moonPosView = v3t(view, SL.v3.scale(moonD, 100));
      ctx.upPosView = v3t(view, [0, 100, 0]);
      const lightD = sunD[1] >= -0.05 ? sunD : moonD;
      ctx.shadowLightPosView = v3t(view, SL.v3.scale(lightD, 100));

      ctx.view = view; ctx.viewInv = viewInv;
      ctx.proj = cam.proj; ctx.projInv = cam.projInv;
      ctx.frustum = SL.mat4.frustumPlanes(SL.mat4.mul(cam.proj, view));

      // 深度テクスチャ
      ctx.depth0 = this.depth0; ctx.depth1 = this.depth1;
      ctx.shadowTex0 = this.shadowTex0; ctx.shadowTex1 = this.shadowTex1;
      ctx.shadowHW0 = this.shadowHW0; ctx.shadowHW1 = this.shadowHW1;
      ctx.shadowColor0 = this.shadowColor0; ctx.shadowColor1 = this.shadowColor1;
      ctx.noisetex = this.textures.noisetex;
      ctx.atlas = this.textures.atlas;
      ctx.lightmap = this.textures.lightmap;

      const stats = { draws: 0, tris: 0 };
      let r;

      // ===== 1. シャドウパス =====
      if (this.shadowsOn && this.progShadow) {
        this._shadowMatrices(ctx, lightD, cam.eye);
        // シャドウパスでは互換行列をシャドウカメラに差し替え
        const savedCompat = [ctx.compatMV, ctx.compatMVinv, ctx.compatProj, ctx.compatProjInv, ctx.compatNormalMat];
        ctx.compatMV = ctx.shadowView; ctx.compatMVinv = ctx.shadowViewInv;
        ctx.compatProj = ctx.shadowProj; ctx.compatProjInv = ctx.shadowProjInv;
        ctx.compatNormalMat = nm(ctx.shadowView);
        this.setUniforms(this.progShadow, ctx);
        // 読み取りテクスチャとしての自分自身への参照は不要 (シャドウは colortex を読まない)
        gl.viewport(0, 0, this.shadowRes, this.shadowRes);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        gl.disable(gl.CULL_FACE);

        // パス1: 不透明のみ → shadowtex1
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShadowA);
        gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([1.0]));
        gl.colorMask(false, false, false, false);
        r = this._drawMeshes(this.progShadow, ctx, 'shadow_opaque');
        stats.draws += r.draws; stats.tris += r.tris;
        gl.colorMask(true, true, true, true);

        // パス2: 全部 → shadowtex0 + shadowcolor
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboShadowB);
        gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([1.0]));
        gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 1]));
        gl.clearBufferfv(gl.COLOR, 1, new Float32Array([0, 0, 0, 1]));
        r = this._drawMeshes(this.progShadow, ctx, 'shadow_all');
        stats.draws += r.draws; stats.tris += r.tris;

        // HW比較用テクスチャへコピー (shadowtex0←全描画, shadowtex1←不透明のみ)
        const hwBlit = (srcFbo, dstTex) => {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboBlitWrite);
          gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dstTex, 0);
          gl.blitFramebuffer(0, 0, this.shadowRes, this.shadowRes, 0, 0, this.shadowRes, this.shadowRes, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        };
        hwBlit(this.fboShadowB, this.shadowHW0);
        hwBlit(this.fboShadowA, this.shadowHW1);
        // 読み書きバッファの depth 結合を戻しておく
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fboBlitWrite);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        // 互換行列を復元
        ctx.compatMV = savedCompat[0]; ctx.compatMVinv = savedCompat[1];
        ctx.compatProj = savedCompat[2]; ctx.compatProjInv = savedCompat[3];
        ctx.compatNormalMat = savedCompat[4];
      } else {
        this._clearShadowTextures();
        this._shadowMatrices(ctx, lightD, cam.eye);
      }

      // ===== 2. GBUFFER =====
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboGbuffer);
      gl.viewport(0, 0, this.w, this.h);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(gl.CCW);
      for (let i = 0; i < this.maxAttach; i++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, this.colortex[this.curIs[i]][i], 0);
      }
      for (let i = this.maxAttach; i < 8; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth0, 0);
      // クリア
      const bctx = gl;
      for (let i = 0; i < this.maxAttach; i++) {
        if (this.clearFlags[i]) bctx.clearBufferfv(bctx.COLOR, i, new Float32Array([0, 0, 0, 1]));
      }
      bctx.clearBufferfv(bctx.DEPTH, 0, new Float32Array([1.0]));

      // 空 (深度書き込みなし) — クリップ空間四角形なので互換行列は単位行列
      if (this.progSky && this.progSky.ok) {
        const savedSkyCompat = [ctx.compatMV, ctx.compatMVinv, ctx.compatProj, ctx.compatProjInv, ctx.compatNormalMat];
        const IDENT_SKY = SL.mat4.ident();
        ctx.compatMV = IDENT_SKY; ctx.compatProj = IDENT_SKY;
        ctx.compatMVinv = IDENT_SKY; ctx.compatProjInv = IDENT_SKY;
        ctx.compatNormalMat = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        this.setUniforms(this.progSky, ctx);
        ctx.compatMV = savedSkyCompat[0]; ctx.compatMVinv = savedSkyCompat[1];
        ctx.compatProj = savedSkyCompat[2]; ctx.compatProjInv = savedSkyCompat[3];
        ctx.compatNormalMat = savedSkyCompat[4];
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(this.quadVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        gl.depthMask(true);
        stats.draws++;
      }

      // 不透明地形
      this.setUniforms(this.progTerrain, ctx);
      r = this._drawMeshes(this.progTerrain, ctx, 'gbuffer_opaque');
      stats.draws += r.draws; stats.tris += r.tris;

      // depthtex1 (水を除く深度) へコピー
      this._blitDepth(this.fboGbuffer, this.fboDepthCopy);

      // 水
      if (SL.World.chunks.some(c => c.water)) {
        const wp = this.progWater;
        if (wp && wp.ok) {
          this.setUniforms(wp, ctx);
          gl.enable(gl.BLEND);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.CULL_FACE);
          for (const ch of SL.World.chunks) {
            if (!ch.water || !ch.aabb) continue;
            if (!SL.mat4.aabbInFrustum(ctx.frustum, ch.aabb.min, ch.aabb.max)) continue;
            gl.bindVertexArray(ch.water.vao);
            gl.drawElements(gl.TRIANGLES, ch.water.count, gl.UNSIGNED_INT, 0);
            stats.draws++; stats.tris += ch.water.tris;
          }
          gl.bindVertexArray(null);
          gl.disable(gl.BLEND);
          gl.enable(gl.CULL_FACE);
        }
      }

      // ===== 3. deferred / composite パス =====
      // gbuffer FBO の attach を外す (composite の sampler とのフィードバック防止)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboGbuffer);
      for (let i = 0; i < 8; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // コンポジットでは互換行列は単位行列扱い (ftransform が四角形頂点をそのまま通す)
      const savedCompat2 = [ctx.compatMV, ctx.compatMVinv, ctx.compatProj, ctx.compatProjInv, ctx.compatNormalMat];
      const IDENTM = SL.mat4.ident();
      ctx.compatMV = IDENTM; ctx.compatMVinv = IDENTM;
      ctx.compatProj = IDENTM; ctx.compatProjInv = IDENTM;
      ctx.compatNormalMat = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      // 注意: パスの書き込みスロットを新しいテクスチャにし、未書き込みは同一テクスチャを参照させる。
      // ただし同一テクスチャが READ(sampler) と WRITE(attachment) に同時に入るフィードバックを避けるため、
      // 該当スロットはクリア済みの「もう一方」に blit してから描画する簡略実装:
      //   書き込みスロット → もう一方 (ping-pong)
      //   未書き込みスロット → 読み取り専用として sampler のみで使用し attachment からは外す
      const runComposites = (chain) => {
        for (const comp of chain) {
          const written = comp.written && comp.written.length ? comp.written : [0];
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboComposite);
          const attachMap = []; // slot -> [texture, isWrite]
          for (let i = 0; i < this.maxAttach; i++) {
            let tex, isWrite = written.includes(i);
            if (isWrite) {
              const other = this.colortex[1 - this.curIs[i]][i];
              const current = this.colortex[this.curIs[i]][i];
              tex = other;
              // clear=false のバッファは前の内容を引き継ぐ
              if (!this.clearFlags[i]) {
                this._blitColor(current, other);
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboComposite);
              }
            } else {
              tex = this.colortex[this.curIs[i]][i];
            }
            attachMap.push([tex, isWrite]);
          }
          for (let i = 0; i < this.maxAttach; i++) {
            // 書き込みスロットのみ attach (未書き込みを attach すると sampler との
            // フィードバックループで描画が無効化されるため)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, attachMap[i][1] ? attachMap[i][0] : null, 0);
          }
          for (let i = this.maxAttach; i < 8; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
          // 書き込みスロットのみクリア (clear=true)
          for (let i = 0; i < this.maxAttach; i++) {
            if (attachMap[i][1] && this.clearFlags[i]) gl.clearBufferfv(gl.COLOR, i, new Float32Array([0, 0, 0, 1]));
          }
          // 読み取り用は現在のテクスチャ (未書き込み) ＋ 書き込みスロットは旧内容 (描画前)
          this.setUniforms(comp, ctx);
          gl.viewport(0, 0, this.w, this.h);
          gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(this.quadVao);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.bindVertexArray(null);
          stats.draws++;
          // curIs 更新 (書き込みスロットのみ)
          for (let i = 0; i < 8; i++) if (written.includes(i)) this.curIs[i] = 1 - this.curIs[i];
          ctx.curColortex = [];
          for (let i = 0; i < 8; i++) ctx.curColortex.push(this.colortex[this.curIs[i]][i]);
        }
      };

      runComposites(this.deferredChain || []);
      runComposites(this.compositeChain || []);

      // ===== 4. final =====
      // final の VS も ftransform (互換行列) を使う → 単位行列のまま実施すること
      // 先に composite FBO のアタッチを全て外す (サンプラーとのフィードバックループ防止)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboComposite);
      for (let i = 0; i < 8; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, scene.canvasW, scene.canvasH);
      if (this.progFinal) {
        this.setUniforms(this.progFinal, ctx);
      } else {
        gl.useProgram(this.progPassFinal);
        let unit = 0;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, ctx.curColortex[0]);
        gl.uniform1i(gl.getUniformLocation(this.progPassFinal, 'colortex0'), 0);
      }
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
      stats.draws++;
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);

      // 互換行列を次フレーム用に復元
      ctx.compatMV = savedCompat2[0]; ctx.compatMVinv = savedCompat2[1];
      ctx.compatProj = savedCompat2[2]; ctx.compatProjInv = savedCompat2[3];
      ctx.compatNormalMat = savedCompat2[4];

      this._lastCtx = ctx;
      return stats;
    }

    // ---------- バッファビューア ----------
    renderBufferView(name, x, y, w, h) {
      const gl = this.gl;
      const ctx = this._lastCtx;
      if (!ctx) return;
      let tex = null, linearize = 0;
      if (name.startsWith('colortex')) tex = ctx.curColortex[+name.slice(8)];
      else if (name === 'depthtex0') { tex = ctx.depth0; linearize = 1; }
      else if (name === 'depthtex1') { tex = ctx.depth1; linearize = 1; }
      else if (name === 'shadowtex0') { tex = ctx.shadowTex0; linearize = 1; }
      else if (name === 'shadowcolor0') tex = ctx.shadowColor0;
      else if (name === 'noisetex') tex = ctx.noisetex;
      if (!tex) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(x, y, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.progDisplay);
      gl.uniform1i(this.uniDisplay.find(u => u.name === 'uTex').loc, 0);
      gl.uniform1f(this.uniDisplay.find(u => u.name === 'uLinearize').loc, linearize);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    }
  }

  SL.Pipeline = Pipeline;
})();
