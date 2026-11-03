// Offset Wizard — płyta drukarki Bambu (H2D): rozmieszczenie części z podglądu 3D na płytach.
// Każda część to jej obrys z góry (rzut trójkątów narysowany na canvasie), zamieniony na maskę z komórek `c` mm i powiększony o pół odstępu.
// Upychanie: części od największej, każda w kilku obrotach, pozycja o najniższym wierzchu (od lewej), pierwsza płyta, na której się zmieści.
// Podstawy, klosze, litery i plasterki idą na osobne płyty. Strefy „tylko lewa / tylko prawa dysza” są używane tylko na życzenie.
const PL = { open: false, src: null, plates: [], sel: 0, busy: false, cache: new Map() };
const PL_GRP = [['podstawa', 'Podstawy'], ['klosz', 'Klosze'], ['litera', 'Litery pełne'], ['plaster', 'Plasterki']];
const PL_SPR = 4;   // px na mm w obrazku części
const PL_KEY = 'offsetPlyta';

function plOpt() {
  const g = id => num($(id).value), o = { W: g('pl-w') || 350, D: g('pl-d') || 320, H: g('pl-hz') || 325, L: $('pl-l').checked, R: $('pl-r').checked, sz: Math.max(0, g('pl-sz')), gap: Math.max(0, g('pl-gap')), mg: Math.max(0, g('pl-mg')), rot: Number($('pl-rot').value), c: Number($('pl-res').value) || 1, flipK: $('pl-fk').checked, grp: {} };
  PL_GRP.forEach(([k]) => { o.grp[k] = $('pl-g' + k).checked; });
  o.xa = (o.L ? 0 : o.sz) + o.mg; o.xb = o.W - (o.R ? 0 : o.sz) - o.mg; o.ya = o.mg; o.yb = o.D - o.mg;
  return o;
}
function plMsg(t) { const m = $('vpl-msg'); m.textContent = t || ''; m.classList.toggle('hidden', !t); }

// części do rozmieszczenia: wierzchołki wyśrodkowane w XY, dół na z = 0 (opcjonalnie obrócone o 180° wokół X)
function plItems(o) {
  const out = [];
  V3.bodies.forEach(b => {
    if (!o.grp[b.part]) return;
    const st = b.numProp || 3, n = b.pos.length / st, flip = b.part === 'klosz' && o.flipK, xyz = new Float32Array(n * 3);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = 0; v < n; v++) {
      let x = b.pos[v * st], y = b.pos[v * st + 1], z = b.pos[v * st + 2]; if (flip) { y = -y; z = -z; }
      xyz[v * 3] = x; xyz[v * 3 + 1] = y; xyz[v * 3 + 2] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (!n) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let v = 0; v < n; v++) { xyz[v * 3] -= cx; xyz[v * 3 + 1] -= cy; xyz[v * 3 + 2] -= z0; }
    out.push({ name: b.name, grp: b.part, plType: b.plType, xyz, tri: b.tri, w: x1 - x0, h: y1 - y0, zh: z1 - z0 });
  });
  return out;
}

// obrys części z góry: wszystkie trójkąty o jednakowym obiegu, więc zlewają się w jedną plamę
function plSprite(it) {
  if (it.spr) return it.spr;
  const cv = document.createElement('canvas'), sw = Math.ceil(it.w * PL_SPR) + 4, sh = Math.ceil(it.h * PL_SPR) + 4; cv.width = sw; cv.height = sh;
  const x = cv.getContext('2d'), P = it.xyz, T = it.tri; x.fillStyle = x.strokeStyle = '#000'; x.lineWidth = 1; x.lineJoin = 'round'; x.beginPath();
  for (let t = 0; t < T.length; t += 3) {
    let a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const ar = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]); if (ar === 0) continue;
    if (ar > 0) { const q = b; b = c; c = q; }
    x.moveTo(sw / 2 + P[a] * PL_SPR, sh / 2 - P[a + 1] * PL_SPR); x.lineTo(sw / 2 + P[b] * PL_SPR, sh / 2 - P[b + 1] * PL_SPR); x.lineTo(sw / 2 + P[c] * PL_SPR, sh / 2 - P[c + 1] * PL_SPR); x.closePath();
  }
  x.fill(); x.stroke();
  return (it.spr = { cv, sw, sh });
}

