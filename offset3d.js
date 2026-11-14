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
// faza zakrętów kieszeni: ostry narożnik materiału wcinający się w kanał ścięty prostą, f mm wzdłuż obu ścian (jak faza we Fusion);
// przy narożniku ostrzejszym niż 60° odcinki wzdłuż ścian rosną, żeby samo ścięcie miało co najmniej f szerokości (inaczej ostry szpic prawie się nie zmienia).
// Łagodne załamania łuków (poniżej 15°) i narożniki odsunięte od kanału zostają bez zmian.
function fazaKieszeni(v, f, mat = -1) {
  if (!(f > 0)) return v;
  const rings = v.map(ring => {
    const P = ring.map(q => [q.X / S, q.Y / S]), n = P.length, len = P.map((p, i) => Math.hypot(P[(i + 1) % n][0] - p[0], P[(i + 1) % n][1] - p[1]));
    const turn = P.map((p, i) => { const a = P[(i + n - 1) % n], b = P[(i + 1) % n], ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1]; return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); });
    const sharp = turn.map(t => Math.abs(t) > 0.26), idx = sharp.flatMap((s, i) => s ? [i] : []);
    if (!idx.some(i => turn[i] * mat > 0)) return ring;     // wnętrze pustki po lewej: skręt w prawo = narożnik materiału (mat = +1: wyspa materiału, skręt w lewo)
    const between = (a, b) => { let s = 0; for (let k = a; k !== b; k = (k + 1) % n) s += len[k]; return s; };
    const skip = new Uint8Array(n), cut = new Map();
    const walk = (i, dir, leg) => { let k = i, rem = leg; for (let c = 0; c < n; c++) { const q = (k + dir + n) % n, L = dir > 0 ? len[k] : len[q]; if (L >= rem) { const t = L > 0 ? rem / L : 0; return [P[k][0] + (P[q][0] - P[k][0]) * t, P[k][1] + (P[q][1] - P[k][1]) * t]; } rem -= L; k = q; skip[k] = 1; } return P[i]; };
    idx.forEach((i, j) => {
      if (turn[i] * mat <= 0) return;
      const prev = idx[(j + idx.length - 1) % idx.length], next = idx[(j + 1) % idx.length], total = len.reduce((s, x) => s + x, 0);
      const kat = Math.PI - Math.abs(turn[i]), chce = Math.max(f, f / (2 * Math.sin(Math.max(0.05, kat) / 2)));     // kat: kąt wewnętrzny narożnika materiału
      const dPrev = idx.length > 1 ? between(prev, i) : total, dNext = idx.length > 1 ? between(i, next) : total, leg = Math.min(chce, 0.45 * dPrev, 0.45 * dNext);
      if (leg > 0.01) cut.set(i, [walk(i, -1, leg), walk(i, 1, leg)]);
    });
    const out = []; for (let i = 0; i < n; i++) { if (cut.has(i)) out.push(...cut.get(i)); else if (!skip[i]) out.push(P[i]); }
    return out.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  });
  return clip('ctUnion', rings);
}

