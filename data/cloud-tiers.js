'use strict';
// =====================================================================
//  data/cloud-tiers.js — Cấu hình tầng mây (layout dọc)
//  Mỗi tầng = 1 đám mây lớn cố định với 10 chậu cây
//  Đám mây đặt ở góc phải (bên trái = cây đậu thần)
// =====================================================================

/**
 * TIER_HEIGHT: khoảng cách giữa các tầng (world pixels)
 * Tier 0 = tầng thấp nhất (ground), tier 4 = cao nhất
 *
 * Mỗi tier:
 *   yWorld  : Y trong world (0 = tier 0, tăng dần lên cao)
 *   slots   : số chậu (luôn 10)
 *   label   : tên tầng
 *   branchX : X của đầu cành từ thân cây → đám mây
 *   color   : màu chủ đạo của tầng (cho đám mây và giao diện)
 */
const TIER_HEIGHT = 700;  // world pixels giữa các tầng

const CLOUD_TIERS = [
  {
    yWorld: 0,
    slots:  10,
    label:  'Đất Bằng',
    branchAngle: 0,
    cloudColor: ['rgba(245,242,255,0.97)', 'rgba(200,230,255,0.92)'],
    accentColor: '#c8b4ff',
  },
  {
    yWorld: TIER_HEIGHT,
    slots:  10,
    label:  'Tầng Thứ Nhất',
    branchAngle: 15,
    cloudColor: ['rgba(255,245,255,0.97)', 'rgba(220,200,255,0.92)'],
    accentColor: '#d4a8ff',
  },
  {
    yWorld: TIER_HEIGHT * 2,
    slots:  10,
    label:  'Tầng Thứ Hai',
    branchAngle: 25,
    cloudColor: ['rgba(250,240,255,0.97)', 'rgba(240,215,255,0.92)'],
    accentColor: '#e0a0ff',
  },
  {
    yWorld: TIER_HEIGHT * 3,
    slots:  10,
    label:  'Tầng Thứ Ba',
    branchAngle: 10,
    cloudColor: ['rgba(255,248,255,0.97)', 'rgba(255,230,255,0.92)'],
    accentColor: '#ffb8ff',
  },
  {
    yWorld: TIER_HEIGHT * 4,
    slots:  10,
    label:  'Thiên Đường',
    branchAngle: 20,
    cloudColor: ['rgba(255,255,255,0.99)', 'rgba(255,245,255,0.96)'],
    accentColor: '#ffd700',
  },
];