// maska obrotu `ang` (CCW): komórki zajęte po powiększeniu o d komórek; wiersz 0 = najniższy y; środek maski = środek części
function plMask(it, ang, c, d) {
  const sp = plSprite(it), th = ang * Math.PI / 180, cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
  const mw = Math.ceil(it.w * cs + it.h * sn) / c, mh = Math.ceil(it.w * sn + it.h * cs) / c, W = Math.ceil(mw) + 2 * d + 2, H = Math.ceil(mh) + 2 * d + 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.translate(W / 2, H / 2); x.rotate(-th); x.scale(1 / (PL_SPR * c), 1 / (PL_SPR * c)); x.drawImage(sp.cv, -sp.sw / 2, -sp.sh / 2);
  const a = x.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); let n0 = 0;
  for (let r = 0; r < H; r++) for (let i = 0; i < W; i++) if (a[(r * W + i) * 4 + 3] > 8) { m[(H - 1 - r) * W + i] = 1; n0++; }
  let md = m;
  if (d > 0) {
    md = new Uint8Array(W * H); const off = []; for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (dx * dx + dy * dy <= d * d + 0.5) off.push([dx, dy]);
    for (let r = 0; r < H; r++) for (let i = 0; i < W; i++) if (m[r * W + i]) for (const [dx, dy] of off) { const rr = r + dy, ii = i + dx; if (rr >= 0 && rr < H && ii >= 0 && ii < W) md[rr * W + ii] = 1; }
  }
  const rows = []; for (let r = 0; r < H; r++) { const ru = []; let s = -1; for (let i = 0; i <= W; i++) { const v = i < W && md[r * W + i]; if (v && s < 0) s = i; else if (!v && s >= 0) { ru.push(s, i); s = -1; } } rows.push(ru); }
  return { ang, W, H, rows, area: n0 * c * c };
}

const plFits = (occ, GW, M, px, py) => {
  for (let r = 0; r < M.H; r++) { const ru = M.rows[r], base = (py + r) * GW + px; for (let k = 0; k < ru.length; k += 2) for (let i = ru[k]; i < ru[k + 1]; i++) if (occ[base + i]) return false; }
  return true;
};
function plBest(occ, GW, GH, masks, stride) {
  let best = null, score = Infinity;
  for (const M of masks) {
    for (let py = 0; py + M.H <= GH; py += stride) {
      if ((py + M.H) * GW >= score) break;
      for (let px = 0; px + M.W <= GW; px += stride) if (plFits(occ, GW, M, px, py)) { const s = (py + M.H) * GW + px; if (s < score) { score = s; best = { M, px, py }; } break; }
    }
  }
  if (!best) return null;
  let { M, px, py } = best;   // dosunięcie na pełną dokładność: w dół i w lewo
  for (let moved = true; moved;) { moved = false; if (py > 0 && plFits(occ, GW, M, px, py - 1)) { py--; moved = true; } else if (px > 0 && plFits(occ, GW, M, px - 1, py)) { px--; moved = true; } }
  return { M, px, py };
}
function plMark(occ, GW, M, px, py) { for (let r = 0; r < M.H; r++) { const ru = M.rows[r], base = (py + r) * GW + px; for (let k = 0; k < ru.length; k += 2) for (let i = ru[k]; i < ru[k + 1]; i++) occ[base + i] = 1; } }

