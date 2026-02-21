/*
 * Gravity Flip Runner
 * Copyright (c) 2026 VersionBear - https://versionbear.itssljk.com
 * Licensed under MIT: https://opensource.org/licenses/MIT
 */

const canvas = document.getElementById('game-canvas'), ctx = canvas.getContext('2d');
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const W = 840, H = 420;
const DPR = Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 2);

function sizeCanvas() {
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = '100%'; canvas.style.aspectRatio = `${W}/${H}`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
sizeCanvas();

// Perf: fewer effects on mobile
const STAR_COUNT = isMobile ? 50 : 100;
const MAX_PARTICLES = isMobile ? 60 : 200;
const DEATH_PARTICLES = isMobile ? 24 : 40;
const FLIP_PARTICLES = isMobile ? 6 : 12;
const ORB_PARTICLES = isMobile ? 8 : 16;

const GROUND_H = 5, PLAYER_SIZE = 24, BASE_SPEED = 3.8, SPEED_INC = .00045, MAX_SPEED = 13;
const FLIP_DURATION = .16, MIN_OBS_GAP = 140, TRAIL_LEN = isMobile ? 10 : 16, ORB_RADIUS = 7;

const ZONES = [
    { speed: 0, name: '', color: '#6c5ce7', gc: '#6c5ce7' },
    { speed: 5, name: '⚡ FAST', color: '#00b894', gc: '#00b894' },
    { speed: 7, name: '🔥 BLAZING', color: '#e17055', gc: '#e17055' },
    { speed: 9, name: '💀 INSANE', color: '#d63031', gc: '#d63031' },
    { speed: 11, name: '🌀 IMPOSSIBLE', color: '#e84393', gc: '#e84393' },
];

let state = 'idle', score = 0, bestScore = parseInt(localStorage.getItem('gfr_best3') || '0', 10);
let speed = BASE_SPEED, distancePx = 0, frameCount = 0, currentZone = 0;
let screenShake = 0, screenFlash = 0, flashColor = '#fff';
let totalFlips = 0, totalOrbs = 0, totalNearMiss = 0, combo = 0, comboTimer = 0;

const player = { x: 110, y: 0, targetY: 0, onCeiling: false, flipProgress: 1, rotation: 0, squash: 1, trail: [], glowPulse: 0 };
let obstacles = [], orbs = [], particles = [], stars = [], buildings = [], gridOffset = 0;

const $ = id => document.getElementById(id);
const scoreEl = $('score-value'), bestEl = $('best-value'), comboEl = $('combo-value');
const comboDisp = $('combo-display'), speedEl = $('speed-value');
const startOv = $('start-overlay'), overOv = $('gameover-overlay');
const finalEl = $('final-score'), bestBadge = $('new-best-badge');
const statO = $('stat-orbs'), statF = $('stat-flips'), statN = $('stat-near');
const toastBox = $('toast-container'), tapFlash = $('tap-flash');
bestEl.textContent = bestScore;

// -- Audio --
let audioCtx = null;
function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume() }
function sfx(type, freq, freq2, dur, vol = .1) {
    ensureAudio(); const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq2, audioCtx.currentTime + dur * .7);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
}
function playFlip() { sfx('sine', 500, 1200, .12, .12) }
function playOrb(p) { sfx('triangle', 600 + p * 80, 900 + p * 100, .15, .1) }
function playDeath() { sfx('sawtooth', 300, 60, .5, .15) }
function playNearMiss() { sfx('sine', 1400, 1800, .1, .06) }
function playMilestone() { [0, .08, .16].forEach((t, i) => { setTimeout(() => sfx('square', 400 + i * 200, 500 + i * 200, .12, .06), t * 1000) }) }

// Haptic
function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms) }

// -- Toast --
function showToast(text, type = 'milestone') {
    const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = text;
    toastBox.appendChild(el); setTimeout(() => el.remove(), 1700);
}

