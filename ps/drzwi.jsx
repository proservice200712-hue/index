#target photoshop
// INDEX → Photoshop: plik grafiki na drzwi wycięty z pliku grafiki ściany.
// Szablon: INDEX (przycisk „Plik drzwi (Photoshop)” przy ścianie z drzwiami) wpisuje niżej dane ściany i drzwi i pobiera gotowy skrypt.
// Uruchomienie: dwuklik w pobrany plik .jsx albo w Photoshopie Plik → Skrypty → Przeglądaj…
// Skrypt: otwiera plik ściany (ścieżka z INDEX; gdy jej nie ma — pyta o plik), sam rozpoznaje, czy plik jest ze spadem, czy netto,
// i ile ma pikseli na milimetr (z proporcji i rozmiaru), wycina każde drzwi razem ze spadami i zapisuje obok pliku ściany jako TIFF
// (kolory i tryb bez zmian, np. CMYK). Spad drzwi wychodzący poza plik ściany uzupełnia odbiciem lustrzanym sąsiedniego pasa.
// Plik ściany zostaje bez zmian (jeśli był otwarty — zostaje otwarty, inaczej jest zamykany bez zapisu).
app.bringToFront();
(function () {
  var P = /*__DANE__*/null;
  if (!P) { alert('Ten plik to szablon. Pobierz skrypt z INDEX: przycisk „Plik drzwi (Photoshop)” przy ścianie z drzwiami.'); return; }
  var cicho = !!P.cicho, raportPlik = P.raport ? new File(P.raport) : null;
  function powiedz(t) { if (cicho) { if (raportPlik) { raportPlik.encoding = 'UTF-8'; raportPlik.open('w'); raportPlik.write(t); raportPlik.close(); } } else alert(t); }
  var stare = app.preferences.rulerUnits, dialogi = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  if (cicho) app.displayDialogs = DialogModes.NO;
  try { main(); } catch (e) { powiedz('INDEX — plik drzwi: błąd\n' + e + (e.line ? ' (linia ' + e.line + ')' : '')); }
  app.preferences.rulerUnits = stare; app.displayDialogs = dialogi;

  function px(v) { return new UnitValue(v, 'px'); }
  function mm(v, s) { return Math.round(v / s) + ' mm'; }
  function bazaNazwy(f) { return decodeURI(f.name).replace(/\.[^.]+$/, ''); }

  function main() {
    var f = new File(P.plik || ''), byl = null, i;
    if (!P.plik || !f.exists) {
      if (cicho) { powiedz('Brak pliku: ' + P.plik); return; }
      f = File.openDialog('INDEX: wskaż plik grafiki ściany ' + P.sciana + ' (' + P.stoisko + ')' + (P.plik ? '\nNie znaleziono: ' + P.plik : ''));
      if (!f) return;
    }
    for (i = 0; i < app.documents.length; i++) { try { if (app.documents[i].fullName.fsName == f.fsName) byl = app.documents[i]; } catch (e) { } }
    var src = byl || app.open(f);
    var Wpx = src.width.as('px'), Hpx = src.height.as('px');
    var B = P.spadSciany, Pw = P.W + B.l + B.r, Ph = P.H + B.t + B.b, a = Wpx / Hpx, jak = '', k, best = null;
    // 1) rzeczywisty wymiar pliku (z rozdzielczości) = ściana ze spadem albo netto, w skali 1:1 albo 1:10
    var res = src.resolution, fW = Wpx / res * 25.4, fH = Hpx / res * 25.4, war = [[true, 1], [false, 1], [true, 10], [false, 10]];
    for (k = 0; k < war.length; k++) { var ew = war[k][0] ? Pw : P.W, eh = war[k][0] ? Ph : P.H, e = Math.max(Math.abs(fW * war[k][1] - ew) / ew, Math.abs(fH * war[k][1] - eh) / eh); if (!best || e < best.e) best = { e: e, zS: war[k][0], skala: war[k][1] }; }
    var eS = Math.abs(a - Pw / Ph) / (Pw / Ph), eN = Math.abs(a - P.W / P.H) / (P.W / P.H), zS;
    if (best.e < 0.01 && (B.l + B.r + B.t + B.b > 0 || best.zS)) { zS = best.zS; jak = 'rozpoznano po wymiarze pliku (skala 1:' + best.skala + ')'; }
    else { zS = eS <= eN; jak = 'rozpoznano po proporcjach pliku'; }
    var ox = zS ? B.l : 0, oy = zS ? B.t : 0, sx = Wpx / (zS ? Pw : P.W), sy = Hpx / (zS ? Ph : P.H);
    if (Math.min(eS, eN) > 0.03 && !cicho && !confirm('Proporcje pliku (' + Math.round(Wpx) + ' × ' + Math.round(Hpx) + ' px) nie pasują ani do ściany ' + P.W + ' × ' + P.H + ' mm, ani do wymiaru ze spadem ' + Pw + ' × ' + Ph + ' mm.\nWyciąć mimo to?')) { if (!byl) src.close(SaveOptions.DONOTSAVECHANGES); return; }
    var raport = [], j;
    for (j = 0; j < P.drzwi.length; j++) raport.push(drzwi(src, P.drzwi[j], Wpx, Hpx, ox, oy, sx, sy, f));
    if (!byl) src.close(SaveOptions.DONOTSAVECHANGES);
    powiedz('INDEX — ' + P.stoisko + ', ściana ' + P.sciana + '\nPlik ściany: ' + (zS ? 'ze spadem (L ' + B.l + ', P ' + B.r + ', G ' + B.t + ', D ' + B.b + ' mm)' : 'bez spadu (netto)') + ', ' + (Math.round(sx * 100) / 100) + ' px na mm — ' + jak + '\n\n' + raport.join('\n\n'));
  }

  function drzwi(src, d, Wpx, Hpx, ox, oy, sx, sy, f) {
    // prostokąt drzwi ze spadami w pikselach pliku ściany (y w dół; dół drzwi = dół ściany)
    var X0 = Math.round((ox + d.x - d.l) * sx), X1 = Math.round((ox + d.x + d.w + d.r) * sx);
    var Y0 = Math.round((oy + P.H - d.h - d.t) * sy), Y1 = Math.round((oy + P.H + d.b) * sy);
    var mL = Math.max(0, -X0), mT = Math.max(0, -Y0), mR = Math.max(0, X1 - Wpx), mB = Math.max(0, Y1 - Hpx);
    app.activeDocument = src;
    var doc = src.duplicate('Drzwi ' + d.znak, true);
    try { doc.flatten(); } catch (e) { }
    // kadrowanie samymi zmianami rozmiaru płótna (jak ręcznie: Obraz → Rozmiar płótna), 4 kroki widoczne w Historii;
    // gdy drzwi ze spadem wychodzą poza plik ściany, ten sam krok dokłada płótno
    doc.resizeCanvas(px(X1), px(Hpx), AnchorPosition.TOPLEFT);                  // 1. prawa krawędź: zostaje od lewej do X1
    doc.resizeCanvas(px(X1 - X0), px(Hpx), AnchorPosition.TOPRIGHT);           // 2. lewa krawędź: zostaje szerokość drzwi ze spadami (od prawej)
    doc.resizeCanvas(px(X1 - X0), px(Y1), AnchorPosition.TOPLEFT);             // 3. dół: zostaje od góry do Y1
    doc.resizeCanvas(px(X1 - X0), px(Y1 - Y0), AnchorPosition.BOTTOMLEFT);     // 4. góra: zostaje wysokość drzwi ze spadami (od dołu)
    var Dw = doc.width.as('px'), Dh = doc.height.as('px'), uzup = [], s;
    // brakujące pasy (poza plikiem ściany): odbicie lustrzane pasa obok
    if (mB) { s = Math.min(mB, Dh - mB); lustro(doc, [0, Dh - mB - s, Dw, Dh - mB], false, true, 0, Dh - mB); uzup.push('dół ' + mm(mB, sy)); }
    if (mT) { s = Math.min(mT, Dh - mT); lustro(doc, [0, mT, Dw, mT + s], false, true, 0, mT - s); uzup.push('góra ' + mm(mT, sy)); }
    if (mL) { s = Math.min(mL, Dw - mL); lustro(doc, [mL, 0, mL + s, Dh], true, false, mL - s, 0); uzup.push('lewo ' + mm(mL, sx)); }
    if (mR) { s = Math.min(mR, Dw - mR); lustro(doc, [Dw - mR - s, 0, Dw - mR, Dh], true, false, Dw - mR, 0); uzup.push('prawo ' + mm(mR, sx)); }
    if (doc.layers.length > 1) doc.flatten();
    // nazwa: plik ściany + znak drzwi + wymiar pliku drzwi do druku (ze spadami), np. A4_drzwi_A4_1400x2300mm.tif
    var out = new File(f.parent.fsName + '/' + bazaNazwy(f) + '_drzwi_' + d.znak + '_' + (d.w + d.l + d.r) + 'x' + (d.h + d.t + d.b) + 'mm.tif');
    var o = new TiffSaveOptions(); o.imageCompression = TIFFEncoding.TIFFLZW; o.layers = false; o.embedColorProfile = true;
    doc.saveAs(out, o, false, Extension.LOWERCASE);
    var mini = miniatura(doc, d, out);
    if (cicho) doc.close(SaveOptions.DONOTSAVECHANGES);
    return 'Drzwi ' + d.znak + ': ' + (d.w + d.l + d.r) + ' × ' + (d.h + d.t + d.b) + ' mm (drzwi ' + d.w + ' × ' + d.h + ', spad L ' + d.l + ' P ' + d.r + ' G ' + d.t + ' D ' + d.b + '), ' + Math.round(Dw) + ' × ' + Math.round(Dh) + ' px\n→ ' + out.fsName + (uzup.length ? '\nspad poza plikiem ściany, uzupełniony odbiciem: ' + uzup.join(', ') : '') + mini;
  }

  // miniaturka pliku drzwi do INDEX: JPG (sRGB, dłuższy bok 2000 px) → Cloudinary → pole thumb elementu „Drzwi — …” + wpis w historii.
  // Wysyłka przez curl z Windows (app.system); starszy Photoshop bez app.system — miniaturka zostaje obok pliku do wgrania ręcznie.
  function miniatura(doc, d, out) {
    if (!P.indeks || !d.eid) return '';
    var m = doc.duplicate('miniatura', true), jpg;
    try {
      try { m.flatten(); } catch (e) { }
      if (m.bitsPerChannel != BitsPerChannelType.EIGHT) m.bitsPerChannel = BitsPerChannelType.EIGHT;
      try { m.convertProfile('sRGB IEC61966-2.1', Intent.RELATIVECOLORIMETRIC, true, false); } catch (e) { m.changeMode(ChangeMode.RGB); }
      var w = m.width.as('px'), h = m.height.as('px'), k = 2000 / Math.max(w, h);
      if (k < 1) m.resizeImage(px(Math.round(w * k)), px(Math.round(h * k)), m.resolution, ResampleMethod.BICUBIC);
      jpg = new File(out.parent.fsName + '/' + decodeURI(out.name).replace(/\.[^.]+$/, '') + '_miniatura.jpg');
      var o = new JPEGSaveOptions(); o.quality = 9; o.embedColorProfile = true;
      m.saveAs(jpg, o, true, Extension.LOWERCASE);
    } finally { m.close(SaveOptions.DONOTSAVECHANGES); }
    if (typeof app.system !== 'function') return '\nminiaturka: ten Photoshop nie umie jej wysłać — wgraj ręcznie do drzwi w INDEX: ' + jpg.fsName;
    var I = P.indeks, tmp = Folder.temp.fsName, odp = new File(tmp + '/index_drzwi_odp.json');
    // 1) Cloudinary (to samo konto i preset co INDEX)
    try { odp.remove(); } catch (e) { }
    app.system('curl -s -F "upload_preset=' + I.preset + '" -F "file=@' + jpg.fsName + '" https://api.cloudinary.com/v1_1/' + I.chmura + '/image/upload -o "' + odp.fsName + '"');
    var t = czytaj(odp), u = t.match(/"secure_url"\s*:\s*"([^"]+)"/);
    if (!u) return '\nminiaturka: nie udało się wysłać (Cloudinary) — wgraj ręcznie: ' + jpg.fsName;
    var url = u[1].replace(/\\\//g, '/'), teraz = iso(), baza = 'https://firestore.googleapis.com/v1/projects/' + I.projekt + '/databases/(default)/documents/';
    // 2) pole thumb elementu drzwi (thumbVec czyszczone: podglądem jest teraz ten obraz)
    var pola = { thumb: url, thumbVec: '', updatedAt: teraz, updatedBy: I.kto, src: 'photoshop' }, maska = '', f;
    for (f in pola) maska += '&updateMask.fieldPaths=' + f;
    var odp2 = curlJson('PATCH', baza + I.elementy + '/' + d.eid + '?key=' + I.klucz + maska, pola, tmp);
    if (odp2.indexOf('"fields"') < 0) return '\nminiaturka wysłana, ale nie zapisała się w INDEX — wgraj ręcznie: ' + jpg.fsName;
    // 3) historia zmian stoiska
    curlJson('POST', baza + I.log + '?key=' + I.klucz, { at: teraz, user: I.kto, text: 'Photoshop: grafika drzwi ' + d.znak + ' (miniatura z pliku ' + decodeURI(out.name) + ')', eid: d.eid }, tmp);
    return '\nminiaturka wysłana do INDEX (element „Drzwi — ' + d.znak + '”)';
  }
  function curlJson(metoda, url, pola, tmp) {
    var body = new File(tmp + '/index_drzwi_body.json'), odp = new File(tmp + '/index_drzwi_odp2.json'), s = '{"fields":{', pierwsze = true, f;
    for (f in pola) { s += (pierwsze ? '' : ',') + '"' + f + '":{"stringValue":' + jsonStr(pola[f]) + '}'; pierwsze = false; }
    s += '}}';
    body.encoding = 'UTF-8'; body.open('w'); body.write(s); body.close();
    try { odp.remove(); } catch (e) { }
    app.system('curl -s -X ' + metoda + ' -H "Content-Type: application/json" --data-binary "@' + body.fsName + '" "' + url + '" -o "' + odp.fsName + '"');
    return czytaj(odp);
  }
  function jsonStr(v) { // ASCII + \uXXXX (polskie znaki bez kłopotów z kodowaniem pliku)
    var s = String(v), w = '"', i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); w += c === 34 ? '\\"' : c === 92 ? '\\\\' : c < 32 || c > 126 ? '\\u' + ('0000' + c.toString(16)).slice(-4) : s.charAt(i); }
    return w + '"';
  }
  function czytaj(f) { if (!f.exists) return ''; f.encoding = 'UTF-8'; f.open('r'); var t = f.read(); f.close(); return t; }
  function iso() { var d = new Date(), z = function (n, k) { n = String(n); while (n.length < (k || 2)) n = '0' + n; return n; }; return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + 'T' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()) + '.' + z(d.getUTCMilliseconds(), 3) + 'Z'; }

  function lustro(doc, r, fh, fv, tx, ty) {
    doc.selection.select([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
    doc.selection.copy(); doc.selection.deselect();
    var L = doc.paste();
    if (fh) L.resize(-100, 100, AnchorPosition.MIDDLECENTER);
    if (fv) L.resize(100, -100, AnchorPosition.MIDDLECENTER);
    var b = L.bounds; L.translate(px(tx - b[0].as('px')), px(ty - b[1].as('px')));
  }
})();
