// Pusty plik TIFF do druku: CMYK 8 bit + przezroczystość (kanał alfa, płótno w całości przezroczyste), rozdzielczość w dpi,
// prowadnice Photoshopa (zasób 8BIM 1032) na liniach spadu. Dane obrazu kompresowane Deflate (zlib) strumieniowo — plik ma ułamek rozmiaru obrazu.
// EmptyTiff.make({ wPx, hPx, dpi, guidesV: [x px], guidesH: [y px], desc }) → Promise<Blob>
(function (G) {
  const enc = new TextEncoder();
  // zasób Photoshopa: '8BIM', id, pusta nazwa (2 bajty), rozmiar, dane (do parzystej długości)
  function psRes(id, data) {
    const pad = data.length & 1, out = new Uint8Array(12 + data.length + pad), dv = new DataView(out.buffer);
    out.set(enc.encode('8BIM'), 0); dv.setUint16(4, id); dv.setUint16(6, 0); dv.setUint32(8, data.length); out.set(data, 12);
    return out;
  }
  function guidesRes(gv, gh) {      // 1032: wersja 1, siatka 576 × 576, liczba prowadnic, [położenie × 32 (1/32 px), kierunek 0 = pionowa / 1 = pozioma]
    const list = gv.map(x => [x, 0]).concat(gh.map(y => [y, 1])), d = new Uint8Array(16 + list.length * 5), dv = new DataView(d.buffer);
    dv.setUint32(0, 1); dv.setUint32(4, 576); dv.setUint32(8, 576); dv.setUint32(12, list.length);
    list.forEach(([v, dir], i) => { dv.setInt32(16 + i * 5, Math.round(v * 32)); d[20 + i * 5] = dir; });
    return psRes(1032, d);
  }
  function resolutionRes(dpi) {     // 1005: rozdzielczość (16.16), jednostka 1 = piksele na cal, wymiary w cm (2)
    const d = new Uint8Array(16), dv = new DataView(d.buffer);
    dv.setInt32(0, Math.round(dpi * 65536)); dv.setUint16(4, 1); dv.setUint16(6, 2);
    dv.setInt32(8, Math.round(dpi * 65536)); dv.setUint16(12, 1); dv.setUint16(14, 2);
    return psRes(1005, d);
  }
  async function deflateZeros(total) {
    const cs = new CompressionStream('deflate'), w = cs.writable.getWriter(), chunks = [], rd = cs.readable.getReader();
    const reading = (async () => { for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); } })();
    const Z = new Uint8Array(Math.min(total, 1 << 20)); let left = total;
    while (left > 0) { const n = Math.min(left, Z.length); await w.write(n === Z.length ? Z : Z.subarray(0, n)); left -= n; }
    await w.close(); await reading;
    return chunks;
  }
  async function make(o) {
    const W = Math.max(1, Math.round(o.wPx)), H = Math.max(1, Math.round(o.hPx)), dpi = o.dpi || 96, spp = 5;
    const strip = await deflateZeros(W * H * spp), stripLen = strip.reduce((a, c) => a + c.length, 0);
    const res = (() => { const a = resolutionRes(dpi), b = guidesRes(o.guidesV || [], o.guidesH || []), r = new Uint8Array(a.length + b.length); r.set(a, 0); r.set(b, a.length); return r; })();
    const soft = enc.encode('INDEX POL-SERVICE\0'), desc = enc.encode(String(o.desc || '') + '\0');
    // układ pliku: nagłówek (8) | pasek obrazu | dane dodatkowe | IFD
    let off = 8 + stripLen; off += off & 1;
    const extra = [], put = bytes => { const at = off; extra.push({ at, bytes }); off += bytes.length; off += off & 1; return at; };
    const bps = new Uint8Array(spp * 2); for (let i = 0; i < spp; i++) new DataView(bps.buffer).setUint16(i * 2, 8, true);
    const rat = n => { const b = new Uint8Array(8), dv = new DataView(b.buffer); dv.setUint32(0, Math.round(n * 1000), true); dv.setUint32(4, 1000, true); return b; };
    const oBps = put(bps), oX = put(rat(dpi)), oY = put(rat(dpi)), oSoft = put(soft), oDesc = desc.length > 1 ? put(desc) : 0, oRes = put(res);
    const tags = [   // [tag, typ (1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED), liczba, wartość lub przesunięcie]
      [256, 4, 1, W], [257, 4, 1, H], [258, 3, spp, oBps], [259, 3, 1, 8], [262, 3, 1, 5],
      ...(oDesc ? [[270, 2, desc.length, oDesc]] : []),
      [273, 4, 1, 8], [277, 3, 1, spp], [278, 4, 1, H], [279, 4, 1, stripLen], [282, 5, 1, oX], [283, 5, 1, oY],
      [284, 3, 1, 1], [296, 3, 1, 2], [305, 2, soft.length, oSoft], [332, 3, 1, 1], [338, 3, 1, 2], [34377, 7, res.length, oRes],
    ];
    const ifdAt = off, ifd = new Uint8Array(2 + tags.length * 12 + 4), dv = new DataView(ifd.buffer);
    dv.setUint16(0, tags.length, true);
    tags.forEach(([t, ty, n, v], i) => { const p = 2 + i * 12; dv.setUint16(p, t, true); dv.setUint16(p + 2, ty, true); dv.setUint32(p + 4, n, true); if (ty === 3 && n === 1) dv.setUint16(p + 8, v, true); else dv.setUint32(p + 8, v, true); });
    dv.setUint32(2 + tags.length * 12, 0, true);
    const head = new Uint8Array(8), hv = new DataView(head.buffer); head[0] = 0x49; head[1] = 0x49; hv.setUint16(2, 42, true); hv.setUint32(4, ifdAt, true);
    // złożenie z odstępami wyrównującymi
    const parts = [head, ...strip]; let pos = 8 + stripLen;
    const pad = to => { if (to > pos) { parts.push(new Uint8Array(to - pos)); pos = to; } };
    extra.forEach(e => { pad(e.at); parts.push(e.bytes); pos += e.bytes.length; });
    pad(ifdAt); parts.push(ifd);
    return new Blob(parts, { type: 'image/tiff' });
  }
  G.EmptyTiff = { make };
})(typeof window !== 'undefined' ? window : globalThis);