async function plPack() {
  if (PL.busy) return; if (!V3.bodies.length) return toast('Najpierw zbuduj bryły w widoku 3D');
  PL.busy = true; $('pl-go').disabled = true;
  try {
    const o = plOpt(); if (!(o.xb - o.xa > 5) || !(o.yb - o.ya > 5)) throw new Error('za mały obszar płyty (sprawdź strefy i marginesy)');
    const c = o.c, d = Math.floor(o.gap / 2 / c), GW = Math.ceil((o.xb - o.xa) / c) + 2 * d, GH = Math.ceil((o.yb - o.ya) / c) + 2 * d, gx0 = o.xa - d * c, gy0 = o.ya - d * c, stride = Math.max(1, Math.round(2 / c)), plates = [], warn = [];
    const items = plItems(o); plMsg('Rozmieszczam…'); await new Promise(r => setTimeout(r, 30));
    const angs = []; if (o.rot > 0) for (let a = 0; a < 360; a += o.rot) angs.push(a); else angs.push(0);
    let done = 0;
    for (const [g, label] of PL_GRP) {
      const list = items.filter(i => i.grp === g).sort((a, b) => b.w * b.h - a.w * a.h || (a.name < b.name ? -1 : 1)); if (!list.length) continue;
      const gp = [];
      for (const it of list) {
        plMsg(`Rozmieszczam: ${label} ${++done}/${items.length}`); await new Promise(r => setTimeout(r, 0));
        if (it.zh > o.H + 0.01) warn.push(`${it.name}: wysokość ${fmt(it.zh, 1)} mm przekracza ${fmt(o.H, 0)} mm`);
        const masks = angs.map(a => plMask(it, a, c, d)).filter(M => M.W <= GW && M.H <= GH);
        if (!masks.length) { warn.push(`${it.name}: nie mieści się na płycie (${fmt(it.w, 0)} × ${fmt(it.h, 0)} mm) — pominięta`); continue; }
        let put = null, plate = null;
        for (const pl of gp) { put = plBest(pl.occ, GW, GH, masks, stride); if (put) { plate = pl; break; } }
        if (!put) { plate = { grp: g, label, no: gp.length + 1, occ: new Uint8Array(GW * GH), items: [], area: 0 }; gp.push(plate); put = plBest(plate.occ, GW, GH, masks, stride); }
        if (!put) { warn.push(`${it.name}: nie udało się ułożyć`); continue; }
        plMark(plate.occ, GW, put.M, put.px, put.py);
        plate.items.push({ it, ang: put.M.ang, x: gx0 + (put.px + put.M.W / 2) * c, y: gy0 + (put.py + put.M.H / 2) * c }); plate.area += put.M.area;
      }
      plates.push(...gp);
    }
    PL.plates = plates; PL.src = V3.bodies; PL.o = o; PL.sel = 0; PL.warn = warn; PL.cache.clear();
    const use = (o.xb - o.xa) * (o.yb - o.ya);
    $('pl-report').innerHTML = plates.length ? `<b>${plates.length}</b> płyt, ${plates.reduce((s, p) => s + p.items.length, 0)} części<br>` + PL_GRP.map(([k, l]) => { const ps = plates.filter(p => p.grp === k); return ps.length ? `${l}: ${ps.length} ${ps.length === 1 ? 'płyta' : 'płyt'} (${ps.map(p => Math.round(100 * p.area / use) + '%').join(', ')})` : ''; }).filter(Boolean).join('<br>') + (warn.length ? '<br><span style="color:#c53030">' + warn.join('<br>') + '</span>' : '') : 'Brak części do rozmieszczenia.';
    ['pl-e1', 'pl-e3', 'pl-es'].forEach(id => { $(id).disabled = !plates.length; });
    plMsg(''); plTabs(); plDraw();
  } catch (e) { console.error(e); plMsg('Błąd rozmieszczania: ' + (e && e.message || e)); setTimeout(() => plMsg(''), 5000); }
  PL.busy = false; $('pl-go').disabled = false;
}

