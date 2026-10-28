// glutil.js — 行列/ベクトル演算 + WebGL2 ヘルパ
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  // ---------- mat4 (column-major, WebGL 互換) ----------
  const M = {
    ident() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },

    mul(a, b, out) {
      out = out || new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        const b0 = b[c*4], b1 = b[c*4+1], b2 = b[c*4+2], b3 = b[c*4+3];
        out[c*4]   = a[0]*b0 + a[4]*b1 + a[8]*b2  + a[12]*b3;
        out[c*4+1] = a[1]*b0 + a[5]*b1 + a[9]*b2  + a[13]*b3;
        out[c*4+2] = a[2]*b0 + a[6]*b1 + a[10]*b2 + a[14]*b3;
        out[c*4+3] = a[3]*b0 + a[7]*b1 + a[11]*b2 + a[15]*b3;
      }
      return out;
    },

    perspective(fovyRad, aspect, near, far) {
      const f = 1 / Math.tan(fovyRad / 2), nf = 1 / (near - far);
      const m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f;
      m[10] = (far + near) * nf; m[11] = -1;
      m[14] = 2 * far * near * nf;
      return m;
    },

    ortho(l, r, b, t, n, f) {
      const m = new Float32Array(16);
      m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
      m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n);
      m[15] = 1;
      return m;
    },

    lookAt(eye, center, up) {
      let zx = eye[0]-center[0], zy = eye[1]-center[1], zz = eye[2]-center[2];
      let len = Math.hypot(zx, zy, zz) || 1; zx/=len; zy/=len; zz/=len;
      let xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
      len = Math.hypot(xx, xy, xz) || 1; xx/=len; xy/=len; xz/=len;
      const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
      const m = new Float32Array(16);
      m[0]=xx; m[1]=yx; m[2]=zx; m[4]=xy; m[5]=yy; m[6]=zy; m[8]=xz; m[9]=yz; m[10]=zz;
      m[12] = -(xx*eye[0]+xy*eye[1]+xz*eye[2]);
      m[13] = -(yx*eye[0]+yy*eye[1]+yz*eye[2]);
      m[14] = -(zx*eye[0]+zy*eye[1]+zz*eye[2]);
      m[15] = 1;
      return m;
    },

    invert(m) {
      const o = new Float32Array(16);
      const a00=m[0],a01=m[1],a02=m[2],a03=m[3], a10=m[4],a11=m[5],a12=m[6],a13=m[7],
            a20=m[8],a21=m[9],a22=m[10],a23=m[11], a30=m[12],a31=m[13],a32=m[14],a33=m[15];
      const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
            b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
            b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
            b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
      let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
      if (!det) return null;
      det = 1 / det;
      o[0]=(a11*b11-a12*b10+a13*b09)*det;  o[1]=(a02*b10-a01*b11-a03*b09)*det;
      o[2]=(a31*b05-a32*b04+a33*b03)*det;  o[3]=(a22*b04-a21*b05-a23*b03)*det;
      o[4]=(a12*b08-a10*b11-a13*b07)*det;  o[5]=(a00*b11-a02*b08+a03*b07)*det;
      o[6]=(a32*b02-a30*b05-a33*b01)*det;  o[7]=(a20*b05-a22*b02+a23*b01)*det;
      o[8]=(a10*b10-a11*b08+a13*b06)*det;  o[9]=(a01*b08-a00*b10-a03*b06)*det;
      o[10]=(a30*b04-a31*b02+a33*b00)*det; o[11]=(a21*b02-a20*b04-a23*b00)*det;
      o[12]=(a11*b07-a10*b09-a12*b06)*det; o[13]=(a00*b09-a01*b07+a02*b06)*det;
      o[14]=(a31*b01-a30*b03-a32*b00)*det; o[15]=(a20*b03-a21*b01+a22*b00)*det;
      return o;
    },

    translation(x, y, z) {
      const m = M.ident();
      m[12] = x; m[13] = y; m[14] = z;
      return m;
    },

    // VP 行列から視錐台平面 6 枚（Gribb-Hartmann）
    frustumPlanes(m) {
      const p = [];
      for (let i = 0; i < 6; i++) {
        const row = i >> 1, s = (i & 1) ? -1 : 1;
        p.push([ m[3]+s*m[row], m[7]+s*m[4+row], m[11]+s*m[8+row], m[15]+s*m[12+row] ]);
      }
      return p;
    },

    // AABB vs 視錐台
    aabbInFrustum(planes, min, max) {
      for (const pl of planes) {
        const px = pl[0] > 0 ? max[0] : min[0];
        const py = pl[1] > 0 ? max[1] : min[1];
        const pz = pl[2] > 0 ? max[2] : min[2];
        if (pl[0]*px + pl[1]*py + pl[2]*pz + pl[3] < 0) return false;
      }
      return true;
    }
  };
  SL.mat4 = M;

  // ---------- vec3 ----------
  SL.v3 = {
    sub: (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
    add: (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
    scale: (a,s) => [a[0]*s, a[1]*s, a[2]*s],
    dot: (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
    cross: (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
    norm(a) { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
  };

  // ---------- WebGL2 ヘルパ ----------
  function createGL(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, depth: true, stencil: false, antialias: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
      desynchronized: false
    });
    if (!gl) return null;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    return gl;
  }

  function compileShader(gl, type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh) || '(info なし)';
      gl.deleteShader(sh);
      const err = new Error('[' + name + '] ' + info.trim());
      err.log = info;
      throw err;
    }
    return sh;
  }

  // attribute エイリアス → 固定スロット（リンク前に bindAttribLocation）
  const ATTR_ALIASES = {
    SL_aPosition: 0, vaPosition: 0, position: 0,
    SL_aUV: 1, vaUV0: 1, vaUV1: 1,
    SL_aNormal: 2, vaNormal: 2, normal: 2, at_tangent: 2,
    SL_aColor: 3, vaColor: 3, color: 3,
    SL_aLight: 4, vaUV2: 4,
    SL_aMidUV: 5, mc_midTexCoord: 5,
    SL_aBlock: 6, mc_Entity: 6
  };

  function linkProgram(gl, vsSrc, fsSrc, name) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, name + '.vsh');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.fsh');
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    for (const [aname, loc] of Object.entries(ATTR_ALIASES)) gl.bindAttribLocation(prog, loc, aname);
    gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog) || '(info なし)';
      gl.deleteProgram(prog);
      throw new Error('[' + name + '] リンク失敗: ' + info.trim());
    }
    return prog;
  }

  // program の active uniform 一覧を取得
  function introspectUniforms(gl, prog) {
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    const list = [];
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, ''); // 配列先頭は添字なしで登録
      const loc = gl.getUniformLocation(prog, info.name);
      if (loc !== null) list.push({ name, loc, type: info.type, size: info.size });
    }
    return list;
  }

  SL.createGL = createGL;
  SL.compileShader = compileShader;
  SL.linkProgram = linkProgram;
  SL.introspectUniforms = introspectUniforms;
  SL.ATTR_ALIASES = ATTR_ALIASES;
})();
