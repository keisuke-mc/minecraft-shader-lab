// noise.js — シード付き乱数・バリューノイズ・ハッシュ
(function () {
  'use strict';
  window.SL = window.SL || {};

  // Mulberry32: シード付き高速 PRNG
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2i(x, y) { // 整数 → [0,1)
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  // 2D バリューノイズ
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const a = hash2i(xi, yi), b = hash2i(xi + 1, yi);
    const c = hash2i(xi, yi + 1), d = hash2i(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // fBm
  function fbm2(x, y, oct) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += noise2(x * freq, y * freq) * amp;
      norm += amp; amp *= 0.5; freq *= 2.03;
    }
    return sum / norm;
  }

  // 領域を [0,1] に正規化した fBm
  function fbm2n(x, y, oct) {
    return fbm2(x, y, oct) / fbm2(0.7311, 2.113, oct || 4) * 0.5;
  }

  SL.rand = mulberry32;
  SL.hash2i = hash2i;
  SL.noise2 = noise2;
  SL.fbm2 = fbm2;
  SL.fbm2n = fbm2n;
})();
