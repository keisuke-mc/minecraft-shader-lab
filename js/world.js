// world.js — ボクセル地形生成・ライト伝播・チャンクメッシュ構築
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  // ---------- 定数 ----------
  const WX = 192, WZ = 192, WY = 96, CHUNK = 32, CX = WX / CHUNK, CZ = WZ / CHUNK;
  const SEA = 44;
  const SEED = 20260101;

  const B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, WATER: 7,
    GLOWSTONE: 8, SNOWGRASS: 9, TALLGRASS: 10, POPPY: 11, DANDELION: 12, BEDROCK: 13
  };

  const opaque = (b) => b === B.GRASS || b === B.DIRT || b === B.STONE || b === B.SAND ||
    b === B.LOG || b === B.GLOWSTONE || b === B.SNOWGRASS || b === B.BEDROCK;
  const cross = (b) => b === B.TALLGRASS || b === B.POPPY || b === B.DANDELION;
  const aoCaster = (b) => opaque(b) || b === B.LEAVES;

  // ブロック → 面タイル [top, side, bottom]
  const FACE_TILES = {
    [B.GRASS]: [SL.TILE.GRASS_TOP, SL.TILE.GRASS_SIDE, SL.TILE.DIRT],
    [B.DIRT]: [SL.TILE.DIRT, SL.TILE.DIRT, SL.TILE.DIRT],
    [B.STONE]: [SL.TILE.STONE, SL.TILE.STONE, SL.TILE.STONE],
    [B.SAND]: [SL.TILE.SAND, SL.TILE.SAND, SL.TILE.SAND],
    [B.LOG]: [SL.TILE.LOG_TOP, SL.TILE.LOG_SIDE, SL.TILE.LOG_TOP],
    [B.LEAVES]: [SL.TILE.LEAVES, SL.TILE.LEAVES, SL.TILE.LEAVES],
    [B.WATER]: [SL.TILE.WATER, SL.TILE.WATER, SL.TILE.WATER],
    [B.GLOWSTONE]: [SL.TILE.GLOWSTONE, SL.TILE.GLOWSTONE, SL.TILE.GLOWSTONE],
    [B.SNOWGRASS]: [SL.TILE.SNOW_TOP, SL.TILE.SNOW_SIDE, SL.TILE.DIRT],
    [B.BEDROCK]: [SL.TILE.BEDROCK, SL.TILE.BEDROCK, SL.TILE.BEDROCK]
  };

  // ---------- 面定義 (CCW、背面カリング用) ----------
  // dir: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
  const FACES = [
    { n: [1, 0, 0], ax1: 1, ax2: 2, shade: 0.65, v: [
      { p: [1, 0, 0], uv: [0, 1], t1: -1, t2: -1 }, { p: [1, 1, 0], uv: [0, 0], t1: 1, t2: -1 },
      { p: [1, 1, 1], uv: [1, 0], t1: 1, t2: 1 }, { p: [1, 0, 1], uv: [1, 1], t1: -1, t2: 1 }] },
    { n: [-1, 0, 0], ax1: 1, ax2: 2, shade: 0.65, v: [
      { p: [0, 0, 1], uv: [1, 1], t1: -1, t2: 1 }, { p: [0, 1, 1], uv: [1, 0], t1: 1, t2: 1 },
      { p: [0, 1, 0], uv: [0, 0], t1: 1, t2: -1 }, { p: [0, 0, 0], uv: [0, 1], t1: -1, t2: -1 }] },
    { n: [0, 1, 0], ax1: 0, ax2: 2, shade: 1.0, v: [
      { p: [0, 1, 1], uv: [0, 1], t1: -1, t2: 1 }, { p: [1, 1, 1], uv: [1, 1], t1: 1, t2: 1 },
      { p: [1, 1, 0], uv: [1, 0], t1: 1, t2: -1 }, { p: [0, 1, 0], uv: [0, 0], t1: -1, t2: -1 }] },
    { n: [0, -1, 0], ax1: 0, ax2: 2, shade: 0.55, v: [
      { p: [0, 0, 0], uv: [0, 0], t1: -1, t2: -1 }, { p: [1, 0, 0], uv: [1, 0], t1: 1, t2: -1 },
      { p: [1, 0, 1], uv: [1, 1], t1: 1, t2: 1 }, { p: [0, 0, 1], uv: [0, 1], t1: -1, t2: 1 }] },
    { n: [0, 0, 1], ax1: 0, ax2: 1, shade: 0.82, v: [
      { p: [0, 0, 1], uv: [0, 1], t1: -1, t2: -1 }, { p: [1, 0, 1], uv: [1, 1], t1: 1, t2: -1 },
      { p: [1, 1, 1], uv: [1, 0], t1: 1, t2: 1 }, { p: [0, 1, 1], uv: [0, 0], t1: -1, t2: 1 }] },
    { n: [0, 0, -1], ax1: 0, ax2: 1, shade: 0.82, v: [
      { p: [1, 0, 0], uv: [0, 1], t1: 1, t2: -1 }, { p: [0, 0, 0], uv: [1, 1], t1: -1, t2: -1 },
      { p: [0, 1, 0], uv: [1, 0], t1: -1, t2: 1 }, { p: [1, 1, 0], uv: [0, 0], t1: 1, t2: 1 }] }
  ];
  const AO_LEVEL = [0.42, 0.62, 0.82, 1.0];

  // ---------- メッシュビルダ (52バイト/頂点) ----------
  // f32: pos(3) uv(2) | u8: normal(4) color(4) light(4) miduv(4) | f32: block(4)
  class MeshBuilder {
    constructor() { this.grow(4096); }
    grow(nv) {
      const old = this.buf;
      this.cap = nv;
      this.buf = new ArrayBuffer(nv * 52);
      this.f32 = new Float32Array(this.buf);
      this.u8 = new Uint8Array(this.buf);
      this.idx = new Uint32Array(nv * 2);
      this.nv = 0; this.ni = 0;
      if (old) { /* 履歴は破棄して再構築前提 */ }
    }
    ensure() {
      if (this.nv + 4 > this.cap) {
        const nv = this.nv, ni = this.ni;
        const of = this.f32, ou = this.u8, oi = this.idx;
        const ncap = this.cap * 2;
        this.buf = new ArrayBuffer(ncap * 52);
        this.f32 = new Float32Array(this.buf);
        this.u8 = new Uint8Array(this.buf);
        this.idx = new Uint32Array(ncap * 2);
        this.f32.set(of); this.u8.set(ou); this.idx.set(oi.subarray(0, ni));
        this.cap = ncap;
      }
    }
    // 頂点データ書き込み
    vert(px, py, pz, u, v, nx, ny, nz, cr, cg, cb, ca, blk, sky, mid, blockId) {
      const vi = this.nv, o = vi * 13, ob = vi * 52;
      const f = this.f32, u8 = this.u8;
      f[o] = px; f[o + 1] = py; f[o + 2] = pz;
      f[o + 3] = u; f[o + 4] = v;
      u8[ob + 20] = nx; u8[ob + 21] = ny; u8[ob + 22] = nz; u8[ob + 23] = 0;
      u8[ob + 24] = cr; u8[ob + 25] = cg; u8[ob + 26] = cb; u8[ob + 27] = ca;
      u8[ob + 28] = blk; u8[ob + 29] = sky; u8[ob + 30] = 0; u8[ob + 31] = 255;
      u8[ob + 32] = mid[0]; u8[ob + 33] = mid[1]; u8[ob + 34] = 0; u8[ob + 35] = 255;
      f[o + 9] = blockId; f[o + 10] = 0; f[o + 11] = 0; f[o + 12] = 1;
      this.nv = vi + 1;
    }
    quad(flip) {
      const i = this.ni, b = this.nv - 4;
      const d = this.idx;
      if (!flip) { d[i]=b; d[i+1]=b+1; d[i+2]=b+2; d[i+3]=b; d[i+4]=b+2; d[i+5]=b+3; }
      else { d[i]=b+1; d[i+1]=b+2; d[i+2]=b+3; d[i+3]=b+1; d[i+4]=b+3; d[i+5]=b; }
      this.ni = i + 6;
    }
    quadReversed() {
      const i = this.ni, b = this.nv - 4;
      const d = this.idx;
      d[i]=b; d[i+1]=b+2; d[i+2]=b+1; d[i+3]=b; d[i+4]=b+3; d[i+5]=b+2;
      this.ni = i + 6;
    }
  }

  // ---------- World ----------
  const World = {
    WX, WZ, WY, CHUNK, CX, CZ, SEA,
    blocks: null, heights: null, skyLight: null, blockLight: null,
    chunks: [],
    getBlock(x, y, z) {
      x |= 0; y |= 0; z |= 0;
      if (x < 0 || x >= WX || z < 0 || z >= WZ || y < 0 || y >= WY) return B.AIR;
      return this.blocks[(y * WZ + z) * WX + x];
    },
    setBlock(x, y, z, b) {
      if (x < 0 || x >= WX || z < 0 || z >= WZ || y < 0 || y >= WY) return;
      this.blocks[(y * WZ + z) * WX + x] = b;
    },
    isOpaque: opaque, isCross: cross,
    spawnHeight(x, z) { return this.heights[Math.max(0, Math.min(WZ - 1, z | 0)) * WX + Math.max(0, Math.min(WX - 1, x | 0))]; },

    // ---------- 地形生成 ----------
    async generate(onProgress) {
      const blocks = this.blocks = new Uint8Array(WX * WZ * WY);
      const heights = this.heights = new Int16Array(WX * WZ);
      this.skyLight = new Uint8Array(WX * WZ * WY);
      this.blockLight = new Uint8Array(WX * WZ * WY);

      const hAt = (x, z) => {
        const base = SL.fbm2n(x / 96 + 13.7, z / 96 + 7.1, 4);
        const detail = SL.fbm2n(x / 26 + 41.2, z / 26 + 3.9, 3);
        const mtn = SL.fbm2n(x / 150 + 71.3, z / 150 + 29.8, 3);
        let h = 36 + base * 24 + detail * 7 + Math.max(0, mtn - 0.56) * 95;
        return Math.max(8, Math.min(WY - 10, Math.round(h)));
      };

      for (let z = 0; z < WZ; z++) {
        for (let x = 0; x < WX; x++) {
          const h = hAt(x, z);
          heights[z * WX + x] = h;
          const snowLine = 62 + SL.hash2i(x >> 3, (z >> 3) + 77.7) * 4;
          for (let y = 0; y <= h; y++) {
            let b;
            if (y === 0) b = B.BEDROCK;
            else if (y === h) {
              if (h < SEA + 2) b = B.SAND;
              else if (h >= snowLine) b = B.SNOWGRASS;
              else b = B.GRASS;
            } else if (y > h - 3) b = h < SEA + 2 ? B.SAND : (h >= snowLine ? B.DIRT : B.DIRT);
            else b = B.STONE;
            blocks[(y * WZ + z) * WX + x] = b;
          }
          for (let y = h + 1; y <= SEA; y++) blocks[(y * WZ + z) * WX + x] = B.WATER;
        }
        if ((z & 15) === 15) { onProgress((z / WZ) * 0.55, '地形生成中'); await new Promise(r => setTimeout(r)); }
      }

      // ---------- 樹木・草木 ----------
      const trees = [];
      for (let z = 2; z < WZ - 2; z++) for (let x = 2; x < WX - 2; x++) {
        const h = heights[z * WX + x];
        if (h <= SEA + 1 || h >= 70) continue;
        if (blocks[(h * WZ + z) * WX + x] !== B.GRASS) continue;
        const r = SL.hash2i(x * 5 + 1, z * 5 + 2);
        if (r > 0.0075) {
          // 草花
          const r2 = SL.hash2i(x * 7 + 3, z * 7 + 4);
          if (r2 < 0.09) blocks[((h + 1) * WZ + z) * WX + x] = B.TALLGRASS;
          else if (r2 < 0.100) blocks[((h + 1) * WZ + z) * WX + x] = B.POPPY;
          else if (r2 < 0.108) blocks[((h + 1) * WZ + z) * WX + x] = B.DANDELION;
          continue;
        }
        let ok = true;
        for (const t of trees) { const dx = t[0] - x, dz = t[1] - z; if (dx * dx + dz * dz < 25) { ok = false; break; } }
        if (!ok) continue;
        trees.push([x, z]);
        const th = 4 + Math.floor(SL.hash2i(x, z) * 2.99);
        for (let i = 1; i <= th; i++) blocks[((h + i) * WZ + z) * WX + x] = B.LOG;
        const top = h + th;
        for (let dy = -2; dy <= 2; dy++) {
          const rad = dy <= 0 ? 2 : (dy === 1 ? 1 : 1);
          for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
            if (dy === 2 && Math.abs(dx) + Math.abs(dz) > 1) continue;
            if (Math.abs(dx) === rad && Math.abs(dz) === rad && SL.hash2i(x + dx * 3, z + dz * 5 + dy) < 0.6) continue;
            const bx = x + dx, by = top + dy, bz = z + dz;
            if (bx < 0 || bx >= WX || bz < 0 || bz >= WZ || by >= WY) continue;
            if (blocks[(by * WZ + bz) * WX + bx] === B.AIR) blocks[(by * WZ + bz) * WX + bx] = B.LEAVES;
          }
        }
      }
      onProgress(0.62, '植生を配置中'); await new Promise(r => setTimeout(r));

      // ---------- グロウストーン ----------
      const rng = SL.rand(SEED);
      const sources = [];
      let placed = 0, tries = 0;
      while (placed < 26 && tries < 4000) {
        tries++;
        const x = 8 + Math.floor(rng() * (WX - 16)), z = 8 + Math.floor(rng() * (WZ - 16));
        const h = heights[z * WX + x];
        if (h <= SEA + 1 || h >= 68) continue;
        if (blocks[((h + 1) * WZ + z) * WX + x] !== B.AIR) continue;
        blocks[((h + 1) * WZ + z) * WX + x] = B.GLOWSTONE;
        sources.push([x, h + 1, z]);
        placed++;
      }

      // ---------- 天空光 ----------
      for (let z = 0; z < WZ; z++) for (let x = 0; x < WX; x++) {
        let light = 15;
        for (let y = WY - 1; y >= 0; y--) {
          this.skyLight[(y * WZ + z) * WX + x] = light;
          const b = blocks[(y * WZ + z) * WX + x];
          if (opaque(b)) light = 0;
          else if (b === B.LEAVES) light = Math.max(0, light - 3);
          else if (b === B.WATER) light = Math.max(0, light - 1);
        }
      }

      // ---------- ブロック光 (BFS) ----------
      const q = [];
      for (const s of sources) { this.blockLight[(s[1] * WZ + s[2]) * WX + s[0]] = 15; q.push(s); }
      const N6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      while (q.length) {
        const [x, y, z] = q.shift();
        const lv = this.blockLight[(y * WZ + z) * WX + x];
        if (lv <= 1) continue;
        for (const d of N6) {
          const nx = x + d[0], ny = y + d[1], nz = z + d[2];
          if (nx < 0 || nx >= WX || nz < 0 || nz >= WZ || ny < 0 || ny >= WY) continue;
          const nb = blocks[(ny * WZ + nz) * WX + nx];
          if (opaque(nb)) continue;
          const i = (ny * WZ + nz) * WX + nx;
          if (this.blockLight[i] < lv - 1) {
            this.blockLight[i] = lv - 1;
            q.push([nx, ny, nz]);
          }
        }
      }
      onProgress(0.7, '光を計算中'); await new Promise(r => setTimeout(r));
    },

    // ---------- メッシュ構築 ----------
    async buildMeshes(gl, onProgress) {
      this.chunks = [];
      const total = CX * CZ;
      for (let cz = 0; cz < CZ; cz++) for (let cx = 0; cx < CX; cx++) {
        this.chunks.push(this.buildChunk(gl, cx, cz));
        onProgress(0.7 + 0.3 * (cz * CX + cx + 1) / total, 'メッシュ構築中');
        await new Promise(r => setTimeout(r));
      }
    },

    buildChunk(gl, ccx, ccz) {
      const opq = new MeshBuilder(), wat = new MeshBuilder();
      const x0 = ccx * CHUNK, z0 = ccz * CHUNK;
      const blocks = this.blocks, sky = this.skyLight, blkL = this.blockLight;
      const idx3 = (x, y, z) => (y * WZ + z) * WX + x;

      const lightAt = (x, y, z) => {
        if (x < 0 || x >= WX || z < 0 || z >= WZ || y < 0 || y >= WY) return [0, 15];
        const i = idx3(x, y, z);
        return [blkL[i], sky[i]];
      };
      const aoAt = (x, y, z) => aoCaster(this.getBlock(x, y, z));

      // 通常の面
      const emitFace = (mb, x, y, z, dir, tile, tint, adjX, adjY, adjZ, topOffset) => {
        const fd = FACES[dir];
        const [lb, ls] = lightAt(adjX, adjY, adjZ);
        const mid = SL.tileMid(tile);
        const aos = [0, 0, 0, 0];
        // AO
        const a1 = [0, 0, 0], a2 = [0, 0, 0];
        a1[fd.ax1] = 1; a2[fd.ax2] = 1;
        for (let i = 0; i < 4; i++) {
          const c = fd.v[i];
          const s1 = aoAt(adjX + a1[0] * c.t1, adjY + a1[1] * c.t1, adjZ + a1[2] * c.t1);
          const s2 = aoAt(adjX + a2[0] * c.t2, adjY + a2[1] * c.t2, adjZ + a2[2] * c.t2);
          const cn = aoAt(adjX + a1[0] * c.t1 + a2[0] * c.t2, adjY + a1[1] * c.t1 + a2[1] * c.t2, adjZ + a1[2] * c.t1 + a2[2] * c.t2);
          aos[i] = (s1 && s2) ? 0 : 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (cn ? 1 : 0));
        }
        for (let i = 0; i < 4; i++) {
          const c = fd.v[i];
          mb.ensure();
          const uv = SL.tileUV(tile, c.uv[0], c.uv[1]);
          const shade = fd.shade * AO_LEVEL[aos[i]];
          const yo = (dir === 2 && topOffset) ? -0.125 : 0; // 水面は少し沈める
          const r = Math.min(255, Math.round(tint[0] * shade * 255));
          const g = Math.min(255, Math.round(tint[1] * shade * 255));
          const bl = Math.min(255, Math.round(tint[2] * shade * 255));
          mb.vert(x + c.p[0], y + c.p[1] + yo, z + c.p[2], uv[0], uv[1],
            fd.n[0] * 127 + 128, fd.n[1] * 127 + 128, fd.n[2] * 127 + 128,
            r, g, bl, 255, lb * 17, ls * 17, mid, blockIdOf(x, y, z));
        }
        mb.quad(aos[0] + aos[2] > aos[1] + aos[3]);
      };

      const blockIdOf = (x, y, z) => this.getBlock(x, y, z);

      // クロス植物
      const emitCross = (x, y, z, tile, tint) => {
        const [lb, ls] = lightAt(x, y, z);
        const mid = SL.tileMid(tile);
        const jx = (SL.hash2i(x * 3 + 1, z * 3 + 5) - 0.5) * 0.25;
        const jz = (SL.hash2i(x * 3 + 7, z * 3 + 11) - 0.5) * 0.25;
        const x0b = x + 0.15 + jx, x1b = x + 0.85 + jx, z0b = z + 0.15 + jz, z1b = z + 0.85 + jz;
        const uv00 = SL.tileUV(tile, 0, 0), uv10 = SL.tileUV(tile, 1, 0), uv01 = SL.tileUV(tile, 0, 1), uv11 = SL.tileUV(tile, 1, 1);
        const id = this.getBlock(x, y, z);
        const put = (ax, az, bx, bz, rev) => {
          const r = Math.round(tint[0] * 0.95 * 255), g = Math.round(tint[1] * 0.95 * 255), b = Math.round(tint[2] * 0.95 * 255);
          const vs = rev
            ? [[bx, 1, bz, uv10], [ax, 1, az, uv00], [ax, 0, az, uv01], [bx, 0, bz, uv11]]
            : [[ax, 0, az, uv01], [bx, 0, bz, uv11], [bx, 1, bz, uv10], [ax, 1, az, uv00]];
          for (const vv of vs) {
            opq.ensure();
            opq.vert(x + vv[0], y + vv[1], z + vv[2], vv[3][0], vv[3][1], 128, 255, 128,
              r, g, b, 255, lb * 17, ls * 17, mid, id);
          }
          opq.quad(false);
        };
        put(x0b, z0b, x1b, z1b, false); put(x0b, z0b, x1b, z1b, true);
        put(x0b, z1b, x1b, z0b, false); put(x0b, z1b, x1b, z0b, true);
      };

      const WHITE = [1, 1, 1];
      for (let z = z0; z < z0 + CHUNK; z++) for (let x = x0; x < x0 + CHUNK; x++) {
        for (let y = 0; y < WY; y++) {
          const b = blocks[idx3(x, y, z)];
          if (b === B.AIR) continue;

          if (cross(b)) {
            const tile = b === B.TALLGRASS ? SL.TILE.TALLGRASS : (b === B.POPPY ? SL.TILE.POPPY : SL.TILE.DANDELION);
            const tint = b === B.TALLGRASS
              ? [0.85 + SL.hash2i(x, z) * 0.3, 1.0, 0.85 + SL.hash2i(x + 9, z) * 0.3]
              : WHITE;
            emitCross(x, y, z, tile, tint);
            continue;
          }

          if (b === B.WATER) {
            // 上面（水面は少し沈める / 水パスでカリング無効化により下面からも見える）
            if (this.getBlock(x, y + 1, z) !== B.WATER) emitFace(wat, x, y, z, 2, SL.TILE.WATER, WHITE, x, y + 1, z, true);
            // 側面・底
            for (const dir of [0, 1, 4, 5]) {
              const fd = FACES[dir];
              const nb = this.getBlock(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
              if (nb === B.AIR || cross(nb)) emitFace(wat, x, y, z, dir, SL.TILE.WATER, WHITE, x + fd.n[0], y, z + fd.n[2], false);
            }
            const below = this.getBlock(x, y - 1, z);
            if (below === B.AIR) emitFace(wat, x, y, z, 3, SL.TILE.WATER, WHITE, x, y - 1, z, false);
            continue;
          }

          // 通常ブロック
          const tiles = FACE_TILES[b];
          const tint = (b === B.GRASS)
            ? [0.85 + SL.hash2i(x, z + 31) * 0.3, 1.0, 0.85 + SL.hash2i(x + 17, z) * 0.3]
            : (b === B.LEAVES ? [0.85 + SL.hash2i(x >> 2, z >> 2) * 0.3, 1.0, 0.85 + SL.hash2i(x, (z >> 2) + 5) * 0.3] : WHITE);
          for (let dir = 0; dir < 6; dir++) {
            const fd = FACES[dir];
            const nb = this.getBlock(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
            let show;
            if (b === B.LEAVES) show = !opaque(nb) && nb !== B.LEAVES;
            else show = !opaque(nb);
            if (!show) continue;
            const tile = dir === 2 ? tiles[0] : (dir === 3 ? tiles[2] : tiles[1]);
            emitFace(opq, x, y, z, dir, tile, tint, x + fd.n[0], y + fd.n[1], z + fd.n[2], false);
          }
        }
      }

      // GL リソース化
      const upload = (mb) => {
        if (!mb.ni) return null;
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, mb.buf.slice(0, mb.nv * 52), gl.STATIC_DRAW);
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mb.idx.subarray(0, mb.ni), gl.STATIC_DRAW);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        const S = 52;
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, S, 20);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, S, 24);
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, S, 28);
        gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, S, 32);
        gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 4, gl.FLOAT, false, S, 36);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bindVertexArray(null);
        return { vao, vbo, ibo, count: mb.ni, tris: mb.ni / 3 };
      };

      // 水面の下から見る用に上面を両面化: 簡易化のため上面のみ反対巻きも追加済み(emitCross と同様) …代わりに cullFace を水パスで無効化する方針
      return {
        cx: ccx, cz: ccz,
        aabb: { min: [x0, 0, z0], max: [x0 + CHUNK, WY, z0 + CHUNK] },
        opaque: upload(opq),
        water: upload(wat)
      };
    }
  };

  SL.World = World;
  SL.BLOCK = B;
  SL.MESH_VERT_STRIDE = 52;
})();
