// camera.js — 旋回(オービット) / 飛行(FPS) カメラ + 入力
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  const FOV = 70 * Math.PI / 180, NEAR = 0.15, FAR = 480;
  const WORLD = () => SL.World;

  class Camera {
    constructor(canvas) {
      this.canvas = canvas;
      this.mode = 'orbit';
      this.autoOrbit = true;
      this.speed = 10;

      // 旋回
      this.oGoal = { tx: 96, ty: 50, tz: 96, yaw: 0.9, pitch: 0.42, dist: 34 };
      this.oCur = { ...this.oGoal };
      // 飛行
      this.fGoal = { px: 96, py: 54, pz: 96, yaw: 0.9, pitch: 0.15 };
      this.fCur = { ...this.fGoal };
      this.keys = {};
      this.autoPaused = 0;
      this.locked = false;

      this._bind();
      this.reset();
    }

    reset() {
      const W = WORLD();
      const h = Math.max(W.SEA + 8, W.spawnHeight(96, 96) + 6);
      this.oGoal.tx = 96; this.oGoal.ty = h; this.oGoal.tz = 96;
      this.oGoal.yaw = 0.9; this.oGoal.pitch = 0.42; this.oGoal.dist = 34;
      this.fGoal.px = 96; this.fGoal.py = h + 6; this.fGoal.pz = 96;
      this.fGoal.yaw = 0.9; this.fGoal.pitch = 0.12;
    }

    setMode(m) {
      if (m === this.mode) return;
      if (m === 'fly') {
        const eye = this.eyePos();
        this.fGoal.px = eye[0]; this.fGoal.py = eye[1]; this.fGoal.pz = eye[2];
        this.fGoal.yaw = this.oGoal.yaw; this.fGoal.pitch = this.oGoal.pitch;
        this.fCur = { ...this.fGoal };
      } else {
        // 旋回に戻す: 現在地形中心へ
        const eye = this.eyePos();
        this.oGoal.tx = eye[0]; this.oGoal.tz = eye[2];
        this.oGoal.ty = Math.max(WORLD().SEA + 4, WORLD().spawnHeight(eye[0] | 0, eye[2] | 0) + 4);
        this.oGoal.dist = 34;
        this.oCur = { ...this.oGoal };
      }
      this.mode = m;
      if (m !== 'fly' && document.pointerLockElement) document.exitPointerLock();
    }

    eyePos() {
      if (this.mode === 'orbit') {
        const o = this.oCur;
        const cp = Math.cos(o.pitch);
        return [o.tx + Math.cos(o.yaw) * cp * o.dist, o.ty + Math.sin(o.pitch) * o.dist, o.tz + Math.sin(o.yaw) * cp * o.dist];
      }
      return [this.fCur.px, this.fCur.py, this.fCur.pz];
    }

    eyeGoal() {
      if (this.mode === 'orbit') {
        const o = this.oGoal;
        const cp = Math.cos(o.pitch);
        return [o.tx + Math.cos(o.yaw) * cp * o.dist, o.ty + Math.sin(o.pitch) * o.dist, o.tz + Math.sin(o.yaw) * cp * o.dist];
      }
      return [this.fGoal.px, this.fGoal.py, this.fGoal.pz];
    }

    dirVec(yaw, pitch) {
      const cp = Math.cos(pitch);
      return [Math.cos(yaw) * cp, Math.sin(pitch), Math.sin(yaw) * cp];
    }

    update(dt) {
      const k = 1 - Math.exp(-dt * 11);
      const clampW = (v, yMin, yMax) => {
        const W = WORLD();
        v[0] = Math.max(6, Math.min(W.WX - 6, v[0]));
        v[2] = Math.max(6, Math.min(W.WZ - 6, v[2]));
        v[1] = Math.max(yMin, Math.min(92, v[1]));
        return v;
      };

      if (this.mode === 'orbit') {
        // 自動旋回
        if (this.autoOrbit && performance.now() > this.autoPaused) this.oGoal.yaw += dt * 0.05;
        // WASD でターゲット移動
        const sp = dt * 14;
        const fw = [Math.cos(this.oGoal.yaw), 0, Math.sin(this.oGoal.yaw)];
        const rt = [-fw[2], 0, fw[0]];
        let moved = false;
        if (this.keys['KeyW']) { this.oGoal.tx += fw[0] * sp; this.oGoal.tz += fw[2] * sp; moved = true; }
        if (this.keys['KeyS']) { this.oGoal.tx -= fw[0] * sp; this.oGoal.tz -= fw[2] * sp; moved = true; }
        if (this.keys['KeyA']) { this.oGoal.tx -= rt[0] * sp; this.oGoal.tz -= rt[2] * sp; moved = true; }
        if (this.keys['KeyD']) { this.oGoal.tx += rt[0] * sp; this.oGoal.tz += rt[2] * sp; moved = true; }
        if (this.keys['Space']) { this.oGoal.ty += sp; moved = true; }
        if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) { this.oGoal.ty -= sp; moved = true; }
        const t = clampW([this.oGoal.tx, this.oGoal.ty, this.oGoal.tz], 3, 92);
        this.oGoal.tx = t[0]; this.oGoal.ty = t[1]; this.oGoal.tz = t[2];
        if (moved) this.autoPaused = performance.now() + 4000;
        // 減衰追従
        for (const key of ['tx', 'ty', 'tz', 'yaw', 'pitch', 'dist']) {
          this.oCur[key] += (this.oGoal[key] - this.oCur[key]) * k;
        }
      } else {
        const sp = dt * this.speed * (this.keys['ShiftLeft'] ? 2.5 : 1);
        const d = this.dirVec(this.fGoal.yaw, this.fGoal.pitch);
        const rt = [-Math.sin(this.fGoal.yaw), 0, Math.cos(this.fGoal.yaw)];
        if (this.keys['KeyW']) { this.fGoal.px += d[0] * sp; this.fGoal.py += d[1] * sp; this.fGoal.pz += d[2] * sp; }
        if (this.keys['KeyS']) { this.fGoal.px -= d[0] * sp; this.fGoal.py -= d[1] * sp; this.fGoal.pz -= d[2] * sp; }
        if (this.keys['KeyA']) { this.fGoal.px -= rt[0] * sp; this.fGoal.pz -= rt[2] * sp; }
        if (this.keys['KeyD']) { this.fGoal.px += rt[0] * sp; this.fGoal.pz += rt[2] * sp; }
        if (this.keys['Space']) this.fGoal.py += sp;
        if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) this.fGoal.py -= sp;
        const t = clampW([this.fGoal.px, this.fGoal.py, this.fGoal.pz], 2, 92);
        this.fGoal.px = t[0]; this.fGoal.py = t[1]; this.fGoal.pz = t[2];
        for (const key of ['px', 'py', 'pz', 'yaw', 'pitch']) {
          this.fCur[key] += (this.fGoal[key] - this.fCur[key]) * k;
        }
      }
    }

    computeView() {
      const eye = this.eyePos();
      let center, up = [0, 1, 0];
      if (this.mode === 'orbit') {
        const o = this.oCur;
        center = [o.tx, o.ty, o.tz];
      } else {
        const d = this.dirVec(this.fCur.yaw, this.fCur.pitch);
        center = [eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]];
      }
      return { view: SL.mat4.lookAt(eye, center, up), eye };
    }

    computeProj(aspect) {
      return SL.mat4.perspective(FOV, aspect, NEAR, FAR);
    }

    // ---------- 入力 ----------
    _bind() {
      const cv = this.canvas;
      const pointers = new Map();
      let pinchDist = 0, panStart = null;

      cv.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button, type: e.pointerType });
        this.autoPaused = performance.now() + 6000;
        cv.setPointerCapture(e.pointerId);
        if (this.mode === 'fly' && e.pointerType === 'mouse' && !this.locked && e.button === 0) {
          cv.requestPointerLock && cv.requestPointerLock();
        }
        if (pointers.size === 2) {
          const pts = [...pointers.values()];
          pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        }
      });

      cv.addEventListener('pointermove', (e) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;

        if (this.locked && this.mode === 'fly') return; // pointerlock は mousemove で処理

        if (pointers.size === 1) {
          this._rotate(dx, dy);
        } else if (pointers.size === 2) {
          const pts = [...pointers.values()];
          const nd = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (this.mode === 'orbit') {
            this.oGoal.dist = Math.max(5, Math.min(170, this.oGoal.dist * (pinchDist / (nd || 1))));
          } else {
            this.speed = Math.max(2, Math.min(60, this.speed * (pinchDist / (nd || 1))));
          }
          pinchDist = nd;
        }
      });

      const up = (e) => { pointers.delete(e.pointerId); };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);

      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.autoPaused = performance.now() + 6000;
        const f = Math.exp(e.deltaY * 0.0012);
        if (this.mode === 'orbit') this.oGoal.dist = Math.max(5, Math.min(170, this.oGoal.dist * f));
        else this.speed = Math.max(2, Math.min(60, this.speed * f));
      }, { passive: false });

      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === cv;
        this.onLockChange && this.onLockChange(this.locked);
      });

      document.addEventListener('mousemove', (e) => {
        if (this.locked && this.mode === 'fly') {
          this._rotate(e.movementX * 1.0, e.movementY * 1.0);
        }
      });

      cv.addEventListener('contextmenu', (e) => e.preventDefault());

      window.addEventListener('keydown', (e) => {
        this.keys[e.code] = true;
        if (e.code === 'Tab') { e.preventDefault(); SL.UI && SL.UI.togglePanel(); }
        if (e.code === 'KeyF') this.setMode(this.mode === 'orbit' ? 'fly' : 'orbit');
        if (e.code === 'KeyR') this.reset();
        if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Tab', 'KeyF'].includes(e.code) && e.target === document.body) e.preventDefault();
      });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; });
    }

    _rotate(dx, dy) {
      const sens = 0.0042;
      if (this.mode === 'orbit') {
        const g = this.oGoal;
        g.yaw += dx * sens;
        g.pitch = Math.max(-0.12, Math.min(1.45, g.pitch + dy * sens));
      } else {
        const g = this.fGoal;
        g.yaw += dx * sens;
        g.pitch = Math.max(-1.5, Math.min(1.5, g.pitch + dy * sens));
      }
      this.autoPaused = performance.now() + 6000;
    }
  }

  SL.Camera = Camera;
  SL.CAMERA_FOV = FOV;
})();
