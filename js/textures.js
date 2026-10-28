// textures.js — 手続き生成のブロックテクスチャアトラス / lightmap / noisetex
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  const TILE = 16, ATLAS_DIM = 64; // 4x4 タイル = 16 種

  // タイル番号
  const T = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6,
    LEAVES: 7, WATER: 8, GLOWSTONE: 9, SNOW_TOP: 10, SNOW_SIDE: 11,
    TALLGRASS: 12, POPPY: 13, DANDELION: 14, BEDROCK: 15
  };
  SL.TILE = T;

  function tileUV(tile, u, v) {
    const tx = (tile % 4) * 16, ty = Math.floor(tile / 4) * 16;
    return [(tx + 0.5 + u * 15) / 64, (ty + 0.5 + v * 15) / 64];
  }
  SL.tileUV = tileUV;
  function tileMid(tile) {
    const tx = (tile % 4) * 16 + 8, ty = Math.floor(tile / 4) * 16 + 8;
    return [tx / 64 * 255, ty / 64 * 255];
  }
  SL.tileMid = tileMid;

  // 各タイルのピクセルペインタ → [r,g,b,a] (0-255)
  const painters = {
    [T.GRASS_TOP](x, y, r) {
      const c = 0.82 + r() * 0.36;
      let g = [Math.round(108 * c), Math.round(178 * c), Math.round(74 * c)];
      if (r() < 0.09) g = [g[0] * 0.78, g[1] * 0.78, g[2] * 0.78];
      return [g[0], g[1], g[2], 255];
    },
    [T.GRASS_SIDE](x, y, r) {
      // 列ごとの草の深さ（キャッシュはペインタ内で毎回生成: 16px なので軽量）
      const depth = 2 + Math.floor(SL.hash2i(x, 91.7) * 3);
      if (y < depth) {
        const c = 0.8 + SL.hash2i(x, y + 7.3) * 0.3;
        return [Math.round(96 * c), Math.round(160 * c), Math.round(66 * c), 255];
      }
      const c = 0.8 + SL.hash2i(x * 3.1, y * 1.7) * 0.4;
      return [Math.round(134 * c), Math.round(96 * c), Math.round(67 * c), 255];
    },
    [T.DIRT](x, y, r) {
      const c = 0.8 + r() * 0.4;
      let d = [Math.round(134 * c), Math.round(96 * c), Math.round(67 * c)];
      if (r() < 0.08) d = [d[0] * 0.72, d[1] * 0.72, d[2] * 0.72];
      return [d[0], d[1], d[2], 255];
    },
    [T.STONE](x, y, r) {
      const c = 0.82 + SL.hash2i(x >> 1, (y >> 1) + 5.2) * 0.3;
      return [Math.round(127 * c), Math.round(127 * c), Math.round(130 * c), 255];
    },
    [T.SAND](x, y, r) {
      const c = 0.9 + r() * 0.18;
      return [Math.round(219 * c), Math.round(206 * c), Math.round(160 * c), 255];
    },
    [T.LOG_SIDE](x, y, r) {
      const col = 0.78 + SL.hash2i(x, 3.7) * 0.4;
      const streak = SL.hash2i(x, (y >> 2) + 11.3) < 0.22 ? 0.7 : 1.0;
      const c = col * streak;
      return [Math.round(106 * c), Math.round(82 * c), Math.round(50 * c), 255];
    },
    [T.LOG_TOP](x, y, r) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.floor(d) % 2 === 0 ? 1.0 : 0.78;
      const edge = d > 6.5 ? 0.85 : 1.0;
      const c = ring * edge * (0.92 + r() * 0.14);
      return [Math.round(160 * c), Math.round(130 * c), Math.round(84 * c), 255];
    },
    [T.LEAVES](x, y, r) {
      if (r() < 0.16) return [0, 0, 0, 0]; // 隙間
      const c = 0.72 + r() * 0.55;
      return [Math.round(64 * c), Math.round(106 * c), Math.round(38 * c), 255];
    },
    [T.WATER](x, y, r) {
      const c = 0.88 + SL.hash2i(x, (y >> 1) + 17.9) * 0.24;
      return [Math.round(56 * c), Math.round(108 * c), Math.round(214 * c), 190];
    },
    [T.GLOWSTONE](x, y, r) {
      const spot = SL.hash2i(x >> 1, (y >> 1) + 23.1);
      if (spot > 0.68) { const c = 0.92 + r() * 0.08; return [Math.round(249 * c), Math.round(222 * c), Math.round(140 * c), 255]; }
      const c = 0.85 + r() * 0.2;
      return [Math.round(150 * c), Math.round(116 * c), Math.round(74 * c), 255];
    },
    [T.SNOW_TOP](x, y, r) {
      const c = 0.93 + r() * 0.07;
      return [Math.round(238 * c), Math.round(245 * c), Math.round(246 * c), 255];
    },
    [T.SNOW_SIDE](x, y, r) {
      if (y < 4) { const c = 0.92 + SL.hash2i(x, 5.5) * 0.08; return [Math.round(238 * c), Math.round(245 * c), Math.round(246 * c), 255]; }
      const c = 0.8 + SL.hash2i(x * 2.3, y * 1.1) * 0.35;
      return [Math.round(134 * c), Math.round(96 * c), Math.round(67 * c), 255];
    },
    [T.TALLGRASS](x, y, r) {
      const col = SL.hash2i(x, 31.3);
      const top = 15 - (4 + Math.floor(col * 9));
      if (col < 0.55 && y >= top) {
        const lean = y < 8 && SL.hash2i(x, 9.1) < 0.4;
        if (lean && Math.abs(x - 8) > 5) return [0, 0, 0, 0];
        const c = 0.75 + SL.hash2i(x, y + 3.3) * 0.5;
        return [Math.round(88 * c), Math.round(148 * c), Math.round(62 * c), 255];
      }
      return [0, 0, 0, 0];
    },
    [T.POPPY](x, y, r) {
      if (x === 8 && y >= 8 && y <= 15) return [62, 112, 42, 255]; // 茎
      if (x === 7 && y === 10) return [62, 112, 42, 255];
      if (x >= 6 && x <= 9 && y >= 4 && y <= 7) {
        const center = (x === 7 || x === 8) && (y === 5 || y === 6);
        return center ? [30, 20, 12, 255] : [196, 42, 42, 255];
      }
      return [0, 0, 0, 0];
    },
    [T.DANDELION](x, y, r) {
      if (x === 8 && y >= 8 && y <= 15) return [62, 112, 42, 255];
      if (x >= 6 && x <= 9 && y >= 4 && y <= 7) {
        const center = (x === 7 || x === 8) && (y === 5 || y === 6);
        return center ? [230, 200, 60, 255] : [242, 222, 92, 255];
      }
      return [0, 0, 0, 0];
    },
    [T.BEDROCK](x, y, r) {
      const b = SL.hash2i(x >> 1, (y >> 1) + 41.3);
      const c = b > 0.5 ? 0.9 : 0.45;
      return [Math.round(78 * c), Math.round(78 * c), Math.round(80 * c), 255];
    }
  };

  function buildAtlasCanvas() {
    const cv = document.createElement('canvas');
    cv.width = ATLAS_DIM; cv.height = ATLAS_DIM;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(ATLAS_DIM, ATLAS_DIM);
    for (let t = 0; t < 16; t++) {
      const painter = painters[t];
      const rng = SL.rand(1234 + t * 777);
      const tx = (t % 4) * 16, ty = Math.floor(t / 4) * 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const px = painter(x, y, rng);
        const i = ((ty + y) * ATLAS_DIM + (tx + x)) * 4;
        img.data[i] = Math.max(0, Math.min(255, px[0]));
        img.data[i + 1] = Math.max(0, Math.min(255, px[1]));
        img.data[i + 2] = Math.max(0, Math.min(255, px[2]));
        img.data[i + 3] = px[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function makeGLTex(gl, src, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  SL.makeGLTex = makeGLTex;

  // lightmap: 32x32 (x=ブロック光源, y=天空光)
  function buildLightmapCanvas() {
    const S = 32;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const b = x / (S - 1), s = y / (S - 1);
      const torch = Math.pow(b, 2.2);
      const sky = Math.pow(s, 1.6);
      const i = (y * S + x) * 4;
      img.data[i]     = Math.round(Math.min(255, 255 * (torch * 1.05 + 0.02 + sky * 0.82)));
      img.data[i + 1] = Math.round(Math.min(255, 255 * (torch * 0.62 + 0.02 + sky * 0.88)));
      img.data[i + 2] = Math.round(Math.min(255, 255 * (torch * 0.32 + 0.03 + sky * 1.0)));
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // noisetex: 256x256 のスムーズドノイズ (RGBA)
  function buildNoiseCanvas() {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const base = new Float32Array(S * S * 4);
    const rng = SL.rand(777777);
    for (let i = 0; i < S * S * 4; i++) base[i] = rng();
    // ボックスブラー 2 パス（ラップアラウンド）
    const tmp = new Float32Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let a = 0, b = 0, c = 0, d = 0;
      for (let k = -1; k <= 1; k++) {
        const xx = (x + k + S) % S;
        a += base[(y * S + xx) * 4]; b += base[(y * S + xx) * 4 + 1];
        c += base[(y * S + xx) * 4 + 2]; d += base[(y * S + xx) * 4 + 3];
      }
      const i = (y * S + x) * 4;
      tmp[i] = a / 3; tmp[i + 1] = b / 3; tmp[i + 2] = c / 3; tmp[i + 3] = d / 3;
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let a = 0, b = 0, c = 0, d = 0;
      for (let k = -1; k <= 1; k++) {
        const yy = (y + k + S) % S;
        a += tmp[(yy * S + x) * 4]; b += tmp[(yy * S + x) * 4 + 1];
        c += tmp[(yy * S + x) * 4 + 2]; d += tmp[(yy * S + x) * 4 + 3];
      }
      const i = (y * S + x) * 4;
      img.data[i] = Math.round(a / 3 * 255); img.data[i + 1] = Math.round(b / 3 * 255);
      img.data[i + 2] = Math.round(c / 3 * 255); img.data[i + 3] = Math.round(d / 3 * 255);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  SL.buildTextures = function (gl) {
    return {
      atlas: makeGLTex(gl, buildAtlasCanvas(), gl.NEAREST),
      lightmap: makeGLTex(gl, buildLightmapCanvas(), gl.LINEAR),
      noisetex: makeGLTex(gl, buildNoiseCanvas(), gl.LINEAR)
    };
  };
})();
