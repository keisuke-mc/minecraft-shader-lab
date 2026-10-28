// main.js — アプリの初期化・状態管理・レンダーループ
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  const state = {
    worldTime: 6000,       // 0-24000 (0 = 6:00 夜明け)
    worldDay: 0,
    timeFlow: true,
    daySpeed: 120,         // 1日 = 120 秒
    rainTarget: 0,
    rainStrength: 0,
    wetness: 0,
    weatherMode: 'clear',
    fogDist: 130,
    shadowsOn: true,
    shadowRes: 2048,
    resScale: 1,
    frameTimeCounter: 0,
    frameCounter: 0,
    lightningFlash: 0,
    _lightningTimer: 2,
    camera: null,
    pipeline: null,
    requestShot: false,

    setWeather(mode) {
      this.weatherMode = mode;
      this.rainTarget = mode === 'clear' ? 0 : 1;
    },

    setBuiltin(which) {
      const pack = which === 'vanilla' ? SL.VANILLA_PACK : SL.SOFTLIGHT_PACK;
      try {
        const parsed = SL.parsePack(pack.files, pack.name);
        state.pipeline.setPack(parsed);
        state.currentPackName = pack.name;
        state.pipeline.usingBuiltinFallback = false;
        SL.UI.setPackChip(pack.name, false);
        SL.UI.toast(pack.name + ' を適用しました');
        try { localStorage.setItem('sl_builtin', which); } catch (e) {}
      } catch (e) {
        SL.UI.toast('内蔵シェーダーの初期化に失敗: ' + e.message, 'error');
      }
    },

    async loadPackFile(file) {
      try {
        SL.UI.toast('読み込み中: ' + file.name + ' …');
        const files = await SL.readZip(file);
        await this._applyPack(files, file.name.replace(/\.zip$/i, ''));
      } catch (e) {
        SL.UI.toast('パック読み込み失敗: ' + e.message, 'error');
      }
    },

    async loadPackFolder(files) {
      try {
        const map = {};
        for (const f of files) map[f.webkitRelativePath || f.name] = f;
        // File オブジェクト → Uint8Array
        const out = {};
        for (const [k, f] of Object.entries(map)) {
          if (f.size > 2 * 1024 * 1024) continue;
          out[k] = new Uint8Array(await f.arrayBuffer());
        }
        await this._applyPack(out, files[0] && (files[0].webkitRelativePath || '').split('/')[0] || 'フォルダ');
      } catch (e) {
        SL.UI.toast('フォルダ読み込み失敗: ' + e.message, 'error');
      }
    },

    async _applyPack(files, name) {
      const parsed = SL.parsePack(files, name);
      const status = this.pipeline.setPack(parsed);
      const errs = status.filter(s => !s.ok).length;
      const fbs = status.filter(s => s.usedFallback).length;
      this.currentPackName = name;
      // セレクトに追加/選択
      const sel = document.getElementById('builtin-select');
      let opt = [...sel.options].find(o => o.value === '__loaded');
      if (!opt) { opt = document.createElement('option'); opt.value = '__loaded'; sel.appendChild(opt); }
      opt.textContent = '読み込み済み: ' + name;
      sel.value = '__loaded';
      SL.UI.setPackChip(name, errs > 0 || fbs > 0);
      SL.UI.toast(`${name}: ${status.length} プログラム (${errs} 失敗 / ${fbs} フォールバック)`, errs ? 'error' : 'ok');
      SL.UI.showProgramStatus();
      for (const d of parsed.diag) SL.UI.dbg('warn', d);
    },

    requestScreenshot() { this.requestShot = true; }
  };

  // ---------- 太陽方向 (sunPathRotation 対応) ----------
  function sunDirWorld(worldTime, pathRotDeg) {
    const t01 = (worldTime % 24000) / 24000;
    const phi = t01 * Math.PI * 2; // 0 = 夜明け (東の地平線)
    let d = [Math.cos(phi), Math.sin(phi), 0];
    const rot = (pathRotDeg || 0) * Math.PI / 180;
    // 東西軸 (X) を中心に回転 → 太陽の軌道面を傾ける
    const cy = Math.cos(rot), sy = Math.sin(rot);
    return [d[0], d[1] * cy - d[2] * sy, d[1] * sy + d[2] * cy];
  }

  // CPU 側の空/霧カラー (uniform 供給用)
  function skyColors(sunD, rain) {
    const day = Math.max(0, Math.min(1, (sunD[1] + 0.07) / 0.23));
    const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    let sky = mix3([0.028, 0.045, 0.095], [0.29, 0.48, 0.80], day);
    let fog = mix3([0.03, 0.04, 0.08], [0.68, 0.80, 0.92], day);
    const sunset = Math.exp(-Math.abs(sunD[1]) * 11);
    fog = mix3(fog, [0.98, 0.52, 0.25], sunset * 0.4);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    sky = mix3(sky, [lum(sky) * 0.45, lum(sky) * 0.45, lum(sky) * 0.5], rain * 0.85);
    fog = mix3(fog, [lum(fog) * 0.5, lum(fog) * 0.5, lum(fog) * 0.55], rain * 0.85);
    return { sky, fog };
  }

  async function boot() {
    const canvas = document.getElementById('glcanvas');
    const gl = SL.createGL(canvas);
    if (!gl) {
      document.getElementById('loading-label').textContent = 'WebGL2 非対応のブラウザです。Chrome / Edge / Firefox の最新版をお使いください。';
      return;
    }
    const dbg = SL.UI.dbg.bind(SL.UI);

    // キャンバスサイズ
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    fit();
    window.addEventListener('resize', fit);

    SL.UI.init(state);
    dbg('info', '起動: WebGL2 初期化');

    // テクスチャ
    const textures = SL.buildTextures(gl);
    dbg('info', 'テクスチャ生成完了');

    // ワールド
    await SL.World.generate((p, label) => SL.UI.loading(p * 0.6, label));
    await SL.World.buildMeshes(gl, (p, label) => SL.UI.loading(p, label));
    dbg('info', 'ワールド生成完了 (' + SL.World.chunks.length + ' チャンク)');

    // カメラ
    state.camera = new SL.Camera(canvas);

    // パイプライン
    const pipeline = new SL.Pipeline(gl, textures);
    state.pipeline = pipeline;

    const applyRes = () => {
      const w = Math.max(64, Math.round(canvas.width * state.resScale));
      const h = Math.max(64, Math.round(canvas.height * state.resScale));
      pipeline.resize(w, h);
    };
    applyRes();

    // 内蔵パック
    let builtin = 'softlight';
    try { builtin = localStorage.getItem('sl_builtin') || 'softlight'; } catch (e) {}
    if (builtin !== 'softlight' && builtin !== 'vanilla') builtin = 'softlight';
    document.getElementById('builtin-select').value = builtin;
    state.setBuiltin(builtin);

    // ?pack= (URL 経由・開発用)
    const params = new URLSearchParams(location.search);
    const packUrl = params.get('pack');
    if (packUrl) {
      try {
        const res = await fetch(packUrl);
        const blob = await res.blob();
        await state.loadPackFile(new File([blob], packUrl.split('/').pop(), { type: blob.type }));
      } catch (e) {
        SL.UI.toast('?pack= の読み込みに失敗: ' + e.message, 'error');
      }
    }

    SL.UI.hideLoading();
    dbg('info', '準備完了');

    // ---------- ループ ----------
    let last = performance.now();
    let fpsEMA = 60;
    let prevEye = null, prevView = null, prevProj = null;
    let lastShadowRes = state.shadowRes;
    let frames = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try {
        // 時間
        if (state.timeFlow) {
          state.worldTime = (state.worldTime + (24000 / state.daySpeed) * dt) % 24000;
          if (state.worldTime < dt * 24000 / state.daySpeed) state.worldDay++;
        }
        state.frameTimeCounter = (state.frameTimeCounter + dt) % 3600;
        state.frameCounter++;

        // 天候
        const rr = 1 - Math.exp(-dt * 0.9);
        state.rainStrength += (state.rainTarget - state.rainStrength) * rr;
        state.wetness = Math.min(1, state.wetness + (state.rainTarget - state.wetness) * dt * 0.2);
        state.lightningFlash *= Math.exp(-dt * 6);
        if (state.weatherMode === 'thunder') {
          state._lightningTimer -= dt;
          if (state._lightningTimer <= 0) {
            state._lightningTimer = 2.5 + Math.random() * 7;
            state.lightningFlash = 0.7 + Math.random() * 0.5;
          }
        }

        // カメラ
        state.camera.update(dt);
        const vc = state.camera.computeView();
        const aspect = canvas.width / canvas.height;
        const proj = state.camera.computeProj(aspect);
        const cam = {
          eye: vc.eye,
          view: vc.view,
          viewInv: SL.mat4.invert(vc.view),
          proj,
          projInv: SL.mat4.invert(proj)
        };

        // 設定反映
        pipeline.shadowsOn = state.shadowsOn;
        if (state.shadowRes !== lastShadowRes) {
          lastShadowRes = state.shadowRes;
          pipeline.shadowRes = state.shadowRes;
          pipeline._makeShadowTargets();
        }
        if (Math.round(canvas.width * state.resScale) !== pipeline.w) applyRes();

        // 太陽
        const pathRot = pipeline.sunPathRotation || 0;
        const sunD = sunDirWorld(state.worldTime, pathRot);
        const { sky, fog } = skyColors(sunD, state.rainStrength);

        // 水中判定
        const eb = SL.World.getBlock(cam.eye[0], cam.eye[1], cam.eye[2]);
        const inWater = eb === SL.BLOCK.WATER ? 1 : 0;

        const stats = pipeline.render({
          camera: cam,
          worldTime: state.worldTime,
          worldDay: state.worldDay,
          frameTimeCounter: state.frameTimeCounter,
          frameCounter: state.frameCounter,
          rainStrength: state.rainStrength,
          wetness: state.wetness,
          lightningFlash: state.lightningFlash,
          isEyeInWater: inWater,
          sunDirW: sunD,
          skyColor: sky,
          fogColor: fog,
          canvasW: canvas.width,
          canvasH: canvas.height,
          prevView: prevView || cam.view,
          prevProj: prevProj || cam.proj,
          prevEye: prevEye || cam.eye
        });
        prevEye = cam.eye.slice(); prevView = cam.view; prevProj = cam.proj;

        // バッファビューア
        if (!document.getElementById('bufview').hidden) {
          const name = document.getElementById('bufview-sel').value;
          const size = 256;
          pipeline.renderBufferView(name, 12, 12, size, Math.round(size * canvas.height / canvas.width));
        }

        // スクリーンショット (描画と同一フレーム内)
        if (state.requestShot) {
          state.requestShot = false;
          try {
            const dataURL = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataURL;
            const t = Math.floor(state.worldTime);
            a.download = `shaderlab_${t}.png`;
            a.click();
            SL.UI.toast('スクリーンショットを保存しました');
          } catch (e) {
            SL.UI.toast('スクリーンショットに失敗: ' + e.message, 'error');
          }
        }

        fpsEMA += ((1 / Math.max(dt, 1e-4)) - fpsEMA) * 0.06;
        frames++;
        if (frames % 4 === 0) SL.UI.frame({ fps: Math.round(fpsEMA), draws: stats.draws, tris: stats.tris });
        else SL.UI.frame(null);
      } catch (e) {
        console.error(e);
        SL.UI.dbg('err', '描画ループ: ' + e.message);
        SL.UI.toast('描画エラー: ' + e.message, 'error');
        throw e;
      }
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
