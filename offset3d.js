// Offset Wizard — bryły 3D zamiast Fusion: te same części i wymiary co wtyczka LiteryPrzestrzenne (Frontlit / Sidelit).
// Litera to warstwy konturów, więc każda część = stos wyciągnięć (kontury liczone Clipperem, bryły i cięcia: Manifold),
// podgląd three.js z widokiem izometrycznym, eksport STL / 3MF. Biblioteki wczytywane dopiero przy pierwszym otwarciu 3D.
const V3 = { lib: null, THREE: null, wasm: null, scene: null, cam: null, ren: null, ctl: null, group: null, bodies: [], meshes: [], dirty: true, building: false, again: false, open: false, view: 'iso', tmr: 0, box: null };
const PALETA3 = [['Biały', 0xf5f5f5], ['Żółty', 0xf0d228], ['Pomarańczowy', 0xf08c1e], ['Czerwony', 0xd22d2d], ['Zielony', 0x28aa50], ['Niebieski', 0x1450d2], ['Czarny', 0x232323]];
const CZESCI = { klosz: 'Klosz', podstawa: 'Podstawa', pleksa: 'Pleksa', litera: 'Litera' };

function load3D() {
  if (V3.lib) return V3.lib;
  V3.lib = (async () => {
    const [THREE, M] = await Promise.all([import('three'), import('https://cdn.jsdelivr.net/npm/manifold-3d@3.2.1/manifold.js')]);
    const wasm = await M.default(); wasm.setup();
    V3.THREE = THREE; V3.wasm = wasm;
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
    otw: cb('b3-otw'), fix: cb('b3-fix'), cut: cb('b3-cut'), row: cb('b3-row'), rg: au('b3-rg', dysza04 ? 0.42 : 0.62), rd: au('b3-rd', dysza04 ? 0.24 : 0.30), rm: n('b3-rm'), r: cb('b3-rnd') ? n('b3-r') : 0, f: cb('b3-rnd') ? n('b3-f') : 0, cyf: Math.max(2, n('b3-cyf') || 5), fh: n('b3-fh'), fr: Math.max(0, n('b3-fr')), fg: cb('b3-fg'), fd: cb('b3-fd') };
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
// cyfry na literach (prawy klawisz na literze): wypukłe na dnie wewnątrz litery, a w tym samym miejscu na tyle w lustrze, wycięte jak rowek profilu.
// Miejsce: jak najbliżej górnego lewego narożnika, zawsze z dala od otworów, linii podziału i plasterków, a w miarę możliwości też od paska LED i profila.
const CYF_UP = 0.3, CYF_GLIFY = {
  0: [[[.25, 0], [.75, 0], [1, .15], [1, .85], [.75, 1], [.25, 1], [0, .85], [0, .15], [.25, 0]]],
  1: [[[.15, .78], [.55, 1], [.55, 0]], [[.15, 0], [.95, 0]]],
  2: [[[0, .8], [.25, 1], [.75, 1], [1, .8], [1, .6], [0, 0], [1, 0]]],
  3: [[[0, .85], [.25, 1], [.75, 1], [1, .85], [1, .65], [.75, .52], [.4, .52]], [[.75, .52], [1, .38], [1, .15], [.75, 0], [.25, 0], [0, .15]]],
  4: [[[.75, 0], [.75, 1], [0, .3], [1, .3]]],
  5: [[[1, 1], [.1, 1], [.05, .55], [.75, .6], [1, .45], [1, .15], [.75, 0], [.25, 0], [0, .15]]],
  6: [[[.9, .95], [.7, 1], [.3, 1], [0, .8], [0, .15], [.25, 0], [.75, 0], [1, .15], [1, .4], [.75, .55], [.25, .55], [0, .4]]],
  7: [[[0, 1], [1, 1], [.35, 0]]],
  8: [[[.25, .52], [.05, .65], [.05, .87], [.25, 1], [.75, 1], [.95, .87], [.95, .65], [.75, .52], [.25, .52], [0, .38], [0, .14], [.25, 0], [.75, 0], [1, .14], [1, .38], [.75, .52]]]
};
CYF_GLIFY[9] = CYF_GLIFY[6].map(s => s.map(([x, y]) => [1 - x, 1 - y]));
const cyfraSzer = (t, h) => t.length * 0.6 * h + (t.length - 1) * 0.3 * h;
function cyfraPolys(t, cx, cy, h, sw, lustro) {
  const c = CL(), w = 0.6 * h, x0 = cx - cyfraSzer(t, h) / 2, y0 = cy - h / 2, paths = [];
  [...t].forEach((ch, i) => (CYF_GLIFY[ch] || []).forEach(s => paths.push(s.map(([u, v]) => { const x = x0 + i * 0.9 * h + sw / 2 + u * (w - sw), y = y0 + sw / 2 + v * (h - sw); return { X: Math.round((lustro ? 2 * cx - x : x) * S), Y: Math.round(y * S) }; }))));
  const co = new c.ClipperOffset(2, 0.01 * S), out = new c.Paths(); co.AddPaths(paths, c.JoinType.jtRound, c.EndType.etOpenRound); co.Execute(out, sw / 2 * S);
  return out;
}
// dno, na którym stoi cyfra: kieszeń, a bez wybrania wierzch płyty; w Sidelit dno podstawy
function cyfryDno(p, m) {
  const R = d => offsetPolys(W.base, d), top = p.st + p.pl;
  if (W.pr.typ === 'S') return { reg: R(-p.t3), z: p.sd };
  return p.wgl && p.gw > 0 ? { reg: fazaKieszeni(R(m.kie), p.f), z: Math.max(0.2, top - p.gw) } : { reg: closeR(R(m.k3), p.r), z: top };
}
function cyfryMiejsca() {
  if (!W.marks.length || !W.base || !W.pr || W.pr.typ === 'P') return [];
  const p = params3D(), key = JSON.stringify([W.baseId, W.pr.typ, W.pr.dysza, W.pr.dLeb, W.m, p.st, p.pl, p.wgl, p.gw, p.f, p.r, p.sd, p.t3, p.rg, p.cyf, W.marks, W.holes.map(h => [h.x, h.y, h.d, h.kind]), W.rails.map(r => [r.x0, r.x1, r.yc, r.h]), W.cuts.map(c => [c.li, c.x, c.y, c.ang]), W.plates.map(q => q.L), W.led && W.led.key]);
  if (V3.cyfKey === key) return V3.cyf;
  const dno = cyfryDno(p, W.m), ls = bedLetters(), sw0 = W.pr.dysza === 4 ? 0.6 : 0.8, plus = ps => ps.map(q => area(q) < 0 ? q.slice().reverse() : q);
  const twarde = W.holes.map(h => circlePoly(h.x, h.y, h.kind === 'fix' ? Math.max(h.d, W.pr.dLeb) : h.d)).concat(plus(W.plates.flatMap(q => q.polys)), plus(cutSegs().map(c => { const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l; return toCl([[c.a[0] + nx, c.a[1] + ny], [c.b[0] + nx, c.b[1] + ny], [c.b[0] - nx, c.b[1] - ny], [c.a[0] - nx, c.a[1] - ny]]); })));
  const profile = plus(W.rails.map(r => { const m = p.rg + 0.5; return toCl([[r.x0 - m, r.yc - r.h / 2 - m], [r.x1 + m, r.yc - r.h / 2 - m], [r.x1 + m, r.yc + r.h / 2 + m], [r.x0 - m, r.yc + r.h / 2 + m]]); }));
  V3.cyf = W.marks.filter(m => ls[m.li]).map(m => {
    const l = ls[m.li], pole = inter(dno.reg, [l.p]), led = W.led ? plus(rowekLED(pole, LED_W)) : [];
    // wielkość ustawiona w panelu; gdy się nie mieści, mniejsza (najmniej 4 mm), a dopiero potem pod paskiem LED lub na profilu
    const wys = [p.cyf]; while (wys[wys.length - 1] * 0.8 >= 4) wys.push(wys[wys.length - 1] * 0.8); if (wys[wys.length - 1] > 4) wys.push(4);
    for (const [naLED, naProfilu] of [[0, 0], [1, 0], [1, 1]]) for (const h0 of wys) {
      const h = Math.round(h0 * 10) / 10, sw = Math.max(sw0, h * 0.14), zajete = clip('ctUnion', twarde.concat(naLED ? [] : led, naProfilu ? [] : profile)), wolne = offsetPolys(diff(pole, zajete), -(Math.hypot(cyfraSzer(m.t, h), h) / 2 + 0.5));
      let best = null; wolne.forEach(q => q.forEach(v => { if (!best || v.Y - v.X > best.Y - best.X) best = v; }));
      if (best) { const x = best.X / S, y = best.Y / S; return { li: m.li, t: m.t, h, hChce: p.cyf, x, y, naLED: !!naLED, naProfilu: !!naProfilu, front: cyfraPolys(m.t, x, y, h, sw), back: cyfraPolys(m.t, x, y, h, sw, true) }; }
    }
    return { li: m.li, t: m.t, h: 0, x: l.bb.x0, y: l.bb.y1, brak: true, front: [], back: [] };
  });
  V3.cyfKey = key; return V3.cyf;
}
const cyfraUwaga = q => q.brak ? `cyfra ${q.t} na literze ${q.li + 1}: za mało miejsca, nie będzie jej na bryle` : q.naProfilu ? `cyfra ${q.t} na literze ${q.li + 1} leży na profilu` : q.naLED ? `cyfra ${q.t} na literze ${q.li + 1} leży pod paskiem LED` : q.h < q.hChce - 0.05 ? `cyfra ${q.t} na literze ${q.li + 1} zmniejszona do ${fmt(q.h, 1)} mm: większa nie zmieści się obok paska LED` : '';
function cyfryReg(p, zDna) {
  const c = cyfryMiejsca(), back = c.flatMap(q => q.back);
  return { front: c.flatMap(q => q.front), back, gl: back.length ? Math.min(p.rd > 0 ? p.rd : 0.3, zDna / 2) : 0, zDna };
}
// każda część: lista warstw {z0, z1, reg}
function warstwyFrontlit(p, m) {
  const R = d => offsetPolys(W.base, d), Rk2 = R(m.k2), Rk1 = R(m.k1), void3 = closeR(R(m.k3), p.r), Rp1 = R(m.p1), Rp2 = openR(R(m.p2), p.r), holes = otworyReg(p), top = p.st + p.pl;
  if (!(p.wk > 0) || !(p.ws > 0) || p.ws > p.wk) throw new Error('sprawdź wysokości klosza: ścianka i stopka muszą być dodatnie');
  const klosz = [{ z0: p.st, z1: p.st + p.ws, reg: diff(Rk2, void3) }, { z0: p.st + p.ws, z1: p.st + p.wk, reg: diff(Rk2, Rk1) }].filter(l => l.z1 - l.z0 > 1e-6);
  const kiesz = p.wgl && p.gw > 0 ? fazaKieszeni(R(m.kie), p.f) : [], rowki = rowkiReg(p, Rp1, holes), zKiesz = kiesz.length ? Math.max(0.2, top - p.gw) : Infinity, cyf = cyfryReg(p, Math.min(zKiesz, top));
  const zs = [...new Set([0, p.st, top, ...(rowki.length ? [p.rd] : []), ...(cyf.gl ? [cyf.gl] : []), ...(zKiesz < top ? [zKiesz] : [])].filter(z => z >= 0 && z <= top))].sort((a, b) => a - b), podstawa = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2; let reg = mid < p.st ? Rp1 : Rp2;
    if (mid > zKiesz) reg = diff(reg, kiesz);
    if (mid < p.rd && rowki.length) reg = diff(reg, rowki);
    if (mid < cyf.gl) reg = diff(reg, cyf.back);
    podstawa.push({ z0, z1, reg: diff(reg, holes) });
  }
  if (cyf.front.length) podstawa.push({ z0: cyf.zDna, z1: cyf.zDna + CYF_UP, reg: cyf.front });
  return { klosz, podstawa, pleksa: [{ z0: p.st + p.wk - p.gp, z1: p.st + p.wk, reg: R(0) }], opis: `ścianka klosza ${fmt(p.wk, 1)}, stopka ${fmt(p.ws, 1)}, podstawa ${fmt(top, 1)} (stopień ${fmt(p.st, 1)} + płyta ${fmt(p.pl, 1)}), pleksa ${fmt(p.gp, 1)}` + (kiesz.length ? `, kieszeń ${fmt(p.gw, 1)} → dno ${fmt(top - p.gw, 1)}` : '') };
}
function warstwySidelit(p) {
  const R = d => offsetPolys(W.base, d), R0 = R(0), holes = otworyReg(p), zK = p.sh - p.kCalk;
  if (!(p.pCalk > p.sd) || !(p.kCalk > p.sf) || p.sw < 0) throw new Error('sprawdź wymiary Sidelit: całkowite muszą być większe od frontu i dna');
  const klosz = [{ z0: zK, z1: zK + p.ss, reg: diff(R0, openR(R(-p.t1), 0)) }, { z0: zK + p.ss, z1: p.sh, reg: R0 }];
  const ringRant = diff(R0, R(-p.t3)), ringSc = diff(openR(R(-p.t2), p.r), R(-p.t3)), rowki = rowkiReg(p, R0, holes), cyf = cyfryReg(p, p.sd);
  const zs = [...new Set([0, p.sd, p.pCalk, p.pCalk + p.sw, ...(rowki.length ? [p.rd] : []), ...(cyf.gl ? [cyf.gl] : [])])].sort((a, b) => a - b), podstawa = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2; let reg = mid < p.sd ? R0 : mid < p.pCalk ? ringRant : ringSc;
    if (mid < p.rd && rowki.length) reg = diff(reg, rowki);
    if (mid < cyf.gl) reg = diff(reg, cyf.back);
    podstawa.push({ z0, z1, reg: diff(reg, holes) });
  }
  if (cyf.front.length) podstawa.push({ z0: cyf.zDna, z1: cyf.zDna + CYF_UP, reg: cyf.front });
  return { klosz, podstawa, pleksa: [], opis: `grubość litery ${fmt(p.sh, 1)} = klosz ${fmt(p.kCalk, 1)} (front ${fmt(p.sf, 1)} + boki ${fmt(p.ss, 1)}) + podstawa ${fmt(p.pCalk, 1)} (dno ${fmt(p.sd, 1)}); pasowanie ${fmt(p.sw, 1)}` };
}
// litera pełna: wyciągnięty kontur, górna (i opcjonalnie dolna) krawędź zaokrąglona promieniem fr.
// Na wysokości z kontur jest cofnięty o r·(1 − cos θ), gdzie sin θ = (z − z0)/r (ćwiartka okręgu). Bryłę buduje pelnaGladka;
// te warstwy (schodki) są tylko zapasem, gdyby gładkiej powierzchni nie dało się złożyć.
function warstwyPelne(p) {
  const H = p.fh; if (!(H > 0.2)) throw new Error('wysokość litery musi być dodatnia');
  const R = d => offsetPolys(W.base, d), g = p.fg, dn = p.fd, r = Math.min(p.fr, g && dn ? H / 2 : H), lay = [];
  const zLo = dn ? r : 0, zHi = H - (g ? r : 0);
  if (zHi - zLo > 1e-6) lay.push({ z0: zLo, z1: zHi, reg: R(0) });
  if (r > 0.01 && (g || dn)) {
    const N = Math.max(6, Math.min(24, Math.ceil(r * 5)));
    for (let k = 0; k < N; k++) {
      const t0 = k / N * Math.PI / 2, t1 = (k + 1) / N * Math.PI / 2, d = r * (1 - Math.cos((t0 + t1) / 2)), reg = R(-d);
      if (g) lay.push({ z0: zHi + r * Math.sin(t0), z1: zHi + r * Math.sin(t1), reg });
      if (dn) lay.push({ z0: zLo - r * Math.sin(t1), z1: zLo - r * Math.sin(t0), reg });
    }
  }
  const kr = (g ? 1 : 0) + (dn ? 1 : 0);
  return { klosz: [], podstawa: [], pleksa: [], litera: lay.filter(l => l.z1 - l.z0 > 1e-6), opis: `litera pełna ${fmt(H, 1)}` + (r > 0.01 && kr ? `, zaokrąglenie R ${fmt(r, 1)} (${g && dn ? 'góra i dół' : g ? 'góra' : 'dół'})` : ', bez zaokrągleń') };
}
// zaokrąglenie jako jedna ciągła powierzchnia: kolejne kontury leżą na swoich wysokościach, a pas między dwoma konturami to pochyłe trójkąty, więc nie ma stopni
function pelnaGladka(p, ndel) {
  const H = p.fh, g = p.fg, dn = p.fd, r = Math.min(p.fr, g && dn ? H / 2 : H); if (!(r > 0.01) || !(g || dn)) return null;
  const { Manifold, Mesh, triangulate } = V3.wasm, R0 = offsetPolys(W.base, 0), zLo = dn ? r : 0, zHi = H - (g ? r : 0), N = Math.max(16, Math.min(48, Math.ceil(r * Math.PI / 2 / 0.2)));
  const xyz = [], tri = [];
  const poziom = (reg, z) => { const polys = toPolys(reg), start = xyz.length / 3; polys.forEach(q => q.forEach(([x, y]) => xyz.push(x, y, z))); return { polys, start }; };
  const pas = (a, b, odwroc) => {   // między konturem a i węższym b (b może nie być, wtedy płaski wierzch); kontury b z odwróconym obiegiem są dziurami pasa
    const polys = [], map = []; let s = a.start;
    a.polys.forEach(q => { polys.push(q); q.forEach((_, i) => map.push(s + i)); s += q.length; });
    if (b) { s = b.start; b.polys.forEach(q => { polys.push(q.slice().reverse()); for (let i = q.length - 1; i >= 0; i--) map.push(s + i); s += q.length; }); }
    triangulate(polys).forEach(([i, j, k]) => { if (odwroc) tri.push(map[i], map[k], map[j]); else tri.push(map[i], map[j], map[k]); });
  };
  // jedna krawędź zaokrąglenia: od konturu litery do wierzchu (dir = 1) albo spodu (dir = −1); gdy kreska jest węższa niż 2 × promień, kontur znika i wierzch zamyka się płasko
  const luk = (z0, dir, L0) => {
    let prev = L0, lastD = 0;
    for (let k = 1; k <= N; k++) {
      const th = k / N * Math.PI / 2, d = r * (1 - Math.cos(th)); if (d - lastD < 0.02 && k < N) continue;
      const reg = offRound(W.base, -d); if (!reg.length) break;
      const L = poziom(reg, z0 + dir * r * Math.sin(th)); pas(prev, L, dir < 0); prev = L; lastD = d;
    }
    pas(prev, null, dir < 0);
  };
  const dol = poziom(R0, zLo), gora = zHi - zLo > 1e-6 ? poziom(R0, zHi) : dol;
  if (gora !== dol) { let s = 0; dol.polys.forEach(q => { const n = q.length; for (let i = 0; i < n; i++) { const j = (i + 1) % n, b0 = dol.start + s + i, b1 = dol.start + s + j, t0 = gora.start + s + i, t1 = gora.start + s + j; tri.push(b0, b1, t1, b0, t1, t0); } s += n; }); }
  if (g) luk(zHi, 1, gora); else pas(gora, null, false);
  if (dn) luk(zLo, -1, dol); else pas(dol, null, true);
  const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(xyz), triVerts: new Uint32Array(tri) });
  return ndel(new Manifold(mesh));
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
    W.pr = params(); const p = params3D(), m = W.m, plan = W.pr.typ === 'P' ? warstwyPelne(p) : W.pr.typ === 'S' ? warstwySidelit(p) : warstwyFrontlit(p, m), parts = {}, bodies = [], ls = letters(bedSrc()), uwagi = [];
    if (W.pr.typ === 'P') { try { parts.litera = pelnaGladka(p, ndel); } catch (e) { console.warn(e); uwagi.push('zaokrąglenie złożone z warstw (schodki): dla tego kształtu nie udało się zbudować gładkiej powierzchni'); } }
    Object.keys(CZESCI).forEach(k => { if (!parts[k]) parts[k] = (plan[k] || []).length ? stos(plan[k], ndel) : null; });
    if (W.overlaps.length) uwagi.push(`litery nachodzą na siebie w ${W.overlaps.length} miejscach — bryły są połączone`);
    if (parts.klosz && parts.podstawa) { const v = objetosc(ndel(V3.wasm.Manifold.intersection(parts.klosz, parts.podstawa))); if (v > 1) uwagi.push(`klosz przenika podstawę (${fmt(v, 1)} mm³) — sprawdź offsety`); }
    const segs = p.cut ? cutSegs() : [], segsK = p.cut ? cutSegs(W.cuts.map(cutK)) : [];     // klosz po swojej, przesuniętej linii; pleksa w całości: nie jest drukowana, tylko cięta laserem
    Object.keys(CZESCI).forEach(k => {
      if (!parts[k]) return;
      let list = parts[k].decompose().map(ndel);
      // podział: linia tnie tylko bryły swojej litery (Fusion tnie wszystko, co dotyka prostokąta linii)
      if (k !== 'pleksa') (k === 'klosz' ? segsK : segs).forEach(c => {
        const L = ls[c.li]; if (!L) return;
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
    // plasterki łączące: osobne elementy do wydruku (nie są cięte ani łączone z częściami)
    const tops = W.pr.typ === 'S' ? { zP: p.sd, hK: p.kCalk - W.pr.plDownK, zK0: p.pCalk + p.sw, zKmax: p.sh - p.sf } : { zP: p.wgl && p.gw > 0 ? Math.max(0.2, p.st + p.pl - p.gw) : -W.pr.plH, hK: p.wk - W.pr.plDownK, zK0: p.st + p.pl, zKmax: p.st + p.ws }, holes2 = otworyReg(p), cntPl = {};
    let nKpom = 0;
    W.plates.forEach(q => {
      if (!q.polys.length) return;
      if (q.type === 'K' && !(tops.hK > 0)) { nKpom++; return; }
      const pl = W.pr, warstwy = q.type === 'K' ? [{ z0: tops.zK0, z1: tops.zK0 + tops.hK, reg: q.polys }] : q.groove.length ? [{ z0: tops.zP, z1: tops.zP + pl.plFloor, reg: diff(q.polys, holes2) }, { z0: tops.zP + pl.plFloor, z1: tops.zP + pl.plH, reg: diff(diff(q.polys, q.groove), holes2) }] : [{ z0: tops.zP, z1: tops.zP + pl.plH, reg: diff(q.polys, holes2) }];
      const s = stos(warstwy, ndel); if (!s) return;
      s.decompose().map(ndel).forEach(b => { const tag = `Plaster_${q.type}_${String(q.li + 1).padStart(2, '0')}`; cntPl[tag] = (cntPl[tag] || 0) + 1; const mesh = b.getMesh(), bb = b.boundingBox(); bodies.push({ part: 'plaster', plType: q.type, plate: { id: q.c.id, key: q.key }, name: `${tag}_${cntPl[tag]}`, pos: mesh.vertProperties.slice(), tri: mesh.triVerts.slice(), numProp: mesh.numProp, vol: objetosc(b), bb }); });
    });
    if (nKpom) uwagi.push(`plasterki klosza pominięte (${nKpom}): klosz nie jest wyższy niż ${fmt(W.pr.plDownK, 1)} mm`);
    if (tops.hK > 0 && tops.zK0 + tops.hK > tops.zKmax && W.plates.some(q => q.type === 'K')) uwagi.push('plasterek klosza sięga wyżej niż podparcie pleksy: zwiększ „niższy o”');
    cyfryMiejsca().forEach(q => { const u = cyfraUwaga(q); if (u) uwagi.push(u); });
    V3.bodies = bodies; V3.dirty = false; show3D();
    const c = k => bodies.filter(b => b.part === k).length, tris = bodies.reduce((s, b) => s + b.tri.length / 3, 0), wol = bodies.reduce((s, b) => s + b.vol, 0);
    $('b3-report').innerHTML = `<b>Części:</b> ${c('litera') ? `litery ${c('litera')}` : `klosz ${c('klosz')}, podstawa ${c('podstawa')}`}${c('pleksa') ? `, pleksa ${c('pleksa')}` : ''}${c('plaster') ? `, plasterki ${c('plaster')}` : ''}<br>${esc(plan.opis)} [mm]<br>${W.led ? `<b>LED:</b> ${fmt(W.led.m, 2)} m<br>` : ''}<b>Materiał:</b> ${fmt(wol / 1000, 0)} cm³ · ${Math.round(tris).toLocaleString('pl-PL')} trójkątów · ${fmt((performance.now() - t0) / 1000, 1)} s${uwagi.length ? `<br><span style="color:#c53030;font-weight:700">${uwagi.map(esc).join('<br>')}</span>` : ''}`;
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
  sterowanie3D(V3.ren.domElement);
  // klik w plasterek: to samo okienko z długością co w widoku 2D; przeciągnięcie dalej obraca widok
  const el = V3.ren.domElement; let dn = null, dnP = null;
  el.addEventListener('pointerdown', e => { closePlatePop(); dn = e.button === 0 ? [e.clientX, e.clientY] : null; dnP = e.button === 2 ? [e.clientX, e.clientY] : null; });
  // prawy klawisz na literze: cyfra (przeciągnięcie prawym dalej przesuwa widok)
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); const d = dnP; dnP = null; if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) >= 3) return;
    const h = ray3D(e).intersectObjects(V3.meshes.filter(m => m.visible), false)[0], li = h ? letterAt(h.point.x, h.point.y) : -1; if (li < 0) return;
    const st = $('stage').getBoundingClientRect(); openMarkPop(li, e.clientX - st.left, e.clientY - st.top);
  });
  el.addEventListener('pointerup', e => {
    const d = dn; dn = null; if (!d || Math.hypot(e.clientX - d[0], e.clientY - d[1]) >= 3) return;
    const m = plate3D(e); if (!m) return;
    const st = $('stage').getBoundingClientRect(); W.sel = { t: 'plate', ...m.userData.plate }; renderPlateList(); openPlatePop(m.userData.plate, e.clientX - st.left, e.clientY - st.top);
  });
  el.addEventListener('pointermove', e => { if (!e.buttons) hover3D(plate3D(e)); });
  el.addEventListener('pointerleave', () => hover3D(null));
  V3.group = new T.Group(); V3.scene.add(V3.group);
  new ResizeObserver(() => size3D()).observe(host);
  size3D();
}
// lewy = obrót wokół środka widoku bez żadnej blokady (można przejść nad biegunem i oglądać spód), środkowy lub prawy = przesuwanie, kółko = zoom do kursora
function sterowanie3D(el) {
  const T = V3.THREE, cam = V3.cam, ctl = V3.ctl = { target: new T.Vector3(), update() { cam.lookAt(ctl.target); } }, Z = new T.Vector3(0, 0, 1);
  const os = (x, y) => new T.Vector3(x, y, 0).applyQuaternion(cam.quaternion), mmNaPx = () => (cam.top - cam.bottom) / cam.zoom / (el.clientHeight || 1);
  const przesun = v => { cam.position.add(v); ctl.target.add(v); };
  const obroc = (q) => { cam.position.sub(ctl.target).applyQuaternion(q).add(ctl.target); cam.quaternion.premultiply(q); cam.up.applyQuaternion(q); };
  let dr = null;
  el.style.touchAction = 'none';
  el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener('pointerdown', e => { dr = { rot: e.button === 0, x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e => {
    if (!dr || !e.buttons) return;
    const dx = e.clientX - dr.x, dy = e.clientY - dr.y, k = 2 * Math.PI / (el.clientHeight || 600); dr.x = e.clientX; dr.y = e.clientY;
    if (dr.rot) {
      // w poziomie wokół pionu litery (do góry nogami w drugą stronę, żeby ruch zgadzał się z ręką), w pionie wokół poziomej osi ekranu
      const q1 = new T.Quaternion().setFromAxisAngle(Z, -dx * k * (os(0, 1).z < 0 ? -1 : 1)), q2 = new T.Quaternion().setFromAxisAngle(os(1, 0), -dy * k);
      obroc(q1); obroc(q2);
    } else { const s = mmNaPx(); przesun(os(-dx * s, dy * s)); }
    render3D();
  });
  const koniec = () => { dr = null; }; el.addEventListener('pointerup', koniec); el.addEventListener('pointercancel', koniec);
  el.addEventListener('wheel', e => {
    e.preventDefault(); const r = el.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2, z0 = cam.zoom, z1 = Math.min(1000, Math.max(0.02, z0 * Math.pow(1.0015, -e.deltaY)));
    const d = 1 / z0 - 1 / z1; przesun(os(nx * cam.right * d, ny * cam.top * d)); cam.zoom = z1; cam.updateProjectionMatrix(); render3D();
  }, { passive: false });
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
function ray3D(e) {
  const T = V3.THREE, r = V3.ren.domElement.getBoundingClientRect(), rc = V3.ray || (V3.ray = new T.Raycaster());
  rc.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), V3.cam);
  return rc;
}
function plate3D(e) {
  const pl = V3.meshes.filter(m => m.visible && m.userData.part === 'plaster'); if (!pl.length) return null;
  const rc = ray3D(e), hit = rc.intersectObjects(pl, false)[0]; if (!hit) return null;
  // plasterka schowanego za nieprzezroczystą częścią nie widać, więc nie można go też kliknąć
  const przed = rc.intersectObjects(V3.meshes.filter(m => m.visible && m.userData.part !== 'plaster' && !m.material.transparent), false)[0];
  return przed && przed.distance < hit.distance ? null : hit.object;
}
function hover3D(m) {
  if (V3.hl === m || (!V3.hl && !m)) return;
  if (V3.hl) V3.hl.material.emissive.setHex(0);
  V3.hl = m; if (m) m.material.emissive.setHex(0x553300);
  V3.ren.domElement.style.cursor = m ? 'pointer' : ''; render3D();
}
function material3D(part, plType) {
  if (part === 'plaster') return new V3.THREE.MeshStandardMaterial({ color: plType === 'K' ? 0x3182ce : 0xdd6b20, flatShading: true, roughness: 0.55, side: V3.THREE.DoubleSide });
  const T = V3.THREE, sel = { klosz: ['b3-ck', 'b3-tk', 0.5], podstawa: ['b3-cp', 'b3-tp', 0.55], pleksa: ['b3-cx', 'b3-tx', 0.45], litera: ['b3-cp', 'b3-tp', 0.55] }[part], tr = $(sel[1]).checked;
  return new T.MeshStandardMaterial({ color: Number($(sel[0]).value), flatShading: true, roughness: 0.55, metalness: 0.02, transparent: tr, opacity: tr ? sel[2] : 1, depthWrite: !tr, side: T.DoubleSide });
}
function show3D() {
  init3D(); const T = V3.THREE;
  V3.meshes.forEach(m => { m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); V3.group.remove(m); }); V3.meshes = []; V3.hl = null;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  V3.bodies.forEach(b => {
    const g = new T.BufferGeometry(), n = b.numProp || 3, pos = n === 3 ? b.pos : Float32Array.from({ length: b.pos.length / n * 3 }, (_, i) => b.pos[Math.floor(i / 3) * n + i % 3]);
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(new T.BufferAttribute(b.tri, 1));
    const mesh = new T.Mesh(g, material3D(b.part, b.plType)), edges = new T.LineSegments(new T.EdgesGeometry(g, 28), new T.LineBasicMaterial({ color: 0x2d3748, transparent: true, opacity: 0.45 }));
    mesh.add(edges); mesh.userData = { part: b.part, plType: b.plType, plate: b.plate }; mesh.renderOrder = b.part === 'podstawa' ? 0 : b.part === 'klosz' ? 1 : 2; V3.group.add(mesh); V3.meshes.push(mesh);
    for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.bb.min[i]); mx[i] = Math.max(mx[i], b.bb.max[i]); }
  });
  const first = !V3.box;
  V3.box = { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], r: Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2) };
  apply3D(); if (first || !V3.keepView) setView(V3.view); V3.keepView = true;
}
function apply3D() {
  const e = Number($('v3-e').value) || 0, vis = { klosz: $('v3-k').checked, podstawa: $('v3-p').checked, pleksa: $('v3-x').checked, plaster: $('v3-l').checked, litera: true }, lift = { litera: 0, podstawa: 0, klosz: e, pleksa: 2 * e };
  V3.meshes.forEach(m => { const u = m.userData; m.visible = vis[u.part]; m.position.z = u.part === 'plaster' ? (u.plType === 'K' ? e : 0) : lift[u.part]; });
  render3D();
}
function recolor3D() { V3.meshes.forEach(m => { m.material.dispose(); m.material = material3D(m.userData.part, m.userData.plType); }); render3D(); }
function groups3D() { const t = (document.querySelector('input[name=typ]:checked') || {}).value; $('g3-f').classList.toggle('hidden', t === 'S'); $('g3-s').classList.toggle('hidden', t !== 'S'); document.body.classList.toggle('t-P', t === 'P'); }
window.mark3D = () => { V3.dirty = true; groups3D(); clearTimeout(V3.tmr); if (V3.open) V3.tmr = setTimeout(build3D, 700); };
async function open3D() {
  if (!W.base) return toast('Najpierw wczytaj kontury');
  closePlatePop(); V3.open = true; $('v3d').classList.remove('hidden'); $('b-3d').classList.add('on'); $('b-2d').classList.remove('on'); $('selbox').classList.add('hidden');
  if (W.panel !== 'bryla') showPanel('bryla', true);
  try { msg3D('Wczytuję silnik 3D…'); await load3D(); init3D(); size3D(); if (V3.dirty) await build3D(); else { msg3D(''); render3D(); } }
  catch (e) { console.error(e); msg3D('Nie udało się wczytać silnika 3D (sprawdź internet): ' + (e && e.message || e)); }
}
function close3D() { closePlatePop(); V3.open = false; $('v3d').classList.add('hidden'); $('b-2d').classList.add('on'); $('b-3d').classList.remove('on'); draw(); }
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
['v3-k', 'v3-p', 'v3-x', 'v3-l'].forEach(id => { $(id).onchange = apply3D; }); $('v3-e').oninput = apply3D;
['b3-ck', 'b3-cp', 'b3-cx', 'b3-tk', 'b3-tp', 'b3-tx'].forEach(id => { $(id).addEventListener('change', () => { clearTimeout(V3.tmr); if (!V3.dirty) { /* sam kolor nie wymaga przebudowy */ } setTimeout(recolor3D, 0); }); });
