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
    const g = c.getContext('2d'), im = g.createImageData(tw, th), spp = src.spp, B = src.bps / 8, hi = src.bps === 16 ? (src.le ? 1 : 0) : 0, rb = w * src.bpp;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / k)), sy = Math.min(h - 1, Math.floor(y / k)), o = sy * rb + sx * src.bpp, v = i => pix[o + i * B + hi], p = (y * tw + x) * 4;
      let r, gg, b;
      if (src.photo === 5 && spp >= 4) { const kk = 1 - v(3) / 255; r = 255 * (1 - v(0) / 255) * kk; gg = 255 * (1 - v(1) / 255) * kk; b = 255 * (1 - v(2) / 255) * kk; }
      else if (spp >= 3) { r = v(0); gg = v(1); b = v(2); } else { r = gg = b = src.photo === 0 ? 255 - v(0) : v(0); }
      im.data[p] = r; im.data[p + 1] = gg; im.data[p + 2] = b; im.data[p + 3] = 255;
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

  const api = { open, door, preview, lzwEncode, lzwDecode, region };
  root.TiffDoor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