function plTabs() {
  const t = $('vpl-tabs'); t.innerHTML = '';
  PL.plates.forEach((p, i) => { const b = document.createElement('button'); b.className = 'btn' + (i === PL.sel ? ' on' : ''); b.textContent = `${p.label} ${p.no} (${p.items.length})`; b.onclick = () => { PL.sel = i; plTabs(); plDraw(); }; t.appendChild(b); });
}
const plHex = v => '#' + (Number(v) || 0).toString(16).padStart(6, '0');
function plColor(it) { return it.grp === 'klosz' ? plHex($('b3-ck').value) : it.grp === 'plaster' ? (it.plType === 'K' ? '#3182ce' : '#dd6b20') : plHex($('b3-cp').value); }
function plTint(it) {
  const col = plColor(it), k = it.col === col && it.tint; if (k) return it.tint;
  const sp = plSprite(it), cv = document.createElement('canvas'); cv.width = sp.sw; cv.height = sp.sh; const x = cv.getContext('2d');
  x.drawImage(sp.cv, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, sp.sw, sp.sh); it.col = col; return (it.tint = cv);
}
// tło płyty: siatka co 10 mm, strefy jednej dyszy (zakreskowane, gdy nieużywane), obszar roboczy; X/Y zamieniają mm na piksele
function plPaintBed(x, o, s, X, Y) {
  x.fillStyle = '#4d5359'; x.fillRect(X(0), Y(o.D), o.W * s, o.D * s);
  x.strokeStyle = 'rgba(255,255,255,.13)'; x.lineWidth = 1; x.beginPath();
  for (let v = 0; v <= o.W; v += 10) { x.moveTo(X(v), Y(0)); x.lineTo(X(v), Y(o.D)); } for (let v = 0; v <= o.D; v += 10) { x.moveTo(X(0), Y(v)); x.lineTo(X(o.W), Y(v)); } x.stroke();
  const strip = (x0, x1, used, txt) => {
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(X(x0), Y(o.D), (x1 - x0) * s, o.D * s);
    if (!used) { x.save(); x.beginPath(); x.rect(X(x0), Y(o.D), (x1 - x0) * s, o.D * s); x.clip(); x.strokeStyle = 'rgba(229,62,62,.55)'; x.lineWidth = 2; x.beginPath(); for (let k = -o.D; k < o.D + (x1 - x0); k += 12) { x.moveTo(X(x0 + k), Y(0)); x.lineTo(X(x0 + k + o.D), Y(o.D)); } x.stroke(); x.restore(); }
    x.save(); x.translate(X((x0 + x1) / 2), Y(o.D / 2)); x.rotate(-Math.PI / 2); x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '600 ' + Math.max(10, 11 * s / 1.3) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt + (used ? '' : ' — nieużywana (kliknij, aby użyć)'), 0, 0); x.restore();
  };
  if (o.sz > 0) { strip(0, o.sz, o.L, 'tylko lewa dysza'); strip(o.W - o.sz, o.W, o.R, 'tylko prawa dysza'); }
  x.setLineDash([6, 4]); x.strokeStyle = '#9ae66e'; x.lineWidth = 1.5; x.strokeRect(X(o.xa), Y(o.yb), (o.xb - o.xa) * s, (o.yb - o.ya) * s); x.setLineDash([]);
  x.strokeStyle = '#1a202c'; x.lineWidth = 2; x.strokeRect(X(0), Y(o.D), o.W * s, o.D * s);
  x.fillStyle = '#cbd5e0'; x.font = '12px sans-serif'; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(`${fmt(o.W, 0)} × ${fmt(o.D, 0)} mm`, X(0) + 4, Y(o.D) + 4);
}
function plInfo() {
  const o = PL.o || plOpt(), p = PL.plates[PL.sel], stale = PL.src && PL.src !== V3.bodies;
  if (p) { const use = (o.xb - o.xa) * (o.yb - o.ya); $('vpl-info').textContent = `${p.label} ${p.no}/${PL.plates.filter(r => r.grp === p.grp).length} · ${p.items.length} części · zapełnienie ${Math.round(100 * p.area / use)}%` + (stale ? ' · bryły się zmieniły — kliknij „Rozmieść”' : ''); $('vpl-info').style.color = stale ? '#c53030' : ''; }
  else $('vpl-info').textContent = '';
}
const plDraw = () => { if (PL.mode === '3d') pl3Build(); else plDraw2D(); plInfo(); };
function plDraw2D() {
  const host = $('vpl-c'), cv = $('vpl-cv'), w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  const o = PL.o || plOpt(), pad = 24, s = Math.min((w - 2 * pad) / o.W, (h - 2 * pad) / o.D), ox = (w - o.W * s) / 2, oy = (h - o.D * s) / 2, X = v => ox + v * s, Y = v => oy + (o.D - v) * s;
  PL.lay = { s, ox, oy };
  plPaintBed(x, o, s, X, Y);
  const p = PL.plates[PL.sel];
  if (p) {
    const names = $('vpl-n').checked;
    p.items.forEach(q => {
      const sp = plSprite(q.it), th = q.ang * Math.PI / 180;
      x.save(); x.translate(X(q.x), Y(q.y)); x.rotate(-th); x.scale(s / PL_SPR, s / PL_SPR); x.globalAlpha = 0.92; x.drawImage(plTint(q.it), -sp.sw / 2, -sp.sh / 2); x.restore();
      if (names && Math.min(q.it.w, q.it.h) * s > 16) { x.fillStyle = '#1a202c'; x.font = '10px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(q.it.name, X(q.x), Y(q.y)); }
    });
  }
}
// klik w strefę jednej dyszy na podglądzie 2D włącza ją albo wyłącza i układa od nowa
function plStripAt(e) {
  const o = PL.o || plOpt(), L = PL.lay; if (!L || !(o.sz > 0)) return 0;
  const r = $('vpl-cv').getBoundingClientRect(), mx = (e.clientX - r.left - L.ox) / L.s, my = (e.clientY - r.top - L.oy) / L.s;
  if (my < 0 || my > o.D) return 0; return mx >= 0 && mx <= o.sz ? 'pl-l' : mx >= o.W - o.sz && mx <= o.W ? 'pl-r' : 0;
}

// ===================== podgląd 3D płyty z orbitą =====================
function pl3Init() {
  if (PL.t) return PL.t; const T = V3.THREE, t = PL.t = { scene: new T.Scene(), cam: new T.OrthographicCamera(-1, 1, 1, -1, -100000, 100000), grp: new T.Group(), view: 'iso' };
  t.scene.background = new T.Color(0xeef1f5); t.scene.add(new T.HemisphereLight(0xffffff, 0x8a93a3, 1.5));
  const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(-1, -2, 3); t.scene.add(sun); const fill = new T.DirectionalLight(0xffffff, 0.5); fill.position.set(2, 1, 1); t.scene.add(fill); t.scene.add(t.grp);
  t.ren = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); t.ren.setPixelRatio(window.devicePixelRatio || 1); t.ren.domElement.style.cssText = 'position:absolute;left:0;top:0'; $('vpl-c').appendChild(t.ren.domElement);
  sterowanie3D(t.ren.domElement, t, () => t.ren.render(t.scene, t.cam));
  return t;
}
function pl3Size() { const t = PL.t; if (!t) return; const h = $('vpl-c'), w = h.clientWidth, ht = h.clientHeight; if (!w || !ht) return; t.ren.setSize(w, ht); pl3Frame(); }
function pl3Frame() {
  const t = PL.t, o = PL.o || plOpt(), h = $('vpl-c'), asp = h.clientWidth / (h.clientHeight || 1), r = Math.hypot(o.W, o.D) / 2 * 1.05 / Math.min(1, asp || 1), c = t.cam;
  c.left = -r * asp; c.right = r * asp; c.top = r; c.bottom = -r; c.updateProjectionMatrix(); t.ren.render(t.scene, c);
}
function pl3View(name) {
  const t = pl3Init(), o = PL.o || plOpt(), D = { iso: [1, -1, 0.8], top: [0, 0, 1], front: [0, -1, 0.0001], side: [1, 0, 0.0001] }[name] || [1, -1, 0.8], d = Math.hypot(o.W, o.D) * 2;
  t.view = name; if (name === 'top') t.cam.up.set(0, 1, 0); else t.cam.up.set(0, 0, 1);
  t.cam.position.set(o.W / 2 + D[0] * d, o.D / 2 + D[1] * d, D[2] * d); t.cam.zoom = 1; t.ctl.target.set(o.W / 2, o.D / 2, 0); t.ctl.update(); t.cam.updateProjectionMatrix();
  document.querySelectorAll('#vpl-views [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === name)); pl3Frame();
}
function pl3Build() {
  const t = pl3Init(), T = V3.THREE, o = PL.o || plOpt(), p = PL.plates[PL.sel];
  t.grp.children.slice().forEach(m => { t.grp.remove(m); if (m.geometry) m.geometry.dispose(); [].concat(m.material || []).forEach(q => { if (q.map) q.map.dispose(); q.dispose(); }); });
  const tx = document.createElement('canvas'); tx.width = Math.round(o.W * 4); tx.height = Math.round(o.D * 4); plPaintBed(tx.getContext('2d'), o, 4, v => v * 4, v => (o.D - v) * 4);
  const bed = new T.Mesh(new T.BoxGeometry(o.W, o.D, 3), [0, 1, 2, 3, 4, 5].map(i => new T.MeshStandardMaterial(i === 4 ? { map: new T.CanvasTexture(tx), roughness: 0.9 } : { color: 0x2d3238, roughness: 0.9 })));
  bed.position.set(o.W / 2, o.D / 2, -1.5); t.grp.add(bed);
  if (p) plBodies(p).forEach((b, i) => {
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(b.pos, 3)); g.setIndex(new T.BufferAttribute(b.tri, 1)); g.computeVertexNormals();
    t.grp.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: plColor(p.items[i].it), flatShading: true, roughness: 0.55, metalness: 0.02, side: T.DoubleSide })));
  });
  pl3Size(); if (!t.set) { t.set = true; pl3View('iso'); }
}
function plMode(m) {
  PL.mode = m; $('vpl-m2').classList.toggle('on', m !== '3d'); $('vpl-m3').classList.toggle('on', m === '3d'); $('vpl-views').classList.toggle('hidden', m !== '3d'); $('vpl-n-l').classList.toggle('hidden', m === '3d');
  $('vpl-cv').style.display = m === '3d' ? 'none' : 'block'; if (PL.t) PL.t.ren.domElement.style.display = m === '3d' ? 'block' : 'none'; plDraw();
}

