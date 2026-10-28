// ui.js — UI 制御（パネル・スライダー・モーダル・トースト・ドラッグ＆ドロップ）
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;
  const $ = (s) => document.querySelector(s);

  const UI = {
    state: null, // main.js の state を参照

    init(state) {
      this.state = state;
      this._panel();
      this._time();
      this._weather();
      this._camera();
      this._settings();
      this._debug();
      this._topbar();
      this._drop();
      this._modals();
      this._keyboard();
    },

    // ---------- パネル開閉 ----------
    togglePanel() {
      const p = $('#panel');
      p.classList.toggle('open');
      setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    },

    _panel() {
      $('#panel-toggle').addEventListener('click', () => this.togglePanel());
    },

    // ---------- 時間 ----------
    _time() {
      const slider = $('#time-slider'), clock = $('#time-clock'), tick = $('#time-tick');
      const setLabel = () => {
        const t = this.state.worldTime;
        const hour = (Math.floor(t / 1000) + 6) % 24;
        const min = Math.floor(((t % 1000) / 1000) * 60);
        clock.textContent = String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');
        tick.textContent = Math.floor(t);
      };
      setLabel();
      let dragging = false;
      slider.addEventListener('input', () => {
        dragging = true;
        this.state.worldTime = +slider.value;
        setLabel();
      });
      slider.addEventListener('change', () => { dragging = false; });
      this._timeSliderRefresh = () => {
        if (!dragging) { slider.value = Math.floor(this.state.worldTime); }
        setLabel();
      };

      document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
        this.state.worldTime = +b.dataset.time;
      }));
      $('#time-play').addEventListener('change', (e) => { this.state.timeFlow = e.target.checked; });
      $('#time-speed').addEventListener('change', (e) => { this.state.daySpeed = +e.target.value; });
    },

    // ---------- 天候 ----------
    _weather() {
      const seg = document.querySelectorAll('#weather-seg .seg-btn');
      seg.forEach(b => b.addEventListener('click', () => {
        seg.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.state.setWeather(b.dataset.weather);
      }));
      const rain = $('#rain-slider'), rv = $('#rain-val');
      rain.addEventListener('input', () => {
        const v = +rain.value;
        this.state.rainTarget = v / 100;
        this.state.weatherMode = v > 70 ? 'thunder' : (v > 0 ? 'rain' : 'clear');
        seg.forEach(x => x.classList.remove('active'));
      });
      this._rainRefresh = () => {
        const pct = Math.round(this.state.rainStrength * 100);
        rv.textContent = pct + '%';
        if (!this._rainDragging) rain.value = pct;
      };
      rain.addEventListener('pointerdown', () => this._rainDragging = true);
      window.addEventListener('pointerup', () => this._rainDragging = false);
    },

    // ---------- カメラ ----------
    _camera() {
      const seg = document.querySelectorAll('#camera-seg .seg-btn');
      seg.forEach(b => b.addEventListener('click', () => {
        seg.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.state.camera.setMode(b.dataset.cam);
      }));
      $('#btn-reset-cam').addEventListener('click', () => this.state.camera.reset());
      $('#auto-orbit').addEventListener('change', (e) => { this.state.camera.autoOrbit = e.target.checked; });
      this._camModeRefresh = () => {
        const m = this.state.camera.mode;
        seg.forEach(x => x.classList.toggle('active', x.dataset.cam === m));
      };
    },

    // ---------- 設定 ----------
    _settings() {
      const fog = $('#fog-slider'), fv = $('#fog-val');
      fog.addEventListener('input', () => { this.state.fogDist = +fog.value; fv.textContent = fog.value; });
      $('#shadow-on').addEventListener('change', (e) => { this.state.shadowsOn = e.target.checked; });
      $('#shadow-res').addEventListener('change', (e) => {
        this.state.shadowRes = +e.target.value;
        this.state.rebuildShadows = true;
      });
      $('#res-scale').addEventListener('change', (e) => { this.state.resScale = +e.target.value; });
      $('#res-scale-toggle').addEventListener('change', (e) => {
        $('#res-scale').value = e.target.checked ? '0.5' : '1';
        this.state.resScale = e.target.checked ? 0.5 : 1;
      });
      $('#show-fps').addEventListener('change', (e) => {
        $('#stats-chip').style.display = e.target.checked ? '' : 'none';
      });
    },

    // ---------- デバッグ ----------
    _debug() {
      $('#bufview-on').addEventListener('change', (e) => {
        $('#bufview').hidden = !e.target.checked;
      });
      $('#bufview-sel').addEventListener('change', (e) => { $('#bufview-label').textContent = e.target.value; });
      $('#bufview-close').addEventListener('click', () => { $('#bufview-on').checked = false; $('#bufview').hidden = true; });
      const params = new URLSearchParams(location.search);
      if (params.get('debug') === '1') $('#debug-console').hidden = false;
      $('#dbg-clear').addEventListener('click', () => { $('#dbg-body').innerHTML = ''; });
      $('#dbg-toggle').addEventListener('click', (e) => {
        const b = $('#dbg-body');
        b.style.display = b.style.display === 'none' ? '' : 'none';
        e.target.textContent = b.style.display === 'none' ? '+' : '−';
      });
    },

    // ---------- トップバー ----------
    _topbar() {
      $('#btn-screenshot').addEventListener('click', () => this.state.requestScreenshot());
      $('#btn-fullscreen').addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      });
      $('#btn-help').addEventListener('click', () => $('#help-modal').showModal());
      $('#hint-close').addEventListener('click', () => $('#controls-hint').remove());
    },

    // ---------- パック読み込み UI ----------
    setPackChip(text, warn) {
      const chip = $('#pack-chip');
      chip.textContent = text;
      chip.classList.toggle('warn', !!warn);
    },

    showProgramStatus() {
      const pipe = this.state.pipeline;
      if (!pipe) return;
      const list = $('#pm-list');
      list.innerHTML = '';
      const packName = pipe.packInfo ? pipe.packInfo.name : '—';
      $('#pm-pack-name').textContent = '(' + packName + ')';
      const okCount = pipe.status.filter(s => s.ok && !s.usedFallback).length;
      const fbCount = pipe.status.filter(s => s.usedFallback).length;
      const errCount = pipe.status.filter(s => !s.ok).length;
      $('#pm-summary').textContent = `${pipe.status.length} プログラム: ✓ 成功 ${okCount} / △ フォールバック ${fbCount} / ✗ 失敗 ${errCount}` +
        (pipe.usingBuiltinFallback ? ' — このパックは未対応のため内蔵シェーダーで表示中' : '');
      for (const s of pipe.status) {
        const row = document.createElement('div');
        row.className = 'pm-row' + (s.ok ? '' : ' err') + (s.usedFallback ? ' fb' : '');
        const badge = s.ok ? (s.usedFallback ? '△' : '✓') : '✗';
        row.innerHTML = `<div class="pm-head"><span class="pm-badge">${badge}</span><code>${s.name}</code>` +
          (s.error ? `<button class="pm-expand">詳細</button>` : '') + `</div>`;
        if (s.error) {
          const det = document.createElement('pre');
          det.className = 'pm-detail';
          det.textContent = s.error;
          det.hidden = true;
          row.querySelector('.pm-expand').addEventListener('click', () => { det.hidden = !det.hidden; });
          row.appendChild(det);
        }
        list.appendChild(row);
      }
      $('#program-modal').showModal();
    },

    // ---------- ドラッグ＆ドロップ ----------
    _drop() {
      const overlay = $('#drop-overlay');
      let depth = 0;
      const fileDrag = (e) => {
        try { return !!(e.dataTransfer && [...e.dataTransfer.types].includes('Files')); }
        catch (err) { return false; }
      };
      const hide = () => { depth = 0; overlay.hidden = true; };
      // ファイルを掴んだ時だけオーバーレイ表示 (テキスト選択ドラッグ等では出さない)
      window.addEventListener('dragenter', (e) => {
        if (!fileDrag(e)) return;
        e.preventDefault();
        depth++;
        overlay.hidden = false;
      });
      window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        // relatedTarget === null → ウィンドウ外へ出たので確実に閉じる
        if (!e.relatedTarget) { hide(); return; }
        // dataTransfer が読めない環境でも、カウントが合えば閉じる
        if (depth > 0 && --depth <= 0) hide();
      });
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('dragend', hide);
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        hide();
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) this.state.loadPackFile(file);
      });
    },

    // ---------- モーダル ----------
    _modals() {
      // ×ボタン・「閉じる」ボタン (data-close 属性で対象 dialog を閉じる)
      document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
        const d = $('#' + b.dataset.close);
        if (d && d.open) d.close();
      }));
      // 背面 (backdrop) クリックで閉じる
      document.querySelectorAll('dialog').forEach(d => {
        d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      });
      $('#btn-program-status').addEventListener('click', () => this.showProgramStatus());
      $('#btn-load-zip').addEventListener('click', () => $('#file-zip').click());
      $('#btn-load-dir').addEventListener('click', () => $('#file-dir').click());
      $('#file-zip').addEventListener('change', (e) => {
        if (e.target.files[0]) this.state.loadPackFile(e.target.files[0]);
        e.target.value = '';
      });
      $('#file-dir').addEventListener('change', (e) => {
        const files = [...e.target.files];
        if (files.length) this.state.loadPackFolder(files);
        e.target.value = '';
      });
      $('#builtin-select').addEventListener('change', (e) => this.state.setBuiltin(e.target.value));
    },

    // ---------- キーボード ----------
    _keyboard() {
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Tab') { e.preventDefault(); this.togglePanel(); }
        if (e.key === 'p' || e.key === 'P') this.state.requestScreenshot();
        if (e.key === 'h' || e.key === 'H') $('#help-modal').showModal();
        if (e.key >= '1' && e.key <= '4') {
          const times = [23000, 6000, 12500, 18000];
          this.state.worldTime = times[+e.key - 1];
        }
      });
    },

    // ---------- トースト ----------
    toast(msg, kind) {
      const t = document.createElement('div');
      t.className = 'toast' + (kind ? ' ' + kind : '');
      t.textContent = msg;
      $('#toasts').appendChild(t);
      setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 500); }, kind === 'error' ? 7000 : 4000);
    },

    // ---------- ローディング ----------
    loading(p, label) {
      $('#loading-fill').style.width = (p * 100).toFixed(1) + '%';
      if (label) $('#loading-label').textContent = label;
    },
    hideLoading() {
      const el = $('#loading-overlay');
      el.classList.add('fade');
      setTimeout(() => { el.style.display = 'none'; }, 650);
    },

    // ---------- デバッグログ ----------
    dbg(kind, msg) {
      const box = $('#debug-console');
      if (box.hidden) return;
      const line = document.createElement('div');
      line.className = 'dbg-line ' + kind;
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      const body = $('#dbg-body');
      body.appendChild(line);
      while (body.children.length > 200) body.firstChild.remove();
      body.scrollTop = body.scrollHeight;
    },

    // ---------- フレーム更新 ----------
    frame(stats) {
      this._timeSliderRefresh && this._timeSliderRefresh();
      this._rainRefresh && this._rainRefresh();
      this._camModeRefresh && this._camModeRefresh();
      if (stats) {
        $('#stats-chip').textContent = `${stats.fps} FPS · ${stats.draws} draws · ${(stats.tris / 1000).toFixed(0)}k tris`;
      }
    }
  };

  // グローバルエラーハンドラ → デバッグコンソール + トースト
  window.addEventListener('error', (e) => {
    UI.dbg('err', e.message + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    UI.dbg('err', 'Promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  SL.UI = UI;
})();
