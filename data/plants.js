'use strict';
// =====================================================================
//  data/plants.js — Định nghĩa các loại cây (20 Cây Trồng Cân Bằng)
// =====================================================================
const PLANTS = {
  // ── NHÓM CÂY CƠ BẢN (Level 1+) ─────────────────────────────────────
  cactus:     { name:'Xương Rồng',  icon:'🌵', stages:['🌱','🌱','🌿','🌵'], grow:80,  reward:{coins:10,score:18}, cost:4,  color:'#5dbf4e', desc:'Ít cần nước, bền bỉ',         rarity:'common'  },
  tulip:      { name:'Hoa Tulip',   icon:'🌷', stages:['🌱','🌿','🌼','🌷'], grow:95,  reward:{coins:12,score:24}, cost:5,  color:'#ff8fa3', desc:'Mềm mại thanh lịch',          rarity:'common'  },
  rose:       { name:'Hoa Hồng',    icon:'🌹', stages:['🌱','🌿','🌸','🌹'], grow:110, reward:{coins:15,score:30}, cost:5,  color:'#ff6eb4', desc:'Hoa đẹp nhất vườn',         rarity:'common'  },
  strawberry: { name:'Dâu Tây',     icon:'🍓', stages:['🌱','🌿','🌸','🍓'], grow:115, reward:{coins:16,score:32}, cost:6,  color:'#ff4757', desc:'Quả đỏ mọng ngọt ngào',       rarity:'common'  },
  sunflower:  { name:'Hướng Dương', icon:'🌻', stages:['🌱','🌿','🌼','🌻'], grow:130, reward:{coins:18,score:36}, cost:7,  color:'#ffe566', desc:'Luôn hướng về mặt trời',     rarity:'common'  },
  tomato:     { name:'Cà Chua Bi',  icon:'🍅', stages:['🌱','🌿','🌼','🍅'], grow:125, reward:{coins:17,score:34}, cost:6,  color:'#ff6348', desc:'Chùm quả tròn mọng tươi ngon',rarity:'common'  },
  daisy:      { name:'Hoa Cúc Vàng',icon:'🌼', stages:['🌱','🌿','🌼','🌼'], grow:120, reward:{coins:16,score:33}, cost:6,  color:'#ffd32a', desc:'Hương thơm thanh mát dịu dàng',rarity:'common'  },

  // ── NHÓM CÂY KHÁ (Level 4+) ────────────────────────────────────────
  mushroom:   { name:'Nấm Phép',    icon:'🍄', stages:['🌱','🌿','🍄','🍄'], grow:90,  reward:{coins:18,score:35}, cost:6,  color:'#e08080', desc:'Bí ẩn nở về đêm',             rarity:'uncommon'},
  lavender:   { name:'Oải Hương',   icon:'🪻', stages:['🌱','🌿','🌸','🪻'], grow:140, reward:{coins:22,score:45}, cost:8,  color:'#a55eea', desc:'Sắc tím thảo nguyên thơ mộng',rarity:'uncommon'},
  clover:     { name:'Cỏ 4 Lá',     icon:'🍀', stages:['🌱','🌿','🍀','🍀'], grow:145, reward:{coins:24,score:50}, cost:9,  color:'#2ed573', desc:'Mang lại may mắn ngập tràn',  rarity:'uncommon'},
  bamboo:     { name:'Trúc Mây',    icon:'🎋', stages:['🌱','🎍','🎋','🎋'], grow:150, reward:{coins:26,score:52}, cost:9,  color:'#4db85c', desc:'Vươn cao tận trời xanh',       rarity:'uncommon'},
  carnation:  { name:'Cẩm Chướng',  icon:'🌺', stages:['🌱','🌿','🌸','🌺'], grow:165, reward:{coins:30,score:60}, cost:11, color:'#ff4081', desc:'Cánh hoa rực rỡ đằm thắm',   rarity:'uncommon'},

  // ── NHÓM CÂY QUÝ HIẾM (Level 7+) ───────────────────────────────────
  cherry:     { name:'Hoa Anh Đào', icon:'🌸', stages:['🌱','🌿','🌸','🌸'], grow:180, reward:{coins:35,score:70}, cost:12, color:'#ffb3c6', desc:'Cực hiếm, cực đẹp',           rarity:'rare'    },
  lotus:      { name:'Sen Vàng',    icon:'🪷', stages:['🌱','🌿','🌺','🪷'], grow:195, reward:{coins:40,score:80}, cost:15, color:'#d4a0f0', desc:'Linh thiêng quý hiếm',          rarity:'rare'    },
  apple:      { name:'Táo Thần',    icon:'🍎', stages:['🌱','🌿','🌸','🍎'], grow:210, reward:{coins:45,score:90}, cost:16, color:'#ee5253', desc:'Quả ngọt tỏa ánh kim thần tiên',rarity:'rare' },
  peach:      { name:'Đào Tiên',    icon:'🍑', stages:['🌱','🌿','🌸','🍑'], grow:230, reward:{coins:50,score:100},cost:18, color:'#ffa8a8', desc:'Đào tiên ngàn năm trường thọ',  rarity:'rare'    },

  // ── NHÓM SỬ THI & HUYỀN THOẠI (Level 15+) ──────────────────────────
  orchid:     { name:'Lan Tiên',    icon:'💐', stages:['🌱','🌿','🌷','💐'], grow:240, reward:{coins:60,score:120},cost:20, color:'#c084fc', desc:'Hoa tiên nở một lần',          rarity:'epic'    },
  watermelon: { name:'Dưa Thiên Đường',icon:'🍉',stages:['🌱','🌿','🍈','🍉'],grow:260,reward:{coins:70,score:140},cost:24,color:'#26de81', desc:'Mát lành mọng nước trên mây',  rarity:'epic'    },
  frost_flower:{ name:'Hoa Băng Tinh',icon:'💠',stages:['🌱','❄️','💎','💠'],grow:280,reward:{coins:85,score:170},cost:28,color:'#70a1ff', desc:'Tinh thể băng vĩnh cửu lung linh',rarity:'epic' },
  starflower: { name:'Hoa Sao',     icon:'⭐',  stages:['🌱','✨','🌟','⭐'],  grow:300, reward:{coins:100,score:200},cost:30,color:'#fde68a', desc:'Kỳ diệu, chỉ nở lúc nửa đêm', rarity:'legendary'},
};

/** Màu rarity để hiển thị badge */
const RARITY_COLOR = {
  common:    { bg:'rgba(100,100,120,0.3)', text:'#aaa',   label:'Thường'   },
  uncommon:  { bg:'rgba(60,200,80,0.2)',   text:'#4db85c', label:'Hiếm'    },
  rare:      { bg:'rgba(80,140,255,0.2)',  text:'#60b8ff', label:'Quý'     },
  epic:      { bg:'rgba(180,80,255,0.2)', text:'#c084fc', label:'Sử Thi'  },
  legendary: { bg:'rgba(255,200,0,0.2)',  text:'#fde68a', label:'Huyền Thoại'},
};
