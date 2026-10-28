// uniforms.js — OptiFine/Iris 標準 uniform 値の供給テーブル
(function () {
  'use strict';
  window.SL = window.SL || {};
  const SL = window.SL;

  // ctx: フレーム毎に pipeline が構築する値
  function buildUniformTable() {
    const f1 = (v) => [v];
    return {
      // 時間
      worldTime: (c) => f1(c.worldTime),
      worldDay: (c) => [c.worldDay],
      frameTimeCounter: (c) => f1(c.frameTimeCounter),
      frameCounter: (c) => [c.frameCounter],
      sunAngle: (c) => f1(c.sunAngle),
      moonPhase: () => [0],

      // 天候
      rainStrength: (c) => f1(c.rainStrength),
      wetness: (c) => f1(c.wetness),
      SL_lightningFlash: (c) => f1(c.lightningFlash),

      // 視点
      cameraPosition: (c) => c.eye,
      previousCameraPosition: (c) => c.prevEye,
      eyeAltitude: (c) => f1(c.eye[1]),
      isEyeInWater: (c) => [c.isEyeInWater],
      screenBrightness: () => f1(1.0),
      nightVision: () => f1(0.0),
      blindness: () => f1(0.0),
      darknessFactor: () => f1(0.0),

      // 行列
      gbufferModelView: (c) => c.view,
      gbufferModelViewInverse: (c) => c.viewInv,
      gbufferProjection: (c) => c.proj,
      gbufferProjectionInverse: (c) => c.projInv,
      gbufferPreviousModelView: (c) => c.prevView,
      gbufferPreviousProjection: (c) => c.prevProj,
      shadowModelView: (c) => c.shadowView,
      shadowModelViewInverse: (c) => c.shadowViewInv,
      shadowProjection: (c) => c.shadowProj,
      shadowProjectionInverse: (c) => c.shadowProjInv,

      // 光源方向 (視点空間, 長さ100)
      sunPosition: (c) => c.sunPosView,
      moonPosition: (c) => c.moonPosView,
      shadowLightPosition: (c) => c.shadowLightPosView,
      upPosition: (c) => c.upPosView,

      // 画面
      viewWidth: (c) => f1(c.width),
      viewHeight: (c) => f1(c.height),
      aspectRatio: (c) => f1(c.width / c.height),
      near: (c) => f1(0.15),
      far: (c) => f1(480.0),
      texelSize: (c) => [1 / c.width, 1 / c.height],

      // 色
      fogColor: (c) => c.fogColor,
      skyColor: (c) => c.skyColor,

      // 追加エンジン uniform
      SL_shadowRes: (c) => f1(c.shadowRes),

      // ---- GLSL 120 互換 uniform (変換器が gl_* を SL_* に置換する) ----
      SL_ModelViewMatrix: (c) => c.compatMV,
      SL_ProjectionMatrix: (c) => c.compatProj,
      SL_ModelViewMatrixInverse: (c) => c.compatMVinv,
      SL_ProjectionMatrixInverse: (c) => c.compatProjInv,
      SL_NormalMatrix: (c) => c.compatNormalMat,

      // 旧名称エイリアス
      gcolor: (c) => ({ sampler: 'colortex0' }),
      gdepth: (c) => ({ sampler: 'colortex1' }),
      gnormal: (c) => ({ sampler: 'colortex2' }),
      gdata: (c) => ({ sampler: 'colortex3' })
    };
  }

  // sampler 系 uniform → テクスチャ解決（ctx を参照）
  function buildSamplerTable() {
    const t = {};
    const ctex = (i) => (c) => c.curColortex[i];
    for (let i = 0; i < 8; i++) t['colortex' + i] = ctex(i);
    t.gaux1 = ctex(4); t.gaux2 = ctex(5); t.gaux3 = ctex(6); t.gaux4 = ctex(7);
    t.gcolor = ctex(0); t.gdepth = ctex(1); t.gnormal = ctex(2); t.gdata = ctex(3);
    t.depthtex0 = (c) => c.depth0;
    t.depthtex1 = (c) => c.depth1;
    t.depthtex2 = (c) => c.depth1;
    t.shadowtex0 = (c) => c.shadowTex0;
    t.shadowtex1 = (c) => c.shadowTex1;
    t.shadowtex0HW = (c) => c.shadowHW0;
    t.shadowtex1HW = (c) => c.shadowHW1;
    t.shadowcolor0 = (c) => c.shadowColor0;
    t.shadowcolor1 = (c) => c.shadowColor1;
    t.gshadow = (c) => c.shadowColor0;
    t.noisetex = (c) => c.noisetex;
    t.gtexture = (c) => c.atlas;
    t.texture = (c) => c.atlas;
    t.lightmap = (c) => c.lightmap;
    return t;
  }

  SL.buildUniformTable = buildUniformTable;
  SL.buildSamplerTable = buildSamplerTable;
})();