// -- Init --
function initStars() { stars = []; for (let i = 0; i < STAR_COUNT; i++)stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + .2, speed: Math.random() * .5 + .05, alpha: Math.random() * .35 + .05, tw: Math.random() * Math.PI * 2 }) }
function initBuildings() { buildings = []; let bx = 0; while (bx < W + 100) { const bw = 30 + Math.random() * 50, bh = 20 + Math.random() * 60; buildings.push({ x: bx, w: bw, h: bh, win: Math.floor(Math.random() * 4) + 1 }); bx += bw + Math.random() * 20 } }
function floorY() { return H - GROUND_H - PLAYER_SIZE }
function ceilingY() { return GROUND_H }
function getZone() { let z = 0; for (let i = ZONES.length - 1; i >= 0; i--)if (speed >= ZONES[i].speed) { z = i; break } return z }
function zoneColor() { return ZONES[currentZone].color }
function hexRgba(hex, a) { return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})` }

function resetPlayer() { Object.assign(player, { onCeiling: false, y: floorY(), targetY: floorY(), flipProgress: 1, rotation: 0, squash: 1, trail: [], glowPulse: 0 }) }
function resetGame() {
    score = 0; speed = BASE_SPEED; distancePx = 0; frameCount = 0; currentZone = 0;
    screenShake = 0; screenFlash = 0; totalFlips = 0; totalOrbs = 0; totalNearMiss = 0;
    combo = 0; comboTimer = 0; obstacles = []; orbs = []; particles = []; gridOffset = 0;
    resetPlayer(); scoreEl.textContent = '0'; comboDisp.style.opacity = '0'; speedEl.textContent = '1.0×';
}

// -- Obstacles --
function spawnObs() {
    const ceil = Math.random() < .5, h = 28 + Math.random() * 65, w = 16 + Math.random() * 16;
    const mov = speed > 6 && Math.random() < .2;
    obstacles.push({ x: W + 30, y: ceil ? GROUND_H : H - GROUND_H - h, w, h, ceil, passed: false, nmCheck: false, mov, phase: Math.random() * Math.PI * 2, amp: mov ? 15 + Math.random() * 20 : 0, baseY: ceil ? GROUND_H : H - GROUND_H - h });
}
function shouldSpawn() { if (!obstacles.length) return true; const l = obstacles[obstacles.length - 1]; return l.x < W - Math.max(MIN_OBS_GAP + Math.random() * 90 - speed * 5, 90) }

function spawnOrb() { const c = Math.random() < .5; orbs.push({ x: W + 20 + Math.random() * 80, y: c ? GROUND_H + 10 + Math.random() * 40 : H - GROUND_H - 10 - Math.random() * 40, pulse: Math.random() * Math.PI * 2 }) }

// -- Particles --
function emit(x, y, count, opts) { for (let i = 0; i < Math.min(count, MAX_PARTICLES - particles.length); i++) { const a = opts.ring ? (i / count) * Math.PI * 2 : Math.random() * Math.PI * 2; const v = opts.vel || 3; particles.push({ x, y, vx: Math.cos(a) * (opts.ring ? v : Math.random() * v + 1), vy: opts.dir ? opts.dir * (Math.random() * 3 + 1) : Math.sin(a) * (opts.ring ? v : Math.random() * v + 1), life: 1, decay: opts.decay || .025, size: Math.random() * (opts.sz || 3) + 1, color: opts.color || '#fff', type: opts.type || 'circle' }) } }

// -- Collision --
function checkHit() { const px = player.x + 4, py = player.y + 4, ps = PLAYER_SIZE - 8; for (const o of obstacles) if (px < o.x + o.w && px + ps > o.x && py < o.y + o.h && py + ps > o.y) return true; return false }

function checkNearMiss() {
    const px = player.x + PLAYER_SIZE / 2, py = player.y + PLAYER_SIZE / 2;
    for (const o of obstacles) {
        if (o.nmCheck) continue; if (o.x + o.w < px && o.x + o.w > px - 36) {
            const dy = o.ceil ? py - (o.y + o.h) : o.y - py;
            if (dy > 0 && dy < 18 + PLAYER_SIZE / 2) { o.nmCheck = true; totalNearMiss++; const b = 15 * (combo > 0 ? combo : 1); score += b; showToast(`CLOSE! +${b}`, 'nearmiss'); playNearMiss(); emit(px, py, 4, { color: '#ffc048', sz: 2, decay: .04 }) }
        }
    }
}

function checkOrbs() {
    const px = player.x + PLAYER_SIZE / 2, py = player.y + PLAYER_SIZE / 2;
    for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i], dx = px - o.x, dy = py - o.y;
        if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE / 2 + ORB_RADIUS) {
            totalOrbs++; combo++; comboTimer = 180; score += 25 * combo;
            emit(o.x, o.y, ORB_PARTICLES, { ring: true, vel: 3, color: '#ffc048', decay: .03 });
            playOrb(Math.min(combo, 8)); vibrate(30);
            comboEl.textContent = `×${combo}`; comboDisp.style.opacity = '1'; orbs.splice(i, 1);
        }
    }
}

function flipGravity() {
    if (state !== 'playing' || player.flipProgress < 1) return;
    player.onCeiling = !player.onCeiling; player.targetY = player.onCeiling ? ceilingY() : floorY();
    player.flipProgress = 0; player.squash = .7; totalFlips++;
    emit(player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2, FLIP_PARTICLES, { dir: player.onCeiling ? 1 : -1, color: zoneColor(), decay: .035 });
    playFlip(); vibrate(15);
    // tap flash
    tapFlash.style.opacity = '1'; setTimeout(() => tapFlash.style.opacity = '0', 80);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3) }

// -- Update --
function update() {
    // particles always
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vx *= .98; p.vy *= .98; p.life -= p.decay; if (p.life <= 0) particles.splice(i, 1) }
    if (screenShake > .1) screenShake *= .85;
    if (screenFlash > .01) screenFlash *= .88;
    player.glowPulse += .05;
    if (state !== 'playing') return;

    frameCount++; speed = Math.min(BASE_SPEED + frameCount * SPEED_INC, MAX_SPEED);
    distancePx += speed; score = Math.max(score, Math.floor(distancePx / 10)); scoreEl.textContent = score;
    speedEl.textContent = `${(speed / BASE_SPEED).toFixed(1)}×`;

    if (comboTimer > 0) { comboTimer--; if (comboTimer <= 0) { combo = 0; comboDisp.style.opacity = '0' } }

    const nz = getZone(); if (nz > currentZone) { currentZone = nz; showToast(ZONES[nz].name); playMilestone(); screenFlash = .6; flashColor = ZONES[nz].color; vibrate(50) }

    if (player.flipProgress < 1) { player.flipProgress += 1 / (FLIP_DURATION * 60); if (player.flipProgress > 1) player.flipProgress = 1; const t = easeOut(player.flipProgress); const s = player.onCeiling ? floorY() : ceilingY(); player.y = s + (player.targetY - s) * t }
    player.squash += (1 - player.squash) * .15;
    player.rotation += (player.onCeiling ? Math.PI : 0 - player.rotation) * .18;
    player.trail.unshift({ x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 });
    if (player.trail.length > TRAIL_LEN) player.trail.pop();

    gridOffset = (gridOffset + speed) % 40;
    for (const s of stars) { s.x -= s.speed * (speed / BASE_SPEED); s.tw += .02; if (s.x < -2) { s.x = W + 2; s.y = Math.random() * H } }
    for (const b of buildings) { b.x -= speed * .25; if (b.x + b.w < -10) { b.x = W + Math.random() * 60; b.w = 30 + Math.random() * 50; b.h = 20 + Math.random() * 60; b.win = Math.floor(Math.random() * 4) + 1 } }

    if (shouldSpawn()) spawnObs();
    for (let i = obstacles.length - 1; i >= 0; i--) { const o = obstacles[i]; o.x -= speed; if (o.mov) { o.phase += .04; const d = Math.sin(o.phase) * o.amp; if (o.ceil) { o.h = Math.max(20, Math.min(90, o.h + d * .3)) } else { const nh = Math.max(20, Math.min(90, o.h + d * .05)); o.y = H - GROUND_H - nh; o.h = nh } } if (o.x + o.w < -40) obstacles.splice(i, 1) }

    if (Math.random() < .012 && orbs.length < 4) spawnOrb();
    for (let i = orbs.length - 1; i >= 0; i--) { orbs[i].x -= speed; orbs[i].pulse += .06; if (orbs[i].x < -20) orbs.splice(i, 1) }

    checkOrbs(); checkNearMiss(); if (checkHit()) die();
}

// -- Draw --
function draw() {
    ctx.save();
    if (screenShake > .5) ctx.translate((Math.random() - .5) * screenShake, (Math.random() - .5) * screenShake);

    const zc = zoneColor();
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#08081a'); bg.addColorStop(1, '#0c0c22'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(108,92,231,.03)'; ctx.lineWidth = 1;
    for (let x = -gridOffset; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    // stars
    for (const s of stars) { ctx.globalAlpha = s.alpha * (.4 + (Math.sin(s.tw) + 1) / 2 * .6); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill() }
    ctx.globalAlpha = 1;

    // buildings
    for (const b of buildings) { ctx.fillStyle = 'rgba(30,30,55,.5)'; ctx.fillRect(b.x, H - GROUND_H - b.h, b.w, b.h); ctx.fillStyle = 'rgba(108,92,231,.08)'; for (let i = 0; i < b.win; i++) { const wy = H - GROUND_H - b.h + 6 + i * 12; ctx.fillRect(b.x + 5, wy, 4, 4); if (b.w > 30) ctx.fillRect(b.x + b.w - 9, wy, 4, 4) } }

    // ground glow
    const gc = ZONES[currentZone].gc;
    let g1 = ctx.createLinearGradient(0, H - GROUND_H, 0, H - GROUND_H - 50); g1.addColorStop(0, hexRgba(gc, .15)); g1.addColorStop(1, 'transparent'); ctx.fillStyle = g1; ctx.fillRect(0, H - GROUND_H - 50, W, 50);
    let g2 = ctx.createLinearGradient(0, GROUND_H, 0, GROUND_H + 50); g2.addColorStop(0, hexRgba(gc, .15)); g2.addColorStop(1, 'transparent'); ctx.fillStyle = g2; ctx.fillRect(0, GROUND_H, W, 50);
    ctx.fillStyle = gc; ctx.fillRect(0, H - GROUND_H, W, GROUND_H); ctx.fillRect(0, 0, W, GROUND_H);

    // orbs
    for (const o of orbs) { const ps = Math.sin(o.pulse) * 2; ctx.shadowColor = 'rgba(255,192,72,.5)'; ctx.shadowBlur = 14; ctx.fillStyle = '#ffc048'; ctx.globalAlpha = .8; ctx.beginPath(); ctx.arc(o.x, o.y, ORB_RADIUS + ps, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#fff8e8'; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(o.x, o.y, ORB_RADIUS * .45, 0, Math.PI * 2); ctx.fill() }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

    // trail
    if (player.trail.length > 1) { ctx.lineCap = 'round'; for (let i = 1; i < player.trail.length; i++) { const t = 1 - i / player.trail.length; ctx.globalAlpha = t * .35; ctx.strokeStyle = zc; ctx.lineWidth = PLAYER_SIZE * .5 * t; ctx.beginPath(); ctx.moveTo(player.trail[i - 1].x, player.trail[i - 1].y); ctx.lineTo(player.trail[i].x, player.trail[i].y); ctx.stroke() } ctx.globalAlpha = 1 }

    // player
    ctx.save(); const pcx = player.x + PLAYER_SIZE / 2, pcy = player.y + PLAYER_SIZE / 2;
    ctx.translate(pcx, pcy); ctx.rotate(player.rotation); ctx.scale(player.squash, 2 - player.squash);
    const gr = PLAYER_SIZE * .8 + Math.sin(player.glowPulse) * 3; ctx.globalAlpha = .08 + Math.sin(player.glowPulse) * .04; ctx.fillStyle = zc; ctx.beginPath(); ctx.arc(0, 0, gr, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.shadowColor = hexRgba(zc, .5); ctx.shadowBlur = 18; ctx.fillStyle = zc;
    const hf = PLAYER_SIZE / 2, rr = 7; ctx.beginPath(); ctx.moveTo(-hf + rr, -hf); ctx.lineTo(hf - rr, -hf); ctx.quadraticCurveTo(hf, -hf, hf, -hf + rr); ctx.lineTo(hf, hf - rr); ctx.quadraticCurveTo(hf, hf, hf - rr, hf); ctx.lineTo(-hf + rr, hf); ctx.quadraticCurveTo(-hf, hf, -hf, hf - rr); ctx.lineTo(-hf, -hf + rr); ctx.quadraticCurveTo(-hf, -hf, -hf + rr, -hf); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(-hf + 3, -hf + 3, PLAYER_SIZE - 6, PLAYER_SIZE * .35);
    ctx.fillStyle = '#fff'; ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(3, -2, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(-5, -2, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a2e'; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(4, -2, 1.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(-4.5, -2, 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // obstacles
    for (const o of obstacles) {
        ctx.shadowColor = 'rgba(255,71,87,.3)'; ctx.shadowBlur = 14;
        const og = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h); og.addColorStop(0, o.ceil ? '#cc3344' : '#ff4757'); og.addColorStop(1, o.ceil ? '#ff4757' : '#cc3344'); ctx.fillStyle = og;
        const c = 5; ctx.beginPath(); ctx.moveTo(o.x + c, o.y); ctx.lineTo(o.x + o.w - c, o.y); ctx.quadraticCurveTo(o.x + o.w, o.y, o.x + o.w, o.y + c); ctx.lineTo(o.x + o.w, o.y + o.h - c); ctx.quadraticCurveTo(o.x + o.w, o.y + o.h, o.x + o.w - c, o.y + o.h); ctx.lineTo(o.x + c, o.y + o.h); ctx.quadraticCurveTo(o.x, o.y + o.h, o.x, o.y + o.h - c); ctx.lineTo(o.x, o.y + c); ctx.quadraticCurveTo(o.x, o.y, o.x + c, o.y); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(0,0,0,.12)'; for (let sy = o.y + 4; sy < o.y + o.h - 4; sy += 12)ctx.fillRect(o.x + 3, sy, o.w - 6, 6);
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(o.x + 3, o.ceil ? o.y + o.h - 3 : o.y + 2, o.w - 6, 2);
        if (o.mov) { ctx.globalAlpha = .15 + Math.sin(o.phase * 2) * .1; ctx.fillStyle = '#ff4757'; ctx.fillRect(o.x - 2, o.y - 2, o.w + 4, o.h + 4); ctx.globalAlpha = 1 }
    }
    ctx.shadowBlur = 0;

    // particles
    for (const p of particles) { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; if (p.type === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill() } else { ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size) } }
    ctx.globalAlpha = 1;

    // flash
    if (screenFlash > .02) { ctx.globalAlpha = screenFlash * .3; ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1 }

    // vignette
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * .4, W / 2, H / 2, W * .8); vig.addColorStop(0, 'transparent'); vig.addColorStop(1, 'rgba(0,0,0,.35)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

// -- Lifecycle --
function startGame() { ensureAudio(); resetGame(); startOv.classList.add('hidden'); overOv.classList.add('hidden'); toastBox.innerHTML = ''; state = 'playing' }
function die() {
    state = 'dead'; const cx = player.x + PLAYER_SIZE / 2, cy = player.y + PLAYER_SIZE / 2;
    emit(cx, cy, DEATH_PARTICLES, { vel: 7, sz: 5, decay: .015, color: '#ff6b81', type: 'square' });
    emit(cx, cy, Math.floor(DEATH_PARTICLES / 2), { ring: true, vel: 4, decay: .025, color: '#ff4757' });
    playDeath(); vibrate([50, 30, 80]); screenShake = 14; screenFlash = 1; flashColor = '#ff4757';
    let isNew = score > bestScore; if (isNew) { bestScore = score; localStorage.setItem('gfr_best3', bestScore); bestEl.textContent = bestScore }
    setTimeout(() => { finalEl.textContent = score; statO.textContent = totalOrbs; statF.textContent = totalFlips; statN.textContent = totalNearMiss; bestBadge.classList.toggle('show', isNew); overOv.classList.remove('hidden') }, 600);
}

function loop() { update(); draw(); requestAnimationFrame(loop) }

// -- Input --
function handleAction() {
    if (state === 'playing') flipGravity();
    else if (state === 'dead' && !overOv.classList.contains('hidden')) startGame();
    else if (state === 'idle') startGame();
}

document.addEventListener('keydown', e => { if (['Space', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) { e.preventDefault(); handleAction() } });
canvas.addEventListener('pointerdown', e => { e.preventDefault(); handleAction() });
document.getElementById('touch-zone').addEventListener('pointerdown', e => { e.preventDefault(); if (state === 'playing') flipGravity() });
$('start-btn').addEventListener('click', startGame);
$('restart-btn').addEventListener('click', startGame);
$('dismiss-rotate').addEventListener('click', () => { $('rotate-hint').style.display = 'none' });

// Prevent ALL default touch behaviors
document.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());

// Handle resize / orientation
window.addEventListener('resize', () => { sizeCanvas() });
window.addEventListener('orientationchange', () => { setTimeout(sizeCanvas, 100); const rh = $('rotate-hint'); if (window.innerWidth > window.innerHeight) rh.style.display = 'none' });

// -- Boot --
initStars(); initBuildings(); resetPlayer(); loop();