function plBodies(p) {
  return p.items.map(q => {
    const it = q.it, th = q.ang * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), n = it.xyz.length / 3, pos = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { const x = it.xyz[v * 3], y = it.xyz[v * 3 + 1]; pos[v * 3] = q.x + x * cs - y * sn; pos[v * 3 + 1] = q.y + x * sn + y * cs; pos[v * 3 + 2] = it.xyz[v * 3 + 2]; }
    return { name: it.name, pos, tri: it.tri, numProp: 3 };
  });
}
const plFile = p => `${fileBase()}_${p.label.replace(/\s+/g, '')}_${p.no}`;
const plU8 = async blob => new Uint8Array(await blob.arrayBuffer());
async function plExport(kind) {
  if (!PL.plates.length) return;
  const one = kind === '1', plates = one ? [PL.plates[PL.sel]] : PL.plates;
  if (kind === 'stl') {
    const files = []; plates.forEach(p => plBodies(p).forEach(b => files.push({ name: `${plFile(p)}/${b.name}.stl`, data: stlOf(b) })));
    saveBlob(fileBase() + '_plyty_STL.zip', await zipFiles(files, 'application/zip')); return toast(`Zapisano ${files.length} plików STL`);
  }
  if (plates.length === 1) { saveBlob(plFile(plates[0]) + '.3mf', await mf3Blob(plBodies(plates[0]))); return toast(`Zapisano 3MF: ${plates[0].items.length} części`); }
  const files = []; for (const p of plates) files.push({ name: plFile(p) + '.3mf', data: await plU8(await mf3Blob(plBodies(p))) });
  saveBlob(fileBase() + '_plyty_3MF.zip', await zipFiles(files, 'application/zip')); toast(`Zapisano ${files.length} plików 3MF w ZIP`);
}

