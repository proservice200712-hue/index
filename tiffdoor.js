// INDEX: plik drzwi wycięty w przeglądarce z pliku TIFF ściany (bez Photoshopa).
// Czyta TIFF (nieskompresowany, LZW, ZIP, PackBits; paskowy albo kafelkowy; 8 / 16 bitów; RGB, CMYK, szary), wycina drzwi razem ze spadami,
// brakujący spad uzupełnia odbiciem lustrzanym sąsiedniego pasa i zapisuje nowy TIFF (LZW) z tymi samymi kolorami, rozdzielczością i profilem ICC.
// Czyta tylko potrzebne paski / kafelki, więc duże pliki nie zapychają pamięci.
(function (root) {
  'use strict';
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  async function rd(file, off, len) { return new DataView(await file.slice(off, off + len).arrayBuffer()); }

  async function readIFD(file, off, le) {
    const n = (await rd(file, off, 2)).getUint16(0, le), dv = await rd(file, off + 2, n * 12 + 4), tags = {};
    for (let i = 0; i < n; i++) {
      const o = i * 12, tag = dv.getUint16(o, le), type = dv.getUint16(o + 2, le), count = dv.getUint32(o + 4, le), sz = (TYPE_SIZE[type] || 1) * count;
      let raw;
      if (sz <= 4) raw = new Uint8Array(dv.buffer.slice(dv.byteOffset + o + 8, dv.byteOffset + o + 8 + sz));
      else { const vo = dv.getUint32(o + 8, le); raw = new Uint8Array(await file.slice(vo, vo + sz).arrayBuffer()); }
      tags[tag] = { tag, type, count, raw };
    }
    return { tags, next: dv.getUint32(n * 12, le) };
  }
  function vals(t, le) {
    if (!t) return [];
    const dv = new DataView(t.raw.buffer, t.raw.byteOffset, t.raw.byteLength), out = [];
    for (let i = 0; i < t.count; i++) {
      if (t.type === 3) out.push(dv.getUint16(i * 2, le)); else if (t.type === 4) out.push(dv.getUint32(i * 4, le)); else if (t.type === 1 || t.type === 7) out.push(t.raw[i]);
      else if (t.type === 5) out.push(dv.getUint32(i * 8, le) / (dv.getUint32(i * 8 + 4, le) || 1)); else if (t.type === 8) out.push(dv.getInt16(i * 2, le)); else out.push(dv.getInt32(i * 4, le));
    }
    return out;
  }

  // ---------- dekompresja ----------
  function lzwDecode(src, expected) {
    const out = new Uint8Array(expected), pre = new Int32Array(4096), suf = new Uint8Array(4096), len = new Uint16Array(4096), fst = new Uint8Array(4096);
    let op = 0, ip = 0, acc = 0, bits = 0, next = 258, cl = 9, prev = -1;
    const lenOf = c => c < 256 ? 1 : len[c], firstOf = c => c < 256 ? c : fst[c];
    const emit = c => { const l = lenOf(c); let p = op + l - 1, k = c; while (k >= 258) { if (p < expected) out[p] = suf[k]; p--; k = pre[k]; } if (p >= 0 && p < expected) out[p] = k; op += l; };
    const add = (pr, f) => { pre[next] = pr; suf[next] = f; len[next] = lenOf(pr) + 1; fst[next] = firstOf(pr); next++; };
    while (op < expected) {
      while (bits < cl) { if (ip >= src.length) { acc = -1; break; } acc = ((acc << 8) | src[ip++]) >>> 0; bits += 8; }
      if (acc === -1) break;
      const code = (acc >>> (bits - cl)) & ((1 << cl) - 1); bits -= cl; acc &= bits ? (1 << bits) - 1 : 0;
      if (code === 257) break;
      if (code === 256) { next = 258; cl = 9; prev = -1; continue; }
      if (prev === -1) { emit(code); prev = code; continue; }
      if (code < next) { emit(code); add(prev, firstOf(code)); } else { add(prev, firstOf(prev)); emit(code); }
      prev = code;
      if (next === 511) cl = 10; else if (next === 1023) cl = 11; else if (next === 2047) cl = 12;
    }
    return out;
  }
  function lzwEncode(src) {
    let out = new Uint8Array(Math.max(1024, (src.length >> 1) + 1024)), op = 0, acc = 0, bits = 0, cl = 9, next = 258, dict = new Map();
    const put = code => {
      acc = ((acc << cl) | code) >>> 0; bits += cl;
      while (bits >= 8) { if (op >= out.length) { const o2 = new Uint8Array(out.length * 2); o2.set(out); out = o2; } out[op++] = (acc >>> (bits - 8)) & 255; bits -= 8; }
      acc &= bits ? (1 << bits) - 1 : 0;
    };
    put(256);
    if (src.length) {
      let w = src[0];
      for (let i = 1; i < src.length; i++) {
        const c = src[i], key = (w << 8) | c, hit = dict.get(key);
        if (hit !== undefined) { w = hit; continue; }
        put(w); dict.set(key, next); next++; w = c;
        if (next === 4094) { put(256); dict = new Map(); next = 258; cl = 9; }
        else if (next > 511 && cl === 9) cl = 10; else if (next > 1023 && cl === 10) cl = 11; else if (next > 2047 && cl === 11) cl = 12;
      }
      put(w);
    }
    put(257);
    if (bits) { if (op >= out.length) { const o2 = new Uint8Array(out.length + 1); o2.set(out); out = o2; } out[op++] = (acc << (8 - bits)) & 255; }
    return out.subarray(0, op);
  }
  function packBits(src, expected) {
    const out = new Uint8Array(expected); let ip = 0, op = 0;
    while (ip < src.length && op < expected) {
      const n = src[ip++] << 24 >> 24;
      if (n >= 0) { for (let i = 0; i <= n && op < expected; i++) out[op++] = src[ip++]; } else if (n !== -128) { const b = src[ip++]; for (let i = 0; i < 1 - n && op < expected; i++) out[op++] = b; }
    }
    return out;
  }
  async function inflate(src) {
    const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(src); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  // ---------- odczyt ----------
  async function open(file) {
    const h = await rd(file, 0, 8), b0 = h.getUint8(0), le = b0 === 0x49;
    if (!(b0 === 0x49 || b0 === 0x4d) || h.getUint8(1) !== b0) throw new Error('to nie jest plik TIFF');
    const magic = h.getUint16(2, le);
    if (magic === 43) throw new Error('BigTIFF (powyżej 4 GB) nie jest obsługiwany — użyj skryptu Photoshopa');
    if (magic !== 42) throw new Error('to nie jest plik TIFF');
    let off = h.getUint32(4, le), best = null, guard = 0;
    while (off && guard++ < 30) {      // wybieramy największy obraz (reszta to miniatury)
      const ifd = await readIFD(file, off, le), t = ifd.tags, w = vals(t[256], le)[0] || 0, hh = vals(t[257], le)[0] || 0;
      if (w && hh && (!best || w * hh > best.w * best.h)) best = { tags: t, w, h: hh };
      off = ifd.next;
    }
    if (!best) throw new Error('pusty plik TIFF');
    const t = best.tags, g = (k, d) => { const v = vals(t[k], le); return v.length ? v[0] : d; };
    const spp = g(277, 1), bps = vals(t[258], le).length ? vals(t[258], le) : [1];
    const im = { file, le, tags: t, w: best.w, h: best.h, spp, bps: bps[0], comp: g(259, 1), photo: g(262, 1), pred: g(317, 1), planar: g(284, 1), fmt: g(339, 1) };
    if (im.planar !== 1) throw new Error('TIFF z oddzielnymi płaszczyznami kolorów nie jest obsługiwany — zapisz bez „Przeplatania kanałów” inaczej albo użyj skryptu Photoshopa');
    if (im.bps !== 8 && im.bps !== 16) throw new Error('obsługiwane są pliki 8 i 16 bitów na kanał (ten ma ' + im.bps + ')');
    if (im.fmt === 3) throw new Error('pliki zmiennoprzecinkowe nie są obsługiwane');
    if (![1, 5, 8, 32946, 32773].includes(im.comp)) throw new Error('kompresja TIFF nr ' + im.comp + ' nie jest obsługiwana (są: brak, LZW, ZIP, PackBits) — zapisz plik z LZW albo bez kompresji');
    if (im.pred !== 1 && im.pred !== 2) throw new Error('nieobsługiwany predyktor TIFF ' + im.pred);
    im.bpp = spp * im.bps / 8; im.rowBytes = im.w * im.bpp;
    if (t[324]) { im.tiled = true; im.tw = g(322, 0); im.th = g(323, 0); im.offs = vals(t[324], le); im.cnts = vals(t[325], le); }
    else { im.rps = Math.min(g(278, im.h), im.h); im.offs = vals(t[273], le); im.cnts = vals(t[279], le); }
    const xr = vals(t[282], le)[0], un = g(296, 2); im.dpi = xr ? (un === 3 ? xr * 2.54 : xr) : 0;     // rozdzielczość w pikselach na cal
    return im;
  }
  async function block(im, idx, rawLen, rowBytes) {
    const buf = new Uint8Array(await im.file.slice(im.offs[idx], im.offs[idx] + im.cnts[idx]).arrayBuffer());
    let raw;
    if (im.comp === 1) { raw = new Uint8Array(rawLen); raw.set(buf.subarray(0, rawLen)); }
    else if (im.comp === 5) raw = lzwDecode(buf, rawLen);
    else if (im.comp === 32773) raw = packBits(buf, rawLen);
    else { const r = await inflate(buf); raw = new Uint8Array(rawLen); raw.set(r.subarray(0, rawLen)); }
    if (im.pred === 2) {
      const rows = rawLen / rowBytes, spp = im.spp;
      for (let y = 0; y < rows; y++) {
        const o = y * rowBytes;
        if (im.bps === 8) for (let i = spp; i < rowBytes; i++) raw[o + i] = (raw[o + i] + raw[o + i - spp]) & 255;
        else { const dv = new DataView(raw.buffer, raw.byteOffset + o, rowBytes); for (let i = spp; i < rowBytes / 2; i++) dv.setUint16(i * 2, (dv.getUint16(i * 2, im.le) + dv.getUint16((i - spp) * 2, im.le)) & 65535, im.le); }
      }
    }
    return raw;
  }
  // prostokąt pikseli [x0, x0+w) × [y0, y0+h) jako ciągła tablica bajtów (piksele przeplatane, kolejność bajtów jak w pliku)
  async function region(im, x0, y0, w, h) {
    const bpp = im.bpp, out = new Uint8Array(w * h * bpp);
    if (!im.tiled) {
      const rps = im.rps, s0 = Math.floor(y0 / rps), s1 = Math.floor((y0 + h - 1) / rps);
      for (let s = s0; s <= s1; s++) {
        const rows = Math.min(rps, im.h - s * rps), raw = await block(im, s, rows * im.rowBytes, im.rowBytes);
        for (let y = Math.max(y0, s * rps); y < Math.min(y0 + h, s * rps + rows); y++) out.set(raw.subarray((y - s * rps) * im.rowBytes + x0 * bpp, (y - s * rps) * im.rowBytes + (x0 + w) * bpp), (y - y0) * w * bpp);
      }
    } else {
      const tw = im.tw, th = im.th, across = Math.ceil(im.w / tw), tr = tw * bpp;
      for (let ty = Math.floor(y0 / th); ty <= Math.floor((y0 + h - 1) / th); ty++) for (let tx = Math.floor(x0 / tw); tx <= Math.floor((x0 + w - 1) / tw); tx++) {
        const raw = await block(im, ty * across + tx, th * tr, tr), ax = Math.max(x0, tx * tw), bx = Math.min(x0 + w, (tx + 1) * tw);
        for (let y = Math.max(y0, ty * th); y < Math.min(y0 + h, (ty + 1) * th); y++) out.set(raw.subarray((y - ty * th) * tr + (ax - tx * tw) * bpp, (y - ty * th) * tr + (bx - tx * tw) * bpp), (y - y0) * w * bpp + (ax - x0) * bpp);
      }
    }
    return out;
  }

  // ---------- zapis ----------
  async function writeTiff(src, w, h, pix) {
    const le = src.le, bpp = src.bpp, rowBytes = w * bpp, rps = Math.max(1, Math.min(h, Math.floor(1048576 / rowBytes))), ns = Math.ceil(h / rps), strips = [];
    for (let s = 0; s < ns; s++) strips.push(lzwEncode(pix.subarray(s * rps * rowBytes, Math.min(h, (s + 1) * rps) * rowBytes)));
    const E = [], u16 = v => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, le); return a; }, u32 = v => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v, le); return a; };
    const cat = list => { const a = new Uint8Array(list.reduce((n, x) => n + x.length, 0)); let o = 0; list.forEach(x => { a.set(x, o); o += x.length; }); return a; };
    const ent = (tag, type, count, bytes) => E.push({ tag, type, count, bytes });
    ent(256, 4, 1, u32(w)); ent(257, 4, 1, u32(h)); ent(258, 3, src.spp, cat(Array.from({ length: src.spp }, () => u16(src.bps)))); ent(259, 3, 1, u16(5)); ent(262, 3, 1, u16(src.photo));
    ent(273, 4, ns, null); ent(274, 3, 1, u16(1)); ent(277, 3, 1, u16(src.spp)); ent(278, 4, 1, u32(rps)); ent(279, 4, ns, cat(strips.map(s => u32(s.length)))); ent(284, 3, 1, u16(1));
    [282, 283, 296, 332, 333, 334, 336, 338, 339, 34675].forEach(k => { const t = src.tags[k]; if (t) ent(k, t.type, t.count, t.raw); });
    E.sort((a, b) => a.tag - b.tag);
    const ifdLen = 2 + E.length * 12 + 4; let dataOff = 8 + ifdLen, dataLen = 0;
    E.forEach(e => { const sz = e.tag === 273 ? ns * 4 : e.bytes.length; if (sz > 4) dataLen += sz + (sz & 1); });
    let sOff = dataOff + dataLen; const offs = strips.map(s => { const o = sOff; sOff += s.length + (s.length & 1); return o; });
    E.find(e => e.tag === 273).bytes = cat(offs.map(u32));
    const head = new Uint8Array(dataOff + dataLen), dv = new DataView(head.buffer); head[0] = head[1] = le ? 0x49 : 0x4d; dv.setUint16(2, 42, le); dv.setUint32(4, 8, le); dv.setUint16(8, E.length, le);
    let dp = dataOff;
    E.forEach((e, i) => {
      const o = 10 + i * 12; dv.setUint16(o, e.tag, le); dv.setUint16(o + 2, e.type, le); dv.setUint32(o + 4, e.count, le);
      if (e.bytes.length <= 4) head.set(e.bytes, o + 8); else { dv.setUint32(o + 8, dp, le); head.set(e.bytes, dp); dp += e.bytes.length + (e.bytes.length & 1); }
    });
    dv.setUint32(10 + E.length * 12, 0, le);
    const parts = [head]; strips.forEach(s => { parts.push(s); if (s.length & 1) parts.push(new Uint8Array(1)); });
    return new Blob(parts, { type: 'image/tiff' });
  }

  // miniatura JPEG (RGB, dłuższy bok max `maxPx`) z pikseli drzwi; CMYK → RGB prostym przeliczeniem (bez profilu)
  async function preview(src, w, h, pix, maxPx) {
    const k = Math.min(1, maxPx / Math.max(w, h)), tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k)), c = document.createElement('canvas'); c.width = tw; c.height = th;
    const g = c.getContext('2d'), im = g.createImageData(tw, th), B = src.bps / 8, hi = src.bps === 16 ? (src.le ? 1 : 0) : 0, rb = w * src.bpp, cv = colorConv(src), nC = cv.nC;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / k)), sy = Math.min(h - 1, Math.floor(y / k)), o = sy * rb + sx * src.bpp, p = (y * tw + x) * 4, v = i => i < nC ? pix[o + i * B + hi] / 255 : 0;
      const rgb = cv.f(v(0), v(1), v(2), v(3)); im.data[p] = (rgb >> 16) & 255; im.data[p + 1] = (rgb >> 8) & 255; im.data[p + 2] = rgb & 255; im.data[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
  }

  // P: { W, H (mm), spadSciany: {l,r,t,b} }, d: { x, w, h, l, r, t, b } (mm; x od lewej krawędzi ściany netto; dół drzwi = dół ściany)
  // zwraca { blob, wPx, hPx, pxMm, opis, zSpadem, uzup, pix, src }
  async function door(im, P, d, opt) {
    const B = P.spadSciany, Pw = P.W + B.l + B.r, Ph = P.H + B.t + B.b, a = im.w / im.h, dpi = im.dpi;
    const fW = dpi ? im.w / dpi * 25.4 : 0, fH = dpi ? im.h / dpi * 25.4 : 0, war = [[true, 1], [false, 1], [true, 10], [false, 10]];
    let best = null, jak, zS;
    if (dpi) war.forEach(([zs, sk]) => { const ew = zs ? Pw : P.W, eh = zs ? Ph : P.H, e = Math.max(Math.abs(fW * sk - ew) / ew, Math.abs(fH * sk - eh) / eh); if (!best || e < best.e) best = { e, zS: zs, skala: sk }; });
    const eS = Math.abs(a - Pw / Ph) / (Pw / Ph), eN = Math.abs(a - P.W / P.H) / (P.W / P.H);
    if (best && best.e < 0.01 && (B.l + B.r + B.t + B.b > 0 || best.zS)) { zS = best.zS; jak = 'rozpoznano po wymiarze pliku (skala 1:' + best.skala + ')'; }
    else { zS = eS <= eN; jak = 'rozpoznano po proporcjach pliku'; }
    if (Math.min(eS, eN) > 0.03) throw new Error('proporcje pliku (' + im.w + ' × ' + im.h + ' px) nie pasują ani do ściany ' + P.W + ' × ' + P.H + ' mm, ani do wymiaru ze spadem ' + Pw + ' × ' + Ph + ' mm — to chyba plik innej ściany');
    const ox = zS ? B.l : 0, oy = zS ? B.t : 0, sx = im.w / (zS ? Pw : P.W), sy = im.h / (zS ? Ph : P.H);
    const X0 = Math.round((ox + d.x - d.l) * sx), X1 = Math.round((ox + d.x + d.w + d.r) * sx), Y0 = Math.round((oy + P.H - d.h - d.t) * sy), Y1 = Math.round((oy + P.H + d.b) * sy);
    const w = X1 - X0, h = Y1 - Y0;
    if (w < 1 || h < 1 || w * h * im.bpp > 1.2e9) throw new Error('wymiar pliku drzwi jest nieprawidłowy lub zbyt duży (' + w + ' × ' + h + ' px)');
    const rx0 = Math.max(0, X0), rx1 = Math.min(im.w, X1), ry0 = Math.max(0, Y0), ry1 = Math.min(im.h, Y1);
    if (rx1 <= rx0 || ry1 <= ry0) throw new Error('drzwi wychodzą poza plik ściany');
    const reg = await region(im, rx0, ry0, rx1 - rx0, ry1 - ry0), rw = rx1 - rx0, bpp = im.bpp, out = new Uint8Array(w * h * bpp);
    // spad poza plikiem ściany: odbicie lustrzane pasa obok (współrzędna odbijana względem krawędzi pliku)
    const refl = (c, lo, hi) => { let n = 0; while ((c < lo || c > hi) && n++ < 8) c = c < lo ? 2 * lo - c - 1 : 2 * hi - c + 1; return Math.max(lo, Math.min(hi, c)); };
    const xm = new Int32Array(w); for (let x = 0; x < w; x++) xm[x] = (refl(X0 + x, rx0, rx1 - 1) - rx0) * bpp;
    for (let y = 0; y < h; y++) {
      const srow = (refl(Y0 + y, ry0, ry1 - 1) - ry0) * rw * bpp, orow = y * w * bpp;
      if (X0 >= rx0 && X1 <= rx1) out.set(reg.subarray(srow + (X0 - rx0) * bpp, srow + (X0 - rx0 + w) * bpp), orow);
      else for (let x = 0; x < w; x++) for (let i = 0; i < bpp; i++) out[orow + x * bpp + i] = reg[srow + xm[x] + i];
    }
    const uzup = []; if (Y1 > im.h) uzup.push('dół ' + Math.round((Y1 - im.h) / sy) + ' mm'); if (Y0 < 0) uzup.push('góra ' + Math.round(-Y0 / sy) + ' mm'); if (X0 < 0) uzup.push('lewo ' + Math.round(-X0 / sx) + ' mm'); if (X1 > im.w) uzup.push('prawo ' + Math.round((X1 - im.w) / sx) + ' mm');
    const blob = await writeTiff(im, w, h, out);
    return { blob, wPx: w, hPx: h, pxMm: sx, zSpadem: zS, jak, uzup, pix: out, src: im };
  }

  // ---------- kolory: profil ICC osadzony w pliku → sRGB ----------
  // Obsługa: CMYK / RGB / szary z tablicami LUT (mft1, mft2, mAB), RGB z macierzą i krzywymi (rXYZ…, rTRC…), szary z kTRC. Bez profilu: CMYK przybliżony, RGB bez zmian.
  const D50 = [0.9642, 1, 0.8249];
  const sGamma = (() => { const t = new Float32Array(4097); for (let i = 0; i <= 4096; i++) { const v = i / 4096; t[i] = (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); } return t; })();
  const toS = v => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; const p = v * 4096, i = p | 0, a = sGamma[i], b = sGamma[Math.min(4096, i + 1)]; return Math.round((a + (b - a) * (p - i)) * 255); };
  function xyzToRgb(X, Y, Z) {
    const r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z, b = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
    return (toS(r) << 16) | (toS(g) << 8) | toS(b);
  }
  function labToXyz(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f = t => t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29);
    return [D50[0] * f(fx), D50[1] * f(fy), D50[2] * f(fz)];
  }
  const sig4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  function curve1(dv, b, o, end) {      // krzywa 'curv' / 'para' → { f(x), size (bajty z dopełnieniem) }
    const t = sig4(b, o);
    if (t === 'curv') {
      const n = dv.getUint32(o + 8), size = 12 + n * 2;
      if (n === 0) return { f: x => x, size: (size + 3) & ~3 };
      if (n === 1) { const g = dv.getUint16(o + 12) / 256; return { f: x => Math.pow(Math.max(0, x), g), size: (size + 3) & ~3 }; }
      const tb = new Float32Array(n); for (let i = 0; i < n; i++) tb[i] = dv.getUint16(o + 12 + i * 2) / 65535;
      return { f: x => { x = Math.max(0, Math.min(1, x)) * (n - 1); const i = Math.min(n - 2, Math.floor(x)); return tb[i] + (tb[i + 1] - tb[i]) * (x - i); }, size: (size + 3) & ~3 };
    }
    if (t === 'para') {
      const ty = dv.getUint16(o + 8), np = [1, 3, 4, 5, 7][ty], p = []; for (let i = 0; i < np; i++) p.push(dv.getInt32(o + 12 + i * 4) / 65536);
      const [g, a, bb, c, d, e, ff] = p, size = 12 + np * 4;
      const fn = ty === 0 ? x => Math.pow(Math.max(0, x), g) : ty === 1 ? x => x >= -bb / a ? Math.pow(Math.max(0, a * x + bb), g) : 0 : ty === 2 ? x => x >= -bb / a ? Math.pow(Math.max(0, a * x + bb), g) + c : c : ty === 3 ? x => x >= d ? Math.pow(Math.max(0, a * x + bb), g) : c * x : x => x >= d ? Math.pow(Math.max(0, a * x + bb), g) + e : c * x + ff;
      return { f: fn, size: (size + 3) & ~3 };
    }
    throw new Error('krzywa ICC ' + t);
  }
  function tableFn(arr, n) { return x => { x = Math.max(0, Math.min(1, x)) * (n - 1); const i = Math.min(n - 2, Math.max(0, Math.floor(x))); return n < 2 ? arr[0] : arr[i] + (arr[i + 1] - arr[i]) * (x - i); }; }
  function clutFn(grid, nIn, nOut, data) {     // wielolinioweinterpolacja n-wymiarowa
    const strides = new Array(nIn); let s = nOut; for (let i = nIn - 1; i >= 0; i--) { strides[i] = s; s *= grid[i]; }
    return (inp, out) => {
      const idx = new Array(nIn), fr = new Array(nIn);
      for (let i = 0; i < nIn; i++) { let x = Math.max(0, Math.min(1, inp[i])) * (grid[i] - 1), k = Math.min(grid[i] - 2, Math.floor(x)); if (grid[i] < 2) k = 0; idx[i] = k; fr[i] = grid[i] < 2 ? 0 : x - k; }
      for (let c = 0; c < nOut; c++) out[c] = 0;
      for (let m = 0; m < (1 << nIn); m++) {
        let w = 1, off = 0; for (let i = 0; i < nIn; i++) { const hi = (m >> i) & 1; w *= hi ? fr[i] : 1 - fr[i]; off += (idx[i] + hi) * strides[i]; }
        if (w === 0) continue; for (let c = 0; c < nOut; c++) out[c] += w * data[off + c];
      }
    };
  }
  function lutPipeline(b, dv, o) {      // zwraca { nIn, run(inp[], out[3]) → wartości 0..1 w kodowaniu PCS tablicy, enc }
    const t = sig4(b, o);
    if (t === 'mft1' || t === 'mft2') {
      const nIn = b[o + 8], nOut = b[o + 9], g = b[o + 10], is16 = t === 'mft2', nE = is16 ? dv.getUint16(o + 48) : 256, nO = is16 ? dv.getUint16(o + 50) : 256;
      let p = o + (is16 ? 52 : 48); const rd = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = is16 ? dv.getUint16(p + i * 2) / 65535 : b[p + i] / 255; p += n * (is16 ? 2 : 1); return a; };
      const ins = []; for (let i = 0; i < nIn; i++) ins.push(tableFn(rd(nE), nE));
      const cl = rd(Math.pow(g, nIn) * nOut), outs = []; for (let i = 0; i < nOut; i++) outs.push(tableFn(rd(nO), nO));
      const cf = clutFn(new Array(nIn).fill(g), nIn, nOut, cl), tmp = new Array(nIn), mid = new Array(nOut);
      return { nIn, enc: is16 ? 'legacy16' : 'v8', run(inp, out) { for (let i = 0; i < nIn; i++) tmp[i] = ins[i](inp[i]); cf(tmp, mid); for (let i = 0; i < 3; i++) out[i] = outs[i](mid[i]); } };
    }
    if (t === 'mAB ') {
      const nIn = b[o + 8], nOut = b[o + 9], oB = dv.getUint32(o + 12), oMat = dv.getUint32(o + 16), oM = dv.getUint32(o + 20), oC = dv.getUint32(o + 24), oA = dv.getUint32(o + 28);
      const curves = (off, n) => { const a = []; let q = o + off; for (let i = 0; i < n; i++) { const c = curve1(dv, b, q); a.push(c.f); q += c.size; } return a; };
      const A = oA ? curves(oA, nIn) : null, B = oB ? curves(oB, nOut) : null, M = oM ? curves(oM, nOut) : null;
      let cf = null; if (oC) {
        const q = o + oC, grid = []; for (let i = 0; i < nIn; i++) grid.push(b[q + i]); const prec = b[q + 16], n = grid.reduce((a, x) => a * x, 1) * nOut, d = new Float32Array(n);
        for (let i = 0; i < n; i++) d[i] = prec === 2 ? dv.getUint16(q + 20 + i * 2) / 65535 : b[q + 20 + i] / 255; cf = clutFn(grid, nIn, nOut, d);
      }
      let mat = null; if (oMat) { mat = []; for (let i = 0; i < 12; i++) mat.push(dv.getInt32(o + oMat + i * 4) / 65536); }
      const tmp = new Array(nIn), mid = new Array(nOut);
      return { nIn, enc: 'v4', run(inp, out) {
        for (let i = 0; i < nIn; i++) tmp[i] = A ? A[i](inp[i]) : inp[i];
        if (cf) cf(tmp, mid); else for (let i = 0; i < nOut; i++) mid[i] = tmp[i];
        if (M) for (let i = 0; i < nOut; i++) mid[i] = M[i](mid[i]);
        if (mat) { const x = [0, 0, 0]; for (let r = 0; r < 3; r++) x[r] = mat[r * 3] * mid[0] + mat[r * 3 + 1] * mid[1] + mat[r * 3 + 2] * mid[2] + mat[9 + r]; for (let i = 0; i < 3; i++) mid[i] = x[i]; }
        for (let i = 0; i < 3; i++) out[i] = B ? B[i](mid[i]) : mid[i];
      } };
    }
    throw new Error('tablica ICC ' + t);
  }
  // przelicznik: (v0, v1, v2, v3 w zakresie 0..1) → 0xRRGGBB; null, gdy brak użytecznego profilu
  function iccConverter(icc, nColor) {
    const b = icc, dv = new DataView(b.buffer, b.byteOffset, b.byteLength), space = sig4(b, 16), pcs = sig4(b, 20), n = dv.getUint32(128), tg = {};
    for (let i = 0; i < n; i++) tg[sig4(b, 132 + i * 12)] = dv.getUint32(136 + i * 12);
    const want = nColor === 4 ? 'CMYK' : nColor === 3 ? 'RGB ' : 'GRAY'; if (space !== want) return null;
    if (nColor === 3 && tg.rXYZ !== undefined && tg.rTRC !== undefined && tg.A2B0 === undefined) {
      const xyz = k => [dv.getInt32(tg[k] + 8) / 65536, dv.getInt32(tg[k] + 12) / 65536, dv.getInt32(tg[k] + 16) / 65536], r = xyz('rXYZ'), g = xyz('gXYZ'), bl = xyz('bXYZ');
      const tr = [curve1(dv, b, tg.rTRC).f, curve1(dv, b, tg.gTRC).f, curve1(dv, b, tg.bTRC).f];
      return (v0, v1, v2) => { const R = tr[0](v0), G = tr[1](v1), B = tr[2](v2); return xyzToRgb(r[0] * R + g[0] * G + bl[0] * B, r[1] * R + g[1] * G + bl[1] * B, r[2] * R + g[2] * G + bl[2] * B); };
    }
    if (nColor === 1 && tg.kTRC !== undefined) { const f = curve1(dv, b, tg.kTRC).f; return v0 => { const y = f(v0), c = toS(y); return (c << 16) | (c << 8) | c; }; }
    const lo = tg.A2B1 !== undefined ? tg.A2B1 : tg.A2B0; if (lo === undefined) return null;
    const lut = lutPipeline(b, dv, lo); if (lut.nIn !== nColor) return null;
    const lab = pcs === 'Lab ', tmp = [0, 0, 0], out = [0, 0, 0], inp = [0, 0, 0, 0];
    const toXyz = o3 => {
      if (lab) {
        const e = lut.enc; let L, a, bb;
        if (e === 'legacy16') { L = o3[0] * 65535 / 65280 * 100; a = o3[1] * 65535 / 256 - 128; bb = o3[2] * 65535 / 256 - 128; } else { L = o3[0] * 100; a = o3[1] * 255 - 128; bb = o3[2] * 255 - 128; }
        return labToXyz(L, a, bb);
      }
      const k = 65535 / 32768; return [o3[0] * k, o3[1] * k, o3[2] * k];
    };
    // kompensacja punktu czerni (jak w Photoshopie): najciemniejszy kolor profilu → czerń sRGB
    let bp = [0, 0, 0];
    if (nColor === 4) { [[0, 0, 0, 1], [1, 1, 1, 1], [0.6, 0.5, 0.5, 1]].forEach(c => { lut.run(c, tmp); const x = toXyz(tmp); if (x[1] < (bp[1] || 9) || !bp[1]) bp = x; }); if (bp[1] > 0.25) bp = [0, 0, 0]; }
    const sc = [D50[0] / (D50[0] - bp[0]), D50[1] / (D50[1] - bp[1]), D50[2] / (D50[2] - bp[2])];
    return (v0, v1, v2, v3) => { inp[0] = v0; inp[1] = v1; inp[2] = v2; inp[3] = v3; lut.run(inp, out); const x = toXyz(out); return xyzToRgb((x[0] - bp[0]) * sc[0], (x[1] - bp[1]) * sc[1], (x[2] - bp[2]) * sc[2]); };
  }
  function colorConv(im) {
    const nC = im.photo === 5 ? 4 : im.photo === 2 ? 3 : 1, icc = im.tags[34675] && im.tags[34675].raw;
    let f = null; if (icc) { try { f = iccConverter(icc, nC); } catch (e) { console.warn('profil ICC:', e); } }
    if (f) return { nC, f, icc: true };
    if (nC === 4) return { nC, icc: false, f: (c, m, y, k) => { const kk = 1 - k; return ((Math.round(255 * (1 - c) * kk) << 16) | (Math.round(255 * (1 - m) * kk) << 8) | Math.round(255 * (1 - y) * kk)); } };
    if (nC === 3) return { nC, icc: false, f: (r, g, b) => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255) };
    return { nC, icc: false, f: v => { const c = Math.round((im.photo === 0 ? 1 - v : v) * 255); return (c << 16) | (c << 8) | c; } };
  }

  // ---------- miniatura całego pliku: skala 1:div (domyślnie 1:10, jak miniaturki.bat), uśrednianie bloków, kolory z profilu ICC, napis PREVIEW ----------
  async function thumb(file, opt) {
    opt = opt || {}; const im = await open(file), spp = im.spp, nC = im.photo === 5 ? 4 : im.photo === 2 ? 3 : 1, B = im.bps / 8, hi = im.bps === 16 ? (im.le ? 1 : 0) : 0;
    let f = Math.max(opt.div || 10, Math.ceil(Math.max(im.w, im.h) / (opt.maxSide || 2400))); f = Math.max(1, Math.min(f, im.w, im.h));
    const ow = Math.floor(im.w / f), oh = Math.floor(im.h / f), res = new Uint8Array(ow * oh * nC), acc = new Uint32Array(ow * nC), norm = f * f; let cur = -1;
    const flush = () => { if (cur < 0) return; for (let i = 0; i < ow * nC; i++) res[cur * ow * nC + i] = Math.min(255, Math.round(acc[i] / norm)); acc.fill(0); };
    const addRow = (raw, off, y) => {
      const oy = (y / f) | 0; if (oy >= oh) return; if (oy !== cur) { flush(); cur = oy; }
      for (let x = 0, lim = ow * f; x < lim; x++) { const o = off + x * im.bpp, a = ((x / f) | 0) * nC; for (let c = 0; c < nC; c++) acc[a + c] += raw[o + c * B + hi]; }
    };
    if (!im.tiled) {
      for (let s = 0; s * im.rps < im.h; s++) {
        const rows = Math.min(im.rps, im.h - s * im.rps); if (s * im.rps >= oh * f) break;
        const raw = await block(im, s, rows * im.rowBytes, im.rowBytes); for (let r = 0; r < rows; r++) addRow(raw, r * im.rowBytes, s * im.rps + r);
        if (opt.onProgress) opt.onProgress((s * im.rps + rows) / im.h);
      }
    } else {
      for (let ty = 0; ty * im.th < im.h; ty++) {
        const rows = Math.min(im.th, im.h - ty * im.th); if (ty * im.th >= oh * f) break;
        const raw = await region(im, 0, ty * im.th, im.w, rows); for (let r = 0; r < rows; r++) addRow(raw, r * im.rowBytes, ty * im.th + r);
        if (opt.onProgress) opt.onProgress((ty * im.th + rows) / im.h);
      }
    }
    flush();
    const conv = colorConv(im), c = document.createElement('canvas'); c.width = ow; c.height = oh;
    const g = c.getContext('2d'), id = g.createImageData(ow, oh), d = id.data, v = [0, 0, 0, 0];
    for (let i = 0, n = ow * oh; i < n; i++) {
      for (let k = 0; k < nC; k++) v[k] = res[i * nC + k] / 255;
      const rgb = conv.f(v[0], v[1], v[2], v[3]); d[i * 4] = (rgb >> 16) & 255; d[i * 4 + 1] = (rgb >> 8) & 255; d[i * 4 + 2] = rgb & 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    if (opt.watermark) {      // czerwony napis z białym halo w prawym dolnym rogu (jak w miniaturki.bat)
      const fs = Math.max(6, Math.min(ow, oh) * 0.028); g.font = '700 ' + fs + 'px Arial, Helvetica, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      let fs2 = fs; const tw = g.measureText(opt.watermark).width; if (tw > ow * 0.9) { fs2 = Math.max(7, fs * ow * 0.9 / tw); g.font = '700 ' + fs2 + 'px Arial, Helvetica, sans-serif'; }
      const margin = Math.max(3, ow * 0.02), x = ow - margin, y = oh - margin - fs2 * 0.2;
      g.lineJoin = 'round'; g.lineWidth = Math.max(1, fs2 * 0.16); g.strokeStyle = '#fff'; g.strokeText(opt.watermark, x, y); g.fillStyle = '#f00'; g.fillText(opt.watermark, x, y);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', opt.quality || 0.85));
    return { blob, w: ow, h: oh, div: f, icc: conv.icc, srcW: im.w, srcH: im.h, canvas: c };
  }

  const api = { open, door, preview, thumb, colorConv, lzwEncode, lzwDecode, region };
  root.TiffDoor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
