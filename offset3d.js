// Offset Wizard — bryły 3D zamiast Fusion: te same części i wymiary co wtyczka LiteryPrzestrzenne (Frontlit / Sidelit).
// Litera to warstwy konturów, więc każda część = stos wyciągnięć (kontury liczone Clipperem, bryły i cięcia: Manifold),
// podgląd three.js z widokiem izometrycznym, eksport STL / 3MF. Biblioteki wczytywane dopiero przy pierwszym otwarciu 3D.
const V3 = { lib: null, THREE: null, wasm: null, scene: null, cam: null, ren: null, ctl: null, group: null, bodies: [], meshes: [], dirty: true, building: false, again: false, open: false, view: 'iso', tmr: 0, box: null };
const PALETA3 = [['Biały', 0xf5f5f5], ['Żółty', 0xf0d228], ['Pomarańczowy', 0xf08c1e], ['Czerwony', 0xd22d2d], ['Zielony', 0x28aa50], ['Niebieski', 0x1450d2], ['Czarny', 0x232323]];
const CZESCI = { klosz: 'Klosz', podstawa: 'Podstawa', pleksa: 'Pleksa' };

function load3D() {
  if (V3.lib) return V3.lib;
  V3.lib = (async () => {
    const [THREE, OC, M] = await Promise.all([import('three'), import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js'), import('https://cdn.jsdelivr.net/npm/manifold-3d@3.2.1/manifold.js')]);
    const wasm = await M.default(); wasm.setup();
    V3.THREE = THREE; V3.OrbitControls = OC.OrbitControls; V3.wasm = wasm;
  })();
  V3.lib.catch(() => { V3.lib = null; });
  return V3.lib;
}
// ===================== kontury (Clipper) =====================
const CL = () => ClipperLib;
function offJoin(polys, d, join) { const c = CL(), co = new c.ClipperOffset(2, 0.005 * S), out = new c.Paths(); co.AddPaths(polys, join, c.EndType.etClosedPolygon); co.Execute(out, d * S); return c.Clipper.CleanPolygons(out, 0.002 * S).filter(p => p.length > 2); }
const offRound = (polys, d) => offJoin(polys, d, CL().JoinType.jtRound);
function clip(type, a, b) {
  if (!a || !a.length) return [];
  const c = CL(), cl = new c.Clipper(), sol = new c.Paths(); cl.AddPaths(a, c.PolyType.ptSubject, true); if (b && b.length) cl.AddPaths(b, c.PolyType.ptClip, true);
  cl.Execute(c.ClipType[type], sol, c.PolyFillType.pftNonZero, c.PolyFillType.pftNonZero);
  return c.Clipper.CleanPolygons(sol, 0.002 * S).filter(p => p.length > 2);
}
const diff = (a, b) => clip('ctDifference', a, b), inter = (a, b) => b && b.length ? clip('ctIntersection', a, b) : [];
const circlePoly = (x, y, d, n = 48) => Array.from({ length: n }, (_, i) => ({ X: Math.round((x + d / 2 * Math.cos(i / n * 2 * Math.PI)) * S), Y: Math.round((y + d / 2 * Math.sin(i / n * 2 * Math.PI)) * S) }));
const toPolys = reg => reg.map(p => p.map(q => [q.X / S, q.Y / S]));
// wypukłe narożniki materiału zaokrąglone promieniem r / to samo od strony pustki
const openR = (reg, r) => r > 0 ? offRound(offRound(reg, -r), r) : reg, closeR = (reg, r) => r > 0 ? offRound(offRound(reg, r), -r) : reg;
// faza zakrętów kieszeni: ostry narożnik materiału wcinający się w kanał ścięty prostą, f mm wzdłuż obu ścian (jak faza we Fusion).
// Łagodne załamania łuków (poniżej 15°) i narożniki odsunięte od kanału zostają bez zmian.
function fazaKieszeni(v, f) {
  if (!(f > 0)) return v;
  const rings = v.map(ring => {
    const P = ring.map(q => [q.X / S, q.Y / S]), n = P.length, len = P.map((p, i) => Math.hypot(P[(i + 1) % n][0] - p[0], P[(i + 1) % n][1] - p[1]));
    const turn = P.map((p, i) => { const a = P[(i + n - 1) % n], b = P[(i + 1) % n], ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1]; return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); });
    const sharp = turn.map(t => Math.abs(t) > 0.26), idx = sharp.flatMap((s, i) => s ? [i] : []);
    if (!idx.some(i => turn[i] < 0)) return ring;     // wnętrze pustki po lewej: skręt w prawo = narożnik materiału
    const between = (a, b) => { let s = 0; for (let k = a; k !== b; k = (k + 1) % n) s += len[k]; return s; };
    const skip = new Uint8Array(n), cut = new Map();
    const walk = (i, dir, leg) => { let k = i, rem = leg; for (let c = 0; c < n; c++) { const q = (k + dir + n) % n, L = dir > 0 ? len[k] : len[q]; if (L >= rem) { const t = L > 0 ? rem / L : 0; return [P[k][0] + (P[q][0] - P[k][0]) * t, P[k][1] + (P[q][1] - P[k][1]) * t]; } rem -= L; k = q; skip[k] = 1; } return P[i]; };
    idx.forEach((i, j) => {
      if (turn[i] >= 0) return;
      const prev = idx[(j + idx.length - 1) % idx.length], next = idx[(j + 1) % idx.length], total = len.reduce((s, x) => s + x, 0);
      const dPrev = idx.length > 1 ? between(prev, i) : total, dNext = idx.length > 1 ? between(i, next) : total, leg = Math.min(f, 0.45 * dPrev, 0.45 * dNext);
      if (leg > 0.01) cut.set(i, [walk(i, -1, leg), walk(i, 1, leg)]);
    });
    const out = []; for (let i = 0; i < n; i++) { if (cut.has(i)) out.push(...cut.get(i)); else if (!skip[i]) out.push(P[i]); }
    return out.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  });
  return clip('ctUnion', rings);
}

