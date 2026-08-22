'use strict';
// =====================================================================
//  game.js — Khu Vườn Trên Mây
//  Requires: constants.js, data/plants.js, data/fertilizers.js,
//            data/pot-grades.js, data/cloud-tiers.js
// =====================================================================

// ── GLOBAL STATE ──────────────────────────────────────────────────────
let playerName = '';
let G          = {};
let canvas, ctx;
let animFrame;
let frameCount = 0;
let particles  = [], floatingTexts = [], clouds = [];
let bgStarsData = null;
let currentTool = 'plant';
let selectedPlantType = null;
let selectedFertType  = null;
let shopOpen    = false;
let mouse       = { x:0, y:0 };
let cursor      = { x:-200, y:-200 };
let bgImage     = null;
let activeTier  = 0;

// ── CAMERA / WORLD STATE ─────────────────────────────────────────────
let cameraY        = 0;    // current camera offset (px, 0=ground, + = scrolled up)
let targetCameraY  = 0;    // smooth lerp target
let currentViewTier= 0;    // which tier is currently in view

// Popup state
let popupPlot = null;
let popupSW   = null;

// ── COMPACT NUMBER FORMATTER (K, M, B, T) ─────────────────────────────
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  const n = Math.abs(Number(num));
  const sign = num < 0 ? '-' : '';
  if (n < 1000) return sign + n.toLocaleString('vi-VN');
  if (n < 1000000) {
    const v = (n / 1000).toFixed(n % 1000 === 0 ? 0 : (n < 10000 ? 1 : 0));
    return sign + v.replace(/\.0+$/, '') + 'K';
  }
  if (n < 1000000000) {
    const v = (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 2);
    return sign + v.replace(/\.0+$/, '').replace(/(\.[1-9])0$/, '$1') + 'M';
  }
  if (n < 1000000000000) {
    const v = (n / 1000000000).toFixed(2);
    return sign + v.replace(/\.0+$/, '').replace(/(\.[1-9])0$/, '$1') + 'B';
  }
  const v = (n / 1000000000000).toFixed(2);
  return sign + v.replace(/\.0+$/, '') + 'T';
}

// ── LEVEL HELPERS (BẬC THANG LŨY TIẾN) ────────────────────────────────
function getLevelConfig() {
  const base   = window._XP_BASE_OVERRIDE   ?? (typeof XP_BASE   !== 'undefined' ? XP_BASE   : 100);
  const growth = window._XP_GROWTH_OVERRIDE ?? (typeof XP_GROWTH !== 'undefined' ? XP_GROWTH : 50);
  return { base, growth };
}

/** Tổng điểm tích lũy cần thiết để đạt cấp độ `level` */
function scoreRequiredForLevel(level) {
  if (level <= 0) return 0;
  const { base, growth } = getLevelConfig();
  return level * base + ((level * (level - 1)) / 2) * growth;
}

/** Tính cấp độ hiện tại dựa trên tổng điểm tích lũy */
function calcLevel(score) {
  if (!score || score <= 0) return 0;
  const { base, growth } = getLevelConfig();
  if (growth <= 0) return Math.floor(score / Math.max(1, base));
  // Giải phương trình bậc 2: (growth/2)*L^2 + (base - growth/2)*L - score = 0
  const a = growth / 2;
  const b = base - growth / 2;
  const discriminant = b * b + 4 * a * score;
  const level = Math.floor((-b + Math.sqrt(discriminant)) / (2 * a));
  return Math.max(0, level);
}

/** Trả về thông tin chi tiết tiến độ cấp độ hiện tại để vẽ thanh XP */
function getLevelProgress(score) {
  const level = calcLevel(score);
  const curScore = scoreRequiredForLevel(level);
  const nxtScore = scoreRequiredForLevel(level + 1);
  const xpInLevel = Math.max(0, (score || 0) - curScore);
  const xpNeeded  = Math.max(1, nxtScore - curScore);
  const pct = Math.min(100, Math.max(0, Math.floor((xpInLevel / xpNeeded) * 100)));
  const xpToNext = Math.max(0, nxtScore - (score || 0));
  return { level, curScore, nxtScore, xpInLevel, xpNeeded, xpToNext, pct };
}

function calcTier(level) {
  const lpt = window._LEVELS_PER_TIER_OVERRIDE ?? (typeof LEVELS_PER_TIER !== 'undefined' ? LEVELS_PER_TIER : 10);
  return Math.min(Math.floor(level / lpt), CLOUD_TIERS.length - 1);
}

// ── GROWTH / REWARD HELPERS ───────────────────────────────────────────
function getGrowNeeded(plant, plot) {
  const def     = PLANTS[plant.type];
  const fert    = plant.fertilizerId ? FERTILIZERS[plant.fertilizerId] : null;
  const fertM   = fert ? (fert.growMult || 1) : 1;
  const grade   = POT_GRADES[plot.grade || 0] || POT_GRADES[0];
  const potM    = 1 + (grade.growBonus || 0);
  const waterM  = plant.watered ? CFG.WATER_MULT : 1;
  return Math.max(1, Math.ceil(def.grow / fertM / potM / waterM));
}

function getHarvestReward(plant, plot) {
  const def   = PLANTS[plant.type];
  const fert  = plant.fertilizerId ? FERTILIZERS[plant.fertilizerId] : null;
  const fertR = fert ? (1 + (fert.rewardBonus || 0)) : 1;
  const grade = POT_GRADES[plot.grade || 0] || POT_GRADES[0];
  const potM  = grade.rewardMult || 1;
  return {
    coins: Math.round(def.reward.coins * potM * fertR),
    score: Math.round(def.reward.score * potM * fertR),
  };
}

// ── RESET ─────────────────────────────────────────────────────────────
function resetGameState() {
  const gc = window._GAME_CONFIG || {};
  const startCoins = gc.START_COINS ?? 50;
  const startWater = gc.START_WATER ?? 20;
  const startSun   = gc.START_SUN   ?? 10;
  G = { coins: startCoins, water: startWater, sun: startSun, score: 0, totalPlants: 0, plots: [], claimedMilestones: [], running: false };
  particles = []; floatingTexts = []; frameCount = 0;
  activeTier = 0;
}

// ── LOCAL STORAGE — MULTI-USER ────────────────────────────────────────
function getAllUsers() {
  try { return JSON.parse(localStorage.getItem(LS_USERS) || '[]'); } catch { return []; }
}
function setAllUsers(users) { localStorage.setItem(LS_USERS, JSON.stringify(users)); }

function getOrCreateUser(name) {
  const users = getAllUsers();
  let user = users.find(u => u.name === name);
  if (!user) {
    user = { name, createdAt: Date.now(), lastLogin: Date.now() };
    users.push(user);
  } else {
    user.lastLogin = Date.now();
  }
  setAllUsers(users);
  return user;
}

function loadCurrentUserName() {
  const legacy = localStorage.getItem(LS_LEGACY_PLAYER);
  if (legacy && !localStorage.getItem(LS_CURRENT)) migrateFromLegacy(legacy);
  return localStorage.getItem(LS_CURRENT) || '';
}

function migrateFromLegacy(name) {
  const legacySave = localStorage.getItem(LS_LEGACY_SAVE);
  if (name) {
    getOrCreateUser(name);
    localStorage.setItem(LS_CURRENT, name);
    if (legacySave) { localStorage.setItem(LS_SAVE(name), legacySave); localStorage.removeItem(LS_LEGACY_SAVE); }
    localStorage.removeItem(LS_LEGACY_PLAYER);
  }
}

function setCurrentUser(name) { getOrCreateUser(name); localStorage.setItem(LS_CURRENT, name); }
function clearCurrentUser()   { localStorage.removeItem(LS_CURRENT); }

function saveGame() {
  if (!playerName) return;
  const plotData = G.plots.map(p => ({
    cloudIdx: p.cloudIdx, slot: p.slot, grade: p.grade || 0,
    plant: p.plant ? { ...p.plant } : null,
  }));
  const save = {
    coins: G.coins, water: G.water, sun: G.sun,
    score: G.score, totalPlants: G.totalPlants,
    activeTier, cameraY, plots: plotData,
    claimedMilestones: G.claimedMilestones || [],
    savedAt: Date.now(),
  };
  // saveSync = write localStorage immediately + fire-and-forget file write
  Storage.saveSync(LS_SAVE(playerName), save);
  // Update user profile stats
  const users = getAllUsers();
  const u = users.find(x => x.name === playerName);
  if (u) { u.score = G.score; u.level = calcLevel(G.score); u.totalPlants = G.totalPlants; setAllUsers(users); }
  showSaveIndicator();
}

function loadSave() {
  if (!playerName) return false;
  // loadSync reads from localStorage (mirrored from file system)
  const save = Storage.loadSync(LS_SAVE(playerName));
  if (!save) return false;
  try {
    G.coins       = save.coins       ?? 50;
    G.water       = save.water       ?? 20;
    G.sun         = save.sun         ?? 10;
    G.score       = save.score       ?? 0;
    G.totalPlants = save.totalPlants ?? 0;
    activeTier    = save.activeTier  ?? 0;
    cameraY       = save.cameraY     ?? 0;
    targetCameraY = cameraY;
    currentViewTier = Math.round(cameraY / TIER_HEIGHT);
    G.claimedMilestones = Array.isArray(save.claimedMilestones) ? save.claimedMilestones : [];
    buildCloudsForTier(activeTier);
    if (save.plots) {
      save.plots.forEach(sp => {
        const p = G.plots.find(gp => gp.cloudIdx === sp.cloudIdx && gp.slot === sp.slot);
        if (!p) return;
        p.grade = sp.grade ?? 0;
        if (sp.plant) {
          const plant = { ...sp.plant };
          if (plant.fertilized === true && !plant.fertilizerId) plant.fertilizerId = 'basic';
          delete plant.fertilized;
          p.plant = plant;
        }
      });
    }
    return true;
  } catch { return false; }
}

function clearSave() { if (playerName) localStorage.removeItem(LS_SAVE(playerName)); }

function showSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  el.classList.add('show');
  clearTimeout(showSaveIndicator._t);
  showSaveIndicator._t = setTimeout(() => el.classList.remove('show'), 2000);
}

// ── NAME SCREEN ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');
  resizeCanvas();
  loadBgImage();

  window.addEventListener('resize', () => { resizeCanvas(); bgStarsData = null; });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    cursor.x = e.clientX - r.left; cursor.y = e.clientY - r.top;
    mouse.x  = cursor.x;           mouse.y  = cursor.y;
  });
  canvas.addEventListener('click',       onCanvasClick);
  canvas.addEventListener('contextmenu', onCanvasRightClick);
  canvas.addEventListener('mouseleave',  () => { cursor.x = -200; cursor.y = -200; });

  // Scroll wheel: navigate between tiers
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (!G.running || activeTier < 1) return;
    const dir = e.deltaY > 0 ? -1 : 1;  // scroll up → higher tier
    const newTier = Math.max(0, Math.min(activeTier, currentViewTier + dir));
    scrollToTier(newTier);
  }, { passive: false });

  populateShop();
  initNameStars();

  document.getElementById('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitName();
  });

  // Init storage (try File System API, fallback to localStorage)
  await Storage.init(false);  // false = don't prompt yet (wait until startGame)

  const saved = loadCurrentUserName();
  if (saved) { playerName = saved; showTitleScreen(); }
  else        document.getElementById('nameScreen').classList.remove('hidden');
});

function scrollToTier(tier) {
  currentViewTier = tier;
  targetCameraY   = tier * TIER_HEIGHT;
}

function initNameStars() {
  const sc = document.getElementById('nameBgCanvas');
  sc.width = window.innerWidth; sc.height = window.innerHeight;
  const sctx = sc.getContext('2d'), s = [];
  for (let i = 0; i < 180; i++)
    s.push({ x:Math.random()*sc.width, y:Math.random()*sc.height, r:Math.random()*2+0.3, a:Math.random(), sp:Math.random()*0.02+0.005 });
  (function loop() {
    sctx.clearRect(0,0,sc.width,sc.height);
    s.forEach(st => { st.a+=st.sp; sctx.beginPath(); sctx.arc(st.x,st.y,st.r,0,Math.PI*2); sctx.fillStyle=`rgba(255,230,255,${0.2+0.7*Math.abs(Math.sin(st.a))})`; sctx.fill(); });
    requestAnimationFrame(loop);
  })();
}

function validateName(name) {
  const t = name.trim();
  if (t.length < NAME_MIN) return `Tên quá ngắn, cần ít nhất ${NAME_MIN} ký tự!`;
  if (t.length > NAME_MAX) return `Tên quá dài, tối đa ${NAME_MAX} ký tự!`;
  if (!/^[\p{L}\p{N}\s_\-.]+$/u.test(t)) return 'Tên chứa ký tự không hợp lệ!';
  return null;
}

function submitName() {
  const input = document.getElementById('nameInput').value;
  const hint  = document.getElementById('nameHint');
  const err   = validateName(input);
  if (err) { hint.textContent=err; hint.className='name-hint error'; document.getElementById('nameInput').focus(); return; }
  playerName = input.trim();
  setCurrentUser(playerName);
  hint.className='name-hint'; hint.textContent='';
  showTitleScreen();
}

function exitGame()   { if (confirm('Bạn có muốn thoát game không?')) window.close(); }

function changeName() {
  document.getElementById('nameInput').value='';
  document.getElementById('nameHint').textContent='Tên từ 2 đến 20 ký tự';
  document.getElementById('nameHint').className='name-hint';
  document.getElementById('nameWelcome').textContent='';
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('nameScreen').classList.remove('hidden');
  setTimeout(()=>document.getElementById('nameInput').focus(),100);
}