// kieszeń z fazą liczoną dla każdego konturu litery osobno: wyspa materiału wokół brzuszka (np. w „A”) dostaje fazę na swoim szpicu,
// zanim zetknie się z resztą kieszeni — inaczej ostry offset wyciąga szpic aż do krawędzi, kieszeń się rozdziela i nie ma czego ściąć
function kieszenFaza(d, f) {
  if (!(f > 0)) return offsetPolys(W.base, d);
  const key = W.baseId + '|' + d + '|' + f; if (W.kfC && W.kfC.key === key) return W.kfC.reg;
  const zew = [], wyspy = [];
  W.base.forEach(ring => {
    if (area(ring) > 0) zew.push(...fazaKieszeni(offsetPolys([ring], d), f));
    else wyspy.push(...fazaKieszeni(offsetPolys([ring.slice().reverse()], -d), f, 1));
  });
  const reg = wyspy.length ? diff(clip('ctUnion', zew), clip('ctUnion', wyspy)) : clip('ctUnion', zew);
  W.kfC = { key, reg }; return reg;
}
function params3D() {
  const n = id => num($(id).value), au = (id, v) => { const s = $(id).value.trim(); return s ? num(s) : v; }, cb = id => $(id).checked, dysza04 = W.pr.dysza === 4;
  const p = { gp: n('b3-gp'), h: n('b3-h'), st: n('b3-st'), pl: n('b3-pl'), wgl: cb('b3-wgl'), gw: n('b3-gw'), sh: n('b3-sh'), ss: n('b3-ss'), sf: n('b3-sf'), sd: n('b3-sd'), t1: n('b3-st1'), t2: n('b3-st2'), t3: n('b3-st3'),
    otw: cb('b3-otw'), fix: cb('b3-fix'), cut: cb('b3-cut'), puz: cb('b3-puz'), puzk: $('b3-puzk') ? $('b3-puzk').value : 'o', puzl: Math.max(0, n('b3-puzl')), row: cb('b3-row'), rg: au('b3-rg', dysza04 ? 0.42 : 0.62), rd: au('b3-rd', dysza04 ? 0.24 : 0.30), rm: n('b3-rm'), r: cb('b3-rnd') ? n('b3-r') : 0, f: cb('b3-rnd') ? n('b3-f') : 0, cyf: Math.max(2, n('b3-cyf') || 10), fh: n('b3-fh'), fr: Math.max(0, n('b3-fr')), fg: cb('b3-fg'), fd: cb('b3-fd') };
  const magOn = $('b3-mon').checked && (W.pr.typ === 'F' || W.pr.typ === 'S' || (W.pr.typ === 'P' && $('b3-fpod').checked));
  if (magOn && W.pr.typ !== 'S' && !magScr()) {     // magnesy: niski kołnierz zamiast płyty; śruby: grubość płyty, kieszeń i stopień z panelu Bryła 3D
    const dn = Math.max(0.3, $('b3-mdn') ? n('b3-mdn') : 1), mh = Math.max(0.5, n('b3-mh') || 2);     // dno gniazda od spodu litery + grubość magnesu = wierzch kołnierza (magnes równo z wierzchem)
    // rant (stopień) podstawy przy magnesach najwyżej 2 mm; gdy magnes się nie mieści (zostaje mniej niż 1 mm pod nim), rośnie kołnierz,
    // a wybranie pogłębia się o tyle samo (dno kieszeni i LED zostają na miejscu)
    if (p.st > 2) { p.st = 2; p.stMag = 'rant'; }
    p.pl = Math.max(0.6, dn + mh - p.st); p.gw = p.pl; p.dn = dn; p.mh = mh;
  }     // magnesy: niski kołnierz zamiast płyty; duże litery: LED na dnie kieszeni, małe: pełna płyta
  if (W.pr.typ === 'P' && $('b3-fpod').checked) { p.ks = Math.max(0.4, n('b3-fks') || 1.2); p.kf = Math.max(0.4, n('b3-fkf') || 1.5); }
  p.wk = au('b3-wk', p.h - p.st); p.ws = au('b3-ws', p.wk - p.gp);
  if (p.ks) { p.wk = p.fh - p.st; p.ws = p.wk - p.kf; }     // pełna z podstawą: klosz od stopnia do wierzchu litery
  p.kCalk = p.sf + p.ss; p.pCalk = p.sh - p.kCalk; p.sw = au('b3-sw', p.ss - 0.5);
  if (magOn && W.pr.typ === 'S' && !magScr()) p.sw = Math.max(0.6, n('b3-mr') || 2);     // Sidelit z magnesami: niskie pasowanie
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
  return p.wgl && p.gw > 0 ? { reg: kieszenFaza(m.kie, p.f), z: Math.max(0.2, top - p.gw) } : { reg: closeR(R(m.k3), p.r), z: top };
}
function cyfryMiejsca() {
  if (!W.marks.length || !W.base || !W.pr || (W.pr.typ === 'P' && !pbWl())) return [];
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
// ===================== zatrzaski klik (push-push) zamiast śrub =====================
// Mechanizm (korpus klika) siedzi w kloszu: uchwyt z płytką z otworem, korpus wchodzi od spodu, zaczepy wystają w dół (Frontlit: uchwyt przyklejony do stopki,
// Sidelit: przy froncie). Na dnie podstawy leży prawdziwy zatrzask z grzybkiem (płytka z dwoma otworami) w ramce, przykręcony albo przyklejony.
// Klosz stoi wyżej o szczelinę (skok mechanizmu), bo żeby zwolnić zatrzask, trzeba go docisnąć.
const rectPoly = (cx, cy, w, h, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return toCl([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c])); };
const zatWym = Z => { const l = Z.luz; return { hole: [Z.a + 2 * l, Z.b + 2 * l], cav: [Z.fl + 2 * l, Z.b + 2 * l], out: [Z.fl + 2 * l + 2 * Z.sc, Z.b + 2 * l + 2 * Z.sc] }; };
const zatWl = () => !!(W.pr && W.pr.zat && W.pr.zat.on && W.pr.typ !== 'P');
const zatGap = () => zatWl() && W.latches.length ? W.pr.zat.gap : 0;
// ścianka, do której idzie ramię języczka (Frontlit: wnętrze klosza) albo do której układa się wieżyczka (Sidelit: wnętrze podstawy)
function zatSciana() {
  const key = W.baseId + '|' + W.pr.typ + '|' + W.m.k3 + '|' + $('b3-st3').value; if (W.zatSc && W.zatSc.key === key) return W.zatSc.polys;
  const polys = W.pr.typ === 'S' ? offsetPolys(W.base, -num($('b3-st3').value)) : offsetPolys(W.base, W.m.k3); W.zatSc = { key, polys }; return polys;
}
function zatNajblizej(x, y) {
  let best = null, bd = Infinity;
  zatSciana().forEach(p => { for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], ax = a.X / S, ay = a.Y / S, dx = b.X / S - ax, dy = b.Y / S - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; best = [qx, qy]; } } });
  return best;
}
// płytka i uchwyt dłuższym bokiem wzdłuż najbliższej ścianki
function zatKat(l) { const w = zatNajblizej(l.x, l.y); return w ? Math.round((Math.atan2(w[1] - l.y, w[0] - l.x) * 180 / Math.PI + 90) * 10) / 10 : 0; }
// obrys klosza z zewnątrz (0,4 mm w głąb od jego powierzchni): lity blok uchwytu nie może wystawać poza klosz
function zatKlosz() {
  const key = W.baseId + '|' + W.m.k2; if (W.zatKl && W.zatKl.key === key) return W.zatKl.polys;
  const polys = offsetPolys(W.base, W.m.k2 - 0.4); W.zatKl = { key, polys }; return polys;
}
const zatPl = Z => ({ L: Z.hl + 2 * Z.hluz, W: Z.hw + 2 * Z.hluz });   // wnętrze ramki na płytkę zatrzasku z grzybkiem (z luzem)
function zatGeo(l) {
  const Z = W.pr.zat, d = zatWym(Z), pl = zatPl(Z), a = (l.ang || 0) * Math.PI / 180, R = (w, h) => [rectPoly(l.x, l.y, w, h, a)], cs = Math.cos(a), sn = Math.sin(a), hx = Z.hs / 2;
  const g = { out: R(d.out[0], d.out[1]), cav: R(d.cav[0], d.cav[1]), hole: R(d.hole[0], d.hole[1]), plate: R(pl.L, pl.W),
    frame: diff(R(pl.L + 2 * Z.hf, pl.W + 2 * Z.hf), R(pl.L, pl.W)), screws: [-hx, hx].map(u => circlePoly(l.x + u * cs, l.y + u * sn, Z.hd)) };
  if (W.pr.typ !== 'S') {   // Frontlit: uchwyt przyklejony do stopki klosza — odstęp od ścianki wypełniony litym blokiem (szerokość uchwytu)
    const w = zatNajblizej(l.x, l.y);
    if (w) {
      const L = Math.hypot(w[0] - l.x, w[1] - l.y) || 1, ux = (w[0] - l.x) / L, uy = (w[1] - l.y) / L, e = L + 1.5, hw0 = d.out[0] / 2, hh0 = d.out[1] / 2;
      const pts = [];
      [0, e].forEach(t => [[-hw0, -hh0], [hw0, -hh0], [hw0, hh0], [-hw0, hh0]].forEach(([u, v]) => pts.push([l.x + ux * t + u * cs - v * sn, l.y + uy * t + u * sn + v * cs])));
      pts.sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1]);
      const cr = (o, a1, b1) => (a1[0] - o[0]) * (b1[1] - o[1]) - (a1[1] - o[1]) * (b1[0] - o[0]), lo = [], up = [];
      pts.forEach(q => { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
      for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
      let hull = toCl(lo.slice(0, -1).concat(up.slice(0, -1)));
      if (C.Clipper.Area(hull) < 0) hull = hull.reverse();
      g.fill = inter(diff([hull], g.out), zatKlosz()); g.arm = g.fill; g.L = L;   // blok nie wychodzi poza zewnętrzną powierzchnię klosza
    }
  }
  return g;
}
// pola dozwolone dla zatrzasku: płytka z grzybkiem leży na dnie (w kieszeni, 0,3 mm od ścianki), uchwyt klosza w całości w środku klosza
// (Frontlit: 0,5 mm od stopki; Sidelit: wewnątrz rantu podstawy). Wejście w rant podstawy ponad dnem nie przeszkadza: uchwyt jest wyżej.
function zatObszar() {
  const p = params3D(), Z = W.pr.zat, key = JSON.stringify([W.baseId, W.pr, p, W.m.k3]);
  if (W.zatOb && W.zatOb.key === key) return W.zatOb;
  const d = zatWym(Z), pl = zatPl(Z), floor = offsetPolys(cyfryDno(p, W.m).reg, -0.3);
  const inner = W.pr.typ === 'S' ? offsetPolys(W.base, -(p.t3 + 0.3)) : offsetPolys(W.base, W.m.k3 - 0.5);
  return W.zatOb = { key, floor, inner, wP: pl.W / 2, wH: Math.min(d.out[0], d.out[1]) / 2, R: Math.max(Math.hypot(pl.L, pl.W), Math.hypot(d.out[0], d.out[1])) / 2 };
}
const zatPole = (x, y, ang, fl, inn) => {   // mm² płytki i uchwytu poza dozwolonymi polami
  const Z = W.pr.zat, d = zatWym(Z), pl = zatPl(Z), a = (ang || 0) * Math.PI / 180, ar = ps => ps.reduce((s, q) => s + Math.abs(area(q)), 0);
  return ar(diff([rectPoly(x, y, pl.L, pl.W, a)], fl)) + ar(diff([rectPoly(x, y, d.out[0], d.out[1], a)], inn));
};
// środek przesuwany w stronę najbliższej ścianki, jak daleko pozwalają płytka i uchwyt (z obrotem): zatrzask dolega do krawędzi
function zatDocisnij(x, y, fl, inn, ang) {
  const a = ang != null ? ang : zatKat({ x, y }), w = zatNajblizej(x, y);
  if (zatPole(x, y, a, fl, inn) > 0.02) return null;
  if (!w) return { x, y, ang: a };
  const L = Math.hypot(w[0] - x, w[1] - y) || 1, ux = (w[0] - x) / L, uy = (w[1] - y) / L, ok = t => zatPole(x + ux * t, y + uy * t, a, fl, inn) < 0.02;
  let lo = 0, hi = L;
  if (ok(hi)) lo = hi; else for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return { x: x + ux * lo, y: y + uy * lo, ang: a };
}
const zatNajblizejNa = (polys, x, y) => {
  let best = null, bd = Infinity;
  polys.forEach(q => { for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], ax = a.X / S, ay = a.Y / S, dx = b.X / S - ax, dy = b.Y / S - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), px = ax + t * dx, py = ay + t * dy, dd = Math.hypot(px - x, py - y); if (dd < bd) { bd = dd; best = [px, py]; } } });
  return best;
};
// dozwolone miejsce środka zatrzasku w literze li: bez zmiany, gdy płytka i uchwyt już się mieszczą; inaczej najbliższe miejsce, w którym się mieszczą
// (i tak blisko wskazanego punktu, jak się da); null = w tej literze zatrzask się nie zmieści. ang = obrót (domyślnie wzdłuż ścianki).
function zatPrzyciagnij(x, y, li, ang) {
  if (!zatWl() || !W.base) return [x, y];
  const A = zatObszar(), L = bedLetters()[li], lp = ps => L ? inter(ps, [L.p]) : ps, fl = offsetPolys(lp(A.floor), -0.08), inn = offsetPolys(lp(A.inner), -0.08);
  const kat = (px, py) => ang != null ? ang : zatKat({ x: px, y: py }), valid = (px, py) => zatPole(px, py, kat(px, py), fl, inn) < 0.02;
  if (valid(x, y)) return [x, y];
  const cand = inter(offsetPolys(A.floor, -A.wP), offsetPolys(A.inner, -A.wH));
  for (const e of [0.2, 1.5, 4, 8]) {
    const reg = lp(offsetPolys(cand, -e)); if (!reg.length) continue;
    const sp = zatNajblizejNa(reg, x, y); if (!sp || !valid(sp[0], sp[1])) continue;
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (valid(sp[0] + (x - sp[0]) * mid, sp[1] + (y - sp[1]) * mid)) lo = mid; else hi = mid; }
    return [sp[0] + (x - sp[0]) * lo, sp[1] + (y - sp[1]) * lo];
  }
  return null;
}
// automatycznie: po n na literę, jak najdalej od siebie, przy ściance, z dala od paska LED, otworów, linii podziału i plasterków; ręcznie postawione zostają
function autoLatches() {
  W.zatWarn = [];
  if (!zatWl() || !W.base) return;
  W.latches = W.latches.filter(l => l.manual).filter(l => {
    const q = zatPrzyciagnij(l.x, l.y, l.li, l.ang);
    if (!q) { W.zatWarn.push(`litera ${l.li + 1}: ręcznie dodany zatrzask nie mieści się (płytka na dnie lub uchwyt w kloszu) — usunięty`); return false; }
    l.x = Math.round(q[0] * 10) / 10; l.y = Math.round(q[1] * 10) / 10; return true;
  });
  const Z = W.pr.zat, d = zatWym(Z), ls = bedLetters(), A = zatObszar(), plus = ps => ps.map(q => area(q) < 0 ? q.slice().reverse() : q);
  const pas = c => { const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * 2, ny = dx / l * 2; return toCl([[c.a[0] + nx, c.a[1] + ny], [c.b[0] + nx, c.b[1] + ny], [c.b[0] - nx, c.b[1] - ny], [c.a[0] - nx, c.a[1] - ny]]); };
  const przeszkody = W.holes.map(h => circlePoly(h.x, h.y, h.d + 2)).concat(plus(W.plates.flatMap(q => q.polys)), plus(cutSegs().concat(cutSegs(kSzew().map(cutK))).map(pas)));
  ls.forEach((l, li) => {
    const moje = W.latches.filter(q => q.li === li), ile = Z.n - moje.length; if (ile <= 0) return;
    const floorL = inter(A.floor, [l.p]), led = W.led ? plus(rowekLED(floorL, LED_W + 1)) : [];
    const flFree = diff(floorL, clip('ctUnion', przeszkody.concat(led))), inFree = diff(inter(A.inner, [l.p]), clip('ctUnion', przeszkody));
    const fl = offsetPolys(flFree, -0.08), inn = offsetPolys(inFree, -0.08);
    const pts = inter(offsetPolys(flFree, -A.wP), offsetPolys(inFree, -A.wH)).flatMap(q => q.map(v => [v.X / S, v.Y / S]));
    const jest = moje.map(q => [q.x, q.y]), cx = (l.bb.x0 + l.bb.x1) / 2, cy = (l.bb.y0 + l.bb.y1) / 2, odstep = Z.hl + 1;
    let dodane = 0;
    for (let k = 0; k < ile; k++) {
      // kandydaci od najlepszego (najdalej od siebie); pierwszy, któremu płytka i uchwyt mieszczą się dokładnie, zostaje dociśnięty do ścianki
      const cand = pts.map(q => ({ q, s: jest.length ? Math.min(...jest.map(o => Math.hypot(o[0] - q[0], o[1] - q[1]))) : Math.hypot(q[0] - cx, q[1] - cy) })).sort((a, b) => b.s - a.s);
      let got = null;
      for (let ci = 0; ci < cand.length && ci < 400; ci++) { const c = cand[ci]; if (jest.length && c.s < odstep) break; got = zatDocisnij(c.q[0], c.q[1], fl, inn); if (got) break; }
      if (!got) break;
      const z = { id: uid++, li, x: Math.round(got.x * 10) / 10, y: Math.round(got.y * 10) / 10, ang: 0, manual: false }; z.ang = zatKat(z);
      W.latches.push(z); jest.push([z.x, z.y]); dodane++;
    }
    if (dodane < ile) W.zatWarn.push(`litera ${li + 1}: zmieściło się ${moje.length + dodane} z ${Z.n}`);
  });
}
// warstwy zatrzasków do brył: ramka i otwory na zatrzask z grzybkiem w podstawie; uchwyt korpusu klika w kloszu
function zatReg(p) {
  const out = { gap: 0, screw: [], pod: [], kl: [], uw: [], zF: Infinity };
  if (!zatWl() || !W.latches.length) return out;
  const Z = W.pr.zat, side = W.pr.typ === 'S', zF = cyfryDno(p, W.m).z, gz = Z.gap;
  out.gap = gz; out.zF = zF;
  const zm = zF + Z.ht + Z.hp, top = side ? p.pCalk : p.st + p.pl;   // czubek grzybka (płytka leży na dnie); wierzch podstawy
  let zp = zm + Z.jz;                                                   // płaszczyzna kołnierza klika przy zatrzaśniętym kloszu (wyżej o skok)
  if (!side) zp = Math.max(zp, top + gz + 0.2);                         // po dociśnięciu uchwyt nie siada na ranncie podstawy
  const zh = zp + Z.h, fz = side ? p.sh - p.kCalk + p.ss + gz : 0;      // wierzch wnęki; Sidelit: wewnętrzna strona frontu klosza
  const cel = side ? fz : p.st + gz + p.wk - p.gp;                      // sufit: front klosza / spód pleksy
  W.latches.forEach((l, i) => {
    const g = zatGeo(l), nr = `zatrzask ${i + 1} (litera ${l.li + 1})`;
    out.screw.push(...g.screws);
    out.pod.push({ z0: zF, z1: zF + Z.ht, reg: g.frame });
    if (side && zh > fz + 0.3) { out.uw.push(`${nr}: litera za płaska: uchwyt klika nie mieści się pod frontem (potrzeba grubości litery co najmniej ${fmt(p.sh + zh - fz, 1)} mm)`); return; }
    if (!side && zh + Z.at > cel - 0.2) out.uw.push(`${nr}: klosz za niski na uchwyt klika (potrzeba wysokości klosza co najmniej ${fmt(p.wk + zh + Z.at - cel + 0.2, 1)} mm)`);
    out.kl.push({ z0: zp, z1: zp + Z.t, reg: diff(g.out, g.hole) }, { z0: zp + Z.t, z1: zh, reg: diff(g.out, g.cav) });
    if (side) out.kl.push({ z0: zh, z1: fz + 0.5, reg: g.out });       // uchwyt wisi na froncie klosza
    else { out.kl.push({ z0: zh, z1: zh + Z.at, reg: g.out }); if (g.fill) out.kl.push({ z0: zp, z1: zh + Z.at, reg: g.fill }); }   // Frontlit: dach i lity blok między uchwytem a stopką
  });
  return out;
}
// próbki do wydruku: zestaw ramek na zatrzask z grzybkiem (różny luz) i zestaw uchwytów na korpus klika (różny luz otworu), każdy z numerem — do sprawdzenia
// z prawdziwymi częściami: czy płytka z grzybkiem wchodzi w ramkę, czy korpus klika wchodzi w uchwyt i się trzyma, jak zatrzask się zatrzaskuje i zwalnia
async function zatProbka() {
  W.pr = params(); const Z = W.pr.zat, garbage = [], ndel = o => { garbage.push(o); return o; };
  try {
    await load3D();
    const wrap = (x, y, w, h) => [rectPoly(x, y, w, h, 0)], CRLF = String.fromCharCode(13, 10);
    // podstawa: ramka na płytkę zatrzasku z grzybkiem — luz ramki −0,1 / z panelu / +0,15 / +0,3
    const luzP = [Math.max(0, Z.hluz - 0.1), Z.hluz, Z.hluz + 0.15, Z.hluz + 0.3], layersB = [], opisB = [];
    luzP.forEach((lz, i) => {
      const Lw = Z.hl + 2 * lz, Ww = Z.hw + 2 * lz, cx = 0, cy = -i * (Ww + 2 * Z.hf + 14), hx = Z.hs / 2;
      layersB.push({ z0: 0, z1: 2, reg: diff(wrap(cx, cy, Lw + 2 * Z.hf + 9, Ww + 2 * Z.hf + 6), [-hx, hx].map(u => circlePoly(cx + u, cy, Z.hd))) },
        { z0: 2, z1: 2 + Z.ht, reg: diff(wrap(cx, cy, Lw + 2 * Z.hf, Ww + 2 * Z.hf), wrap(cx, cy, Lw, Ww)) },
        { z0: 2, z1: 2.4, reg: cyfraPolys(String(i + 1), cx + (Lw + 2 * Z.hf) / 2 + 4, cy, 4, 0.7) });
      opisB.push(`${i + 1}: luz ramki ${fmt(lz, 2)} mm (wnętrze ${fmt(Lw, 2)} × ${fmt(Ww, 2)} mm, ścianka ${fmt(Z.hf, 1)} mm, wysokość ${fmt(Z.ht, 1)} mm, otwory na śruby ${fmt(Z.hd, 1)} mm co ${fmt(Z.hs, 1)} mm)`);
    });
    // klosz: uchwyt na korpus klika — luz otworu z panelu −0,05 / z panelu / +0,1 / +0,2 (korpus wchodzi od spodu, przez płytkę z otworem)
    const luzy = [Math.max(0, Z.luz - 0.05), Z.luz, Z.luz + 0.1, Z.luz + 0.2], layersK = [], opisK = [];
    luzy.forEach((lz, i) => {
      const d = zatWym({ ...Z, luz: lz }), cx = i * (d.out[0] + 8), cy = 0;
      layersK.push({ z0: 0, z1: Z.t, reg: diff(wrap(cx, cy, d.out[0], d.out[1]), wrap(cx, cy, d.hole[0], d.hole[1])) },
        { z0: Z.t, z1: Z.h, reg: diff(wrap(cx, cy, d.out[0], d.out[1]), wrap(cx, cy, d.cav[0], d.cav[1])) },
        { z0: Z.h, z1: Z.h + Z.at, reg: wrap(cx, cy, d.out[0], d.out[1]) },
        { z0: Z.h + Z.at, z1: Z.h + Z.at + 0.4, reg: cyfraPolys(String(i + 1), cx, cy, 5, 0.8) });
      opisK.push(`${i + 1}: luz otworu ${fmt(lz, 2)} mm (otwór na korpus ${fmt(d.hole[0], 2)} × ${fmt(d.hole[1], 2)} mm)`);
    });
    const body = (m, name) => { const mesh = m.getMesh(); return { name, pos: mesh.vertProperties.slice(), tri: mesh.triVerts.slice(), numProp: mesh.numProp }; };
    const B = stos(layersB, ndel), K = stos(layersK, ndel);
    const readme = ['Próbki zatrzasku klik (Offset Wizard, zakładka Montaż)', '',
      'Mechanizm (korpus klika) siedzi w kloszu, a zatrzask z grzybkiem (płytka z dwoma otworami) leży na dnie podstawy.', '',
      'DRUK: obie płytki tak jak w pliku (podstawą do stołu). Ramki z filamentu podstawy, uchwyty z filamentu klosza. Numer jest wyciśnięty obok / na górze.', '',
      'RAMKI NA ZATRZASK Z GRZYBKIEM (Zatrzask_baza_ramki_zestaw.stl) — do podstawy:', ...opisB, '',
      'UCHWYTY NA KORPUS KLIKA (Zatrzask_klosz_uchwyty_zestaw.stl) — do klosza:', ...opisK, '',
      'SPRAWDŹ z prawdziwymi częściami:',
      '1. Który numer ramki: płytka z grzybkiem wchodzi z lekkim oporem i nie lata (otwory na śruby pasują do otworów w płytce)?',
      '2. Który numer uchwytu: korpus klika wchodzi od spodu (zaczepami w dół) z oporem i się trzyma, a kołnierz klika opiera się o płytkę uchwytu?',
      `3. Włóż korpus w uchwyt, płytkę w ramkę i dociśnij uchwyt od góry na grzybek: klik zatrzaskuje, drugie dociśnięcie zwalnia. Ile trzeba docisnąć? (w kreatorze: szczelina pod kloszem = ${fmt(Z.gap, 1)} mm, grzybek ${fmt(Z.hp, 1)} mm nad płytką, koniec grzybka ${fmt(Z.jz, 1)} mm pod kołnierzem).`,
      'Napisz numery, które działają — wpiszę je jako domyślne.', ''].join(CRLF);
    const files = [body(B, 'Zatrzask_baza_ramki_zestaw'), body(K, 'Zatrzask_klosz_uchwyty_zestaw')].map(b => ({ name: b.name + '.stl', data: stlOf(b) })).concat([{ name: 'OPIS.txt', data: new TextEncoder().encode(readme) }]);
    saveBlob(fileBase() + '_proba_zatrzasku.zip', await zipFiles(files, 'application/zip'));
    toast('Zapisano próbki: 4 ramki na zatrzask z grzybkiem i 4 uchwyty na korpus klika, każdy z numerem (STL + OPIS w ZIP)');
  } catch (e) { console.error(e); toast('Nie udało się zbudować próbki: ' + (e && e.message || e), 6000); }
  garbage.forEach(o => { try { o.delete(); } catch (e) { /* już zwolnione */ } });
}
// ===================== mocowanie na magnesy (zakładka Montaż): klosz trzymany na magnesach neodymowych wklejanych po wydruku =====================
// Kołnierz podstawy jest niski (domyślnie 2 mm; Sidelit: pasowanie). Magnes w podstawie leży w kołnierzu: wierzch równo z kołnierzem, gniazdo schodzi niżej,
// a wokół gniazda kołnierz jest pogrubiony do środka litery. Drugi magnes siedzi w uszku klosza tuż nad nim, twarzą w twarz; uszko sięga ścianki klosza.
// Środki magnesów leżą na linii odsuniętej od zewnętrznej krawędzi kołnierza o promień gniazda i odsunięcie (domyślnie 1 mm): od zewnątrz zostaje ścianka.
const magScr = () => !!($('b3-mrodz') && $('b3-mrodz').value === 's');     // mocowanie na śruby od spodu podstawy (zamiast magnesów)
const magWl = () => !!(W.pr && $('b3-mon').checked && (W.pr.typ === 'F' || W.pr.typ === 'S' || pbWl()));
const magBrzeg = () => W.pr.typ === 'S' ? -num($('b3-st2').value) : W.m.p2;     // zewnętrzna krawędź kołnierza
function magWym() {
  const v = id => num($(id).value);
  if (magScr()) {   // śruba od spodu: otwór w podstawie, uszko klosza z gwintem (otwór ślepy); rp = promień otworu w podstawie, s = ścianka uszka wokół
    const dh = Math.max(1, v('b3-msd') || 2.5);
    return { screw: true, d: dh, h: Math.max(2, v('b3-msh') || 5), rp: dh / 2 + 0.1, s: Math.max(0.8, v('b3-msw') || 3), o: Math.max(0, v('b3-mso')), f: Math.max(0, v('b3-msr')), k: Math.max(0, $('b3-msf') ? v('b3-msf') : 2), lz: Math.max(0, v('b3-msz')), n: Number($('b3-msn').value) || 4, dp: Math.max(0.8, v('b3-msp') || dh), fu: Math.max(0, $('b3-msu') ? v('b3-msu') : 1) };
  }
  const d = Math.max(1, v('b3-md') || 6), l = Math.max(0, v('b3-ml'));
  return { d, h: Math.max(0.5, v('b3-mh') || 2), rp: d / 2 + l / 2, s: Math.max(0.4, v('b3-ms') || 0.8), o: Math.max(0, v('b3-mo')), f: Math.max(0, $('b3-mf') ? v('b3-mf') : 2), k: Math.max(0, $('b3-mk') ? v('b3-mk') : 1), lz: Math.max(0, $('b3-mz') ? v('b3-mz') : 0.1), u: Math.max(0, $('b3-mu') ? v('b3-mu') : 0), rz: Math.max(0, $('b3-mrz') ? v('b3-mrz') : 0), n: Number($('b3-mn').value) || 2 };
}
function magLinia() {
  const g = magWym(), b = magBrzeg(), key = W.baseId + '|' + b + '|' + g.rp + '|' + g.o; if (W.magL && W.magL.key === key) return W.magL.polys;
  const polys = offsetPolys(W.base, b - g.rp - g.o); W.magL = { key, polys }; return polys;     // o: ścianka gniazda od zewnętrznej krawędzi rantu
}
// miejsca awaryjne w literze li, gdy linia środków magnesów nie ma w niej miejsca (litera za wąska, offsety za duże): wnętrze litery z coraz mniejszym marginesem
// od krawędzi rantu, a gdy nawet to puste — najgłębsze punkty litery. Dzięki temu magnes da się zawsze postawić, przesunąć, dodać i usunąć.
function magAwaryjne(li) {
  const L = bedLetters()[li]; if (!L) return [];
  const g = magWym(), key = W.baseId + '|' + li + '|' + magBrzeg() + '|' + g.rp + '|' + g.o; if (W.magAw && W.magAw.key === key) return W.magAw.polys;
  let polys = [];
  for (const e of [g.rp + g.o, g.rp, g.rp / 2, 0.3, 0]) { polys = inter(offsetPolys(W.base, magBrzeg() - e), [L.p]); if (polys.length) break; }
  if (!polys.length) { let prev = [L.p]; for (let k = 0.5; k < 200; k += 0.5) { const r = offsetPolys([L.p], -k); if (!r.length) break; prev = r; } polys = prev; }
  W.magAw = { key, polys }; return polys;
}
// punkty co ~1,5 mm wzdłuż obrysów (do wyboru miejsca magnesu)
function magProbki(polys, filtr) {
  const pts = [];
  polys.forEach(p => {
    if (filtr && !filtr(p)) return;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], ax = a.X / S, ay = a.Y / S, bx = b.X / S, by = b.Y / S, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5)); for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); }
  });
  return pts;
}
// najbliższy punkt na obrysach polys; z wnetrze = true punkt już leżący wewnątrz obszaru zostaje bez zmiany
function magNajblizszy(polys, x, y, wnetrze) {
  if (wnetrze) { const pt = { X: Math.round(x * S), Y: Math.round(y * S) }; let w = 0; polys.forEach(p => { if (C.Clipper.PointInPolygon(pt, p) !== 0) w += area(p) > 0 ? 1 : -1; }); if (w > 0) return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; }
  let best = null, bd = Infinity;
  polys.forEach(p => {
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], ax = a.X / S, ay = a.Y / S, dx = b.X / S - ax, dy = b.Y / S - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))), qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; best = [Math.round(qx * 100) / 100, Math.round(qy * 100) / 100]; } }
  });
  return best;
}
// najbliższy punkt linii środków magnesów w obrębie litery li; gdy w tej literze linii nie ma — najbliższy punkt obszaru awaryjnego (magnes wymuszony)
function magNaLinii(x, y, li) {
  const L = bedLetters()[li], lin = magLinia().filter(p => !L || C.Clipper.PointInPolygon(p[0], L.p) !== 0);
  return lin.length ? magNajblizszy(lin, x, y, false) : magNajblizszy(magAwaryjne(li), x, y, true);
}
// propozycja: po n na literę, jak najdalej od siebie, z dala od paska LED, otworów, linii podziału i plasterków; ręcznie postawione zostają
function autoMagnets() {
  W.magWarn = [];
  if (!magWl() || !W.base) return;
  W.mags = W.mags.filter(m => m.manual);
  const g = magWym(), R = g.rp + g.s, ls = bedLetters(), plus = ps => ps.map(q => area(q) < 0 ? q.slice().reverse() : q);
  const pas = c => { const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l; return toCl([[c.a[0] + nx, c.a[1] + ny], [c.b[0] + nx, c.b[1] + ny], [c.b[0] - nx, c.b[1] - ny], [c.a[0] - nx, c.a[1] - ny]]); };
  const przeszkody = W.holes.map(h => circlePoly(h.x, h.y, h.d)).concat(plus(W.plates.flatMap(q => q.polys)), plus(cutSegs().concat(cutSegs(kSzew().map(cutK))).map(pas)), W.led ? plus(rowekLED(offsetPolys(W.base, magBrzeg()), LED_W)) : []);
  const zakaz = offsetPolys(clip('ctUnion', przeszkody), R + 0.5);
  const wZakazie = (x, y) => { const pt = { X: Math.round(x * S), Y: Math.round(y * S) }; let w = 0; zakaz.forEach(p => { if (C.Clipper.PointInPolygon(pt, p) !== 0) w += area(p) > 0 ? 1 : -1; }); return w > 0; };
  const linia = magLinia();
  ls.forEach((l, li) => {
    const moje = W.mags.filter(m => m.li === li), ile = g.n - moje.length; if (ile <= 0) return;
    const pts = [];
    linia.forEach(p => {
      if (C.Clipper.PointInPolygon(p[0], l.p) === 0) return;
      for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], ax = a.X / S, ay = a.Y / S, bx = b.X / S, by = b.Y / S, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5)); for (let k = 0; k < n; k++) { const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n; if (!wZakazie(x, y)) pts.push([x, y]); } }
    });
    const jest = moje.map(m => [m.x, m.y]), cx = (l.bb.x0 + l.bb.x1) / 2, cy = (l.bb.y0 + l.bb.y1) / 2; let dodane = 0;
    for (let k = 0; k < ile; k++) {
      let best = null, bs = -1;
      pts.forEach(q => { const s = jest.length ? Math.min(...jest.map(o => Math.hypot(o[0] - q[0], o[1] - q[1]))) : Math.hypot(q[0] - cx, q[1] - cy); if (s > bs) { bs = s; best = q; } });
      if (!best || (jest.length && bs < 2 * R + 2)) break;
      W.mags.push({ id: uid++, li, x: Math.round(best[0] * 100) / 100, y: Math.round(best[1] * 100) / 100, manual: false }); jest.push(best); dodane++;
    }
    if (dodane < ile) {
      // wymuszenie: najpierw cała linia środków bez omijania przeszkód, a gdy litera nie ma linii — obszar awaryjny; każdy kolejny magnes jak najdalej od pozostałych
      const lin = linia.filter(pp => C.Clipper.PointInPolygon(pp[0], l.p) !== 0);
      const dod = lin.length ? magProbki(lin) : magProbki(magAwaryjne(li));
      let wym = 0;
      for (let k = dodane; k < ile; k++) {
        let best = null, bs = -1;
        dod.forEach(q => { const s = jest.length ? Math.min(...jest.map(o => Math.hypot(o[0] - q[0], o[1] - q[1]))) : Math.hypot(q[0] - cx, q[1] - cy); if (s > bs) { bs = s; best = q; } });
        if (!best || (jest.length && bs < 0.5)) break;
        W.mags.push({ id: uid++, li, x: Math.round(best[0] * 100) / 100, y: Math.round(best[1] * 100) / 100, manual: false, wymus: true }); jest.push(best); wym++;
      }
      if (wym) W.magWarn.push(`litera ${li + 1}: ${wym === 1 ? 'magnes wymuszony' : wym + ' magnesy wymuszone'} poza zalecanym polem (przeszkody, za mało miejsca albo za wąska litera) — sprawdź i przesuń lub usuń`);
      if (moje.length + dodane + wym < g.n) W.magWarn.push(`litera ${li + 1}: zmieściło się ${moje.length + dodane + wym} z ${g.n}`);
    }
  });
}
// bryły: pogrubienie kołnierza z gniazdem w podstawie (od z0 do wierzchu kołnierza), uszko z gniazdem w kloszu sięgające jego wewnętrznej ścianki (offset sc).
// Uszko wypełnia klin między sobą a najbliższym rogiem wnętrza klosza (styczne od rogu do uszka), a jego styki ze ścianką są zaokrąglone promieniem z pola (domyślnie 2 mm).
// Gniazdo w uszku jest na wylot (bez sufitu nad magnesem), więc klosz drukuje się bez podpór w gnieździe.
function magReg(p, Rbaza, Rkl, o) {
  const out = { pod: [], kl: [], pocket: [], zDno: -1, stozki: { pod: [], kl: [] }, uw: [], sHoles: [], sCut: [], sWrap: [], lugZ: [], lugi: [] }; if (!magWl() || !W.mags.length) return out;
  const g = magWym(), top = o.top, zD = top - g.h, Ru = Math.max(g.rp + g.s, o.sc - (magBrzeg() - g.rp - g.o) + 0.6); out.zDno = zD;
  // faza wylotu gniazda (k mm pod kątem 45°): stożki odejmowane od gotowych brył w build3D, więc ściana fazy jest gładka
  const fz = Math.min(g.k, g.h / 2), stozek = (m, zGora) => ({ x: m.x, y: m.y, z0: zGora - fz, h: fz + 0.02, r0: g.rp, r1: g.rp + fz + 0.02 });
  if (g.screw && W.pr.typ !== 'F') { out.uw.push('mocowanie na śruby od spodu działa we Frontlit — w tym rodzaju litery pominięte (użyj magnesów)'); return out; }
  if (p.dn != null && p.st + p.pl - p.mh > p.dn + 0.05) out.uw.push(`dno gniazda magnesu jest ${fmt(p.st + p.pl - p.mh, 1)} mm od spodu zamiast ${fmt(p.dn, 1)} mm: stopień podstawy (${fmt(p.st, 1)} mm) jest za wysoki na tak cienki magnes`);
  if (p.stMag === 'rant') out.uw.push('rant (stopień) podstawy przy magnesach ograniczony do 2 mm');
  if (!g.screw && zD < 0.6) out.uw.push(`gniazdo magnesu (${fmt(g.h, 1)} mm) za głębokie: pod magnesem zostaje ${fmt(Math.max(0, zD), 1)} mm, a powinno co najmniej 0,6 mm — podnieś kołnierz albo stopień`);
  const kaw = offsetPolys(W.base, o.sc);     // wnętrze klosza przy kołnierzu
  if (!g.screw && o.lim != null && top + g.lz + g.h + (g.u || 0) > o.lim) out.uw.push(`uszko klosza z magnesem sięga ${fmt(top + g.lz + g.h + (g.u || 0), 1)} mm, a frontu od ${fmt(o.lim, 1)} mm — za płaska litera albo za gruby magnes`);
  W.mags.forEach(m => {
    const pk = [circlePoly(m.x, m.y, 2 * g.rp)], obr = [circlePoly(m.x, m.y, 2 * (g.rp + g.s))], usz = [circlePoly(m.x, m.y, 2 * Ru)];
    if (!g.screw) {
      out.pocket.push(...pk);
      out.pod.push({ z0: o.z0, z1: top, reg: diff(inter(obr, Rbaza), pk) });
      if (zD - o.z0 > 0.05) out.pod.push({ z0: o.z0, z1: zD, reg: inter(pk, Rbaza) });     // dno gniazda: pod magnesem pełny materiał (też wewnątrz kieszeni LED)
      if (fz > 0) out.stozki.pod.push(stozek(m, top));
    }
    // najbliższy róg wnętrza klosza (wypukły narożnik pustki) w zasięgu 2,5 promienia uszka: klin od rogu do uszka
    let rog = null, rd = 2.5 * Ru;
    kaw.forEach(ring => { const n = ring.length; for (let i = 0; i < n; i++) { const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n], ux = b.X - a.X, uy = b.Y - a.Y, vx = c.X - b.X, vy = c.Y - b.Y, t = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy), d = Math.hypot(b.X / S - m.x, b.Y / S - m.y); if (t > 0.35 && d < rd) { rd = d; rog = [b.X / S, b.Y / S]; } } });
    const klin = rog ? inter([toCl(hullOf(fromCl(usz[0]).concat([rog])))], kaw) : [], zasieg = (rog ? rd : Ru) + 3 * g.f;
    const nb = [circlePoly(m.x, m.y, 2 * (zasieg + 2 * g.f))], sciana = inter(diff(Rkl, kaw), nb);
    const led = W.led ? rowekLED(nb, LED_W + 2) : [], klinOk = diff(klin, led);     // klin do rogu nie wchodzi nad pasek LED (nie zasłania światła)
    const A = clip('ctUnion', usz.concat(klinOk, sciana)), zaokr = g.f > 0 ? offRound(offRound(A, g.f), -g.f) : A;     // zaokrąglenia styków zawsze (są za małe, by zasłonić światło)
    const uszko = inter(inter(zaokr, [circlePoly(m.x, m.y, 2 * zasieg)]), kaw).concat(inter(usz, Rkl));
    if (g.screw) {   // uszko siedzi w wycięciu kołnierza, na stopniu podstawy (kosztem kołnierza); śruba od spodu przez stopień wchodzi w otwór ślepy uszka
      const stopien = o.st != null ? o.st : top, b0 = stopien + g.lz, b1 = b0 + g.h, st = clip('ctUnion', uszko), pil = [circlePoly(m.x, m.y, g.dp)];
      // górny rant uszka fazowany gładko: górna część (fu) to wyciągnięcie obrysu uszka ze skalą góry (zwężenie 45° przy okręgu uszka), otwór dociera z góry w build3D
      const fu = Math.min(g.fu, Math.max(0, g.h - 0.6));
      out.sHoles.push(circlePoly(m.x, m.y, g.d)); out.sCut.push(...offsetPolys(st, 0.2));
      const fb = Math.min(g.k, Math.max(0, stopien - 0.4)); if (fb > 0) out.stozki.pod.push({ x: m.x, y: m.y, z0: -0.02, h: fb + 0.02, r0: g.d / 2 + fb + 0.02, r1: g.d / 2 });   // faza otworu od spodu podstawy (stożek 45°)
      out.kl.push({ z0: b0, z1: b1 - fu, reg: diff(st, pil) });     // otwór w uszku na przelot
      if (fu > 0.05) out.lugi.push({ x: m.x, y: m.y, z: b1 - fu, fu, scale: Math.max(0.3, (Ru - fu) / Ru), polys: st, r: g.dp / 2, zD0: b0 - 0.1, zD1: b1 + 0.1 });
      else out.kl.push({ z0: b1 - 0.001, z1: b1, reg: diff(st, pil) });
      if (b1 > top + 5 && o.lim == null) out.uw.push(`uszko ${fmt(g.h, 1)} mm sięga ${fmt(b1, 1)} mm, wysoko nad kołnierzem ${fmt(top, 1)} mm — sprawdź wysokość klosza`);
      return;
    }
    out.lugZ.push(...offsetPolys(clip('ctUnion', uszko), 0.3));     // obrys uszka klosza (+0,3 mm): tu podwyższony rant podstawy się kończy
    const a0 = top + g.lz, a1 = a0 + g.h + (g.u || 0);     // lz: luz pionowy uszka nad kołnierzem podstawy; u: uszko wyższe od magnesu (więcej materiału przy ściankach, gniazdo dalej na wylot)
    out.kl.push({ z0: a0, z1: a1, reg: diff(clip('ctUnion', uszko), pk) });
    if (fz > 0 && o.lim == null) out.stozki.kl.push(stozek(m, a1));     // w Sidelit górę uszka przykrywa front
  });
  // rant (ścianka wybrania) nie urywa się przy uszku: obiega wycięcie po jego zaokrągleniu (grubość jak rant) i łączy się z paskiem po obu stronach
  if (g.screw && o.rw > 0 && out.sCut.length) { const cu = clip('ctUnion', out.sCut); out.sWrap = inter(diff(offRound(cu, o.rw), cu), Rbaza); }
  return out;
}
// łączenie jak puzzle: obszar A = półpłaszczyzna po stronie normalnej linii podziału + wypustki (łebek na szyjce) w każdym miejscu, gdzie litera jest dość gruba;
// druga część dostaje wcięcie z luzem. Zwraca wielokąty A (Clipper) i A powiększone o luz.
// parametry łączenia z panelu: kształt, luz, jaskółczy ogon (szerokość i wysokość ząbka), puzzle (średnica łebka) — jako ułamek szerokości litery w miejscu cięcia
function puzPrm() {
  const n = id => $(id) ? num($(id).value) : NaN, pc = (id, d) => { const v = n(id); return (v > 0 ? v : d) / 100; };
  return { kind: $('b3-puzk') ? $('b3-puzk').value : 'o', luz: Math.max(0, n('b3-puzl') || 0), fw: pc('b3-puzw', 100 / 3), fh: pc('b3-puzh', 25), fd: pc('b3-puzd', 50) };
}
function puzzleObszar(c, q = puzPrm()) {
  const a = c.c.ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, O = [c.c.x, c.c.y], BIG = 3000, luz = q.luz, knobs = [];
  const W2 = (u, v) => ({ X: Math.round((O[0] + dx * u + nx * v) * S), Y: Math.round((O[1] + dy * u + ny * v) * S) });
  const spans = lineSpans(offsetPolys(W.base, W.m.p2), c.c).filter(sp => sp[1] - sp[0] >= 10);
  const parts = [[W2(-BIG, 0), W2(BIG, 0), W2(BIG, BIG), W2(-BIG, BIG)]], wn_ = offsetPolys(W.base, W.m.p2 - 2.5), n = 40;     // wnętrze litery bez 2,5 mm przy krawędzi: tu łebek musi się zmieścić w całości
  let ile = 0;
  spans.forEach(([u0, u1]) => {
    const uc = (u0 + u1) / 2, s = u1 - u0;
    // największy łebek / ząbek (do zadanego % szerokości), który mieści się w literze (pasek pod kątem do linii bywa węższy niż odcinek linii)
    for (let k = 1; k > 0.04; k -= 0.05) {
      let head, path;
      if (q.kind === 'j') {     // jaskółczy ogon: trapez, szeroki (szerokość ząbka) na końcu, przy linii 0,48 tej szerokości, wysoki na wysokość ząbka
        const Wd = q.fw * s * k, h = q.fh * s * k, nk = 0.48 * Wd; if (Wd < 4 || h < 1.5) break;
        head = [W2(uc - Wd / 2, -h), W2(uc + Wd / 2, -h), W2(uc + nk / 2, 0), W2(uc + nk / 2, 0.5), W2(uc - nk / 2, 0.5), W2(uc - nk / 2, 0)];
        path = [[uc - nk / 2, 0], [uc - Wd / 2, -h], [uc + Wd / 2, -h], [uc + nk / 2, 0]];
      } else {     // okrąg o środku 0,6 r za linią: łebek bez szyjki, szyjka = cięciwa 1,6 r
        const D = q.fd * s * k, r = D / 2, al = Math.asin(0.6); if (D < 5) break;
        head = Array.from({ length: n }, (_, i) => W2(uc + r * Math.cos(i / n * 2 * Math.PI), -0.6 * r + r * Math.sin(i / n * 2 * Math.PI)));
        path = Array.from({ length: 33 }, (_, i) => { const t = Math.PI - al + (Math.PI + 2 * al) * i / 32; return [uc + r * Math.cos(t), -0.6 * r + r * Math.sin(t)]; });
      }
      const knob = clip('ctUnion', [head]);
      if (diff(knob, wn_).length) continue;
      parts.push(head); knobs.push({ uc, path }); ile++; break;
    }
  });
  const A = clip('ctUnion', parts);
  return { A, G: luz > 0 ? offRound(A, luz) : A, n: ile, knobs };
}
// mostki w kloszu na łączeniach (zamiast plasterków klosza): żebro w poprzek wnętrza klosza na linii cięcia klosza, łączy wolne końce ścianek.
// Od dołu odsunięte (miejsce na LED), od góry niżej niż pleksa (nie zaciemnia jej), górna krawędź łukiem jak żebro łodzi.
// Grubość 2 × (3 × dysza): linia klosza dzieli żebro na pół, każda część ma swoje 3 dysze i klosze skleja się na mostku;
// góra każdej połówki fazowana 45° od strony wnętrza jej części (przekrój jak daszek), więc światło rozchodzi się dalej.
function mostkiBryla(zK0, zKmax, ndel, uw) {
  const { Manifold } = V3.wasm, t = mostekT(), zB = zK0 + Math.max(0, num($('b3-kmd').value) || 0), zT = zKmax - Math.max(0, num($('b3-kmg').value) || 0), H = zT - zB;
  if (H < 3) { uw.push(`mostki w kloszu pominięte: między odstępem od dołu a odstępem od pleksy zostaje ${fmt(Math.max(0, H), 1)} mm (potrzeba co najmniej 3 mm)`); return null; }
  // przy ściance cięcie klosza jest skośne (kloszObszar): granica części przesuwa się tam o s w poprzek linii, więc końce mostka są poszerzone (klin przy ściance),
  // żeby każda połówka zawsze zrastała się ze ścianką swojej części
  const sk = kSkos() * Math.PI / 180, dc = Math.max(0, (W.m.k1 + W.m.k2) / 2 - plateRegs().dK), ph = sk > 0 ? Math.min(3.5, dc * Math.tan(Math.min(sk, 1.4)) + t) + 0.3 : t, pl = 3.5;
  const ribs = W.mostki.map(mk => {
    const { u0, u1, ln } = mk, ua = u0 - 3, ub = u1 + 3, um = (u0 + u1) / 2, hw = (u1 - u0) / 2;
    // łuk: na końcach (przy ściankach) pełna wysokość, w środku niżej — najwyżej do 40 % wysokości (min. 3 mm), nie głębiej niż 0,35 długości
    const sag = Math.max(0, Math.min(H - Math.max(3, 0.4 * H), 0.35 * (u1 - u0))), R = sag > 0.01 ? (hw * hw + sag * sag) / (2 * sag) : 0, cz = zT - sag + R;
    const top = u => sag > 0.01 && Math.abs(u - um) < hw ? cz - Math.sqrt(Math.max(0, R * R - (u - um) ** 2)) : zT, N = 48, ring = [[ua, zB - 20], [ub, zB - 20], [ub, zT]];
    for (let i = N; i >= 0; i--) { const u = u0 + (u1 - u0) * i / N; ring.push([u, top(u)]); }
    ring.push([ua, zT]);
    // lokalnie: x = wzdłuż linii, y = wysokość, z = w poprzek; daszek fazy = część wspólna dwóch pochylonych (45°) kopii profilu
    const pr = ndel(ndel(Manifold.extrude([ring], 2 * (t + 2))).translate([0, 0, -(t + 2)]));
    const a1 = ndel(pr.warp(v => { v[1] -= v[2]; })), a2 = ndel(pr.warp(v => { v[1] += v[2]; }));
    const box = (x0, x1, h) => ndel(ndel(Manifold.cube([x1 - x0, zT - zB + 5, 2 * h], false)).translate([x0, zB, -h]));
    const slab = ph > t + 0.01 ? ndel(Manifold.union([box(ua, ub, t), box(ua, Math.min(um, u0 + pl), ph), box(Math.max(um, u1 - pl), ub, ph)])) : box(ua, ub, t);
    const rib = ndel(Manifold.intersection(ndel(Manifold.intersection(a1, a2)), slab)), a = ln.ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    return ndel(rib.warp(v => { const u = v[0], z = v[1], w = -v[2]; v[0] = ln.x + u * dx + w * nx; v[1] = ln.y + u * dy + w * ny; v[2] = z; }));
  });
  // tylko we wnętrzu klosza (+0,6 mm w ściankę, żeby się z nią zrosły)
  const wn = stos([{ z0: zB - 1, z1: zT + 1, reg: offsetPolys(W.base, plateRegs().dK + 0.6) }], ndel);
  return wn ? ndel(Manifold.intersection(ndel(Manifold.union(ribs)), wn)) : null;
}
// klosz: ścianki przecinane pod skosem (patrząc od góry). Linia cięcia zostaje prosta, ale w otoczeniu każdego przecięcia ze ścianką (promień 3,5 mm)
// granica obszaru A jest obrócona tak, że płaszczyzna cięcia tworzy z normalną do ścianki kąt skos; światło nie ucieka prosto przez szczelinę.
function kloszObszar(c, skos) {
  const a = c.c.ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), O = [c.c.x, c.c.y], BIG = 3000, R = 3.5, sg = skos * Math.PI / 180;
  const frame = (px, py, an) => (u, v) => ({ X: Math.round((px + Math.cos(an) * u - Math.sin(an) * v) * S), Y: Math.round((py + Math.sin(an) * u + Math.cos(an) * v) * S) });
  const F0 = frame(O[0], O[1], a), A0 = [[F0(-BIG, 0), F0(BIG, 0), F0(BIG, BIG), F0(-BIG, BIG)]];
  const wall = offsetPolys(W.base, (W.m.k1 + W.m.k2) / 2), cross = (ax, ay, bx, by) => ax * by - ay * bx, pts = [];
  wall.forEach(ring => { for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], px = p.X / S, py = p.Y / S, ex = q.X / S - px, ey = q.Y / S - py, den = cross(ex, ey, dx, dy); if (Math.abs(den) < 1e-9) continue;
    const s = cross(O[0] - px, O[1] - py, dx, dy) / den; if (s < 0 || s >= 1) continue;
    const X = px + s * ex, Y = py + s * ey; if (pts.some(t => Math.hypot(t.x - X, t.y - Y) < 0.4)) continue;
    const l = Math.hypot(ex, ey); let nx = -ey / l, ny = ex / l; if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }
    const th = Math.atan2(cross(nx, ny, dx, dy), nx * dx + ny * dy); if (Math.abs(th) >= sg - 0.035) continue;      // już dość skośnie
    const t2 = (th >= 0 ? 1 : -1) * sg, d2 = [Math.cos(t2) * nx - Math.sin(t2) * ny, Math.sin(t2) * nx + Math.cos(t2) * ny];
    pts.push({ x: X, y: Y, an: Math.atan2(d2[1], d2[0]) });
  } });
  if (!pts.length) return { A: A0, G: A0, n: 0 };
  const circ = pts.map(t => circlePoly(t.x, t.y, 2 * R)), wedges = pts.map((t, i) => { const F = frame(t.x, t.y, t.an); return inter([[F(-BIG, 0), F(BIG, 0), F(BIG, BIG), F(-BIG, BIG)]], [circ[i]]); }).flat();
  const A = clip('ctUnion', diff(A0, clip('ctUnion', circ)).concat(wedges));
  return { A, G: A, n: pts.length };
}
// każda część: lista warstw {z0, z1, reg}
function warstwyFrontlit(p, m) {
  const R = d => offsetPolys(W.base, d), Rk2 = R(m.k2), Rk1 = R(m.k1), void3 = closeR(R(m.k3), p.r), Rp1 = R(m.p1), Rp2 = openR(R(m.p2), p.r), holes = otworyReg(p), top = p.st + p.pl;
  if (!(p.wk > 0) || !(p.ws > 0) || p.ws > p.wk) throw new Error('sprawdź wysokości klosza: ścianka i stopka muszą być dodatnie');
  const mag = magReg(p, Rp2, Rk2, { top: p.st + p.pl, z0: p.wgl && p.gw > 0 ? Math.max(0.2, p.st + p.pl - p.gw) : p.st, sc: m.k3, st: p.st, rw: p.wgl && p.gw > 0 ? Math.abs(m.p2 - m.kie) : 0 }), zat = zatReg(p), gz = zat.gap, klosz = [{ z0: p.st + gz, z1: p.st + gz + p.ws, reg: diff(Rk2, void3) }, { z0: p.st + gz + p.ws, z1: p.st + gz + p.wk, reg: diff(Rk2, Rk1) }].filter(l => l.z1 - l.z0 > 1e-6).concat(zat.kl, mag.kl);
  const kiesz = p.wgl && p.gw > 0 ? kieszenFaza(m.kie, p.f) : [], rowki = rowkiReg(p, Rp1, holes), zKiesz = kiesz.length ? Math.max(0.2, top - p.gw) : Infinity, cyf = cyfryReg(p, Math.min(zKiesz, top));
  const zs = [...new Set([0, p.st, top, ...(rowki.length ? [p.rd] : []), ...(cyf.gl ? [cyf.gl] : []), ...(zKiesz < top ? [zKiesz] : []), ...(mag.zDno > 0 ? [mag.zDno] : [])].filter(z => z >= 0 && z <= top))].sort((a, b) => a - b), podstawa = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2; let reg = mid < p.st ? Rp1 : Rp2;
    if (mid > zKiesz) reg = diff(reg, kiesz);
    if (mid < p.rd && rowki.length) reg = diff(reg, rowki);
    if (mid < cyf.gl) reg = diff(reg, cyf.back);
    if (zat.screw.length && mid < zat.zF) reg = diff(reg, zat.screw);
    if (mag.pocket.length && mid > mag.zDno) reg = diff(reg, mag.pocket);
    if (mag.sCut.length && mid > p.st) reg = diff(reg, mag.sCut);       // kołnierz wycięty pod uszka klosza (śruby od spodu)
    if (mag.sWrap.length && mid > p.st) reg = clip('ctUnion', reg.concat(mag.sWrap));     // rant obiega wycięcie
    if (mag.sHoles.length && mid < p.st) reg = diff(reg, mag.sHoles);   // otwory na śruby w stopniu podstawy
    podstawa.push({ z0, z1, reg: diff(reg, holes) });
  }
  if (cyf.front.length) podstawa.push({ z0: cyf.zDna, z1: cyf.zDna + CYF_UP, reg: cyf.front });
  podstawa.push(...zat.pod, ...mag.pod); W.zatUw = zat.uw; W.magUw = mag.uw;
  // podwyższony rant podstawy (magnesy, Frontlit): pasek ranta wyżej o rz, ale nie tam, gdzie siedzi uszko klosza z magnesem
  const gm = magWl() && W.mags.length ? magWym() : null;
  if (gm && !gm.screw && gm.rz > 0 && mag.lugZ.length) {
    const zMax = p.st + gz + p.wk - p.gp - 0.5, rz = Math.min(gm.rz, zMax - top);     // pod pleksą zostaje 0,5 mm
    if (rz > 0.05) { const rim = kiesz.length ? diff(Rp2, kiesz) : diff(Rp2, offsetPolys(W.base, m.p2 - 1.2)); podstawa.push({ z0: top, z1: top + rz, reg: diff(diff(rim, holes), mag.lugZ) }); }
    if (rz < gm.rz - 0.05) mag.uw.push(`podwyższenie ranta ograniczone do ${fmt(Math.max(0, rz), 1)} mm (pod pleksą musi zostać 0,5 mm)`);
  }
  return { magKl: mag.kl, stozki: mag.stozki, lugi: mag.lugi, klosz, podstawa, pleksa: [{ z0: p.st + gz + p.wk - p.gp, z1: p.st + gz + p.wk, reg: R(0) }], opis: `ścianka klosza ${fmt(p.wk, 1)}, stopka ${fmt(p.ws, 1)}, podstawa ${fmt(top, 1)} (stopień ${fmt(p.st, 1)} + płyta ${fmt(p.pl, 1)}), pleksa ${fmt(p.gp, 1)}` + (kiesz.length ? `, kieszeń ${fmt(p.gw, 1)} → dno ${fmt(top - p.gw, 1)}` : '') };
}
function warstwySidelit(p) {
  const R = d => offsetPolys(W.base, d), R0 = R(0), holes = otworyReg(p), zK = p.sh - p.kCalk;
  if (!(p.pCalk > p.sd) || !(p.kCalk > p.sf) || p.sw < 0) throw new Error('sprawdź wymiary Sidelit: całkowite muszą być większe od frontu i dna');
  const mag = magReg(p, R(-p.t2), R0, { top: p.pCalk + p.sw, z0: p.sd, sc: -p.t1, lim: zK + p.ss }), zat = zatReg(p), gz = zat.gap, klosz = [{ z0: zK + gz, z1: zK + gz + p.ss, reg: diff(R0, openR(R(-p.t1), 0)) }, { z0: zK + gz + p.ss, z1: p.sh + gz, reg: R0 }].concat(zat.kl, mag.kl);
  const ringRant = diff(R0, R(-p.t3)), ringSc = diff(openR(R(-p.t2), p.r), R(-p.t3)), rowki = rowkiReg(p, R0, holes), cyf = cyfryReg(p, p.sd);
  const zs = [...new Set([0, p.sd, p.pCalk, p.pCalk + p.sw, ...(rowki.length ? [p.rd] : []), ...(cyf.gl ? [cyf.gl] : []), ...(mag.zDno > 0 ? [mag.zDno] : [])])].sort((a, b) => a - b), podstawa = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], mid = (z0 + z1) / 2; let reg = mid < p.sd ? R0 : mid < p.pCalk ? ringRant : ringSc;
    if (mid < p.rd && rowki.length) reg = diff(reg, rowki);
    if (mid < cyf.gl) reg = diff(reg, cyf.back);
    if (zat.screw.length && mid < zat.zF) reg = diff(reg, zat.screw);
    if (mag.pocket.length && mid > mag.zDno) reg = diff(reg, mag.pocket);
    podstawa.push({ z0, z1, reg: diff(reg, holes) });
  }
  if (cyf.front.length) podstawa.push({ z0: cyf.zDna, z1: cyf.zDna + CYF_UP, reg: cyf.front });
  podstawa.push(...zat.pod, ...mag.pod); W.zatUw = zat.uw; W.magUw = mag.uw;
  return { stozki: mag.stozki, klosz, podstawa, pleksa: [], opis: `grubość litery ${fmt(p.sh, 1)} = klosz ${fmt(p.kCalk, 1)} (front ${fmt(p.sf, 1)} + boki ${fmt(p.ss, 1)}) + podstawa ${fmt(p.pCalk, 1)} (dno ${fmt(p.sd, 1)}); pasowanie ${fmt(p.sw, 1)}` };
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
function pelnaGladka(p, ndel) { return gladkaBryla(0, 0, p.fh, p.fr, p.fg, p.fd, ndel); }
// bryła z konturu litery odsuniętego o d0, od zA do zA + H, z gładko zaokrągloną górną (i / lub dolną) krawędzią;
// przy d0 ≠ 0 wszystkie kontury z zaokrąglonymi narożnikami, żeby kolejne leżały jeden w drugim (inaczej pas między nimi się psuje)
function gladkaBryla(d0, zA, H, rr, g, dn, ndel) {
  const r = Math.min(rr, g && dn ? H / 2 : H); if (!(r > 0.01) || !(g || dn)) return null;
  const { Manifold, Mesh, triangulate } = V3.wasm, R0 = d0 ? offRound(W.base, d0) : offsetPolys(W.base, 0), zLo = zA + (dn ? r : 0), zHi = zA + H - (g ? r : 0), N = Math.max(16, Math.min(48, Math.ceil(r * Math.PI / 2 / 0.2)));
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
      const reg = offRound(W.base, d0 - d); if (!reg.length) break;
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
// ===================== litera pełna z podstawą: świeci cały klosz (front i boki) =====================
// Podstawa jak we Frontlit (stopień, płyta, kieszeń na LED, otwory). Klosz to skorupa z filamentu do podświetleń: na zewnątrz kontur litery
// z gładko zaokrągloną górną krawędzią, w środku pusto (boki ks, front kf), wnętrze zaokrąglone promieniem pomniejszonym o grubość boku.
const pbWl = () => !!(W.pr && W.pr.typ === 'P' && $('b3-fpod').checked);
// przybliżenie warstwami (do liczenia filamentu i gdyby gładka skorupa się nie złożyła)
function kloszPLayers(p) {
  const R = d => d ? offRound(W.base, d) : offsetPolys(W.base, 0), r = Math.min(p.fg ? p.fr : 0, p.fh - p.st), ri = Math.max(0, r - p.ks), zHi = p.fh - r, zc = p.fh - p.kf, N = 8, zs = new Set([p.st, p.fh, zHi, zc, zc - ri]);
  for (let k = 1; k < N; k++) { zs.add(zHi + r * Math.sin(k / N * Math.PI / 2)); zs.add(zc - ri + ri * Math.sin(k / N * Math.PI / 2)); }
  const zz = [...zs].filter(z => z >= p.st && z <= p.fh).sort((a, b) => a - b), lay = [];
  const odsun = (z, z0, rr) => z <= z0 ? 0 : rr - Math.sqrt(Math.max(0, rr * rr - (z - z0) * (z - z0)));
  for (let i = 0; i + 1 < zz.length; i++) {
    const z0 = zz[i], z1 = zz[i + 1], mid = (z0 + z1) / 2; if (z1 - z0 < 1e-6) continue;
    const zew = R(-odsun(mid, zHi, r)), wew = mid < zc ? R(-p.ks - odsun(mid, zc - ri, ri)) : [];
    lay.push({ z0, z1, reg: wew.length ? diff(zew, wew) : zew });
  }
  return lay;
}
function planPelneBaza(p) {
  if (!(p.fh - p.st > p.kf + 1)) throw new Error('litera pełna z podstawą: wysokość litery musi być większa od stopnia i frontu klosza');
  const plan = warstwyFrontlit(p, W.m), top = p.st + p.pl, r = p.fg ? Math.min(p.fr, p.fh - p.st) : 0;
  plan.pleksa = []; plan.klosz = kloszPLayers(p).concat(plan.magKl || []);
  plan.opis = `litera pełna ${fmt(p.fh, 1)} z podstawą ${fmt(top, 1)} (stopień ${fmt(p.st, 1)} + płyta ${fmt(p.pl, 1)}); klosz świecący: boki ${fmt(p.ks, 1)}, front ${fmt(p.kf, 1)}` + (r > 0.01 ? `, zaokrąglenie R ${fmt(r, 1)}` : '');
  return plan;
}
// gładka skorupa klosza: bryła zewnętrzna minus wnętrze
function kloszPGladki(p, ndel) {
  const { Manifold } = V3.wasm, H = p.fh - p.st, ri = Math.max(0, (p.fg ? p.fr : 0) - p.ks), zc = p.fh - p.kf;
  const zew = (p.fg && p.fr > 0.01 ? gladkaBryla(0, p.st, H, p.fr, true, false, ndel) : null) || stos([{ z0: p.st, z1: p.fh, reg: offsetPolys(W.base, 0) }], ndel);
  const wew = (ri > 0.01 ? gladkaBryla(-p.ks, p.st - 1, zc - p.st + 1, ri, true, false, ndel) : null) || stos([{ z0: p.st - 1, z1: zc, reg: offRound(W.base, -p.ks) }], ndel);
  if (!zew) return null;
  return wew ? ndel(Manifold.difference(zew, wew)) : zew;
}
function planLitery(p) { return W.pr.typ === 'P' ? (pbWl() ? planPelneBaza(p) : warstwyPelne(p)) : W.pr.typ === 'S' ? warstwySidelit(p) : warstwyFrontlit(p, W.m); }
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
    W.pr = params(); const p = params3D(), m = W.m, plan = planLitery(p), parts = {}, bodies = [], ls = letters(bedSrc()), uwagi = [];
    if (pbWl()) { try { parts.klosz = kloszPGladki(p, ndel); if (parts.klosz && (plan.magKl || []).length) parts.klosz = ndel(V3.wasm.Manifold.union(parts.klosz, stos(plan.magKl, ndel))); } catch (e) { console.warn(e); uwagi.push('klosz złożony z warstw (schodki): dla tego kształtu nie udało się zbudować gładkiej skorupy'); } }
    else if (W.pr.typ === 'P') { try { parts.litera = pelnaGladka(p, ndel); } catch (e) { console.warn(e); uwagi.push('zaokrąglenie złożone z warstw (schodki): dla tego kształtu nie udało się zbudować gładkiej powierzchni'); } }
    Object.keys(CZESCI).forEach(k => { if (!parts[k]) parts[k] = (plan[k] || []).length ? stos(plan[k], ndel) : null; });
    // faza wylotu gniazd magnesów: prawdziwe stożki (gładka ściana pod kątem), odjęte od podstawy i klosza
    if (plan.stozki) { const { Manifold } = V3.wasm, bryla = l => ndel(Manifold.union(l.map(c => ndel(ndel(Manifold.cylinder(c.h, c.r0, c.r1, 64)).translate([c.x, c.y, c.z0])))));
      if (plan.stozki.pod.length && parts.podstawa) parts.podstawa = ndel(Manifold.difference(parts.podstawa, bryla(plan.stozki.pod)));
      if (plan.stozki.kl.length && parts.klosz) parts.klosz = ndel(Manifold.difference(parts.klosz, bryla(plan.stozki.kl))); }
    // gładka faza górnego ranta uszek (śruby od spodu): górna część uszka zwężana liniowo, otwór na przelot wycięty walcem
    if (plan.lugi && plan.lugi.length && parts.klosz) { const { Manifold } = V3.wasm;
      const caps = plan.lugi.map(L => { const polys = toPolys(L.polys).map(r => r.map(([x, y]) => [x - L.x, y - L.y])); return ndel(ndel(Manifold.extrude(polys, L.fu, 0, 0, [L.scale, L.scale])).translate([L.x, L.y, L.z])); });
      const otw = plan.lugi.map(L => ndel(ndel(Manifold.cylinder(L.zD1 - L.zD0, L.r, L.r, 48)).translate([L.x, L.y, L.zD0])));
      parts.klosz = ndel(Manifold.difference(ndel(Manifold.union([parts.klosz, ...caps])), ndel(Manifold.union(otw)))); }
    if (W.overlaps.length) uwagi.push(`litery nachodzą na siebie w ${W.overlaps.length} miejscach — bryły są połączone`);
    if (parts.klosz && parts.podstawa) { const v = objetosc(ndel(V3.wasm.Manifold.intersection(parts.klosz, parts.podstawa))); if (v > 1) uwagi.push(`klosz przenika podstawę (${fmt(v, 1)} mm³) — sprawdź offsety`); }
    const tops = W.pr.typ === 'S' ? { zP: p.sd, hK: p.kCalk - W.pr.plDownK, zK0: p.pCalk + p.sw + zatGap(), zKmax: p.sh - p.sf + zatGap() } : { zP: p.wgl && p.gw > 0 ? Math.max(0.2, p.st + p.pl - p.gw) : -W.pr.plH, hK: p.wk - W.pr.plDownK, zK0: p.st + p.pl + zatGap(), zKmax: p.st + p.ws + zatGap() };
    if (mostkiChce() && W.cuts.length && !mostkiWl()) uwagi.push(`mostki w kloszu się nie mieszczą (między odstępem od dołu a od pleksy zostaje ${fmt(Math.max(0, mostkiH()), 1)} mm, potrzeba 3 mm) — zamiast nich plasterki klosza`);
    if (parts.klosz && mostkiWl() && (W.mostki || []).length) { const mb = mostkiBryla(tops.zK0, tops.zKmax, ndel, uwagi); if (mb) parts.klosz = ndel(V3.wasm.Manifold.union(parts.klosz, mb)); }
    const segs = p.cut ? cutSegs() : [], segsK = p.cut ? cutSegs(W.cuts.map(cutK)) : [];     // klosz po swojej, przesuniętej linii; pleksa w całości: nie jest drukowana, tylko cięta laserem
    Object.keys(CZESCI).forEach(k => {
      if (!parts[k]) return;
      let list = parts[k].decompose().map(ndel);
      // podział: linia tnie tylko bryły swojej litery (Fusion tnie wszystko, co dotyka prostokąta linii)
      if (k !== 'pleksa') (k === 'klosz' ? segsK : segs).forEach(c => {
        const L = ls[c.li]; if (!L) return;
        const pz = k === 'podstawa' && p.puz ? puzzleObszar(c) : k === 'klosz' && kSkos() > 0 ? kloszObszar(c, kSkos()) : null, Zh = 2000, zOd = -50;      // puzzle tylko w podstawie, i tylko gdy jest gdzie położyć łebek
        const pzM = pz && pz.n ? (() => { const { Manifold } = V3.wasm, pr = P => ndel(ndel(Manifold.extrude(toPolys(P), Zh)).translate([0, 0, zOd])); return { A: pr(pz.A), G: pr(pz.G) }; })() : null;
        const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], len = Math.hypot(dx, dy) || 1, n = [-dy / len, dx / len, 0], off = n[0] * c.a[0] + n[1] * c.a[1], next = [];
        list.forEach(b => {
          const bb = b.boundingBox(), cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
          if (cx < L.bb.x0 - 3 || cx > L.bb.x1 + 3 || cy < L.bb.y0 - 3 || cy > L.bb.y1 + 3) { next.push(b); return; }
          const [u, v] = pzM ? [ndel(V3.wasm.Manifold.intersection(b, pzM.A)), ndel(V3.wasm.Manifold.difference(b, pzM.G))] : b.splitByPlane(n, off); if (!pzM) { ndel(u); ndel(v); } [u, v].forEach(h => { if (!h.isEmpty()) h.decompose().map(ndel).forEach(q => next.push(q)); });
        });
        list = next;
      });
      const rows = list.map(b => { const bb = b.boundingBox(), cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2; let li = ls.findIndex(l => cx >= l.bb.x0 && cx <= l.bb.x1 && cy >= l.bb.y0 && cy <= l.bb.y1); if (li < 0) li = 0; return { b, bb, li, cx }; }).sort((a, c) => a.li - c.li || a.cx - c.cx);
      const cnt = {}; rows.forEach(r => { cnt[r.li] = (cnt[r.li] || 0) + 1; }); const nr = {};
      rows.forEach(r => { nr[r.li] = (nr[r.li] || 0) + 1; const mesh = r.b.getMesh(); bodies.push({ part: k, name: `${CZESCI[k]}_${String(r.li + 1).padStart(2, '0')}${cnt[r.li] > 1 ? String.fromCharCode(96 + nr[r.li]) : ''}`, pos: mesh.vertProperties.slice(), tri: mesh.triVerts.slice(), numProp: mesh.numProp, vol: objetosc(r.b), bb: r.bb }); });
    });
    // plasterki łączące: osobne elementy do wydruku (nie są cięte ani łączone z częściami)
    const holes2 = otworyReg(p), cntPl = {};
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
    if (W.pr.typ !== 'P') (W.zatUw || []).concat(W.zatWarn || []).forEach(u => uwagi.push('zatrzaski: ' + u));
    if (magWl()) { (W.magUw || []).concat(W.magWarn || []).forEach(u => uwagi.push((magScr() ? 'śruby: ' : 'magnesy: ') + u)); if (W.mags.length) { const n = W.mags.length; uwagi.push(magScr() ? `śruby od spodu: ${n} szt., otwór ${fmt(magWym().d, 1)} mm w podstawie, przelot ${fmt(magWym().dp, 1)} mm w uszku klosza, kołnierz ${fmt(p.pl, 1)} mm` : `magnesy: ${n} ${n === 1 ? "para" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "pary" : "par"}, kołnierz ${fmt(W.pr.typ === 'S' ? p.sw : p.pl, 1)} mm`); }; }
    if (zatGap()) uwagi.push(`zatrzaski: ${W.latches.length} szt., klosz wyżej o ${fmt(zatGap(), 1)} mm (skok do zwolnienia)`);
    liczFilament(); V3.bodies = bodies; V3.dirty = false; show3D();
    const c = k => bodies.filter(b => b.part === k).length, tris = bodies.reduce((s, b) => s + b.tri.length / 3, 0), wol = bodies.reduce((s, b) => s + b.vol, 0);
    $('b3-report').innerHTML = `<b>Części:</b> ${c('litera') ? `litery ${c('litera')}` : `klosz ${c('klosz')}, podstawa ${c('podstawa')}`}${c('pleksa') ? `, pleksa ${c('pleksa')}` : ''}${c('plaster') ? `, plasterki ${c('plaster')}` : ''}<br>${esc(plan.opis)} [mm]<br>${W.led ? `<b>LED:</b> ${fmt(W.led.m, 2)} m<br>` : ''}${W.fil ? `<b>Filament:</b> ok. ${(Math.round(W.fil.sum / 5) * 5).toLocaleString('pl-PL')} g (szacunek)<br>` : ''}<b>Materiał:</b> ${fmt(wol / 1000, 0)} cm³ · ${Math.round(tris).toLocaleString('pl-PL')} trójkątów · ${fmt((performance.now() - t0) / 1000, 1)} s${uwagi.length ? `<br><span style="color:#c53030;font-weight:700">${uwagi.map(esc).join('<br>')}</span>` : ''}`;
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
function sterowanie3D(el, S = V3, draw = render3D) {
  const T = V3.THREE, cam = S.cam, ctl = S.ctl = { target: new T.Vector3(), update() { cam.lookAt(ctl.target); } }, Z = new T.Vector3(0, 0, 1);
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
    draw();
  });
  const koniec = () => { dr = null; }; el.addEventListener('pointerup', koniec); el.addEventListener('pointercancel', koniec);
  el.addEventListener('wheel', e => {
    e.preventDefault(); const r = el.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width * 2 - 1, ny = 1 - (e.clientY - r.top) / r.height * 2, z0 = cam.zoom, z1 = Math.min(1000, Math.max(0.02, z0 * Math.pow(1.0015, -e.deltaY)));
    const d = 1 / z0 - 1 / z1; przesun(os(nx * cam.right * d, ny * cam.top * d)); cam.zoom = z1; cam.updateProjectionMatrix(); draw();
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
// linie graniczne bryły: ostre krawędzie (> 28°) oraz obrys każdej płaskiej ściany poziomej (wierzch, spód, stopnie) — także na łukach, gdzie
// ścianka boczna jest zbudowana z wielu drobnych trójkątów i zwykły próg kąta nic by tam nie narysował; gładkie boki łuków nie dostają linii
function konturyGeom(g, T) {
  const pos = g.attributes.position.array, idx = g.index.array, key = i => Math.round(pos[3 * i] * 1e3) + ',' + Math.round(pos[3 * i + 1] * 1e3) + ',' + Math.round(pos[3 * i + 2] * 1e3), E = new Map(), out = [], cosA = Math.cos(28 * Math.PI / 180);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]], p = v.map(i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n); if (l < 1e-12) continue; n = n.map(c => c / l);
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], ka = key(a), kb = key(b); if (ka === kb) continue;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka, o = E.get(k); if (o) o.n.push(n); else E.set(k, { a, b, n: [n] });
    }
  }
  const flat = n => Math.abs(n[2]) > 0.99999;
  E.forEach(o => {
    const [n1, n2] = o.n; let on = o.n.length !== 2;
    if (!on) on = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < cosA || flat(n1) !== flat(n2);
    if (on) out.push(pos[3 * o.a], pos[3 * o.a + 1], pos[3 * o.a + 2], pos[3 * o.b], pos[3 * o.b + 1], pos[3 * o.b + 2]);
  });
  const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.BufferAttribute(Float32Array.from(out), 3)); return lg;
}
function show3D() {
  init3D(); const T = V3.THREE;
  V3.meshes.forEach(m => { m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); V3.group.remove(m); }); V3.meshes = []; V3.hl = null;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  V3.bodies.forEach(b => {
    const g = new T.BufferGeometry(), n = b.numProp || 3, pos = n === 3 ? b.pos : Float32Array.from({ length: b.pos.length / n * 3 }, (_, i) => b.pos[Math.floor(i / 3) * n + i % 3]);
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(new T.BufferAttribute(b.tri, 1));
    const mesh = new T.Mesh(g, material3D(b.part, b.plType)), edges = new T.LineSegments(konturyGeom(g, T), new T.LineBasicMaterial({ color: 0x2d3748, transparent: true, opacity: 0.6 }));
    mesh.add(edges); mesh.userData = { part: b.part, plType: b.plType, plate: b.plate }; mesh.renderOrder = b.part === 'podstawa' ? 0 : b.part === 'klosz' ? 1 : 2; V3.group.add(mesh); V3.meshes.push(mesh);
    for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.bb.min[i]); mx[i] = Math.max(mx[i], b.bb.max[i]); }
  });
  const first = !V3.box;
  V3.box = { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], r: Math.max(1, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2) };
  apply3D(); if (first || !V3.keepView) setView(V3.view); V3.keepView = true; profil3D();
}
function apply3D() {
  const e = Number($('v3-e').value) || 0, vis = { klosz: $('v3-k').checked, podstawa: $('v3-p').checked, pleksa: $('v3-x').checked, plaster: $('v3-l').checked, litera: true }, lift = { litera: 0, podstawa: 0, klosz: e, pleksa: 2 * e };
  const ob = $('v3-o').checked; if (V3.prof) { V3.prof.visible = $('v3-pr').checked; V3.prof.position.z = -e; }
  V3.meshes.forEach(m => { const u = m.userData; m.children.forEach(c => { if (c.isLineSegments) c.visible = ob; }); m.visible = vis[u.part]; m.position.z = u.part === 'plaster' ? (u.plType === 'K' ? e : 0) : lift[u.part]; });
  render3D();
}
// profil montażowy „U” za literami (tylko podgląd, nie idzie do STL / 3MF): szerokość = grubość profilu z zakładki Otwory,
// ścianka z pola w Bryła 3D; dno profilu na dole, otwarty do góry, wzdłuż wysokości liter
function profil3D() {
  if (!V3.group) return; const T = V3.THREE;
  if (V3.prof) { V3.prof.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); V3.group.remove(V3.prof); }
  const g = V3.prof = new T.Group(), s = Math.max(0.3, num($('b3-prs').value) || 1.5);
  const mat = new T.MeshStandardMaterial({ color: 0x8a929c, transparent: true, opacity: 0.35, depthWrite: false, side: T.DoubleSide, roughness: 0.6 }), lm = new T.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.55 });
  const kloc = (x0, x1, y0, y1, z0, z1) => { const geo = new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m = new T.Mesh(geo, mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.renderOrder = 3; m.add(new T.LineSegments(new T.EdgesGeometry(geo), lm)); g.add(m); };
  W.rails.forEach(r => {
    const y0 = r.yc - r.h / 2, y1 = r.yc + r.h / 2, D = Math.max(2 * s + 0.5, num($('b3-prd').value) || r.h);
    kloc(r.x0, r.x1, y0, y1, -s, 0);            // ścianka przy literach
    kloc(r.x0, r.x1, y0, y1, -D, -D + s);       // ścianka tylna
    kloc(r.x0, r.x1, y0, y0 + s, -D + s, -s);   // dno (otwarte do góry)
  });
  V3.group.add(g); apply3D();
}
// ===================== filament (szacunek) =====================
// Z warstw brył: na każdej warstwie ściany = pas „liczba ścian × szerokość linii” od brzegu, skóra góra / dół tam, gdzie nad / pod warstwą nic nie ma
// (do grubości z liczby warstw), reszta wnętrza w podanym % wypełnienia. Plasterki są cieńsze niż ściany, więc liczone jako pełne. Bez slicera, więc to szacunek.
function filamentMasy(p, plan) {
  const v = id => num($(id).value), lw = v('b3-fil-lw') || 0.62, lh = v('b3-fil-lh') || 0.3, ro = v('b3-fil-ro') || 1.24, A = reg => reg.reduce((s, q) => s + area(q), 0), out = {};
  ['podstawa', 'klosz', 'litera'].forEach(k => {
    const L = (plan[k] || []).filter(l => l.z1 - l.z0 > 1e-6 && l.reg.length); if (!L.length) return;
    const c = k === 'klosz' ? 'k' : 'p', N = Math.max(0, v(`b3-fil-${c}w`)), T = Math.max(0, v(`b3-fil-${c}t`)) * lh, B = Math.max(0, v(`b3-fil-${c}b`)) * lh, inf = Math.min(100, Math.max(0, v(`b3-fil-${c}i`))) / 100;
    let vol = 0;
    L.forEach(l => {
      const dz = l.z1 - l.z0, nad = L.filter(q => Math.abs(q.z0 - l.z1) < 1e-6).flatMap(q => q.reg), pod = L.filter(q => Math.abs(q.z1 - l.z0) < 1e-6).flatMap(q => q.reg);
      const wn = N > 0 ? offsetPolys(l.reg, -N * lw) : l.reg, aWn = Math.max(0, A(wn)), aW = Math.max(0, A(l.reg) - aWn);
      const sk = Math.min(aWn * dz, (T > 0 ? Math.max(0, A(diff(wn, nad))) * Math.min(dz, T) : 0) + (B > 0 ? Math.max(0, A(diff(wn, pod))) * Math.min(dz, B) : 0));
      vol += aW * dz + sk + (aWn * dz - sk) * inf;
    });
    out[k] = vol * ro / 1000;
  });
  const hK = W.pr.typ === 'S' ? p.kCalk - W.pr.plDownK : p.wk - W.pr.plDownK;
  out.plaster = W.plates.reduce((s, q) => s + (q.type === 'K' ? Math.max(0, A(q.polys)) * Math.max(0, hK) : Math.max(0, A(q.polys)) * W.pr.plH - Math.max(0, A(q.groove)) * (W.pr.plH - W.pr.plFloor)), 0) * ro / 1000;
  return out;
}
function liczFilament() {
  const box = $('fil-info'); if (!box) return;
  if (!W.base || !W.pr) { W.fil = null; box.textContent = '—'; return; }
  try {
    const p = params3D(), plan = planLitery(p), m = filamentMasy(p, plan);
    const g = x => Math.round((x || 0) / 5) * 5, sum = (m.podstawa || 0) + (m.klosz || 0) + (m.litera || 0) + (m.plaster || 0);
    W.fil = { ...m, sum };
    box.innerHTML = `<b>Filament: ok. ${g(sum).toLocaleString('pl-PL')} g</b><br><span class="hint">${m.litera ? `litery ${g(m.litera)} g` : `podstawa ${g(m.podstawa)} g · klosz ${g(m.klosz)} g`}${m.plaster ? ` · plasterki ${g(m.plaster)} g` : ''} (szacunek wg ustawień druku)</span>`;
  } catch (e) { W.fil = null; box.textContent = 'Filament: — (' + (e && e.message || e) + ')'; }
}
function recolor3D() { V3.meshes.forEach(m => { m.material.dispose(); m.material = material3D(m.userData.part, m.userData.plType); }); render3D(); }
function groups3D() { const t = (document.querySelector('input[name=typ]:checked') || {}).value; $('g3-f').classList.toggle('hidden', t === 'S'); $('g3-s').classList.toggle('hidden', t !== 'S'); document.body.classList.toggle('t-P', t === 'P'); }
window.mark3D = () => { V3.dirty = true; groups3D(); clearTimeout(V3.tmr); if (V3.open) V3.tmr = setTimeout(build3D, 700); clearTimeout(V3.ftmr); V3.ftmr = setTimeout(liczFilament, 800); };
async function open3D() {
  if (!W.base) return toast('Najpierw wczytaj kontury');
  closePlatePop(); V3.open = true; $('v3d').classList.remove('hidden'); $('b-3d').classList.add('on'); $('b-2d').classList.remove('on'); $('selbox').classList.add('hidden');
  if (W.panel !== 'bryla') showPanel('bryla', true);
  try { msg3D('Wczytuję silnik 3D…'); await load3D(); init3D(); size3D(); if (V3.dirty) await build3D(); else { msg3D(''); profil3D(); } }
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
// eksportują się tylko części zaznaczone w podglądzie 3D (klosz, podstawa, pleksa, plasterki)
const widoczne3D = () => V3.bodies.filter((b, i) => !V3.meshes[i] || V3.meshes[i].visible);
async function exportSTL() {
  const bodies = widoczne3D(); if (!bodies.length) return toast('Zaznacz w podglądzie 3D, co ma się wyeksportować');
  const files = bodies.map(b => ({ name: b.name + '.stl', data: stlOf(b) }));
  saveBlob(fileBase() + '_STL.zip', await zipFiles(files, 'application/zip'));
  toast(`Zapisano ${files.length} plików STL w ZIP`);
}
async function mf3Blob(bodies) {
  const enc = new TextEncoder(), files = [
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: enc.encode(model3mf(bodies)) }];
  return zipFiles(files, 'model/3mf');
}
async function export3MF() {
  const bodies = widoczne3D(); if (!bodies.length) return toast('Zaznacz w podglądzie 3D, co ma się wyeksportować');
  saveBlob(fileBase() + '.3mf', await mf3Blob(bodies));
  toast(`Zapisano 3MF: ${bodies.length} części`);
}
// ===================== start =====================
[['b3-ck', 0], ['b3-cp', 0], ['b3-cx', 5]].forEach(([id, d]) => { const s = $(id), had = s.dataset.v; s.innerHTML = PALETA3.map(([n, c]) => `<option value="${c}">${n}</option>`).join(''); s.value = String(PALETA3[d][1]); });
try { const o = JSON.parse(localStorage.getItem(KEY) || 'null'); if (o && o.pr && o.pr.p3) ['b3-ck', 'b3-cp', 'b3-cx'].forEach(id => { if (o.pr.p3[id]) $(id).value = o.pr.p3[id]; }); } catch (e) { /* zostają domyślne */ }
groups3D();
$('b-3d').onclick = open3D; $('b-2d').onclick = close3D; $('v3-b').onclick = () => build3D();
$('b3-stl').onclick = exportSTL; $('b3-3mf').onclick = export3MF;
document.querySelectorAll('#v3-bar [data-v]').forEach(b => { b.onclick = () => setView(b.dataset.v); });
['v3-k', 'v3-p', 'v3-x', 'v3-l', 'v3-o', 'v3-pr'].forEach(id => { $(id).onchange = apply3D; }); $('v3-e').oninput = apply3D;
['b3-ck', 'b3-cp', 'b3-cx', 'b3-tk', 'b3-tp', 'b3-tx'].forEach(id => { $(id).addEventListener('change', () => { clearTimeout(V3.tmr); if (!V3.dirty) { /* sam kolor nie wymaga przebudowy */ } setTimeout(recolor3D, 0); }); });