async function openPL() {
  if (!W.base) return toast('Najpierw wczytaj kontury');
  closePlatePop();
  if (!V3.open || V3.dirty || !V3.bodies.length) await open3D();
  if (!V3.bodies.length) return;
  $('v3d').classList.add('hidden'); $('vpl').classList.remove('hidden'); PL.open = true;
  ['b-2d', 'b-3d'].forEach(id => $(id).classList.remove('on')); $('b-pl').classList.add('on'); showPanel('plyta', true);
  plTabs(); plDraw(); if (!PL.plates.length || PL.src !== V3.bodies) plPack();
}
function closePL() { if (!PL.open) return; PL.open = false; $('vpl').classList.add('hidden'); $('b-pl').classList.remove('on'); }

// ===================== start =====================
$('b-pl').onclick = openPL;
$('b-2d').onclick = () => { closePL(); close3D(); };
$('b-3d').onclick = async () => { if (PL.open) { closePL(); $('v3d').classList.remove('hidden'); $('b-3d').classList.add('on'); showPanel('bryla', true); if (V3.dirty) await open3D(); else { size3D(); render3D(); } } else open3D(); };
$('pl-go').onclick = plPack; $('pl-e1').onclick = () => plExport('1'); $('pl-e3').onclick = () => plExport('3'); $('pl-es').onclick = () => plExport('stl');
$('vpl-n').onchange = plDraw; new ResizeObserver(() => { if (!PL.open) return; if (PL.mode === '3d') pl3Size(); else plDraw2D(); }).observe($('vpl-c'));
$('vpl-m2').onclick = () => plMode('2d'); $('vpl-m3').onclick = () => plMode('3d'); document.querySelectorAll('#vpl-views [data-v]').forEach(b => { b.onclick = () => pl3View(b.dataset.v); });
$('vpl-cv').addEventListener('click', e => { const id = plStripAt(e); if (!id) return; $(id).checked = !$(id).checked; plSave(); plPack(); });
$('vpl-cv').addEventListener('mousemove', e => { $('vpl-cv').style.cursor = plStripAt(e) ? 'pointer' : ''; });
['pl-w', 'pl-d', 'pl-hz', 'pl-sz', 'pl-gap', 'pl-mg'].forEach(id => addSpin($(id), { 'pl-w': 5, 'pl-d': 5, 'pl-hz': 5, 'pl-sz': 1, 'pl-gap': 0.5, 'pl-mg': 0.5 }[id], () => plSave()));
// ustawienia płyty zapamiętane w przeglądarce
const PL_IDS = ['pl-w', 'pl-d', 'pl-hz', 'pl-sz', 'pl-l', 'pl-r', 'pl-gap', 'pl-mg', 'pl-rot', 'pl-res', 'pl-gpodstawa', 'pl-gklosz', 'pl-glitera', 'pl-gplaster', 'pl-fk'];
function plSave() { try { const o = {}; PL_IDS.forEach(id => { const e = $(id); o[id] = e.type === 'checkbox' ? e.checked : e.value; }); localStorage.setItem(PL_KEY, JSON.stringify(o)); } catch (e) { /* bez zapisu */ } }
try { const o = JSON.parse(localStorage.getItem(PL_KEY) || 'null'); if (o) PL_IDS.forEach(id => { const e = $(id); if (e && id in o) { if (e.type === 'checkbox') e.checked = !!o[id]; else e.value = o[id]; } }); } catch (e) { /* domyślne */ }
PL_IDS.forEach(id => $(id).addEventListener($(id).type === 'text' ? 'input' : 'change', plSave));
