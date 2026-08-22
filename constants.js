'use strict';
// =====================================================================
//  constants.js — Khu Vườn Trên Mây — hằng số cấu hình
//  Dữ liệu game (cây, phân, chậu, tầng mây) đã chuyển vào data/
// =====================================================================

// ── LocalStorage keys (multi-user schema) ────────────────────────────
const LS_USERS          = 'kvtm_users';
const LS_CURRENT        = 'kvtm_current';
const LS_SAVE           = (name) => `kvtm_save_${name}`;
const LS_LEGACY_PLAYER  = 'kvtm_player';
const LS_LEGACY_SAVE    = 'kvtm_save';
const LS_PLANT_CONFIG   = 'kvtm_plant_config';
const LS_POT_CONFIG     = 'kvtm_pot_config';
const LS_FERT_CONFIG    = 'kvtm_fert_config';
const LS_LADDER_CONFIG  = 'kvtm_ladder_config';
const LS_GAME_CONFIG    = 'kvtm_game_config';

// ── Validation ───────────────────────────────────────────────────────
const NAME_MIN = 2;
const NAME_MAX = 20;

// ── Level / Tier system (Bậc thang lũy tiến) ──────────────────────────
const XP_BASE         = 100; // Điểm cần cho cấp 1
const XP_GROWTH       = 50;  // Điểm tăng thêm mỗi cấp tiếp theo (Lv2 cần 150, Lv3 cần 200...)
const LEVELS_PER_TIER = 10;  // Số level để mở 1 tầng mây mới

// ── Core game config ─────────────────────────────────────────────────
const CFG = {
  CELL_W:    88,    // pixel width of one plot slot
  CELL_H:    86,    // pixel height of one plot slot
  GROW_TICK: 60,    // frames per growth tick
  WATER_MULT: 2,    // water speed multiplier
  RAIN_INT:  1800,  // frames between rain events
  SUN_INT:    900,  // frames between sun events
  BONUS_INT: 3600,  // frames between coin bonus events
  POT_W: 52,
  POT_H: 38,
};