function switchUser() {
  if (G.running && (G.score>0||G.totalPlants>0)) saveGame();
  if (animFrame) cancelAnimationFrame(animFrame);
  G.running = false;
  canvas.classList.remove('game-active');
  clearCurrentUser(); playerName='';
  ['hud','toolbar','infoPanel'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('shopPanel').classList.remove('open');
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('nameInput').value='';
  document.getElementById('nameHint').textContent='Nhập tên để đăng nhập hoặc tạo tài khoản mới';
  document.getElementById('nameHint').className='name-hint';
  document.getElementById('nameWelcome').textContent='';
  document.getElementById('nameScreen').classList.remove('hidden');
  setTimeout(()=>document.getElementById('nameInput').focus(),100);
}

// ── TITLE SCREEN ──────────────────────────────────────────────────────
function showTitleScreen() {
  document.getElementById('nameScreen').classList.add('hidden');
  document.getElementById('titleScreen').classList.remove('hidden');
  ['hud','toolbar','infoPanel'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('shopPanel').classList.remove('open');
  shopOpen=false; canvas.classList.remove('game-active');
  const h=new Date().getHours();
  const g=h<5?'Đêm khuya vẫn làm vườn':h<11?'Chào buổi sáng':h<13?'Chào buổi trưa':h<18?'Chào buổi chiều':'Chào buổi tối';
  document.getElementById('titleGreeting').textContent=`${g}, ${playerName}! 🌸`;
  initTitleStars();
}

function initTitleStars() {
  const sc=document.getElementById('starsCanvas');
  sc.width=window.innerWidth; sc.height=window.innerHeight;
  const sctx=sc.getContext('2d'), s=[];
  for (let i=0;i<200;i++) s.push({x:Math.random()*sc.width,y:Math.random()*sc.height,r:Math.random()*2.2+0.4,a:Math.random(),sp:Math.random()*0.02+0.005});
  (function loop() {
    if (document.getElementById('titleScreen').classList.contains('hidden')) return;
    sctx.clearRect(0,0,sc.width,sc.height);
    s.forEach(st=>{st.a+=st.sp;sctx.beginPath();sctx.arc(st.x,st.y,st.r,0,Math.PI*2);sctx.fillStyle=`rgba(255,240,255,${0.3+0.7*Math.abs(Math.sin(st.a))})`;sctx.fill();});
    requestAnimationFrame(loop);
  })();
}

// ── GAME LIFECYCLE ────────────────────────────────────────────────────
function startGame() {
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('hud').style.display='flex';
  document.getElementById('toolbar').style.display='flex';
  document.getElementById('infoPanel').style.display='block';
  document.getElementById('hudPlayer').textContent='👤 '+playerName;
  canvas.classList.add('game-active');
  bgStarsData=null;
  loadPlantConfig();
  loadFertConfig();
  loadPotConfig();
  loadLadderConfig();
  loadGameConfig();
  resetGameState(); G.running=true;
  cameraY = 0; targetCameraY = 0; currentViewTier = 0;
  bgStarsData=null;
  buildCloudsForTier(0);
  // Storage: try to reconnect existing handle silently (no prompt)
  Storage.init(false).catch(() => {});
  const hasSave=loadSave();
  if (hasSave) showToast(`💾 Đã khôi phục tiến trình của ${playerName}!`);
  selectTool('plant');
  if (animFrame) cancelAnimationFrame(animFrame);
  gameLoop(); updateHUD();
}

function restartGame() {
  clearSave();
  document.getElementById('gameOverScreen').classList.add('hidden');
  resetGameState(); G.running=true; bgStarsData=null;
  buildCloudsForTier(0);
  document.getElementById('hud').style.display='flex';
  document.getElementById('toolbar').style.display='flex';
  document.getElementById('infoPanel').style.display='block';
  canvas.classList.add('game-active');
  selectTool('plant');
  if (animFrame) cancelAnimationFrame(animFrame);
  gameLoop(); updateHUD();
}

function showTitle() {
  G.running=false;
  if (G.score>0||G.totalPlants>0) saveGame();
  if (animFrame) cancelAnimationFrame(animFrame);
  canvas.classList.remove('game-active');
  closeAllPopups();
  ['hud','toolbar','infoPanel'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('gameOverScreen').classList.add('hidden');
  showTitleScreen();
}

// ── CANVAS / BG ───────────────────────────────────────────────────────
function resizeCanvas() { canvas.width=window.innerWidth; canvas.height=window.innerHeight; }
function loadBgImage()  { if (bgImage) return; bgImage=new Image(); bgImage.src='bg.jpg'; }

// ── CLOUDS & PLOTS ────────────────────────────────────────────────────
/**
 * Mỗi tier = 1 cloud lớn với 10 slots.
 * Cloud đặt ở phía phải màn hình (bên trái là cây đậu thần).
 * Y-position trong world: tier * TIER_HEIGHT
 */
function buildCloudsForTier(tier) {
  const W = canvas.width, H = canvas.height;
  const existing = G.plots ? [...G.plots] : [];
  clouds = [];
  let cloudId = 0;

  const BEANSTALK_W = 185;   // beanstalk takes left ~185px
  const POTS        = 10;
  const availW      = W - BEANSTALK_W - 30;
  // Clamp cell width so all 10 pots always fit on screen
  const cellW       = Math.min(CFG.CELL_W, Math.floor(availW / POTS));
  const cloudW      = POTS * cellW + 40;
  const cx          = BEANSTALK_W + cloudW / 2 + 15; // cloud center X (after beanstalk)

  for (let t = 0; t <= Math.min(tier, CLOUD_TIERS.length - 1); t++) {
    const cfg = CLOUD_TIERS[t];
    clouds.push({
      id:          cloudId++,
      cx,                       // screen X (beanstalk-aware)
      cy:          cfg.yWorld,  // world Y (camera offset applied in getCloudCenter)
      slots:       POTS,
      size:        1.0,         // REQUIRED by drawFluffyCloud/drawPot
      cellW,                    // dynamic slot width for this screen
      tier:        t,
      label:       cfg.label,
      accentColor: cfg.accentColor,
      bobOff:      seedRand(t * 137) * Math.PI * 2,
      bobSpd:      0.25 + seedRand(t * 251) * 0.15,
      bobAmp:      4    + seedRand(t * 317) * 5,
    });
  }

  G.plots = [];
  clouds.forEach((c, ci) => {
    for (let s = 0; s < c.slots; s++) {
      const ex = existing.find(p => p.cloudIdx === ci && p.slot === s);
      G.plots.push({ cloudIdx: ci, slot: s, grade: ex ? ex.grade ?? 0 : 0, plant: ex ? ex.plant : null });
    }
  });
}

function seedRand(seed) { const x=Math.sin(seed+1)*43758.5453123; return x-Math.floor(x); }

/** Get cloud center in SCREEN coords (applies camera + bob) */
function getCloudCenter(c, t) {
  const bob = Math.sin(t * c.bobSpd * 0.01 + c.bobOff) * (c.bobAmp || 5);
  const screenY = canvas.height * 0.55 - (c.cy - cameraY) + bob;
  return { x: c.cx, y: screenY };
}

/** Get slot screen coords */
function getSlotWorld(plot, t) {
  const c   = clouds[plot.cloudIdx];
  if (!c) return { x: -999, y: -999 };
  const pos  = getCloudCenter(c, t);
  const cw   = c.cellW || CFG.CELL_W;  // use dynamic or fallback
  const totalW = c.slots * cw;
  const startX = pos.x - totalW / 2;
  return {
    x: startX + plot.slot * cw + cw / 2,
    y: pos.y - CFG.POT_H * 0.3
  };
}

/** isMouseOverSlot uses same cell width */
function isMouseOverSlot(plot) {
  const sw  = getSlotWorld(plot, frameCount);
  const c   = clouds[plot.cloudIdx];
  const hw  = ((c?.cellW || CFG.CELL_W) / 2) - 2;
  return Math.abs(mouse.x - sw.x) < hw && Math.abs(mouse.y - sw.y) < CFG.CELL_H / 2 - 2;
}

// ── LEVEL-UP CHECK ────────────────────────────────────────────────────
function checkLevelUp(prevScore) {
  const pLv=calcLevel(prevScore), nLv=calcLevel(G.score);
  if (nLv<=pLv) return;
  for (let lv=pLv+1;lv<=nLv;lv++) {
    const newTier=calcTier(lv);
    if (newTier>activeTier&&newTier<CLOUD_TIERS.length) { activeTier=newTier; buildCloudsForTier(activeTier); showLevelUpModal(lv,true,newTier); }
    else showLevelUpModal(lv,false,-1);
  }
  updateHUD();
}

function showLevelUpModal(level,newCloud,tier) {
  const modal=document.getElementById('levelUpModal');
  document.getElementById('levelupNum').textContent=level;
  document.getElementById('levelupDesc').textContent=`Xuất sắc! Bạn đã đạt level ${level}!`;
  const ul=document.getElementById('levelupUnlock');
  ul.textContent = newCloud && tier >= 0
    ? `🌥️ "${CLOUD_TIERS[tier]?.label || 'Tầng mới'}" mở khóa! +10 chậu mới!`
    : `Tiếp tục thu hoạch để mở tầng mây tiếp theo!`;
  modal.classList.add('show');
  // Lightweight celebration: just 2 simple bursts, not 5 emoji bursts
  spawnLightBurst(canvas.width*0.35, canvas.height*0.4);
  setTimeout(()=>spawnLightBurst(canvas.width*0.65, canvas.height*0.45), 160);
}

function closeLevelUpModal() { document.getElementById('levelUpModal').classList.remove('show'); }

// ── GAME LOOP ─────────────────────────────────────────────────────────
function gameLoop() {
  if (!G.running) return;
  frameCount++;

  if (frameCount%CFG.RAIN_INT===0) { const b=5+Math.floor(Math.random()*6); G.water=Math.min(G.water+b,99); showToast(`🌧️ Mưa phép thuật! +${b} nước`); spawnRainParticles(); updateHUD(); }
  if (frameCount%CFG.SUN_INT===0)  { const b=3+Math.floor(Math.random()*4); G.sun=Math.min(G.sun+b,99); spawnSunParticles(); updateHUD(); }
  if (frameCount%CFG.BONUS_INT===0){ const b=10+Math.floor(Math.random()*16); G.coins+=b; showToast(`✨ Phép màu! +${b} xu`); updateHUD(); }
  if (frameCount%1800===0&&G.running) saveGame();

  // Plant growth
  if (frameCount%CFG.GROW_TICK===0) {
    G.plots.forEach(p=>{
      if (!p.plant||p.plant.stage>=3||p.plant.readyToHarvest) return;
      p.plant.growTimer++;
      const needed=getGrowNeeded(p.plant,p);
      if (p.plant.growTimer>=needed) {
        p.plant.growTimer=0;
        p.plant.watered=false;
        p.plant.stage++;
        if (p.plant.stage>=3) { p.plant.readyToHarvest=true; spawnGlowAt(getSlotWorld(p,frameCount)); }
      }
    });
  }

  draw();
  animFrame=requestAnimationFrame(gameLoop);
}

// ── DRAW ──────────────────────────────────────────────────────────────
function draw() {
  const W = canvas.width, H = canvas.height;

  // Smooth camera lerp
  cameraY += (targetCameraY - cameraY) * 0.08;

  // Background
  if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
    ctx.drawImage(bgImage, 0, 0, W, H);
    const ov = ctx.createLinearGradient(0, 0, 0, H);
    ov.addColorStop(0,'rgba(6,0,18,0.55)'); ov.addColorStop(0.4,'rgba(22,4,55,0.32)');
    ov.addColorStop(0.78,'rgba(50,15,70,0.18)'); ov.addColorStop(1,'rgba(16,8,0,0.30)');
    ctx.fillStyle = ov; ctx.fillRect(0, 0, W, H);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,'#0d0028'); sky.addColorStop(0.3,'#2a0855');
    sky.addColorStop(0.6,'#6b2a9e'); sky.addColorStop(0.85,'#d090e0'); sky.addColorStop(1,'#ffd6b0');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  }
  drawBgStars(W, H);
  drawSun(W, H);

  // Draw beanstalk BEFORE clouds so clouds appear on top
  drawBeanstalk(W, H);

  // Draw each cloud tier with its pots
  clouds.forEach((c, ci) => {
    const pos = getCloudCenter(c, frameCount);
    // Only draw if roughly in view (performance)
    if (pos.y < -200 || pos.y > H + 200) return;
    drawFluffyCloud(c, pos);
    drawCloudPots(c, ci, pos);
  });

  updateParticles();
  updateFloatingTexts();
  drawTierIndicator(W, H);
  // Cursor is now CSS emoji via data-tool attribute — no canvas draw needed
}

// ── BEANSTALK (CÂY ĐẬU THẦN CỔ THỤ THẦN TIÊN UỐN LƯỢN MƯỢT MÀ) ───────
function drawBeanstalk(W, H) {
  const trunkX   = 115;           // screen X of trunk center
  const groundY  = H * 0.96;     // bottom of trunk on screen
  const maxTierY = getCloudCenter(clouds[activeTier] || clouds[0], frameCount).y - 70;
  const topY     = Math.min(maxTierY, groundY - 140);

  ctx.save();

  // ── 1. Magical Celestial Ambient Aura
  ctx.shadowColor = 'rgba(74, 222, 128, 0.4)';
  ctx.shadowBlur = 28;

  // ── 2. Smooth Continuous Majestic Beanstalk Trunk (Thân cây gỗ xoắn đôi nhẵn mượt, không đốt sâu)
  const steps = 36;
  const dy = (groundY - topY) / steps;
  const baseW = 54; // Thick solid base width
  const topW  = 38; // Tapering towards top

  // Left & Right continuous edge points
  const leftPts = [];
  const rightPts = [];
  const midPts = [];

  for (let i = 0; i <= steps; i++) {
    const cy = groundY - i * dy;
    const tNorm = i / steps;
    const curW = baseW + (topW - baseW) * tNorm;
    
    // Smooth gentle S-curve wave (Chu kỳ dài, uốn lượn mượt mà)
    const curveWave = 22 * Math.sin(tNorm * Math.PI * 2.2 + frameCount * 0.005);
    const cx = trunkX + curveWave;

    midPts.push({ x: cx, y: cy, w: curW });
    leftPts.push({ x: cx - curW * 0.5, y: cy });
    rightPts.push({ x: cx + curW * 0.5, y: cy });
  }

  // Draw main smooth solid trunk silhouette
  ctx.beginPath();
  ctx.moveTo(leftPts[0].x, leftPts[0].y);
  for (let i = 1; i < leftPts.length; i++) {
    const prev = leftPts[i - 1];
    const curr = leftPts[i];
    ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) * 0.5, (prev.y + curr.y) * 0.5);
  }
  ctx.lineTo(leftPts[leftPts.length - 1].x, leftPts[leftPts.length - 1].y);
  ctx.lineTo(rightPts[rightPts.length - 1].x, rightPts[rightPts.length - 1].y);
  for (let i = rightPts.length - 2; i >= 0; i--) {
    const prev = rightPts[i + 1];
    const curr = rightPts[i];
    ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) * 0.5, (prev.y + curr.y) * 0.5);
  }
  ctx.closePath();

  // Rich 3D Cylindrical Bark Gradient
  const trunkGrd = ctx.createLinearGradient(trunkX - baseW * 0.6, 0, trunkX + baseW * 0.6, 0);
  trunkGrd.addColorStop(0, '#153e18');
  trunkGrd.addColorStop(0.2, '#246324');
  trunkGrd.addColorStop(0.5, '#459d30');
  trunkGrd.addColorStop(0.75, '#68c545');
  trunkGrd.addColorStop(1, '#1b4a1b');

  ctx.fillStyle = trunkGrd;
  ctx.fill();

  // ── 3. Smooth Intertwined Twin Vines (Dây leo xoắn đôi mượt mà uốn dọc thân)
  ctx.save();
  ctx.shadowBlur = 0;
  for (let v = 0; v < 2; v++) {
    ctx.beginPath();
    const vOffset = v * Math.PI;
    let started = false;

    for (let i = 0; i <= steps; i++) {
      const pt = midPts[i];
      const tNorm = i / steps;
      const vineX = pt.x + Math.sin(tNorm * Math.PI * 5 + vOffset + frameCount * 0.007) * (pt.w * 0.38);
      if (!started) {
        ctx.moveTo(vineX, pt.y);
        started = true;
      } else {
        ctx.lineTo(vineX, pt.y);
      }
    }

    // Outer shade
    ctx.strokeStyle = v === 0 ? '#1b4d1a' : '#235919';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Inner bright vine
    ctx.strokeStyle = v === 0 ? '#78dc48' : '#8ef257';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Gloss line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // ── 4. Natural Graceful Branches Cradling Cloud Tiers (Cành cây vươn dài thanh thoát)
  for (let t = 0; t <= activeTier; t++) {
    const cloudPos = getCloudCenter(clouds[t] || clouds[0], frameCount);
    const branchY  = cloudPos.y + 24;
    if (branchY < -60 || branchY > H + 60) continue;

    // Find nearest point on trunk
    let nearestMid = midPts[0];
    let minD = 9999;
    for (let pt of midPts) {
      const d = Math.abs(pt.y - branchY);
      if (d < minD) { minD = d; nearestMid = pt; }
    }

    const startX = nearestMid.x + nearestMid.w * 0.35;
    const startY = nearestMid.y;
    const branchEndX = cloudPos.x - clouds[t].slots * CFG.CELL_W * 0.5 - 15;
    const branchMidX = startX + (branchEndX - startX) * 0.48;
    const branchMidY = branchY - 32;

    // Thick Smooth Wooden Branch Arch
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(branchMidX, branchMidY, branchEndX, branchY);
    ctx.strokeStyle = '#1b4d1a';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(branchMidX, branchMidY, branchEndX, branchY);
    ctx.strokeStyle = '#439e2d';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Top Gloss line on branch
    ctx.beginPath();
    ctx.moveTo(startX, startY - 2);
    ctx.quadraticCurveTo(branchMidX, branchMidY - 3, branchEndX, branchY - 2);
    ctx.strokeStyle = 'rgba(210, 255, 140, 0.6)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // ── Graceful Spiral Tendril at Branch End (Tua cuốn xoắn ốc tinh tế)
    ctx.beginPath();
    const curlX = branchEndX - 8;
    const curlY = branchY + 10;
    ctx.arc(curlX, curlY, 8, 0, Math.PI * 1.5);
    ctx.strokeStyle = '#68c545';
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // ── Big Beautiful Heart-Shaped Fairy Leaves (Lá đậu thần to xanh mướt, sắc nét)
    [-1, 1].forEach((side, lIdx) => {
      const lx = nearestMid.x + side * (nearestMid.w * 0.65 + 10);
      const ly = branchY - 16 + lIdx * 10;
      const tilt = side * 0.6 + Math.sin(frameCount * 0.012 + t + lIdx) * 0.15;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(tilt);

      // Leaf shadow
      ctx.fillStyle = 'rgba(10, 40, 10, 0.22)';
      ctx.beginPath();
      ctx.ellipse(3, 3, 16, 26, 0, 0, Math.PI * 2);
      ctx.fill();

      // Lush Leaf Body
      const lgrd = ctx.createRadialGradient(-4, -8, 2, 0, 0, 28);
      lgrd.addColorStop(0, '#a7f3d0');
      lgrd.addColorStop(0.3, '#34d399');
      lgrd.addColorStop(0.7, '#059669');
      lgrd.addColorStop(1, '#064e3b');

      ctx.fillStyle = lgrd;
      ctx.beginPath();
      ctx.ellipse(0, -6, 16, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#047857';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Delicate Leaf Veins
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 16);
      ctx.lineTo(0, -28);
      ctx.stroke();

      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(0, 6);   ctx.lineTo(side * 9, -2);
      ctx.moveTo(0, -5);  ctx.lineTo(side * 10, -12);
      ctx.moveTo(0, -16); ctx.lineTo(side * 8, -22);
      ctx.stroke();

      // Dewdrop sparkle
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(side * 5, -8, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });
  }

  // ── 5. Strong Ancient Roots at Base (Bộ rễ cổ thụ xòe rộng nâng thân cây)
  for (let r = -3; r <= 3; r++) {
    const rx = trunkX + r * 14;
    const ry = groundY - 2;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.quadraticCurveTo(rx + r * 28, ry + 22, rx + r * 46, ry + 14);
    ctx.strokeStyle = '#153e18';
    ctx.lineWidth = Math.max(3, 9 - Math.abs(r) * 2);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // ── 6. Magical Fireflies Floating along Beanstalk (Đom đóm thần tiên bay lượn)
  for (let f = 0; f < 4; f++) {
    const fPhase = frameCount * 0.02 + f * 1.6;
    const fNorm = (fPhase % 1);
    const fIdx = Math.floor(fNorm * steps);
    const pt = midPts[Math.min(fIdx, midPts.length - 1)];
    if (pt) {
      const fx = pt.x + Math.sin(fPhase * 3) * (pt.w * 0.65);
      const fy = pt.y + Math.cos(fPhase * 2) * 8;
      const fAlpha = Math.sin(fNorm * Math.PI);
      ctx.save();
      ctx.globalAlpha = fAlpha * 0.85;
      ctx.fillStyle = '#a7f3d0';
      ctx.shadowColor = '#34d399';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

// ── TIER INDICATOR ────────────────────────────────────────────────────
function drawTierIndicator(W, H) {
  if (!G.running || activeTier < 1) return;
  const cfg   = CLOUD_TIERS[currentViewTier] || CLOUD_TIERS[0];
  const label = cfg.label;

  // Scroll arrows
  const arrowX = W - 30;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if (currentViewTier < activeTier) {
    // Up arrow (scroll up → higher tier)
    const upPulse = 0.6 + 0.4 * Math.sin(frameCount * 0.08);
    ctx.globalAlpha = upPulse;
    ctx.fillStyle = CLOUD_TIERS[currentViewTier + 1]?.accentColor || '#fff';
    ctx.fillText('▲', arrowX, H * 0.38);
    ctx.font = '10px Quicksand,sans-serif';
    ctx.fillText(CLOUD_TIERS[currentViewTier + 1]?.label || '', arrowX, H * 0.38 + 18);
  }
  if (currentViewTier > 0) {
    // Down arrow
    ctx.globalAlpha = 0.5;
    ctx.font = '20px serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('▼', arrowX, H * 0.65);
    ctx.font = '10px Quicksand,sans-serif';
    ctx.fillText(CLOUD_TIERS[currentViewTier - 1]?.label || '', arrowX, H * 0.65 + 18);
  }

  // Current tier label
  ctx.globalAlpha = 0.6;
  ctx.font = 'bold 11px Quicksand,sans-serif';
  ctx.fillStyle = cfg.accentColor || '#c77dff';
  ctx.textAlign = 'right';
  ctx.fillText(`🌿 ${label}  (${currentViewTier + 1}/${activeTier + 1})`, W - 10, H - 16);
  ctx.restore();
}

function drawBgStars(W,H) {
  if (!bgStarsData) {
    bgStarsData=[];
    for (let i=0;i<120;i++) bgStarsData.push({x:Math.random()*W,y:Math.random()*H*0.6,r:Math.random()*1.6+0.3,ph:Math.random()*Math.PI*2,sp:Math.random()*0.03+0.01});
  }
  bgStarsData.forEach(s=>{ const a=0.2+0.55*Math.abs(Math.sin(frameCount*s.sp+s.ph)); ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fillStyle=`rgba(255,240,255,${a})`; ctx.fill(); });
}

function drawSun(W,H) {
  const sx=W*0.82,sy=H*0.10;
  ctx.save(); ctx.translate(sx,sy); ctx.rotate(frameCount*0.003);
  for (let i=0;i<14;i++) {
    const ang=(i/14)*Math.PI*2,len=60+22*Math.sin(frameCount*0.05+i);
    ctx.beginPath(); ctx.moveTo(Math.cos(ang)*26,Math.sin(ang)*26); ctx.lineTo(Math.cos(ang)*len,Math.sin(ang)*len);
    ctx.strokeStyle=`rgba(255,230,80,${0.16+0.09*Math.sin(frameCount*0.04+i)})`; ctx.lineWidth=3; ctx.stroke();
  }
  ctx.restore();
  const grd=ctx.createRadialGradient(sx,sy,0,sx,sy,72);
  grd.addColorStop(0,'rgba(255,238,80,0.92)'); grd.addColorStop(0.45,'rgba(255,205,55,0.48)'); grd.addColorStop(1,'rgba(255,180,40,0)');
  ctx.beginPath(); ctx.arc(sx,sy,72,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
  ctx.beginPath(); ctx.arc(sx,sy,22,0,Math.PI*2); ctx.fillStyle='#ffe566'; ctx.fill();
  ctx.beginPath(); ctx.arc(sx,sy,15,0,Math.PI*2); ctx.fillStyle='#fff5a0'; ctx.fill();
}

function drawFluffyCloud(c,pos) {
  const {x,y}=pos,s=c.size;
  const Wc=c.slots*CFG.CELL_W+40,Hc=52*s;
  ctx.save(); ctx.shadowColor='rgba(160,100,255,0.28)'; ctx.shadowBlur=30; ctx.shadowOffsetY=8;
  ctx.fillStyle='rgba(245,242,255,0.97)'; roundRect(ctx,x-Wc/2,y-Hc*0.35,Wc,Hc*0.55,14); ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  const bumps=Math.max(c.slots+1,4),bspacing=Wc/(bumps-0.6);
  for (let i=0;i<bumps;i++) {
    const bx=x-Wc/2+i*bspacing+bspacing*0.2,by=y-Hc*0.35;
    const bR=(22+8*Math.sin(i*1.7))*s,bRy=(16+5*Math.sin(i*2.1))*s;
    const grd=ctx.createRadialGradient(bx,by-bRy*0.3,0,bx,by,bR*1.2);
    grd.addColorStop(0,'rgba(255,255,255,0.98)'); grd.addColorStop(0.65,'rgba(240,238,255,0.95)'); grd.addColorStop(1,'rgba(220,210,250,0.7)');
    ctx.beginPath(); ctx.ellipse(bx,by,bR,bRy,0,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
  }
  ctx.fillStyle='rgba(220,215,248,0.88)';
  const ub=Math.max(c.slots,3),us=Wc/(ub+0.2);
  for (let i=0;i<ub;i++) { const bx=x-Wc/2+10+i*us+us*0.3,by=y-Hc*0.35+Hc*0.55+8; ctx.beginPath(); ctx.ellipse(bx,by,us*0.48,16*s,0,0,Math.PI*2); ctx.fill(); }
  const sh=ctx.createLinearGradient(x-Wc/2,y-Hc,x-Wc/2,y);
  sh.addColorStop(0,'rgba(255,255,255,0.55)'); sh.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=sh; roundRect(ctx,x-Wc/2+2,y-Hc*0.35+2,Wc-4,Hc*0.22,8); ctx.fill();
  ctx.restore();
}

// ── POT SPRING & ANIMATION HELPERS ────────────────────────────────────
function triggerPotBounce(plot, amount = 1.32) {
  if (!plot) return;
  plot.springScaleX = 1 + (amount - 1);
  plot.springScaleY = 1 - (amount - 1) * 0.75;
  plot.springVelX = 0.06;
  plot.springVelY = -0.06;
}

// ── HD ZODIAC POT SPRITE SHEET ────────────────────────────────────────
const zodiacSheetImg = new Image();
zodiacSheetImg.src = 'assets/zodiac_pots.jpg';
let zodiacSheetLoaded = false;
zodiacSheetImg.onload = () => { zodiacSheetLoaded = true; };

// ── POTS ──────────────────────────────────────────────────────────────
function drawCloudPots(c, ci, pos) {
  G.plots.filter(p => p.cloudIdx === ci).forEach(plot => {
    const sw = getSlotWorld(plot, frameCount);
    const hover = isMouseOverSlot(plot);
    drawPot(sw.x, sw.y, hover, plot.plant, c.size, plot.grade || 0, plot);
    if (plot.plant) drawPlant(plot, sw.x, sw.y - CFG.POT_H * 0.55 - 4);
    // Auto-harvest hint on hover
    if (hover && plot.plant && plot.plant.readyToHarvest) drawHarvestBtn(sw.x, sw.y);
  });
}

function drawPot(cx, cy, hover, plant, cloudScale, grade, plot) {
  const g = POT_GRADES[grade] || POT_GRADES[0];
  const s = Math.min(cloudScale, 1);
  const PW = (CFG.POT_W || 56) * s * 1.10;
  const PH = (CFG.POT_H || 42) * s * 1.06;
  const topW = PW * 0.94;
  const baseW = PW * 0.72;
  const rimH = PH * 0.26;
  const top = cy - PH * 0.26;
  const bot = cy + PH * 0.68;

  ctx.save();

  // ── Spring Physics Simulation for Juicy Squash & Stretch
  if (plot) {
    if (plot.springScaleX === undefined) plot.springScaleX = 1;
    if (plot.springScaleY === undefined) plot.springScaleY = 1;
    if (plot.springVelX === undefined) plot.springVelX = 0;
    if (plot.springVelY === undefined) plot.springVelY = 0;

    const k = 0.24, damp = 0.74;
    plot.springVelX += (1 - plot.springScaleX) * k;
    plot.springVelX *= damp;
    plot.springScaleX += plot.springVelX;

    plot.springVelY += (1 - plot.springScaleY) * k;
    plot.springVelY *= damp;
    plot.springScaleY += plot.springVelY;
  }

  // ── Organic Floating Breathing Wave & Sway
  const slotSeed = plot ? (plot.slot * 0.85 + (plot.cloudIdx || 0) * 1.6) : 0;
  const floatWave = Math.sin(frameCount * 0.045 + slotSeed) * 2.5;
  const tiltAngle = Math.sin(frameCount * 0.035 + slotSeed) * 0.015;
  const hoverOffset = hover ? -5.0 + Math.sin(frameCount * 0.12) * 1.5 : 0;

  // ── Transform for Squash & Stretch + Floating
  ctx.translate(cx, cy + floatWave + hoverOffset);
  ctx.rotate(tiltAngle);
  const scX = (plot ? plot.springScaleX : 1) * (hover ? 1.07 : 1.0);
  const scY = (plot ? plot.springScaleY : 1) * (hover ? 1.07 : 1.0);
  ctx.scale(scX, scY);
  ctx.translate(-cx, -cy);

  // ── 0. Soft Multi-Layered Ambient Contact Shadow on Cloud
  const shadowSpread = (1 - (floatWave + hoverOffset) * 0.04);
  ctx.beginPath();
  ctx.ellipse(cx, bot + 6, baseW * 1.15 * shadowSpread, Math.max(2, 7 * s * shadowSpread), 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(35, 10, 60, 0.28)';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, bot + 4, baseW * 0.85 * shadowSpread, Math.max(1.5, 4 * s * shadowSpread), 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20, 5, 40, 0.35)';
  ctx.fill();

  // ── Grade Outer Aura Glow
  if (g.glowColor) {
    const pulseGlow = 0.85 + 0.15 * Math.sin(frameCount * 0.08 + slotSeed);
    ctx.shadowColor = g.glowColor;
    ctx.shadowBlur = (hover ? 34 : (grade >= 1 ? 24 : 12)) * pulseGlow;
  } else if (hover) {
    ctx.shadowColor = 'rgba(199, 125, 255, 0.7)';
    ctx.shadowBlur = 24;
  }

  // ── 🌟 AUTHENTIC HD ZODIAC SPRITE RENDERING (Ảnh nghệ thuật gốc 100% giống thật)
  if (g.spriteCol !== null && g.spriteCol !== undefined && zodiacSheetImg.complete && zodiacSheetImg.naturalWidth > 0) {
    const cellW = 1792 / 4;
    const cellH = 1024 / 3;
    const sx = g.spriteCol * cellW + 18;
    const sy = g.spriteRow * cellH + 12;
    const sw = cellW - 36;
    const sh = cellH - 24;

    const potDestW = 96 * s;
    const potDestH = 82 * s;
    const potDestX = cx - potDestW * 0.5;
    const potDestY = cy - potDestH * 0.5 - 2 * s;

    // Draw authentic HD illustration
    ctx.drawImage(zodiacSheetImg, sx, sy, sw, sh, potDestX, potDestY, potDestW, potDestH);

    // Soil Surface with Texture Specks on top
    const dirtGrd = ctx.createRadialGradient(cx, top + rimH * 0.38, 2, cx, top + rimH * 0.38, topW * 0.42);
    if (plant && plant.watered) {
      dirtGrd.addColorStop(0, '#3a506b');
      dirtGrd.addColorStop(0.5, '#1c2541');
      dirtGrd.addColorStop(1, '#0b132b');
    } else {
      dirtGrd.addColorStop(0, lighten(g.dirt || '#5c3a21', 18));
      dirtGrd.addColorStop(0.7, g.dirt || '#4a2e18');
      dirtGrd.addColorStop(1, darken(g.dirt || '#321808', 28));
    }
    ctx.fillStyle = dirtGrd;
    ctx.beginPath();
    ctx.ellipse(cx, top + rimH * 0.38, topW * 0.42, rimH * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // Water moisture sparkle dots on soil
    if (plant && plant.watered) {
      const moistTime = frameCount * 0.08 + slotSeed;
      ctx.fillStyle = 'rgba(116, 215, 255, 0.9)';
      ctx.shadowColor = '#60d5ff';
      ctx.shadowBlur = 6;
      for (let i = 0; i < 3; i++) {
        const mx = cx + Math.sin(moistTime + i * 2) * (topW * 0.24);
        const my = top + rimH * 0.38 + Math.cos(moistTime + i * 2) * (rimH * 0.20);
        ctx.beginPath();
        ctx.arc(mx, my, 1.3 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    // Star Glints & Sparkling Highlights
    const glintT = (frameCount * 0.05 + grade) % (Math.PI * 2);
    const glintA = Math.max(0, Math.sin(glintT));
    if (glintA > 0.05) {
      const glintX = cx - topW * 0.36 + Math.cos(grade) * 6;
      const glintY = top + rimH * 0.24;
      drawSparkleStar(ctx, glintX, glintY, 3.8 * s + glintA * 3.5, glintA);
    }

    ctx.restore();
    return;
  }

  // ── 1. Saucer Tray (Đế đĩa lót gốm sứ 3D cao cấp ở dưới cùng)
  const trayW = PW * 1.16;
  const trayH = PH * 0.30;
  const trayY = bot - 2;

  // Tray lower bevel
  const trayGrd = ctx.createLinearGradient(cx - trayW / 2, trayY, cx + trayW / 2, trayY + trayH);
  trayGrd.addColorStop(0, lighten(g.saucer || g.body2, 18));
  trayGrd.addColorStop(0.3, hover ? lighten(g.saucer || g.body2, 38) : lighten(g.saucer || g.body2, 28));
  trayGrd.addColorStop(0.7, g.saucer || g.body2);
  trayGrd.addColorStop(1, darken(g.saucer || g.body2, 35));

  ctx.beginPath();
  ctx.ellipse(cx, trayY + 4.5 * s, trayW * 0.49, trayH * 0.54, 0, 0, Math.PI * 2);
  ctx.fillStyle = trayGrd;
  ctx.fill();

  // Tray upper rim lip
  ctx.beginPath();
  ctx.ellipse(cx, trayY, trayW * 0.52, trayH * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = lighten(g.saucer || g.rim, 24);
  ctx.fill();

  // Golden Inlay Line on Saucer
  ctx.strokeStyle = grade >= 1 ? 'rgba(255, 225, 120, 0.85)' : 'rgba(255, 230, 160, 0.5)';
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  // Inlaid sparkling gemstones on saucer corners
  if (grade >= 1) {
    const gemColors = ['#ffd700', '#00f5d4', '#ff70a6', '#ffee32'];
    for (let i = 0; i < 4; i++) {
      const spAng = frameCount * 0.025 + i * (Math.PI / 2) + slotSeed;
      const spX = cx + Math.cos(spAng) * (trayW * 0.46);
      const spY = trayY + Math.sin(spAng) * (trayH * 0.28);

      ctx.save();
      ctx.shadowColor = gemColors[i % gemColors.length];
      ctx.shadowBlur = 6;
      ctx.fillStyle = gemColors[i % gemColors.length];
      ctx.beginPath();
      ctx.arc(spX, spY, 1.4 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(spX - 0.4, spY - 0.4, 0.6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── 2. Chubby Porcelain Pot Belly (Thân chậu sứ tròn trĩnh, bóng gương 3D)
  const bellyGrd = ctx.createRadialGradient(cx - PW * 0.18, cy - PH * 0.08, 2, cx, cy, PW * 0.68);
  if (grade >= 13 && (g.mascot === 'omniverse' || g.mascot === 'phoenix')) {
    // Cosmic Nebula Shifter
    const hue = (frameCount * 0.9 + slotSeed * 30) % 360;
    bellyGrd.addColorStop(0, `hsl(${hue}, 95%, 75%)`);
    bellyGrd.addColorStop(0.45, `hsl(${(hue + 50) % 360}, 85%, 50%)`);
    bellyGrd.addColorStop(1, '#080014');
  } else {
    bellyGrd.addColorStop(0, hover ? lighten(g.body1, 35) : lighten(g.body1, 18));
    bellyGrd.addColorStop(0.45, hover ? lighten(g.body1, 24) : g.body1);
    bellyGrd.addColorStop(0.85, g.body2);
    bellyGrd.addColorStop(1, darken(g.body2, 30));
  }

  ctx.beginPath();
  ctx.moveTo(cx - topW * 0.48, top + rimH * 0.6);
  // Chubby rounded curve outwards
  ctx.bezierCurveTo(
    cx - PW * 0.64, top + PH * 0.35,
    cx - baseW * 0.68, bot - PH * 0.1,
    cx - baseW * 0.44, bot
  );
  ctx.quadraticCurveTo(cx, bot + 3.5 * s, cx + baseW * 0.44, bot);
  ctx.bezierCurveTo(
    cx + baseW * 0.68, bot - PH * 0.1,
    cx + PW * 0.64, top + PH * 0.35,
    cx + topW * 0.48, top + rimH * 0.6
  );
  ctx.closePath();
  ctx.fillStyle = bellyGrd;
  ctx.fill();

  // ── 3. Multi-Layer Wavy Horizontal Decorative Ribbons (Họa tiết lượn sóng sứ tinh xảo)
  ctx.save();
  for (let w = 0; w < 2; w++) {
    const waveY = top + PH * (0.40 + w * 0.24);
    const waveAmp = 2.8 * s;
    const waveFreq = 0.13;
    const startX = cx - PW * (0.46 - w * 0.05);
    const endX   = cx + PW * (0.46 - w * 0.05);

    // Subtle dark wave shade beneath
    ctx.beginPath();
    ctx.moveTo(startX, waveY + 1.5);
    for (let wx = startX; wx <= endX; wx += 2) {
      const wy = waveY + 1.5 + Math.sin((wx - cx) * waveFreq + frameCount * 0.02 + w) * waveAmp;
      ctx.lineTo(wx, wy);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 3.0 * s;
    ctx.stroke();

    // Main bright wave
    ctx.beginPath();
    ctx.moveTo(startX, waveY);
    for (let wx = startX; wx <= endX; wx += 2) {
      const wy = waveY + Math.sin((wx - cx) * waveFreq + frameCount * 0.02 + w) * waveAmp;
      ctx.lineTo(wx, wy);
    }
    ctx.strokeStyle = g.waveColor || 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2.4 * s;
    ctx.stroke();
  }
  ctx.restore();

  // ── 4. Dual Specular Curved Light Streaks (Ánh sáng phản chiếu bóng gương hai bên)
  // Main Left Highlight
  ctx.save();
  ctx.globalAlpha = hover ? 0.46 : 0.30;
  const specGrd = ctx.createLinearGradient(cx - PW * 0.46, top, cx + PW * 0.1, bot);
  specGrd.addColorStop(0, '#ffffff');
  specGrd.addColorStop(0.5, '#ffffff');
  specGrd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = specGrd;
  ctx.beginPath();
  ctx.moveTo(cx - PW * 0.35, top + rimH);
  ctx.bezierCurveTo(
    cx - PW * 0.48, top + PH * 0.4,
    cx - baseW * 0.50, bot - PH * 0.15,
    cx - baseW * 0.32, bot - 2
  );
  ctx.lineTo(cx - baseW * 0.18, bot - 2);
  ctx.bezierCurveTo(
    cx - baseW * 0.32, bot - PH * 0.15,
    cx - PW * 0.26, top + PH * 0.4,
    cx - PW * 0.21, top + rimH
  );
  ctx.closePath();
  ctx.fill();

  // Secondary Subtle Right Bounce Highlight
  ctx.globalAlpha = hover ? 0.22 : 0.14;
  const rightSpecGrd = ctx.createLinearGradient(cx + PW * 0.45, top, cx + PW * 0.2, bot);
  rightSpecGrd.addColorStop(0, '#ffffff');
  rightSpecGrd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rightSpecGrd;
  ctx.beginPath();
  ctx.ellipse(cx + PW * 0.38, cy + PH * 0.1, 2.5 * s, 10 * s, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── 5. Pot Rim Collar (Miệng chậu tròn 3D có viền vàng kim)
  ctx.shadowBlur = 0;
  const rimGrd = ctx.createLinearGradient(cx - topW / 2, top, cx + topW / 2, top + rimH);
  rimGrd.addColorStop(0, lighten(g.rim || '#c88', 22));
  rimGrd.addColorStop(0.3, hover ? lighten(g.rim || '#c88', 42) : lighten(g.rim || '#c88', 30));
  rimGrd.addColorStop(0.7, g.rim || '#c88');
  rimGrd.addColorStop(1, darken(g.rim || '#c88', 22));

  // Outer collar rim
  ctx.fillStyle = rimGrd;
  ctx.beginPath();
  ctx.ellipse(cx, top + rimH * 0.48, topW * 0.52, rimH * 0.65, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = grade >= 1 ? 'rgba(255, 235, 140, 0.9)' : 'rgba(255, 230, 120, 0.5)';
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  // ── 6. Soil Surface with Texture Specks (Lòng đất dinh dưỡng màu mỡ)
  const dirtGrd = ctx.createRadialGradient(cx, top + rimH * 0.42, 2, cx, top + rimH * 0.42, topW * 0.44);
  if (plant && plant.watered) {
    dirtGrd.addColorStop(0, '#3a506b');
    dirtGrd.addColorStop(0.5, '#1c2541');
    dirtGrd.addColorStop(1, '#0b132b');
  } else {
    dirtGrd.addColorStop(0, lighten(g.dirt || '#5c3a21', 18));
    dirtGrd.addColorStop(0.7, g.dirt || '#4a2e18');
    dirtGrd.addColorStop(1, darken(g.dirt || '#321808', 28));
  }
  ctx.fillStyle = dirtGrd;
  ctx.beginPath();
  ctx.ellipse(cx, top + rimH * 0.44, topW * 0.44, rimH * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();

  // Soil Nutrient Granules (Hạt đất dinh dưỡng li ti)
  ctx.fillStyle = plant && plant.watered ? 'rgba(100, 200, 255, 0.4)' : 'rgba(200, 150, 100, 0.3)';
  for (let i = 0; i < 5; i++) {
    const gx = cx + Math.cos(i * 1.3 + slotSeed) * (topW * 0.28);
    const gy = top + rimH * 0.44 + Math.sin(i * 1.3 + slotSeed) * (rimH * 0.22);
    ctx.beginPath();
    ctx.arc(gx, gy, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Water Moisture Ripples & Sparkle Dots on Soil
  if (plant && plant.watered) {
    const moistTime = frameCount * 0.08 + slotSeed;
    ctx.fillStyle = 'rgba(116, 215, 255, 0.9)';
    ctx.shadowColor = '#60d5ff';
    ctx.shadowBlur = 4;
    for (let i = 0; i < 3; i++) {
      const mx = cx + Math.sin(moistTime + i * 2) * (topW * 0.26);
      const my = top + rimH * 0.44 + Math.cos(moistTime + i * 2) * (rimH * 0.22);
      ctx.beginPath();
      ctx.arc(mx, my, 1.3 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // ── 7. Detailed 3D Chibi Mascot Illustration (Nhân vật Chibi tinh xảo ôm trọn thân chậu)
  if (grade >= 1 && g.mascot) {
    drawChibiMascot(ctx, cx, cy + PH * 0.12, g.mascot, s, frameCount + slotSeed * 10);
  }

  // ── 8. Star Glints & Sparkling Highlights on Pot Rim
  if (grade >= 1) {
    const glintT = (frameCount * 0.05 + grade) % (Math.PI * 2);
    const glintA = Math.max(0, Math.sin(glintT));
    if (glintA > 0.05) {
      const glintX = cx - topW * 0.36 + Math.cos(grade) * 6;
      const glintY = top + rimH * 0.28;
      drawSparkleStar(ctx, glintX, glintY, 3.8 * s + glintA * 3.5, glintA);
    }
  }

  ctx.restore();
}

/**
 * Vẽ nhân vật Chibi Hoàng Đạo / Thần Thoại 3D ngồi vắt chân trên đĩa lót, ôm chậu, chớp mắt & hoạt ảnh sống động
 */
function drawChibiMascot(ctx, cx, cy, mascot, s, time) {
  ctx.save();
  const mX = cx;
  const mY = cy;

  // Mascot scale & natural breathing oscillation
  const sc = s * 1.62;
  const breath = Math.sin(time * 0.07) * 1.6 * s;
  const sway = Math.sin(time * 0.04) * 0.035;
  ctx.translate(mX, mY + breath);
  ctx.rotate(sway);

  // Natural Blinking Anime Eyes Simulation (Chớp mắt tự nhiên)
  const blinkCycle = (time * 0.04) % 7;
  const isBlink = blinkCycle < 0.22;

  switch (mascot) {
    case 'leo': {
      // 🦁 Leo — Chibi Vua Sư Tử Ngồi Vắt Chân Lên Đĩa Lót Chậu
      const tailWag = Math.sin(time * 0.16) * 0.25;

      // 1. Animated Royal Lion Tail (Đuôi sư tử đung đưa sau chậu)
      ctx.save();
      ctx.translate(-14 * sc, 10 * sc);
      ctx.rotate(tailWag);
      ctx.strokeStyle = '#ffa200';
      ctx.lineWidth = 3.5 * sc;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-10 * sc, -4 * sc, -14 * sc, -12 * sc);
      ctx.stroke();
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      ctx.arc(-14 * sc, -12 * sc, 4.5 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2. Lush Lion Mane (Bờm sư tử dày dặn xòe rộng bao quanh chậu)
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const maneBreath = Math.sin(time * 0.1 + i) * 0.8 * sc;
        ctx.arc(Math.cos(ang) * (15 * sc + maneBreath), -4 * sc + Math.sin(ang) * (13 * sc + maneBreath), 6.5 * sc, 0, Math.PI * 2);
      }
      ctx.fill();

      // Inner golden mane highlights
      ctx.fillStyle = '#ffa200';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + 0.26;
        ctx.arc(Math.cos(ang) * 11 * sc, -4 * sc + Math.sin(ang) * 10 * sc, 5.0 * sc, 0, Math.PI * 2);
      }
      ctx.fill();

      // 3. Chibi Face
      ctx.fillStyle = '#ffe5b4';
      ctx.beginPath();
      ctx.arc(0, -4 * sc, 9.8 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 4. Ears with Cute Wiggle
      const earWig = Math.sin(time * 0.12) * 0.1;
      ctx.fillStyle = '#ff9100';
      ctx.beginPath();
      ctx.arc(-8.5 * sc, -12 * sc + earWig * sc, 4.0 * sc, 0, Math.PI * 2);
      ctx.arc(8.5 * sc, -12 * sc - earWig * sc, 4.0 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffb3c6';
      ctx.beginPath();
      ctx.arc(-8.5 * sc, -12 * sc + earWig * sc, 2.2 * sc, 0, Math.PI * 2);
      ctx.arc(8.5 * sc, -12 * sc - earWig * sc, 2.2 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 5. Anime Eyes with Blinking
      if (isBlink) {
        // Cute smiling closed eyes ⌒ ⌒
        ctx.strokeStyle = '#3a1500';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-4 * sc, -4 * sc, 2.2 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(4 * sc, -4 * sc, 2.2 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        // Big round shiny anime eyes with double catchlights
        ctx.fillStyle = '#3a1500';
        ctx.beginPath();
        ctx.arc(-3.8 * sc, -4.5 * sc, 2.5 * sc, 0, Math.PI * 2);
        ctx.arc(3.8 * sc, -4.5 * sc, 2.5 * sc, 0, Math.PI * 2);
        ctx.fill();
        // Catchlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-4.5 * sc, -5.2 * sc, 1.1 * sc, 0, Math.PI * 2);
        ctx.arc(3.1 * sc, -5.2 * sc, 1.1 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-3.2 * sc, -3.8 * sc, 0.6 * sc, 0, Math.PI * 2);
        ctx.arc(4.4 * sc, -3.8 * sc, 0.6 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6. Cute Smile & Blush
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(-6 * sc, -1.5 * sc, 2.2 * sc, 0, Math.PI * 2);
      ctx.arc(6 * sc, -1.5 * sc, 2.2 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a2200';
      ctx.beginPath();
      ctx.arc(0, -3.0 * sc, 0.8 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a2200';
      ctx.lineWidth = 0.8 * sc;
      ctx.beginPath();
      ctx.arc(0, -2.0 * sc, 1.6 * sc, 0.1, Math.PI - 0.1);
      ctx.stroke();

      // 7. Paws Grasping Pot Belly & Torso
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      ctx.arc(0, 6.5 * sc, 6.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Arms embracing pot
      ctx.fillStyle = '#ffa200';
      ctx.beginPath();
      ctx.arc(-11 * sc, 2.5 * sc, 3.8 * sc, 0, Math.PI * 2);
      ctx.arc(11 * sc, 2.5 * sc, 3.8 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffb3c6';
      ctx.beginPath();
      ctx.arc(-11 * sc, 2.5 * sc, 1.8 * sc, 0, Math.PI * 2);
      ctx.arc(11 * sc, 2.5 * sc, 1.8 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 8. Sitting Legs Dangling Over Saucer Tray (Chân vắt lên đĩa lót)
      ctx.fillStyle = '#ffa200';
      ctx.beginPath();
      // Left foot resting on saucer
      ctx.ellipse(-6 * sc, 13 * sc, 3.8 * sc, 2.4 * sc, -0.2, 0, Math.PI * 2);
      // Right foot resting on saucer
      ctx.ellipse(6 * sc, 13 * sc, 3.8 * sc, 2.4 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffb3c6';
      ctx.beginPath();
      ctx.arc(-6 * sc, 13 * sc, 1.6 * sc, 0, Math.PI * 2);
      ctx.arc(6 * sc, 13 * sc, 1.6 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 9. Royal Staff with Pulsing Star Sparkles
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2 * sc;
      ctx.beginPath();
      ctx.moveTo(11 * sc, 0);
      ctx.lineTo(11 * sc, 14 * sc);
      ctx.stroke();
      drawSparkleStar(ctx, 11 * sc, -1 * sc, 4.5 * sc + Math.sin(time * 0.1) * 1.5, 1.0);
      break;
    }

    case 'sagittarius': {
      // 🏹 Sagittarius — Thần Cung Thủ Ngồi Vắt Chân & Giương Cung Thần
      // 1. Winged Golden Tiara with Sapphire
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(-14 * sc, -14 * sc);
      ctx.lineTo(-5 * sc, -10 * sc);
      ctx.lineTo(0, -17 * sc);
      ctx.lineTo(5 * sc, -10 * sc);
      ctx.lineTo(14 * sc, -14 * sc);
      ctx.lineTo(8 * sc, -8 * sc);
      ctx.lineTo(-8 * sc, -8 * sc);
      ctx.closePath();
      ctx.fill();

      // Center sapphire
      ctx.fillStyle = '#00b4d8';
      ctx.beginPath();
      ctx.arc(0, -12 * sc, 2.4 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 2. Chibi Face
      ctx.fillStyle = '#fcd5b5';
      ctx.beginPath();
      ctx.arc(0, -3.5 * sc, 9.8 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 3. Flowing Red Beard Blowing in the Wind
      const beardWind = Math.sin(time * 0.12) * 1.5 * sc;
      ctx.fillStyle = '#d00000';
      ctx.beginPath();
      ctx.moveTo(-7 * sc, -1.5 * sc);
      ctx.quadraticCurveTo(beardWind, 10 * sc, 7 * sc, -1.5 * sc);
      ctx.quadraticCurveTo(beardWind, 14 * sc, -7 * sc, -1.5 * sc);
      ctx.fill();

      // 4. Hero Eyes with Blinking
      if (isBlink) {
        ctx.strokeStyle = '#1d3557';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-3.6 * sc, -4 * sc, 2.2 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(3.6 * sc, -4 * sc, 2.2 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#1d3557';
        ctx.beginPath();
        ctx.arc(-3.6 * sc, -4.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.6 * sc, -4.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-4.2 * sc, -5.2 * sc, 1.0 * sc, 0, Math.PI * 2);
        ctx.arc(3.0 * sc, -5.2 * sc, 1.0 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. Cyan Tunic & Sitting Legs on Saucer
      ctx.fillStyle = '#48cae4';
      ctx.beginPath();
      ctx.arc(0, 6.5 * sc, 6.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Boots resting on saucer
      ctx.fillStyle = '#7a3b00';
      ctx.beginPath();
      ctx.ellipse(-6 * sc, 13.5 * sc, 4.0 * sc, 2.2 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(6 * sc, 13.5 * sc, 4.0 * sc, 2.2 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // 6. Golden Bow with Energy Arrow
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2.4 * sc;
      ctx.beginPath();
      ctx.arc(12 * sc, 1 * sc, 10 * sc, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();

      // Pulsing energy star
      drawSparkleStar(ctx, 17 * sc, 1 * sc, 4 * sc + Math.sin(time * 0.15) * 1.5, 1.0);
      break;
    }

    case 'gemini': {
      // 👼 Gemini — Thiên Thần Sinh Đôi Ngồi Vắt Chân & Vỗ Cánh Thiên Thần
      const wingFlap = Math.sin(time * 0.1) * 0.25;

      // 1. Spreading Layered Angel Wings with Live Flapping
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(-14 * sc, -3 * sc, 10 * sc, 6 * sc, -Math.PI * 0.28 + wingFlap, 0, Math.PI * 2);
      ctx.ellipse(14 * sc, -3 * sc, 10 * sc, 6 * sc, Math.PI * 0.28 - wingFlap, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();

      // 2. Fluffy Blonde Hair
      ctx.fillStyle = '#ffeaa7';
      ctx.beginPath();
      ctx.arc(0, -6 * sc, 11 * sc, 0, Math.PI * 2);
      ctx.arc(-8 * sc, -5 * sc, 5.5 * sc, 0, Math.PI * 2);
      ctx.arc(8 * sc, -5 * sc, 5.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 3. Cute Face
      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.arc(0, -3 * sc, 9.2 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 4. Golden Angel Halo
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2.2 * sc;
      ctx.beginPath();
      ctx.ellipse(0, -15 * sc + Math.sin(time * 0.08) * 1.2 * sc, 9 * sc, 3 * sc, 0, 0, Math.PI * 2);
      ctx.stroke();

      // 5. Anime Eyes with Blinking
      if (isBlink) {
        ctx.strokeStyle = '#0984e3';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-3.6 * sc, -3.8 * sc, 2.2 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(3.6 * sc, -3.8 * sc, 2.2 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#0984e3';
        ctx.beginPath();
        ctx.arc(-3.6 * sc, -4 * sc, 2.5 * sc, 0, Math.PI * 2);
        ctx.arc(3.6 * sc, -4 * sc, 2.5 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-4.3 * sc, -4.8 * sc, 1.1 * sc, 0, Math.PI * 2);
        ctx.arc(2.9 * sc, -4.8 * sc, 1.1 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#ff7675';
      ctx.beginPath();
      ctx.arc(-5.5 * sc, -1 * sc, 2.2 * sc, 0, Math.PI * 2);
      ctx.arc(5.5 * sc, -1 * sc, 2.2 * sc, 0, Math.PI * 2);
      ctx.fill();

      // 6. Sitting Robe & Little Angel Feet on Saucer
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 6 * sc, 6.2 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Cute feet dangling on saucer
      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.ellipse(-5 * sc, 13 * sc, 3.2 * sc, 2.0 * sc, -0.15, 0, Math.PI * 2);
      ctx.ellipse(5 * sc, 13 * sc, 3.2 * sc, 2.0 * sc, 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'aries': {
      // ♈ Aries — Dũng Sĩ Sừng Cừu Ngồi Vắt Chân
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(-12 * sc, -8 * sc, 6.5 * sc, 0, Math.PI * 2);
      ctx.arc(12 * sc, -8 * sc, 6.5 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cc8800';
      ctx.beginPath();
      ctx.arc(-12 * sc, -8 * sc, 3.8 * sc, 0, Math.PI * 2);
      ctx.arc(12 * sc, -8 * sc, 3.8 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Flame Helmet
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.arc(0, -4.5 * sc, 10.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Face
      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.arc(0, -2.5 * sc, 8.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      if (isBlink) {
        ctx.strokeStyle = '#b7094c';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#b7094c';
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-4.1 * sc, -4.1 * sc, 0.9 * sc, 0, Math.PI * 2);
        ctx.arc(2.9 * sc, -4.1 * sc, 0.9 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sitting armored legs on saucer
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.ellipse(-6 * sc, 13 * sc, 3.6 * sc, 2.2 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(6 * sc, 13 * sc, 3.6 * sc, 2.2 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'taurus': {
      // ♉ Taurus — Chiến Binh Giáp Xanh Ngồi Vắt Chân
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(-15 * sc, -15 * sc); ctx.lineTo(-7 * sc, -6 * sc); ctx.lineTo(-12 * sc, -3 * sc);
      ctx.moveTo(15 * sc, -15 * sc); ctx.lineTo(7 * sc, -6 * sc); ctx.lineTo(12 * sc, -3 * sc);
      ctx.fill();

      ctx.fillStyle = '#2d6a4f';
      ctx.beginPath();
      ctx.arc(0, -4.5 * sc, 10.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fceade';
      ctx.beginPath();
      ctx.arc(0, -2.5 * sc, 8.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      if (isBlink) {
        ctx.strokeStyle = '#1b4332';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#1b4332';
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // Armored green boots on saucer
      ctx.fillStyle = '#1b4332';
      ctx.beginPath();
      ctx.ellipse(-6 * sc, 13 * sc, 3.8 * sc, 2.2 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(6 * sc, 13 * sc, 3.8 * sc, 2.2 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'cancer': {
      // ♋ Cancer — Nàng Tiên Càng Cua Vàng
      const clawSnap = Math.sin(time * 0.14) * 0.15;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(-12.5 * sc, -3 * sc + clawSnap * sc, 6.0 * sc, 0, Math.PI * 2);
      ctx.arc(12.5 * sc, -3 * sc - clawSnap * sc, 6.0 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#00b4d8';
      ctx.beginPath();
      ctx.arc(0, -4.5 * sc, 10.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.arc(0, -2.5 * sc, 8.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      if (isBlink) {
        ctx.strokeStyle = '#023e8a';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#023e8a';
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sitting feet on saucer
      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.ellipse(-5 * sc, 13 * sc, 3.2 * sc, 2.0 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(5 * sc, 13 * sc, 3.2 * sc, 2.0 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'virgo': {
      // ♍ Virgo — Nàng Tiên Hoa Tím Thuần Khiết
      ctx.fillStyle = '#c77dff';
      ctx.beginPath();
      ctx.arc(0, -5 * sc, 11.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.arc(0, -2.5 * sc, 9 * sc, 0, Math.PI * 2);
      ctx.fill();

      // Flower Crown
      ctx.fillStyle = '#55a630';
      ctx.beginPath();
      ctx.ellipse(0, -11 * sc, 9 * sc, 2.5 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff70a6';
      ctx.beginPath();
      ctx.arc(-5 * sc, -11 * sc, 3.0 * sc, 0, Math.PI * 2);
      ctx.arc(0, -12 * sc, 3.2 * sc, 0, Math.PI * 2);
      ctx.arc(5 * sc, -11 * sc, 3.0 * sc, 0, Math.PI * 2);
      ctx.fill();

      if (isBlink) {
        ctx.strokeStyle = '#5a189a';
        ctx.lineWidth = 1.6 * sc;
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.arc(3.5 * sc, -3.2 * sc, 2.0 * sc, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#5a189a';
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fairy feet on saucer
      ctx.fillStyle = '#ffe5d9';
      ctx.beginPath();
      ctx.ellipse(-5 * sc, 13 * sc, 3.2 * sc, 2.0 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(5 * sc, 13 * sc, 3.2 * sc, 2.0 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'aquarius':
    case 'poseidon': {
      // ♒ Aquarius / Poseidon — Thủy Thần Đại Dương & Đinh Ba Vàng
      ctx.fillStyle = '#0077b6';
      ctx.beginPath();
      ctx.arc(0, -4.5 * sc, 10.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fceade';
      ctx.beginPath();
      ctx.arc(0, -2.5 * sc, 8.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      if (!isBlink) {
        ctx.fillStyle = '#03045e';
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // Golden Trident with Pulsing Light
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2.4 * sc;
      ctx.beginPath();
      ctx.moveTo(10 * sc, 14 * sc); ctx.lineTo(10 * sc, -10 * sc);
      ctx.moveTo(6 * sc, -6 * sc); ctx.lineTo(14 * sc, -6 * sc);
      ctx.moveTo(6 * sc, -10 * sc); ctx.lineTo(6 * sc, -6 * sc);
      ctx.moveTo(14 * sc, -10 * sc); ctx.lineTo(14 * sc, -6 * sc);
      ctx.stroke();
      drawSparkleStar(ctx, 10 * sc, -10 * sc, 3.5 * sc + Math.sin(time * 0.12) * 1.5, 1.0);

      // Sitting feet on saucer
      ctx.fillStyle = '#0077b6';
      ctx.beginPath();
      ctx.ellipse(-5 * sc, 13 * sc, 3.5 * sc, 2.0 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(5 * sc, 13 * sc, 3.5 * sc, 2.0 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'zeus': {
      // ⚡ Zeus — Vua Thần Tóc Bạc & Tia Sét Lôi Điện Sống Động
      ctx.fillStyle = '#e9ecef';
      ctx.beginPath();
      ctx.arc(0, -5.5 * sc, 11 * sc, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fceade';
      ctx.beginPath();
      ctx.arc(0, -2.5 * sc, 8.5 * sc, 0, Math.PI * 2);
      ctx.fill();

      if (!isBlink) {
        ctx.fillStyle = '#3a0ca3';
        ctx.beginPath();
        ctx.arc(-3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.arc(3.5 * sc, -3.5 * sc, 2.4 * sc, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crackling Animated Lightning Bolt
      const boltJitter = (Math.sin(time * 0.4) > 0.3) ? (Math.random() - 0.5) * 4 : 0;
      ctx.fillStyle = '#ffee32';
      ctx.shadowColor = '#ffff3f';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(12 * sc + boltJitter, -12 * sc);
      ctx.lineTo(7 * sc, 0);
      ctx.lineTo(12 * sc, 0);
      ctx.lineTo(8 * sc + boltJitter, 14 * sc);
      ctx.lineTo(15 * sc, -2 * sc);
      ctx.lineTo(10 * sc, -2 * sc);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Sitting feet on saucer
      ctx.fillStyle = '#3c096c';
      ctx.beginPath();
      ctx.ellipse(-5 * sc, 13 * sc, 3.5 * sc, 2.0 * sc, -0.2, 0, Math.PI * 2);
      ctx.ellipse(5 * sc, 13 * sc, 3.5 * sc, 2.0 * sc, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    default: {
      // General Mythological Crest
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(0, 0, 8 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3c096c';
      ctx.beginPath();
      ctx.arc(0, 0, 5.5 * sc, 0, Math.PI * 2);
      ctx.fill();
      drawSparkleStar(ctx, 0, 0, 4 * sc + Math.sin(time * 0.1) * 1.5, 1.0);
      break;
    }
  }

  ctx.restore();
}

/** Helper to draw a sparkling 4-point star */
function drawSparkleStar(ctx, x, y, size, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x, y, x + size, y);
  ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y);
  ctx.quadraticCurveTo(x, y, x, y - size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Darken a hex color by subtracting N from each channel */
function darken(hex, n) {
  if (!hex || hex[0] !== '#') return hex;
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - n);
  const gv = Math.max(0, parseInt(hex.slice(3, 5), 16) - n);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - n);
  return `rgb(${r},${gv},${b})`;
}

/** Lighten a hex color by adding N to each channel */
function lighten(hex,n) {
  if (!hex||hex[0]!=='#') return hex;
  const r=Math.min(255,parseInt(hex.slice(1,3),16)+n);
  const gv=Math.min(255,parseInt(hex.slice(3,5),16)+n);
  const b=Math.min(255,parseInt(hex.slice(5,7),16)+n);
  return `rgb(${r},${gv},${b})`;
}

/** Draw floating harvest button above a ready plant */
function drawHarvestBtn(x,y) {
  const by=y-58, bw=92, bh=26, br=13;
  ctx.save();
  ctx.shadowColor='rgba(255,215,0,0.85)'; ctx.shadowBlur=18;
  const pulse=0.88+0.12*Math.sin(frameCount*0.12);
  ctx.globalAlpha=pulse;
  ctx.fillStyle='rgba(255,200,0,0.92)';
  roundRect(ctx,x-bw/2,by-bh/2,bw,bh,br); ctx.fill();
  ctx.shadowBlur=0; ctx.globalAlpha=1;
  ctx.fillStyle='#1a0533'; ctx.font='bold 11px Quicksand,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('🧺 Thu Hoạch!',x,by);
  ctx.restore();
}

function drawPlant(plot,x,y) {
  const pl=plot.plant, def=PLANTS[pl.type], stage=def.stages[pl.stage];
  if (pl.readyToHarvest) {
    const r=26+7*Math.sin(frameCount*0.05);
    const grd=ctx.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0,def.color+'aa'); grd.addColorStop(1,def.color+'00');
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
  }
  if (pl.watered) { ctx.fillStyle='rgba(116,215,255,0.6)'; ctx.beginPath(); ctx.arc(x+18,y-18,4,0,Math.PI*2); ctx.fill(); }
  if (pl.fertilizerId&&!pl.readyToHarvest) {
    const fd=FERTILIZERS[pl.fertilizerId];
    ctx.font='10px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(fd?fd.icon:'✨',x+20,y-16);
  }
  const bounce=pl.readyToHarvest?Math.sin(frameCount*0.08)*3.5:0;
  const sz=24+pl.stage*5;
  ctx.font=`${sz}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(stage,x,y+bounce);
  if (!pl.readyToHarvest&&pl.stage<3) {
    const needed=getGrowNeeded(pl,plot);
    const pct=Math.min(pl.growTimer/needed,1);
    const bw=44,bh=4,bx=x-bw/2,bys=y+sz*0.55+6;
    ctx.fillStyle='rgba(0,0,0,0.38)'; ctx.beginPath(); roundRect(ctx,bx,bys,bw,bh,2); ctx.fill();
    const grade=POT_GRADES[plot.grade||0]||POT_GRADES[0];
    ctx.fillStyle=pl.fertilizerId?FERTILIZERS[pl.fertilizerId]?.color||def.color:def.color;
    ctx.beginPath(); roundRect(ctx,bx,bys,bw*pct,bh,2); ctx.fill();
  }
}

function drawCursor() {
  if (cursor.x<0) return;
  const icons={plant:'🌱',water:'💧',harvest:'🧺',fertilize:'🧪',remove:'🪓'};
  ctx.font='22px serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(icons[currentTool]||'👆',cursor.x+6,cursor.y+2);
}

function roundRect(ctx,x,y,w,h,r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x,y,w,h,r); }
  else {
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
  }
}

// ── INTERACTION ───────────────────────────────────────────────────────

function onCanvasClick(e) {
  if (!G.running) return;
  const r=canvas.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  for (const plot of G.plots) {
    const sw=getSlotWorld(plot,frameCount);
    if (Math.abs(mx-sw.x)<CFG.CELL_W/2-2&&Math.abs(my-sw.y)<CFG.CELL_H/2-2) {
      // Auto-harvest takes priority regardless of tool
      if (plot.plant&&plot.plant.readyToHarvest) { doHarvest(plot,sw); return; }
      handleClick(plot,sw,e.clientX,e.clientY); return;
    }
  }
  closeAllPopups();
}

function onCanvasRightClick(e) {
  e.preventDefault();
  if (!G.running) return;
  const r=canvas.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  for (const plot of G.plots) {
    const sw=getSlotWorld(plot,frameCount);
    if (Math.abs(mx-sw.x)<CFG.CELL_W/2-2&&Math.abs(my-sw.y)<CFG.CELL_H/2-2) {
      showUpgradePopup(plot,sw,e.clientX,e.clientY); return;
    }
  }
}

function handleClick(plot,sw,scx,scy) {
  if      (currentTool==='plant')     doPlant(plot,sw,scx,scy);
  else if (currentTool==='water')     doWater(plot,sw);
  else if (currentTool==='harvest')   doHarvest(plot,sw);
  else if (currentTool==='fertilize') doFertilize(plot,sw,scx,scy);
  else if (currentTool==='remove')    doRemove(plot,sw);
}

// ── TOOL ACTIONS ──────────────────────────────────────────────────────
function doPlant(plot,sw,scx,scy) {
  if (plot.plant) { showToast('⚠️ Chậu này đã có cây rồi!'); return; }
  if (selectedPlantType) {
    // Sticky: plant directly with saved selection
    doPlantDirect(plot, sw, selectedPlantType);
  } else {
    // No selection yet: show popup
    showPlantPopup(plot, sw, scx, scy);
  }
}

/** Plant a specific type directly without popup */
function doPlantDirect(plot, sw, plantType) {
  const def = PLANTS[plantType];
  if (!def) return;
  if (G.coins < def.cost) { showToast(`❌ Cần ${def.cost} xu! (${def.name})`); return; }
  G.coins -= def.cost;
  plot.plant = { type:plantType, stage:0, growTimer:0, watered:false, fertilizerId:null, readyToHarvest:false };
  G.totalPlants++;
  triggerPotBounce(plot, 1.28);
  spawnParticles(sw.x, sw.y, '#5dbf4e', 6);
  addFloatingText(sw.x, sw.y, `${def.icon} +1`, '#a0ffa0');
  updateHUD();
}

function doWater(plot,sw) {
  if (!plot.plant)               { showToast('⚠️ Chậu trống!'); return; }
  if (plot.plant.readyToHarvest) { showToast('🌟 Thu hoạch ngay đi!'); return; }
  if (plot.plant.watered)        { showToast('💧 Đã tưới rồi!'); return; }
  if (G.water<=0)                { showToast('❌ Hết nước! Chờ mưa~'); return; }
  G.water--; plot.plant.watered=true;
  triggerPotBounce(plot, 1.25);
  spawnParticles(sw.x,sw.y,'#74d7ff',10);
  addFloatingText(sw.x,sw.y,'💧 Tưới!','#74d7ff');
  updateHUD();
}

function doHarvest(plot,sw) {
  if (!plot.plant)                { showToast('⚠️ Không có gì!'); return; }
  if (!plot.plant.readyToHarvest) { showToast('⏳ Chưa trưởng thành!'); return; }
  const prevScore=G.score;
  const rew=getHarvestReward(plot.plant,plot);
  G.coins+=rew.coins; G.score+=rew.score;
  triggerPotBounce(plot, 1.38);
  spawnParticles(sw.x,sw.y,PLANTS[plot.plant.type].color,10);  // reduced: 10 not 20
  spawnLightBurst(sw.x,sw.y);                                   // lightweight, no emoji
  addFloatingText(sw.x,sw.y-10,`+${formatNumber(rew.coins)} xu`,'#ffd700');
  addFloatingText(sw.x,sw.y+16,`+${formatNumber(rew.score)} pts`,'#a0ffb0');
  const grade=POT_GRADES[plot.grade||0];
  if (grade&&grade.id!=='dirt') addFloatingText(sw.x,sw.y-28,grade.icon,'#fff');
  plot.plant=null;
  checkLevelUp(prevScore); saveGame(); updateHUD();
}

function doFertilize(plot,sw,scx,scy) {
  if (!plot.plant)               { showToast('⚠️ Chậu trống!'); return; }
  if (plot.plant.readyToHarvest) { showToast('🌟 Thu hoạch ngay đi!'); return; }
  if (plot.plant.fertilizerId)   { showToast('✨ Đã bón phân rồi!'); return; }
  if (selectedFertType) {
    // Sticky: apply same fertilizer directly
    applyFertDirect(plot, sw, selectedFertType);
  } else {
    showFertPopup(plot, sw, scx, scy);
  }
}

/** Apply fertilizer directly without popup */
function applyFertDirect(plot, sw, fertId) {
  const def = FERTILIZERS[fertId];
  if (!def) return;
  if (G.coins < def.cost) { showToast(`❌ Cần ${def.cost} xu! (${def.name})`); return; }
  G.coins -= def.cost;
  plot.plant.fertilizerId = fertId;
  triggerPotBounce(plot, 1.3);
  if (def.skipStage && plot.plant.stage < 2) {
    plot.plant.stage++; plot.plant.growTimer = 0;
    addFloatingText(sw.x, sw.y-10, '⚡ Skip!', '#ffe566');
  }
  spawnParticles(sw.x, sw.y, def.color||'#e0a0ff', 6);
  addFloatingText(sw.x, sw.y, `${def.icon} bón!`, '#e0a0ff');
  updateHUD();
}

function doRemove(plot,sw) {
  if (!plot.plant) { showToast('⚠️ Chậu trống!'); return; }
  plot.plant=null;
  triggerPotBounce(plot, 1.2);
  spawnParticles(sw.x,sw.y,'#ff8080',6);
  addFloatingText(sw.x,sw.y,'Đã dọn','#ff8080');
  updateHUD();
}

// ── POPUP SYSTEM ──────────────────────────────────────────────────────
function positionPopup(popup, scx, scy) {
  const pw=popup.offsetWidth||240, ph=popup.offsetHeight||300;
  let px=scx+14, py=scy-ph/2;
  if (px+pw>window.innerWidth-10)  px=scx-pw-14;
  if (py<10)                         py=10;
  if (py+ph>window.innerHeight-10)  py=window.innerHeight-ph-10;
  if (px<10)                         px=10;
  popup.style.left=px+'px';
  popup.style.top=py+'px';
}

function showOverlay() { document.getElementById('popupOverlay').classList.remove('hidden'); }

function closeAllPopups() {
  ['plantPopup','fertPopup','upgradePopup'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('popupOverlay').classList.add('hidden');
  popupPlot=null; popupSW=null;
}

// ─ Plant popup ─────────────────────────────────────────────────────
function showPlantPopup(plot,sw,scx,scy) {
  popupPlot=plot; popupSW=sw;
  const popup=document.getElementById('plantPopup');
  const grid=document.getElementById('plantPopupList');
  grid.innerHTML=Object.entries(PLANTS).map(([key,def])=>{
    const can=G.coins>=def.cost;
    const rc=RARITY_COLOR[def.rarity]||RARITY_COLOR.common;
    return `<div class="pp-item${can?'':' disabled'}" ${can?`onclick="doPlantFromPopup('${key}')"`:''}
      style="--rarity-bg:${rc.bg};--rarity-color:${rc.text}">
      <span class="pp-icon">${def.icon}</span>
      <div class="pp-info">
        <div class="pp-name">${def.name} <span class="pp-rarity">${rc.label}</span></div>
        <div class="pp-desc">${def.desc}</div>
        <div class="pp-grow">⏱ ${def.grow} tick tăng trưởng</div>
      </div>
      <div class="pp-cost ${can?'':'pp-no-coin'}">💰 ${formatNumber(def.cost)}</div>
    </div>`;
  }).join('');
  popup.classList.remove('hidden');
  showOverlay();
  positionPopup(popup,scx,scy);
}

function doPlantFromPopup(plantType) {
  if (!popupPlot||!popupSW) return;
  // Set sticky selection FIRST, then plant
  selectedPlantType = plantType;
  doPlantDirect(popupPlot, popupSW, plantType);
  closeAllPopups();
  updateToolbarSelection();
  showToast(`${PLANTS[plantType].icon} Đã chọn ${PLANTS[plantType].name} — click vào chậu khác để tiếp tục trồng!`);
}

// ─ Fertilizer popup ────────────────────────────────────────────────
function showFertPopup(plot,sw,scx,scy) {
  popupPlot=plot; popupSW=sw;
  const popup=document.getElementById('fertPopup');
  const list=document.getElementById('fertPopupList');
  list.innerHTML=Object.entries(FERTILIZERS).map(([key,def])=>{
    const can=G.coins>=def.cost;
    const applied=plot.plant&&plot.plant.fertilizerId===key;
    const rc=RARITY_COLOR[def.rarity]||RARITY_COLOR.common;
    return `<div class="fert-item${can?'':' disabled'}${applied?' applied':''}"
      style="--rarity-bg:${rc.bg};--rarity-color:${rc.text}"
      ${can&&!applied?`onclick="applyFertilizer('${key}')"`:''}> 
      <span class="fert-icon">${def.icon}</span>
      <div class="fert-info">
        <div class="fert-name">${def.name} <span class="fert-rarity">${rc.label}</span></div>
        <div class="fert-desc">${def.desc}</div>
      </div>
      <div class="fert-cost">${applied?'✅ Đã bón':can?`💰${def.cost}`:'❌ '+def.cost}</div>
    </div>`;
  }).join('');
  popup.classList.remove('hidden');
  showOverlay();
  positionPopup(popup,scx,scy);
}

function applyFertilizer(fertId) {
  if (!popupPlot||!popupPlot.plant) return;
  // Set sticky selection FIRST, then apply
  selectedFertType = fertId;
  applyFertDirect(popupPlot, popupSW, fertId);
  closeAllPopups();
  updateToolbarSelection();
  showToast(`${FERTILIZERS[fertId].icon} Đã chọn ${FERTILIZERS[fertId].name} — click vào cây khác để tiếp tục bón!`);
}

// ─ Upgrade popup ───────────────────────────────────────────────────
function showUpgradePopup(plot,sw,scx,scy) {
  popupPlot=plot; popupSW=sw;
  const cur=POT_GRADES[plot.grade||0]||POT_GRADES[0];
  const nxt=POT_GRADES[(plot.grade||0)+1];
  const popup=document.getElementById('upgradePopup');
  const content=document.getElementById('upgradeContent');
  content.innerHTML=`
    <div class="upg-row">
      <div class="upg-grade current"><span class="upg-icon">${cur.icon}</span><span class="upg-name">${cur.name}</span></div>
      <span class="upg-arrow">→</span>
      <div class="upg-grade next ${nxt?'':'maxed'}">
        <span class="upg-icon">${nxt?nxt.icon:'🏆'}</span>
        <span class="upg-name">${nxt?nxt.name:'Tối đa!'}</span>
      </div>
    </div>
    ${nxt?`
    <div class="upg-stats">
      <div class="upg-stat">🌱 Tốc độ: <strong>+${Math.round(nxt.growBonus*100)}%</strong></div>
      <div class="upg-stat">💰 Thưởng: <strong>×${nxt.rewardMult}</strong></div>
      <div class="upg-stat-desc">${nxt.description}</div>
    </div>
    <div class="upg-cost">Chi phí: <strong style="color:#ffd700">${formatNumber(nxt.upgradeCost)} xu</strong></div>
    <button class="upg-btn ${G.coins>=(nxt.upgradeCost||0)?'':'disabled'}" onclick="doUpgrade()"
      ${G.coins>=(nxt.upgradeCost||0)?'':'disabled'}>
      ${G.coins>=(nxt.upgradeCost||0)?'⬆️ Nâng cấp!':'❌ Không đủ xu'}
    </button>`
    :`<div class="upg-maxed">🏆 Chậu đã đạt cấp tối đa!</div>`}
  `;
  popup.classList.remove('hidden');
  showOverlay();
  positionPopup(popup,scx,scy);
}

function doUpgrade() {
  if (!popupPlot) return;
  const grade=popupPlot.grade||0;
  const nxt=POT_GRADES[grade+1];
  if (!nxt)              { showToast('🏆 Chậu đã tối đa!'); closeAllPopups(); return; }
  if (G.coins<nxt.upgradeCost) { showToast('❌ Không đủ xu!'); return; }
  G.coins-=nxt.upgradeCost;
  popupPlot.grade=grade+1;
  triggerPotBounce(popupPlot, 1.5);
  spawnParticles(popupSW.x,popupSW.y,nxt.body1||'#ffd700',25);
  spawnStarBurst(popupSW.x,popupSW.y);
  addFloatingText(popupSW.x,popupSW.y-10,`⬆️ ${nxt.name}!`,'#ffd700');
  closeAllPopups(); saveGame(); updateHUD();
  showToast(`✨ Nâng cấp lên ${nxt.name}!`);
}

// ── PARTICLES ─────────────────────────────────────────────────────────
function spawnParticles(x,y,color,n) {
  for (let i=0;i<n;i++) { const a=Math.random()*Math.PI*2,sp=1.5+Math.random()*3; particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-2,r:3+Math.random()*4,color,life:1,decay:0.022+Math.random()*0.02,type:'dot'}); }
}
/** Lightweight burst: colored dots only, no emoji rendering */
function spawnLightBurst(x,y) {
  const cols=['#ffd700','#ff9ff3','#74d7ff','#a0ffa0','#e0a0ff','#ffe566'];
  for (let i=0;i<8;i++) {
    const a=(i/8)*Math.PI*2, sp=2+Math.random()*2.5;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-1.5,r:4+Math.random()*3,
      color:cols[i%cols.length],life:1,decay:0.024+Math.random()*0.01,type:'dot'});
  }
}
/** Keep spawnStarBurst as alias for compatibility */
const spawnStarBurst = spawnLightBurst;
function spawnGlowAt(sw) { for (let i=0;i<12;i++) { const a=Math.random()*Math.PI*2; particles.push({x:sw.x,y:sw.y,vx:Math.cos(a)*(1+Math.random()*2),vy:Math.sin(a)*(1+Math.random()*2)-2,r:4+Math.random()*4,color:'#ffd700',life:1,decay:0.015,type:'dot'}); } }
function spawnRainParticles() { for (let i=0;i<35;i++) particles.push({x:Math.random()*canvas.width,y:-10,vx:(Math.random()-0.5)*0.5,vy:4+Math.random()*4,r:2+Math.random()*2,color:'#74d7ff',life:1,decay:0.009,type:'drop'}); }
function spawnSunParticles()  { const sx=canvas.width*0.82,sy=canvas.height*0.10; for (let i=0;i<16;i++) particles.push({x:sx+(Math.random()-0.5)*40,y:sy+(Math.random()-0.5)*40,vx:(Math.random()-0.5)*4,vy:1.5+Math.random()*3,r:3+Math.random()*3,color:'#ffe566',life:1,decay:0.008,type:'dot'}); }

function updateParticles() {
  // Hard cap to prevent lag spikes
  if (particles.length > 80) particles = particles.slice(-80);
  particles = particles.filter(p => p.life > 0.001);
  particles.forEach(p => {
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=p.decay;
    if (p.life<=0) return;
    ctx.globalAlpha = Math.max(0,p.life);
    if (p.type==='drop') {
      ctx.fillStyle=p.color; ctx.beginPath();
      ctx.ellipse(p.x,p.y,Math.max(0.01,p.r*0.45),Math.max(0.01,p.r*1.4),Math.PI*0.1,0,Math.PI*2);
      ctx.fill();
    } else {
      ctx.fillStyle=p.color; ctx.beginPath();
      ctx.arc(p.x,p.y,Math.max(0.01,p.r*p.life),0,Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha=1;
  });
}

function addFloatingText(x,y,text,color) { floatingTexts.push({x,y,vy:-1.6,text,color,life:1,decay:0.018}); }
function updateFloatingTexts() {
  floatingTexts=floatingTexts.filter(f=>f.life>0);
  floatingTexts.forEach(f=>{ f.y+=f.vy; f.life-=f.decay; ctx.globalAlpha=Math.max(0,f.life); ctx.font='bold 12px Quicksand,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=3; ctx.strokeText(f.text,f.x,f.y); ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y); ctx.globalAlpha=1; });
}

// ── UI HELPERS ────────────────────────────────────────────────────────
function selectTool(tool) {
  // Re-clicking same tool clears sticky selection → forces re-pick
  if (tool === currentTool && tool === 'plant')     { selectedPlantType = null; showToast('🔄 Click chậu trống để chọn cây mới!'); }
  if (tool === currentTool && tool === 'fertilize') { selectedFertType  = null; showToast('🔄 Click vào cây để chọn phân bón mới!'); }
  currentTool = tool;
  // Drive CSS emoji cursor via data-tool attribute
  canvas.dataset.tool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');
  const tips = {
    plant:    'Click chậu trống để chọn cây. Sau khi chọn, click tiếp các chậu khác để trồng ngay. Click lại nút 🌱 để đổi cây.',
    water:    'Click vào chậu cây để tưới nước (2× tăng trưởng).',
    harvest:  'Di chuột vào cây chín → nút thu hoạch tự hiện. Hoặc click bất cứ cây chín nào.',
    fertilize:'Click vào cây để chọn phân bón. Sau khi chọn, click các cây khác để bón ngay. Click lại nút 🧪 để đổi phân.',
    remove:   'Click vào cây để dọn sạch chậu.',
  };
  document.getElementById('infoPanelContent').innerHTML = tips[tool] + '<div class="tip">💡 Chuột phải vào chậu để nâng cấp!</div>';
  updateToolbarSelection();
}

/** Cập nhật icon toolbar để hiển thị loại đang chọn */
function updateToolbarSelection() {
  const plantBtn = document.getElementById('tool-plant');
  const fertBtn  = document.getElementById('tool-fertilize');
  if (!plantBtn||!fertBtn) return;

  if (selectedPlantType && PLANTS[selectedPlantType]) {
    const d = PLANTS[selectedPlantType];
    plantBtn.innerHTML = `${d.icon}<span class="tool-label">${d.name}</span><span class="tool-sel">✓</span>`;
    plantBtn.title = `Đang trồng: ${d.name} (click lại để đổi)`;
  } else {
    plantBtn.innerHTML = `🌱<span class="tool-label">Trồng</span>`;
    plantBtn.title = 'Chọn cây trồng';
  }

  if (selectedFertType && FERTILIZERS[selectedFertType]) {
    const d = FERTILIZERS[selectedFertType];
    fertBtn.innerHTML = `${d.icon}<span class="tool-label">${d.name}</span><span class="tool-sel">✓</span>`;
    fertBtn.title = `Đang dùng: ${d.name} (click lại để đổi)`;
  } else {
    fertBtn.innerHTML = `🧪<span class="tool-label">Bón phân</span>`;
    fertBtn.title = 'Chọn phân bón';
  }
}

function toggleShop() { shopOpen=!shopOpen; document.getElementById('shopPanel').classList.toggle('open',shopOpen); }

function populateShop() {
  const container=document.getElementById('shopItems');
  container.innerHTML='';
  // The shop just shows info now, main plant select is via popup on click
  container.innerHTML=`<div style="font-size:11px;color:rgba(200,160,255,0.6);text-align:center;padding:8px 0">Click chậu trống để xem & chọn cây trồng</div>`;
}

let toastTimer;
function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}

function updateHUD() {
  const prog = getLevelProgress(G.score);
  const level = prog.level, tier = calcTier(level);
  document.getElementById('hudScore').textContent   = formatNumber(G.score);
  document.getElementById('hudScore').title         = G.score.toLocaleString('vi-VN') + ' điểm';
  document.getElementById('hudCoins').textContent   = formatNumber(G.coins);
  document.getElementById('hudCoins').title         = G.coins.toLocaleString('vi-VN') + ' xu';
  document.getElementById('hudWater').textContent   = G.water;
  document.getElementById('hudSun').textContent     = G.sun;
  document.getElementById('hudPlants').textContent  = G.totalPlants;
  document.getElementById('hudLevel').textContent   = level;
  document.getElementById('hudTier').textContent    = tier + 1;

  // XP progress bar
  document.getElementById('xpBarFill').style.width = prog.pct + '%';
  document.getElementById('xpPct').textContent     = prog.pct + '%';
  document.getElementById('xpNextLv').textContent  = level + 1;
  // Hide glow dot when bar is empty or full
  const glow = document.getElementById('xpGlow');
  if (glow) glow.style.display = (prog.pct > 2 && prog.pct < 100) ? 'block' : 'none';

  // Check unclaimed milestone rewards
  const unclaimedCount = (typeof LEVEL_LADDER !== 'undefined')
    ? LEVEL_LADDER.filter(m => level >= m.level && !(G.claimedMilestones || []).includes(m.level)).length
    : 0;

  document.getElementById('hudLevelBadge').title =
    `Level ${level} | ${prog.xpInLevel}/${prog.xpNeeded} XP (${prog.pct}%) | Cần thêm ${prog.xpToNext} để lên Lv.${level+1}` +
    (unclaimedCount > 0 ? `\n🎁 Có ${unclaimedCount} phần quà Bậc Thang chưa nhận! (Click để mở)` : '\n🏆 Click để xem Bậc Thang Cấp Độ');
}

// ── BẬC THANG LEVEL (LEVEL LADDER SYSTEM) ─────────────────────────────
let currentLadderTab = 'milestones';

function switchLadderTab(tab) {
  currentLadderTab = tab;
  const tabM = document.getElementById('tabLadderMilestones');
  const tabX = document.getElementById('tabLadderXPTable');
  const listM = document.getElementById('ladderStepsList');
  const listX = document.getElementById('ladderXPTableList');
  if (tabM) tabM.classList.toggle('active', tab === 'milestones');
  if (tabX) tabX.classList.toggle('active', tab === 'xptable');
  if (listM) listM.classList.toggle('hidden', tab !== 'milestones');
  if (listX) listX.classList.toggle('hidden', tab !== 'xptable');
  if (tab === 'xptable') renderLadderXPTable();
  else renderLadderSteps();
}

function openLadderModal() {
  switchLadderTab(currentLadderTab);
  const modal = document.getElementById('ladderModal');
  if (modal) modal.classList.add('show');
}

function closeLadderModal() {
  const modal = document.getElementById('ladderModal');
  if (modal) modal.classList.remove('show');
}

function renderLadderXPTable() {
  const container = document.getElementById('ladderXPTableList');
  if (!container) return;

  const prog = getLevelProgress(G.score);
  const curLevel = prog.level;
  const { base, growth } = getLevelConfig();

  // Levels to list: 1 to 50, then by 5s to 100
  const levelsToShow = [];
  for (let i = 1; i <= 50; i++) levelsToShow.push(i);
  for (let i = 55; i <= 100; i += 5) levelsToShow.push(i);

  const rowsHtml = levelsToShow.map(lvl => {
    const xpNeededForThisLevel = base + (lvl - 1) * growth;
    const totalScoreNeeded = scoreRequiredForLevel(lvl);
    const tier = calcTier(lvl) + 1;
    const isPast = curLevel >= lvl;
    const isCurrent = curLevel === (lvl - 1);

    let statusHtml = '';
    let rowClass = 'xpt-row';
    if (isPast) {
      statusHtml = '<span class="xpt-status-badge done">✅ Đã đạt</span>';
      rowClass += ' unlocked';
    } else if (isCurrent) {
      statusHtml = `<span class="xpt-status-badge cur">👉 Mục tiêu (${prog.pct}%)</span>`;
      rowClass += ' current';
    } else {
      const diff = totalScoreNeeded - G.score;
      statusHtml = `<span class="xpt-status-badge lock">🔒 Còn ${formatNumber(diff)} ⭐</span>`;
    }

    return `
      <tr class="${rowClass}">
        <td style="font-weight:700;color:#ffd700">Lv.${lvl}</td>
        <td>+${formatNumber(xpNeededForThisLevel)} <span style="font-size:10px;color:rgba(200,160,255,0.7)">XP</span></td>
        <td style="font-weight:700">${formatNumber(totalScoreNeeded)} ⭐</td>
        <td>Tầng ${tier}</td>
        <td>${statusHtml}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div style="font-size:12px;color:rgba(200,160,255,0.85);margin-bottom:10px;padding:8px 12px;background:rgba(255,255,255,0.05);border-radius:10px">
      📈 <strong>Quy luật bậc thang:</strong> Cấp 1 cần <strong>${base} XP</strong>. Mỗi cấp cao hơn tăng thêm <strong>+${growth} XP</strong>.
    </div>
    <table class="ladder-xptable-wrap">
      <thead>
        <tr>
          <th>Cấp Độ</th>
          <th>XP Cần/Cấp</th>
          <th>Tổng Điểm Tích Lũy</th>
          <th>Tầng Mây</th>
          <th>Trạng Thái</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
}

function renderLadderSteps() {
  if (typeof LEVEL_LADDER === 'undefined') return;
  const curLevel = calcLevel(G.score);
  const curTier  = calcTier(curLevel) + 1;
  const claimed  = G.claimedMilestones || [];

  const curLvEl = document.getElementById('ladderCurLv');
  if (curLvEl) curLvEl.textContent = `Lv.${curLevel}`;
  const curScoreEl = document.getElementById('ladderCurScore');
  if (curScoreEl) curScoreEl.textContent = `${G.score} ⭐`;
  const curTierEl = document.getElementById('ladderCurTier');
  if (curTierEl) curTierEl.textContent = `Tầng ${curTier}`;

  const unclaimed = LEVEL_LADDER.filter(m => curLevel >= m.level && !claimed.includes(m.level));
  const unclaimEl = document.getElementById('ladderUnclaimed');
  if (unclaimEl) unclaimEl.textContent = `${unclaimed.length} 🎁`;

  const container = document.getElementById('ladderStepsList');
  if (!container) return;

  container.innerHTML = LEVEL_LADDER.map((m, idx) => {
    const isUnlocked = curLevel >= m.level;
    const isClaimed  = claimed.includes(m.level);
    const isCurrent  = isUnlocked && (!LEVEL_LADDER[idx + 1] || curLevel < LEVEL_LADDER[idx + 1].level);

    let stepClass = 'ladder-step';
    if (isCurrent) stepClass += ' current';
    else if (isUnlocked) stepClass += ' unlocked';
    else stepClass += ' locked';

    // Reward pills
    const rewPills = [];
    if (m.reward.coins) rewPills.push(`<span class="ladder-rew-pill">💰 +${formatNumber(m.reward.coins)}</span>`);
    if (m.reward.water) rewPills.push(`<span class="ladder-rew-pill">💧 +${m.reward.water}</span>`);
    if (m.reward.sun)   rewPills.push(`<span class="ladder-rew-pill">☀️ +${m.reward.sun}</span>`);
    if (m.reward.fert && typeof FERTILIZERS !== 'undefined' && FERTILIZERS[m.reward.fert]) {
      const f = FERTILIZERS[m.reward.fert];
      rewPills.push(`<span class="ladder-rew-pill">${f.icon} ${f.name}</span>`);
    }

    let btnHtml = '';
    if (isClaimed) {
      btnHtml = `<button class="ladder-claim-btn claimed" disabled>✅ Đã Nhận</button>`;
    } else if (isUnlocked) {
      btnHtml = `<button class="ladder-claim-btn ready" onclick="claimMilestoneReward(${m.level})">✨ Nhận Quà!</button>`;
    } else {
      btnHtml = `<button class="ladder-claim-btn locked" disabled>🔒 Lv.${m.level}</button>`;
    }

    return `
      <div class="${stepClass}">
        <div class="ladder-badge-col">
          <span class="ladder-badge-icon">${m.badge}</span>
          <span class="ladder-lvl-tag">Lv.${m.level}</span>
        </div>
        <div class="ladder-info-col">
          <div class="ladder-step-title">
            ${m.title}
            ${m.isTierUnlock ? '<span class="ladder-tier-badge">🌤️ TẦNG MÂY MỚI</span>' : ''}
          </div>
          <div class="ladder-step-desc">${m.desc}</div>
          <div class="ladder-unlock-tag">🎁 Mở khóa: ${m.unlock}</div>
        </div>
        <div class="ladder-reward-col">
          <div class="ladder-rewards-list">${rewPills.join('')}</div>
          ${btnHtml}
        </div>
      </div>
    `;
  }).join('');
}

function claimMilestoneReward(level) {
  if (typeof LEVEL_LADDER === 'undefined') return;
  const milestone = LEVEL_LADDER.find(m => m.level === level);
  if (!milestone) return;

  const curLevel = calcLevel(G.score);
  if (curLevel < level) {
    showToast(`❌ Bạn cần đạt Level ${level} để nhận mốc này!`);
    return;
  }
  if (!G.claimedMilestones) G.claimedMilestones = [];
  if (G.claimedMilestones.includes(level)) {
    showToast('⚠️ Bạn đã nhận phần thưởng mốc này rồi!');
    return;
  }

  // Grant rewards
  G.claimedMilestones.push(level);
  if (milestone.reward.coins) G.coins += milestone.reward.coins;
  if (milestone.reward.water) G.water = Math.min(G.water + milestone.reward.water, 99);
  if (milestone.reward.sun)   G.sun   = Math.min(G.sun + milestone.reward.sun, 99);

  // Celebration effects
  spawnLightBurst(canvas.width * 0.5, canvas.height * 0.4);
  setTimeout(() => spawnLightBurst(canvas.width * 0.6, canvas.height * 0.45), 180);

  const parts = [];
  if (milestone.reward.coins) parts.push(`+${milestone.reward.coins} xu 💰`);
  if (milestone.reward.water) parts.push(`+${milestone.reward.water} nước 💧`);
  if (milestone.reward.sun)   parts.push(`+${milestone.reward.sun} sáng ☀️`);
  if (milestone.reward.fert && typeof FERTILIZERS !== 'undefined' && FERTILIZERS[milestone.reward.fert]) {
    parts.push(`1x ${FERTILIZERS[milestone.reward.fert].name} ✨`);
  }

  showToast(`🎉 Nhận thưởng Cột Mốc Lv.${level}: ${parts.join(', ')}!`);
  saveGame();
  updateHUD();
  renderLadderSteps();
}

// ── PLANT CONFIG (admin override) ────────────────────────────────────
// LS_PLANT_CONFIG is defined in constants.js


/**
 * Load cấu hình cây do admin chỉnh sửa từ localStorage và patch PLANTS object.
 * Gọi sau khi data/plants.js đã load.
 */
function loadPlantConfig() {
  try {
    const raw = localStorage.getItem(LS_PLANT_CONFIG);
    if (!raw) return;
    const cfg = JSON.parse(raw);
    Object.entries(cfg).forEach(([key, override]) => {
      if (!PLANTS[key]) return;
      if (typeof override.cost === 'number')          PLANTS[key].cost = override.cost;
      if (override.reward) {
        if (typeof override.reward.coins === 'number') PLANTS[key].reward.coins = override.reward.coins;
        if (typeof override.reward.score === 'number') PLANTS[key].reward.score = override.reward.score;
      }
    });
  } catch { /* ignore */ }
}

function loadFertConfig() {
  try {
    const raw = localStorage.getItem('kvtm_fert_config');
    if (!raw) return;
    const cfg = JSON.parse(raw);
    Object.entries(cfg).forEach(([key, ov]) => {
      if (!FERTILIZERS[key]) return;
      if (typeof ov.cost        === 'number') FERTILIZERS[key].cost        = ov.cost;
      if (typeof ov.growMult    === 'number') FERTILIZERS[key].growMult    = ov.growMult;
      if (typeof ov.rewardBonus === 'number') FERTILIZERS[key].rewardBonus = ov.rewardBonus;
    });
  } catch { /* ignore */ }
}

function loadGameConfig() {
  try {
    const raw = localStorage.getItem('kvtm_game_config');
    if (!raw) return;
    const cfg = JSON.parse(raw);
    // Patch CFG object with admin overrides
    if (typeof cfg.GROW_TICK   === 'number') CFG.GROW_TICK   = cfg.GROW_TICK;
    if (typeof cfg.WATER_MULT  === 'number') CFG.WATER_MULT  = cfg.WATER_MULT;
    if (typeof cfg.RAIN_INT    === 'number') CFG.RAIN_INT    = cfg.RAIN_INT;
    if (typeof cfg.SUN_INT     === 'number') CFG.SUN_INT     = cfg.SUN_INT;
    if (typeof cfg.BONUS_INT   === 'number') CFG.BONUS_INT   = cfg.BONUS_INT;
    // Note: XP_BASE, XP_GROWTH, LEVELS_PER_TIER are const — store overrides separately
    if (typeof cfg.XP_BASE === 'number')         window._XP_BASE_OVERRIDE = cfg.XP_BASE;
    if (typeof cfg.XP_GROWTH === 'number')       window._XP_GROWTH_OVERRIDE = cfg.XP_GROWTH;
    if (typeof cfg.SCORE_PER_LEVEL === 'number') window._XP_BASE_OVERRIDE = cfg.SCORE_PER_LEVEL;
    if (typeof cfg.LEVELS_PER_TIER === 'number') window._LEVELS_PER_TIER_OVERRIDE = cfg.LEVELS_PER_TIER;
    // Starting resources are applied in resetGameState if no save exists
    window._GAME_CONFIG = cfg;
  } catch { /* ignore */ }
}

function loadLadderConfig() {
  try {
    const raw = localStorage.getItem(LS_LADDER_CONFIG || 'kvtm_ladder_config');
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (Array.isArray(cfg) && cfg.length > 0 && typeof LEVEL_LADDER !== 'undefined') {
      LEVEL_LADDER.length = 0;
      cfg.forEach(m => LEVEL_LADDER.push(m));
    }
  } catch { /* ignore */ }
}

function loadPotConfig() {
  try {
    const raw = localStorage.getItem(LS_POT_CONFIG || 'kvtm_pot_config');
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (!Array.isArray(cfg) && typeof cfg === 'object') {
      // Support object format keyed by pot id (dirt, copper, silver, etc.) or index
      POT_GRADES.forEach((pot, idx) => {
        const ov = cfg[pot.id] || cfg[idx];
        if (!ov) return;
        if (typeof ov.name === 'string' && ov.name.trim()) pot.name = ov.name.trim();
        if (typeof ov.upgradeCost === 'number' || ov.upgradeCost === null) pot.upgradeCost = ov.upgradeCost;
        if (typeof ov.growBonus === 'number') pot.growBonus = ov.growBonus;
        if (typeof ov.rewardMult === 'number') pot.rewardMult = ov.rewardMult;
        if (typeof ov.description === 'string') pot.description = ov.description;
      });
    }
  } catch { /* ignore */ }
}
