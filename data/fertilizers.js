'use strict';
// =====================================================================
//  data/fertilizers.js — Các loại phân bón
// =====================================================================

/**
 * growMult   : Hệ số tăng tốc sinh trưởng
 * rewardBonus: Phần thưởng thêm (0 = không, 1 = nhân đôi)
 * skipStage  : Bỏ qua 1 giai đoạn ngay khi bón
 * color      : Màu hiệu ứng particle
 */
const FERTILIZERS = {
  basic: {
    name: 'Phân Cơ Bản',   icon: '✨', cost: 8,
    growMult: 3,  rewardBonus: 0,   skipStage: false,
    color: '#e0a0ff',
    desc: 'Tăng tốc sinh trưởng 3×',
    rarity: 'common',
  },
  quick: {
    name: 'Phân Thần Tốc',  icon: '⚡', cost: 18,
    growMult: 6,  rewardBonus: 0,   skipStage: false,
    color: '#ffe566',
    desc: 'Tăng tốc sinh trưởng 6×',
    rarity: 'uncommon',
  },
  lunar: {
    name: 'Phân Ánh Trăng', icon: '🌙', cost: 22,
    growMult: 2,  rewardBonus: 1.0, skipStage: false,
    color: '#b0c8ff',
    desc: 'Tốc độ 2×, nhân đôi phần thưởng',
    rarity: 'uncommon',
  },
  stardust: {
    name: 'Phân Bụi Sao',   icon: '💫', cost: 30,
    growMult: 4,  rewardBonus: 0,   skipStage: true,
    color: '#fde68a',
    desc: 'Tốc độ 4×, bỏ qua 1 giai đoạn',
    rarity: 'rare',
  },
  super: {
    name: 'Phân Siêu Cấp',  icon: '🚀', cost: 40,
    growMult: 10, rewardBonus: 0,   skipStage: false,
    color: '#ff8080',
    desc: 'Tăng tốc sinh trưởng 10×',
    rarity: 'rare',
  },
  crystal: {
    name: 'Phân Pha Lê',    icon: '🔮', cost: 60,
    growMult: 8,  rewardBonus: 2.0, skipStage: true,
    color: '#c084fc',
    desc: 'Tốc độ 8×, thưởng ×3, bỏ qua giai đoạn',
    rarity: 'epic',
  },
};
