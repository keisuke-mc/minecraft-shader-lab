// zipreader.js — 外部依存ゼロのネイティブ zip リーダー（DecompressionStream 使用）
(function () {
  'use strict';
  window.SL = window.SL || {};

  const TD = new TextDecoder('utf-8');

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('このブラウザは DecompressionStream 非対応のため zip を展開できません（新しいブラウザをお使いください）');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // zip ファイル（File/Blob）→ { path: Uint8Array }
  async function readZip(file, onProgress) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (buf.length < 22) throw new Error('zip ファイルが壊れています');

    // End of Central Directory を末尾から探す
    let eocd = -1;
    const scanEnd = Math.max(0, buf.length - 22 - 65536);
    for (let i = buf.length - 22; i >= scanEnd; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip ではありません（EOCD が見つかりません）');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (p === 0xFFFFFFFF || p + 4 > buf.length) throw new Error('zip64 には対応していません');

    const entries = [];
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = TD.decode(buf.subarray(p + 46, p + 46 + nlen));
      if (!name.endsWith('/')) entries.push({ name, method, csize, lho });
      p += 46 + nlen + elen + clen;
    }
    if (!entries.length) throw new Error('zip 内にファイルがありません');

    const files = {};
    let done = 0;
    for (const e of entries) {
      const lp = e.lho;
      if (lp + 30 > buf.length || dv.getUint32(lp, true) !== 0x04034b50) continue;
      const nlen2 = dv.getUint16(lp + 26, true);
      const elen2 = dv.getUint16(lp + 28, true);
      const start = lp + 30 + nlen2 + elen2;
      const raw = buf.subarray(start, start + e.csize);
      let out;
      if (e.method === 0) out = raw;
      else if (e.method === 8) out = await inflateRaw(raw);
      else continue;
      files[e.name] = out;
      if (onProgress) onProgress(++done / entries.length, e.name);
    }
    if (!Object.keys(files).length) throw new Error('zip からファイルを取り出せませんでした');
    return files;
  }

  // zip 内パスの正規化（小文字・区切り統一・先頭 ./ 除去）
  function normPath(p) {
    return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  SL.readZip = readZip;
  SL.normZipPath = normPath;
})();