function params3D() {
  const n = id => num($(id).value), au = (id, v) => { const s = $(id).value.trim(); return s ? num(s) : v; }, cb = id => $(id).checked, dysza04 = W.pr.dysza === 4;
  const p = { gp: n('b3-gp'), h: n('b3-h'), st: n('b3-st'), pl: n('b3-pl'), wgl: cb('b3-wgl'), gw: n('b3-gw'), sh: n('b3-sh'), ss: n('b3-ss'), sf: n('b3-sf'), sd: n('b3-sd'), t1: n('b3-st1'), t2: n('b3-st2'), t3: n('b3-st3'),
    otw: cb('b3-otw'), fix: cb('b3-fix'), cut: cb('b3-cut'), row: cb('b3-row'), rg: au('b3-rg', dysza04 ? 0.42 : 0.62), rd: au('b3-rd', dysza04 ? 0.24 : 0.30), rm: n('b3-rm'), r: cb('b3-rnd') ? n('b3-r') : 0, f: cb('b3-rnd') ? n('b3-f') : 0 };
  p.wk = au('b3-wk', p.h - p.st); p.ws = au('b3-ws', p.wk - p.gp);
  p.kCalk = p.sf + p.ss; p.pCalk = p.sh - p.kCalk; p.sw = au('b3-sw', p.ss - 0.5);
  return p;
}
// otwory i rowki profilu (w tyle podstawy, z odstępem od krawędzi — jak _wytnijRowekProfilu)
function otworyReg(p) { return W.holes.filter(h => (h.kind === 'fix' ? p.fix : p.otw)).map(h => circlePoly(h.x, h.y, h.d)); }
function rowkiReg(p, dno, holes) {
  if (!p.row || !W.rails.length || !(p.rg > 0) || !(p.rd > 0)) return [];
  const rail = r => [[r.x0, r.yc - r.h / 2], [r.x1, r.yc - r.h / 2], [r.x1, r.yc + r.h / 2], [r.x0, r.yc + r.h / 2]].map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  const pole = offsetPolys(diff(dno, holes), -p.rm); let out = [];
  W.rails.forEach(r => { const rect = [rail(r)]; out = out.concat(inter(diff(offsetPolys(rect, p.rg), rect), pole)); });
  return out.filter(q => Math.abs(area(q)) >= p.rg * 2);    // krótsze odcinki pomijamy (jak minDlugosc we wtyczce)
}
// każda część: lista warstw {z0, z1, reg}
function warstwyFrontlit(p, m) {
  const R = d => offsetPolys(W.base, d), Rk2 = R(m.k2), Rk1 = R(m.k1), void3 = closeR(R(m.k3), p.r), Rp1 = R(m.p1), Rp2 = openR(R(m.p2), p.r), holes = otworyReg(p), top = p.st + p.pl;
  if (!(p.wk > 0) || !(p.ws > 0) || p.ws > p.wk) throw new Error('sprawdź wysokości klosza: ścianka i stopka muszą być dodatnie');
  const klosz = [{ z0: p.st, z1: p.st + p.ws, reg: diff(Rk2, void3) }, { z0: p.st + p.ws, z1: p.st + p.wk, reg: diff(Rk2, Rk1) }].filter(l => l.z1 - l.z0 > 1e-6);
  const kiesz = p.wgl && p.gw > 0 ? fazaKieszeni(R(m.kie), p.f) : [], rowki = rowkiReg(p, Rp1, holes), zKiesz = kiesz.length ? Math.max(0.2, top - p.gw) : Infinity;
  const zs = [...new Set([0, p.st, top, ...(rowki.length ? [p.rd] : []), ...(zKiesz < top ? [zKiesz] : [])].filter(z => z >= 0 && z <= top))].sort((a, b) => a - b), podstawa = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2; let reg = mid < p.st ? Rp1 : Rp2;
    if (mid > zKiesz) reg = diff(reg, kiesz);
    if (mid < p.rd && rowki.length) reg = diff(reg, rowki);
    podstawa.push({ z0, z1, reg: diff(reg, holes) });
  }
  return { klosz, podstawa, pleksa: [{ z0: p.st + p.wk - p.gp, z1: p.st + p.wk, reg: R(0) }], opis: `ścianka klosza ${fmt(p.wk, 1)}, stopka ${fmt(p.ws, 1)}, podstawa ${fmt(top, 1)} (stopień ${fmt(p.st, 1)} + płyta ${fmt(p.pl, 1)}), pleksa ${fmt(p.gp, 1)}` + (kiesz.length ? `, kieszeń ${fmt(p.gw, 1)} → dno ${fmt(top - p.gw, 1)}` : '') };
}
function warstwySidelit(p) {
  const R = d => offsetPolys(W.base, d), R0 = R(0), holes = otworyReg(p), zK = p.sh - p.kCalk;
  if (!(p.pCalk > p.sd) || !(p.kCalk > p.sf) || p.sw < 0) throw new Error('sprawdź wymiary Sidelit: całkowite muszą być większe od frontu i dna');
  const klosz = [{ z0: zK, z1: zK + p.ss, reg: diff(R0, openR(R(-p.t1), 0)) }, { z0: zK + p.ss, z1: p.sh, reg: R0 }];
  const ringRant = diff(R0, R(-p.t3)), ringSc = diff(openR(R(-p.t2), p.r), R(-p.t3)), rowki = rowkiReg(p, R0, holes);
  const zs = [...new Set([0, p.sd, p.pCalk, p.pCalk + p.sw, ...(rowki.length ? [p.rd] : [])])].sort((a, b) => a - b), podstawa = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2; let reg = mid < p.sd ? R0 : mid < p.pCalk ? ringRant : ringSc;
    if (mid < p.rd && rowki.length) reg = diff(reg, rowki);
    podstawa.push({ z0, z1, reg: diff(reg, holes) });
  }
  return { klosz, podstawa, pleksa: [], opis: `grubość litery ${fmt(p.sh, 1)} = klosz ${fmt(p.kCalk, 1)} (front ${fmt(p.sf, 1)} + boki ${fmt(p.ss, 1)}) + podstawa ${fmt(p.pCalk, 1)} (dno ${fmt(p.sd, 1)}); pasowanie ${fmt(p.sw, 1)}` };
}
// ===================== bryły (Manifold) =====================
function stos(warstwy, ndel) {
  const { Manifold } = V3.wasm, list = [];
  warstwy.forEach(l => { const polys = toPolys(l.reg); if (!polys.length) return; const e = ndel(Manifold.extrude(polys, l.z1 - l.z0)); list.push(ndel(e.translate([0, 0, l.z0]))); });
  return list.length ? ndel(Manifold.union(list)) : null;
}
const objetosc = m => { try { return m.volume(); } catch (e) { return m.getProperties().volume; } };
async function build3D() {
  if (V3.building) { V3.again = true; return; }
  if (!W.base) return msg3D('Najpierw wczytaj kontury');
  V3.building = true; msg3D('Buduję bryły…'); $('b3-stl').disabled = true; $('b3-3mf').disabled = true;
  await new Promise(r => setTimeout(r, 30));
  const t0 = performance.now(), garbage = [], ndel = o => { garbage.push(o); return o; };
  try {
    await load3D();
    W.pr = params(); const p = params3D(), m = W.m, plan = W.pr.typ === 'S' ? warstwySidelit(p) : warstwyFrontlit(p, m), parts = {}, bodies = [], ls = letters(bedSrc()), uwagi = [];
    Object.keys(CZESCI).forEach(k => { parts[k] = plan[k].length ? stos(plan[k], ndel) : null; });
    if (W.overlaps.length) uwagi.push(`litery nachodzą na siebie w ${W.overlaps.length} miejscach — bryły są połączone`);
    if (parts.klosz && parts.podstawa) { const v = objetosc(ndel(V3.wasm.Manifold.intersection(parts.klosz, parts.podstawa))); if (v > 1) uwagi.push(`klosz przenika podstawę (${fmt(v, 1)} mm³) — sprawdź offsety`); }
    const segs = p.cut ? cutSegs() : [];
    Object.keys(CZESCI).forEach(k => {
      if (!parts[k]) return;
      let list = parts[k].decompose().map(ndel);
      // podział: linia tnie tylko bryły swojej litery (Fusion tnie wszystko, co dotyka prostokąta linii)
      segs.forEach(c => {
        const L = ls[c.g.li]; if (!L) return;
        const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], len = Math.hypot(dx, dy) || 1, n = [-dy / len, dx / len, 0], off = n[0] * c.a[0] + n[1] * c.a[1], next = [];
        list.forEach(b => {
          const bb = b.boundingBox(), cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
          if (cx < L.bb.x0 - 3 || cx > L.bb.x1 + 3 || cy < L.bb.y0 - 3 || cy > L.bb.y1 + 3) { next.push(b); return; }
          const [u, v] = b.splitByPlane(n, off); ndel(u); ndel(v); [u, v].forEach(h => { if (!h.isEmpty()) h.decompose().map(ndel).forEach(q => next.push(q)); });
        });
        list = next;
      });
      const rows = list.map(b => { const bb = b.boundingBox(), cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2; let li = ls.findIndex(l => cx >= l.bb.x0 && cx <= l.bb.x1 && cy >= l.bb.y0 && cy <= l.bb.y1); if (li < 0) li = 0; return { b, bb, li, cx }; }).sort((a, c) => a.li - c.li || a.cx - c.cx);
      const cnt = {}; rows.forEach(r => { cnt[r.li] = (cnt[r.li] || 0) + 1; }); const nr = {};
      rows.forEach(r => { nr[r.li] = (nr[r.li] || 0) + 1; const mesh = r.b.getMesh(); bodies.push({ part: k, name: `${CZESCI[k]}_${String(r.li + 1).padStart(2, '0')}${cnt[r.li] > 1 ? String.fromCharCode(96 + nr[r.li]) : ''}`, pos: mesh.vertProperties.slice(), tri: mesh.triVerts.slice(), numProp: mesh.numProp, vol: objetosc(r.b), bb: r.bb }); });
    });
    V3.bodies = bodies; V3.dirty = false; show3D();
    const c = k => bodies.filter(b => b.part === k).length, tris = bodies.reduce((s, b) => s + b.tri.length / 3, 0), wol = bodies.reduce((s, b) => s + b.vol, 0);
    $('b3-report').innerHTML = `<b>Części:</b> klosz ${c('klosz')}, podstawa ${c('podstawa')}${c('pleksa') ? `, pleksa ${c('pleksa')}` : ''}<br>${esc(plan.opis)} [mm]<br>${W.led ? `<b>LED:</b> ${fmt(W.led.m, 2)} m<br>` : ''}<b>Materiał:</b> ${fmt(wol / 1000, 0)} cm³ · ${Math.round(tris).toLocaleString('pl-PL')} trójkątów · ${fmt((performance.now() - t0) / 1000, 1)} s${uwagi.length ? `<br><span style="color:#c53030;font-weight:700">${uwagi.map(esc).join('<br>')}</span>` : ''}`;
    $('b3-stl').disabled = false; $('b3-3mf').disabled = false; msg3D('');
  } catch (e) { console.error(e); msg3D('Nie udało się zbudować: ' + (e && e.message || e)); $('b3-report').textContent = 'Błąd: ' + (e && e.message || e); }
  garbage.forEach(o => { try { o.delete(); } catch (e) { /* już zwolnione */ } });
  V3.building = false;
  if (V3.again) { V3.again = false; build3D(); }
}
// ===================== podgląd =====================
function msg3D(t) { const d = $('v3-msg'); d.textContent = t; d.classList.toggle('hidden', !t); }
function init3D() {
  if (V3.ren) return;
  const T = V3.THREE, host = $('v3-c');
  V3.scene = new T.Scene(); V3.scene.background = new T.Color(0xeef1f5);
  V3.scene.add(new T.HemisphereLight(0xffffff, 0x8a93a3, 1.5));
  const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(-1, -2, 3); V3.scene.add(sun);
  const fill = new T.DirectionalLight(0xffffff, 0.5); fill.position.set(2, 1, 1); V3.scene.add(fill);
  V3.cam = new T.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
  V3.ren = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); V3.ren.setPixelRatio(window.devicePixelRatio || 1); host.appendChild(V3.ren.domElement);
  V3.ctl = new V3.OrbitControls(V3.cam, V3.ren.domElement); V3.ctl.addEventListener('change', render3D);
  V3.group = new T.Group(); V3.scene.add(V3.group);
  new ResizeObserver(() => size3D()).observe(host);
  size3D();
}
function size3D() { const h = $('v3-c'), w = h.clientWidth, ht = h.clientHeight; if (!V3.ren || !w || !ht) return; V3.ren.setSize(w, ht); frame3D(); }
function frame3D() {
  if (!V3.cam || !V3.box) return;
  const h = $('v3-c'), asp = h.clientWidth / (h.clientHeight || 1), r = V3.box.r * 1.1 / (V3.zoomKeep || 1);
  V3.cam.left = -r * asp; V3.cam.right = r * asp; V3.cam.top = r; V3.cam.bottom = -r; V3.cam.updateProjectionMatrix(); render3D();
}
function setView(name) {
  V3.view = name; if (!V3.box) return;
  const D = { iso: [1, -1, 0.8], top: [0, 0, 1], front: [0, -1, 0], back: [0, 0, -1], side: [1, 0, 0] }[name], c = V3.box.c, d = V3.box.r * 4, up = name === 'top' ? [0, 1, 0] : name === 'back' ? [0, -1, 0] : [0, 0, 1];
  V3.cam.up.set(up[0], up[1], up[2]); V3.cam.position.set(c[0] + D[0] * d, c[1] + D[1] * d, c[2] + D[2] * d); V3.cam.zoom = 1; V3.ctl.target.set(c[0], c[1], c[2]); V3.ctl.update(); V3.cam.updateProjectionMatrix();
  document.querySelectorAll('#v3-bar [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === name)); frame3D();
}
const render3D = () => { if (V3.ren) V3.ren.render(V3.scene, V3.cam); };
function material3D(part) {
  const T = V3.THREE, sel = { klosz: ['b3-ck', 'b3-tk', 0.5], podstawa: ['b3-cp', 'b3-tp', 0.55], pleksa: ['b3-cx', 'b3-tx', 0.45] }[part], tr = $(sel[1]).checked;
  return new T.MeshStandardMaterial({ color: Number($(sel[0]).value), flatShading: true, roughness: 0.55, metalness: 0.02, transparent: tr, opacity: tr ? sel[2] : 1, depthWrite: !tr, side: T.DoubleSide });
}
function show3D() {
  init3D(); const T = V3.THREE;
  V3.meshes.forEach(m => { m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); V3.group.remove(m); }); V3.meshes = [];
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  V3.bodies.forEach(b => {
    const g = new T.BufferGeometry(), n = b.numProp || 3, pos = n === 3 ? b.pos : Float32Array.from({ length: b.pos.length / n * 3 }, (_, i) => b.pos[Math.floor(i / 3) * n + i % 3]);
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(new T.BufferAttribute(b.tri, 1));
    const mesh = new T.Mesh(g, material3D(b.part)), edges = new T.LineSegments(new T.EdgesGeometry(g, 28), new T.LineBasicMaterial({ color: 0x2d3748, transparent: true, opacity: 0.45 }));
    mesh.add(edges); mesh.userData = { part: b.part }; mesh.renderOrder = b.part === 'podstawa' ? 0 : b.part === 'klosz' ? 1 : 2; V3.group.add(mesh); V3.meshes.push(mesh);
    for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.bb.min[i]); mx[i] = Math.max(mx[i], b.bb.max[i]); }
  });
  const first = !V3.box;
  V3.box = { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], r: Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2) };
  apply3D(); if (first || !V3.keepView) setView(V3.view); V3.keepView = true;
}
function apply3D() {
  const e = Number($('v3-e').value) || 0, vis = { klosz: $('v3-k').checked, podstawa: $('v3-p').checked, pleksa: $('v3-x').checked }, lift = { podstawa: 0, klosz: e, pleksa: 2 * e };
  V3.meshes.forEach(m => { m.visible = vis[m.userData.part]; m.position.z = lift[m.userData.part]; });
  render3D();
}
function recolor3D() { V3.meshes.forEach(m => { m.material.dispose(); m.material = material3D(m.userData.part); }); render3D(); }
function groups3D() { const s = (document.querySelector('input[name=typ]:checked') || {}).value === 'S'; $('g3-f').classList.toggle('hidden', s); $('g3-s').classList.toggle('hidden', !s); }
window.mark3D = () => { V3.dirty = true; groups3D(); clearTimeout(V3.tmr); if (V3.open) V3.tmr = setTimeout(build3D, 700); };
async function open3D() {
  if (!W.base) return toast('Najpierw wczytaj kontury');
  V3.open = true; $('v3d').classList.remove('hidden'); $('b-3d').classList.add('on'); $('b-2d').classList.remove('on'); $('selbox').classList.add('hidden');
  if (W.panel !== 'bryla') showPanel('bryla', true);
  try { msg3D('Wczytuję silnik 3D…'); await load3D(); init3D(); size3D(); if (V3.dirty) await build3D(); else { msg3D(''); render3D(); } }
  catch (e) { console.error(e); msg3D('Nie udało się wczytać silnika 3D (sprawdź internet): ' + (e && e.message || e)); }
}
function close3D() { V3.open = false; $('v3d').classList.add('hidden'); $('b-2d').classList.add('on'); $('b-3d').classList.remove('on'); draw(); }
// ===================== eksport =====================
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(u8) { if (!window.CompressionStream) return null; const cs = new CompressionStream('deflate-raw'), out = new Response(new Blob([u8]).stream().pipeThrough(cs)); return new Uint8Array(await out.arrayBuffer()); }
// ZIP (także kontener 3MF)
async function zipFiles(files, mime) {
  const parts = [], cen = [], enc = new TextEncoder(); let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data), z = await deflate(data), comp = z && z.length < data.length ? z : data, method = comp === data ? 0 : 8;
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, comp);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    cen.push(c.buffer, name); off += 30 + name.length + comp.length;
  }
  const cenLen = cen.reduce((s, x) => s + x.byteLength, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cenLen, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, e.buffer], { type: mime });
}
function stlOf(b) {
  const n = b.tri.length / 3, st = b.numProp || 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf); dv.setUint32(80, n, true); let o = 84;
  const P = i => [b.pos[i * st], b.pos[i * st + 1], b.pos[i * st + 2]];
  for (let t = 0; t < n; t++) {
    const a = P(b.tri[t * 3]), c = P(b.tri[t * 3 + 1]), d = P(b.tri[t * 3 + 2]), ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    [nx, ny, nz, ...a, ...c, ...d].forEach(v => { dv.setFloat32(o, v, true); o += 4; }); o += 2;
  }
  return new Uint8Array(buf);
}
function model3mf(bodies) {
  const s = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="pl" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<resources>\n'];
  bodies.forEach((b, i) => {
    const st = b.numProp || 3, nv = b.pos.length / st;
    s.push(`<object id="${i + 1}" name="${b.name}" type="model"><mesh><vertices>`);
    for (let v = 0; v < nv; v++) s.push(`<vertex x="${b.pos[v * st].toFixed(4)}" y="${b.pos[v * st + 1].toFixed(4)}" z="${b.pos[v * st + 2].toFixed(4)}"/>`);
    s.push('</vertices><triangles>');
    for (let t = 0; t < b.tri.length; t += 3) s.push(`<triangle v1="${b.tri[t]}" v2="${b.tri[t + 1]}" v3="${b.tri[t + 2]}"/>`);
    s.push('</triangles></mesh></object>\n');
  });
  s.push('</resources>\n<build>'); bodies.forEach((b, i) => s.push(`<item objectid="${i + 1}"/>`)); s.push('</build>\n</model>');
  return s.join('');
}
async function exportSTL() {
  if (!V3.bodies.length) return;
  const files = V3.bodies.map(b => ({ name: b.name + '.stl', data: stlOf(b) }));
  saveBlob(fileBase() + '_STL.zip', await zipFiles(files, 'application/zip'));
  toast(`Zapisano ${files.length} plików STL w ZIP`);
}
async function export3MF() {
  if (!V3.bodies.length) return;
  const enc = new TextEncoder(), files = [
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: enc.encode(model3mf(V3.bodies)) }];
  saveBlob(fileBase() + '.3mf', await zipFiles(files, 'model/3mf'));
  toast(`Zapisano 3MF: ${V3.bodies.length} części`);
}
// ===================== start =====================
[['b3-ck', 0], ['b3-cp', 0], ['b3-cx', 5]].forEach(([id, d]) => { const s = $(id), had = s.dataset.v; s.innerHTML = PALETA3.map(([n, c]) => `<option value="${c}">${n}</option>`).join(''); s.value = String(PALETA3[d][1]); });
try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.pr && o.pr.p3) ['b3-ck', 'b3-cp', 'b3-cx'].forEach(id => { if (o.pr.p3[id]) $(id).value = o.pr.p3[id]; }); } catch (e) { /* zostają domyślne */ }
groups3D();
$('b-3d').onclick = open3D; $('b-2d').onclick = close3D; $('b3-open').onclick = open3D; $('v3-b').onclick = () => build3D();
$('b3-stl').onclick = exportSTL; $('b3-3mf').onclick = export3MF;
document.querySelectorAll('#v3-bar [data-v]').forEach(b => { b.onclick = () => setView(b.dataset.v); });
['v3-k', 'v3-p', 'v3-x'].forEach(id => { $(id).onchange = apply3D; }); $('v3-e').oninput = apply3D;
['b3-ck', 'b3-cp', 'b3-cx', 'b3-tk', 'b3-tp', 'b3-tx'].forEach(id => { $(id).addEventListener('change', () => { clearTimeout(V3.tmr); if (!V3.dirty) { /* sam kolor nie wymaga przebudowy */ } setTimeout(recolor3D, 0); }); });
