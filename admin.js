/* Espace d'administration : formulaires (fiches, régions, thèmes), photos, taxonomie, données */
window.BA = window.BA || {};
(function (BA) {
  const { esc, norm, slugify } = BA.u;
  const $ = s => document.querySelector(s);
  const clone = o => JSON.parse(JSON.stringify(o));
  const MAX_FILE = 25 * 1024 * 1024;
  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

  /* ---------- Traitement d'image (réduction pour économiser la place) ---------- */
  async function processImage(file) {
    const max = 1600;
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible')); i.src = URL.createObjectURL(file); });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Conversion impossible')), 'image/jpeg', 0.86));
  }

  /* ---------- Champ photo réutilisable ---------- */
  class ImageField {
    constructor(img) {
      this.orig = img ? clone(img) : null;
      this.origId = img && img.imageId || null;
      this.keepInternal = !!this.origId;
      this.pending = null; this.pendingUrl = null;
    }
    html() {
      const i = this.orig || {};
      return `<div class="imgfield"><div class="imgprev" data-prev></div><div class="imgctl">
        <label>Choisir une photographie sur ton ordinateur<input type="file" data-file accept="image/jpeg,image/png,image/webp,image/gif,image/avif"></label>
        <label>… ou l'adresse (URL) d'une image que tu as le droit d'utiliser<input type="url" data-url placeholder="https://…" value="${esc(i.url || '')}"></label>
        <label>Texte alternatif (décrit l'image aux lecteurs d'écran)<input data-alt value="${esc(i.alt || '')}"></label>
        <div class="two"><label>Crédit photographe<input data-credit value="${esc(i.credit || '')}"></label><label>Source / licence<input data-source value="${esc(i.source || '')}"></label></div>
        <button type="button" class="btn small danger" data-remove>Retirer la photographie</button></div></div>`;
    }
    wire(root, onError, onChange) {
      this.root = root; this.onError = onError;
      const q = s => root.querySelector(s);
      this.q = q;
      q('[data-file]').addEventListener('change', async e => {
        const f = e.target.files[0]; if (!f) return;
        if (!OK_TYPES.includes(f.type)) { onError('Ce fichier n\'est pas une image acceptée (JPEG, PNG, WebP, GIF ou AVIF).'); e.target.value = ''; return; }
        if (f.size > MAX_FILE) { onError('Cette image dépasse 25 Mo. Choisis-en une plus légère.'); e.target.value = ''; return; }
        try { this.pending = await processImage(f); this.keepInternal = false; q('[data-url]').value = ''; this.refresh(); onChange && onChange(); }
        catch (err) { onError('Impossible de lire cette image : ' + err.message); }
      });
      q('[data-url]').addEventListener('input', e => { if (e.target.value.trim()) { this.pending = null; this.keepInternal = false; q('[data-file]').value = ''; } this.refresh(); onChange && onChange(); });
      q('[data-remove]').addEventListener('click', () => { this.pending = null; this.keepInternal = false; q('[data-url]').value = ''; q('[data-file]').value = ''; this.refresh(); onChange && onChange(); });
      this.refresh();
    }
    previewSrc() {
      if (this.pending) { if (!this.pendingUrl) this.pendingUrl = URL.createObjectURL(this.pending); return this.pendingUrl; }
      const u = this.q('[data-url]').value.trim();
      return u || null;
    }
    refresh() {
      if (this.pendingUrl && !this.pending) { URL.revokeObjectURL(this.pendingUrl); this.pendingUrl = null; }
      if (this.pending && this.pendingUrl) { URL.revokeObjectURL(this.pendingUrl); this.pendingUrl = null; }
      const box = this.q('[data-prev]'), src = this.previewSrc();
      if (src) box.innerHTML = BA.photo(null, 'Aperçu', { previewSrc: src });
      else if (this.keepInternal && this.origId) { box.innerHTML = BA.photo({ imageId: this.origId }, 'Aperçu'); BA.hydrate(box); }
      else box.innerHTML = BA.photo(null, '');
    }
    urlError() {
      const u = this.q('[data-url]').value.trim();
      if (!u) return '';
      try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw 0; } catch (e) { return 'L\'adresse de l\'image doit commencer par http:// ou https://.'; }
      return '';
    }
    async commit() {
      const q = this.q, url = q('[data-url]').value.trim();
      let imageId = null, outUrl = url;
      if (this.pending) { imageId = await BA.img.put(this.pending); outUrl = ''; }
      else if (!url && this.keepInternal) imageId = this.origId;
      if (this.origId && this.origId !== imageId) await BA.img.del(this.origId);
      if (!imageId && !outUrl) return null;
      return { imageId, url: outUrl, alt: q('[data-alt]').value.trim(), credit: q('[data-credit]').value.trim(), source: q('[data-source]').value.trim() };
    }
  }

  const splitList = s => String(s || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  const regionByName = v => [...BA.regions.values()].find(r => norm(r.name) === norm(v));
  const regionDatalist = () => `<datalist id="dl-reg">${[...BA.regions.values()].map(r => `<option value="${esc(r.name)}">`).join('')}</datalist>`;
  const showErrors = (box, list) => { const e = box.querySelector('.errors'); e.innerHTML = list.length ? '<strong>À corriger :</strong><ul>' + list.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''; e.classList.toggle('hidden', !list.length); if (list.length) e.scrollIntoView({ block: 'nearest' }); };

  /* ---------- Formulaire de fiche animale ---------- */
  BA.openAnimalForm = function (id, preset) {
    const isNew = !id;
    const a = isNew ? Object.assign(BA.newAnimal(), preset || {}) : clone(BA.animal(id));
    if (!isNew && !a) return;
    const d = BA.data, f = a.fields || {}, g = a.geo || {}, c = a.conservation || {};
    const cat = BA.cat(a.categoryId), fam = BA.fam(a.familyId);
    const imgf = new ImageField(a.image);
    let dist = a.distribution.map(x => ({ ...x })), secs = (a.sections || []).map(s => ({ ...s, id: s.id || BA.u.uid() }));
    let dirty = false;
    const inp = (n, label, v, extra) => `<label>${label}<input data-f="${n}" value="${esc(v || '')}" ${extra || ''}></label>`;
    const ta = (n, label, v, rows) => `<label>${label}<textarea data-f="${n}" rows="${rows || 3}">${esc(v || '')}</textarea></label>`;
    const html = `<form id="aform" novalidate autocomplete="off">
      <div class="fform-head"><h3>${isNew ? 'Nouvelle fiche animale' : 'Modifier « ' + esc(a.common) + ' »'}</h3><button type="button" class="btn" id="aPrev" aria-pressed="false">👁 Aperçu</button></div>
      <p class="hint">Seul le nom commun est obligatoire. Tout le reste peut être complété plus tard : les champs vides ne sont pas affichés.</p>
      <div class="errors hidden" role="alert"></div>
      <div id="aBody">
      <details open><summary>Identification</summary>
        <div class="two">${inp('common', 'Nom commun *', a.common, 'required autofocus')}${inp('scientific', 'Nom scientifique', a.scientific)}</div>
        ${inp('otherNames', 'Autres noms (séparés par des virgules)', (a.otherNames || []).join(', '))}
        <div class="two"><label>Catégorie<input data-f="category" list="dl-cat" value="${esc(cat ? cat.name : '')}" placeholder="ex : Mammifères"></label>
        <label>Famille zoologique<input data-f="family" list="dl-fam" value="${esc(fam ? fam.name : '')}" placeholder="ex : Félidés"></label></div>
        <datalist id="dl-cat">${d.categories.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
        <datalist id="dl-fam">${d.families.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist>
        <div class="two">${inp('genus', 'Genre', a.genus)}${inp('order', 'Ordre', a.order)}</div>
        ${ta('taxoNote', 'Statut taxonomique / remarques', a.taxoNote, 2)}</details>
      <details open><summary>Carte et photographie</summary>
        ${ta('cardText', 'Court texte affiché sur la carte', a.cardText, 2)}${ta('summary', 'Présentation générale (en tête de la fiche)', a.summary, 4)}
        <h4>Photographie</h4><p class="hint">N'ajoute que des photos que tu as choisies et que tu as le droit d'utiliser. Aucune image n'est générée automatiquement.</p>
        <div id="imgHost">${imgf.html()}</div></details>
      <details><summary>Description</summary>${BA.schema.desc.map(([k, l]) => ta('desc_' + k, l, f[k], 2)).join('')}</details>
      <details open><summary>Géographie</summary>
        ${regionDatalist()}
        <label>Ajouter un pays ou un continent<div class="distrow"><input id="dIn" list="dl-reg" placeholder="Tape un nom (ex : Madagascar)"><select id="dSt" aria-label="Type de présence">${Object.entries(BA.schema.statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button type="button" class="btn" id="dAdd">Ajouter</button></div></label>
        ${BA.geo ? '' : '<p class="note">Les pays n\'ont pas pu être chargés (connexion ?) : seuls les continents sont disponibles pour l\'instant.</p>'}
        <ul id="dList" class="plist"></ul>
        ${inp('geo_habitats', 'Habitats', g.habitats)}${ta('geo_range', 'Aire de répartition naturelle (précisions)', g.range, 2)}${ta('geo_more', 'Informations complémentaires sur la distribution', g.more, 2)}</details>
      <details><summary>Conservation</summary>${BA.schema.cons.map(([k, l]) => ta('cons_' + k, l, c[k], 2)).join('')}</details>
      <details open><summary>Mots-clés</summary>
        <datalist id="dl-kw">${d.keywords.map(x => `<option value="${esc(x.label)}">`).join('')}</datalist>
        <label>Mots-clés (séparés par des virgules, ex : forêt-tropicale, espèce-nocturne)<input data-f="keywords" list="dl-kw" value="${esc(a.keywordIds.map(k => (BA.kw(k) || {}).label).filter(Boolean).join(', '))}"></label></details>
      <details><summary>Sections libres</summary><p class="hint">Ajoute tes propres rubriques (texte ou liste à puces, une ligne par puce).</p><div id="secList"></div><button type="button" class="btn" id="secAdd">+ Ajouter une section</button></details>
      </div>
      <div id="aPreview" class="hidden"></div>
      <div class="foot sticky"><button type="button" class="btn" id="aCancel">Annuler</button><button type="submit" class="btn primary" id="aSave">Enregistrer</button></div></form>`;
    const box = BA.openModal(html, { wide: true, guard: () => !dirty || confirm('Abandonner les modifications non enregistrées ?') });
    const q = s => box.querySelector(s);
    const val = n => (q(`[data-f="${n}"]`).value || '').trim();
    const mark = () => { dirty = true; };
    box.addEventListener('input', mark); box.addEventListener('change', mark);
    imgf.wire(q('#imgHost'), m => showErrors(box, [m]), mark);

    function renderDist() {
      q('#dList').innerHTML = dist.map((x, i) => `<li><span>📍 ${esc(BA.regionName(x.region))} <em>— ${esc(BA.schema.statuses[x.status])}</em></span><button type="button" class="btn small danger" data-di="${i}" aria-label="Retirer ${esc(BA.regionName(x.region))}">✕</button></li>`).join('') || '<li class="muted">Aucune région associée pour l\'instant.</li>';
    }
    q('#dAdd').onclick = () => {
      const r = regionByName(q('#dIn').value), st = q('#dSt').value;
      if (!r) { showErrors(box, ['Région inconnue : choisis un nom dans la liste proposée.']); return; }
      if (!dist.some(x => x.region === r.id && x.status === st)) { dist.push({ region: r.id, status: st }); mark(); }
      q('#dIn').value = ''; showErrors(box, []); renderDist();
    };
    q('#dIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q('#dAdd').click(); } });
    q('#dList').addEventListener('click', e => { const b = e.target.closest('[data-di]'); if (b) { dist.splice(+b.dataset.di, 1); mark(); renderDist(); } });
    renderDist();

    function renderSecs() {
      q('#secList').innerHTML = secs.map((s, i) => `<div class="secrow"><div class="two"><label>Titre<input data-si="${i}" data-sk="title" value="${esc(s.title || '')}"></label>
        <label>Type<select data-si="${i}" data-sk="kind"><option value="text"${s.kind !== 'list' ? ' selected' : ''}>Paragraphes</option><option value="list"${s.kind === 'list' ? ' selected' : ''}>Liste à puces</option></select></label></div>
        <label>Contenu<textarea data-si="${i}" data-sk="body" rows="4">${esc(s.body || '')}</textarea></label>
        <div class="secbtn"><button type="button" class="btn small" data-sm="up" data-si="${i}" aria-label="Monter la section">↑</button><button type="button" class="btn small" data-sm="down" data-si="${i}" aria-label="Descendre la section">↓</button><button type="button" class="btn small danger" data-sm="del" data-si="${i}">Supprimer la section</button></div></div>`).join('');
    }
    q('#secAdd').onclick = () => { secs.push({ id: BA.u.uid(), title: '', kind: 'text', body: '' }); mark(); renderSecs(); };
    q('#secList').addEventListener('input', e => { const t = e.target; if (t.dataset.si != null) secs[+t.dataset.si][t.dataset.sk] = t.value; });
    q('#secList').addEventListener('click', e => {
      const b = e.target.closest('[data-sm]'); if (!b) return; const i = +b.dataset.si, m = b.dataset.sm;
      if (m === 'del') secs.splice(i, 1);
      else { const j = m === 'up' ? i - 1 : i + 1; if (j >= 0 && j < secs.length) [secs[i], secs[j]] = [secs[j], secs[i]]; }
      mark(); renderSecs();
    });
    renderSecs();

    function collect() {
      const o = clone(a);
      Object.assign(o, { common: val('common'), scientific: val('scientific'), otherNames: splitList(val('otherNames')), genus: val('genus'), order: val('order'), taxoNote: val('taxoNote'), cardText: val('cardText'), summary: val('summary') });
      o.fields = {}; BA.schema.desc.forEach(([k]) => { const v = val('desc_' + k); if (v) o.fields[k] = v; });
      o.geo = { habitats: val('geo_habitats'), range: val('geo_range'), more: val('geo_more') };
      o.conservation = {}; BA.schema.cons.forEach(([k]) => { const v = val('cons_' + k); if (v) o.conservation[k] = v; });
      o.distribution = dist.map(x => ({ ...x }));
      o.sections = secs.filter(s => (s.title || '').trim() || (s.body || '').trim()).map(s => ({ id: s.id, title: (s.title || '').trim(), kind: s.kind === 'list' ? 'list' : 'text', body: (s.body || '').trim() }));
      return o;
    }
    function validate() {
      const e = [];
      if (!val('common')) e.push('Le nom commun est obligatoire.');
      const u = imgf.urlError(); if (u) e.push(u);
      return e;
    }
    q('#aPrev').onclick = () => {
      const pv = q('#aPreview'), on = pv.classList.contains('hidden');
      if (on) {
        const errs = validate(); if (errs.length) { showErrors(box, errs); return; }
        showErrors(box, []);
        const o = collect();
        o.image = { imageId: imgf.keepInternal ? imgf.origId : null, url: '', alt: imgf.q('[data-alt]').value.trim(), credit: imgf.q('[data-credit]').value.trim(), source: imgf.q('[data-source]').value.trim() };
        pv.innerHTML = '<p class="note">Aperçu — rien n\'est encore enregistré.</p>' + BA.ficheHTML(o, { preview: true, previewSrc: imgf.previewSrc() || undefined, names: { cat: val('category'), fam: val('family'), kws: splitList(val('keywords')) } });
        BA.hydrate(pv);
      }
      pv.classList.toggle('hidden', !on); q('#aBody').classList.toggle('hidden', on);
      q('#aPrev').setAttribute('aria-pressed', String(on)); q('#aPrev').textContent = on ? '✎ Retour au formulaire' : '👁 Aperçu';
    };
    q('#aCancel').onclick = () => BA.closeModal();
    q('#aform').addEventListener('submit', async ev => {
      ev.preventDefault();
      const errs = validate(); if (errs.length) { showErrors(box, errs); return; }
      showErrors(box, []);
      const btn = q('#aSave'); btn.disabled = true; btn.textContent = 'Enregistrement…';
      try {
        const o = collect();
        o.image = await imgf.commit();
        const catName = val('category'), famName = val('family');
        o.categoryId = BA.ensureCategory(d, catName);
        o.familyId = BA.ensureFamily(d, famName, o.categoryId);
        o.keywordIds = splitList(val('keywords')).map(l => BA.ensureKeyword(d, l)).filter((x, i, arr) => x && arr.indexOf(x) === i);
        o.updated = Date.now();
        if (isNew) { o.slug = BA.uniqueSlug(d.animals, o.common, o.id); d.animals.push(o); }
        else { o.slug = a.slug || BA.uniqueSlug(d.animals, o.common, o.id); d.animals[d.animals.findIndex(x => x.id === o.id)] = o; }
        BA.touch(); dirty = false; BA.closeModal(true);
        BA.toast(isNew ? 'Fiche créée.' : 'Fiche enregistrée.', 'ok');
        if (isNew && /^#\/(animal|bibliotheque)?/.test(location.hash) && location.hash.startsWith('#/animal')) location.hash = '#/animal/' + o.slug;
      } catch (err) {
        console.error(err); btn.disabled = false; btn.textContent = 'Enregistrer'; showErrors(box, ['L\'enregistrement a échoué : ' + err.message]);
      }
    });
  };

  async function deleteAnimal(id) {
    const a = BA.animal(id); if (!a) return;
    const ok = await BA.confirm({ title: 'Supprimer cette fiche ?', message: '« ' + a.common + ' » sera supprimée définitivement, avec sa photo. Tu peux d\'abord exporter une sauvegarde.', confirmLabel: 'Supprimer', danger: true, backup: true });
    if (!ok) return;
    if (a.image && a.image.imageId) await BA.img.del(a.image.imageId);
    BA.data.animals = BA.data.animals.filter(x => x.id !== id);
    BA.touch(); BA.toast('Fiche supprimée.');
    if (location.hash.startsWith('#/animal/')) location.hash = '#/bibliotheque';
  }

  /* ---------- Page régionale ---------- */
  BA.openRegionForm = function (rid) {
    const page = clone(BA.data.regionPages[rid] || {});
    const imgf = new ImageField(page.image);
    let dirty = false;
    const r0 = rid ? BA.regions.get(rid) : null;
    const box = BA.openModal(`<form id="rform" novalidate><h3>Page de région</h3><div class="errors hidden" role="alert"></div>
      ${regionDatalist()}
      <label>Région *<input data-f="region" list="dl-reg" value="${esc(r0 ? r0.name : '')}" ${r0 ? 'readonly' : 'autofocus'} placeholder="Pays ou continent"></label>
      <label>Courte présentation (affichée dans le tiroir du globe)<textarea data-f="short" rows="2">${esc(page.short || '')}</textarea></label>
      <label>Description (page de la région)<textarea data-f="description" rows="5">${esc(page.description || '')}</textarea></label>
      <label>Informations géographiques supplémentaires<textarea data-f="info" rows="3">${esc(page.info || '')}</textarea></label>
      <h4>Image facultative</h4><div id="imgHost">${imgf.html()}</div>
      <div class="foot">${r0 && BA.data.regionPages[rid] ? '<button type="button" class="btn danger" id="rDel">Supprimer la page</button>' : ''}<button type="button" class="btn" id="rCancel">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div></form>`,
    { wide: true, guard: () => !dirty || confirm('Abandonner les modifications non enregistrées ?') });
    const q = s => box.querySelector(s), val = n => q(`[data-f="${n}"]`).value.trim();
    box.addEventListener('input', () => { dirty = true; });
    imgf.wire(q('#imgHost'), m => showErrors(box, [m]), () => { dirty = true; });
    q('#rCancel').onclick = () => BA.closeModal();
    const del = q('#rDel');
    if (del) del.onclick = async () => {
      if (!confirm('Supprimer la page personnalisée de cette région ? (Les animaux ne sont pas touchés.)')) return;
      if (page.image && page.image.imageId) await BA.img.del(page.image.imageId);
      delete BA.data.regionPages[rid]; dirty = false; BA.touch(); BA.closeModal(true);
    };
    q('#rform').addEventListener('submit', async ev => {
      ev.preventDefault();
      const r = r0 || regionByName(val('region'));
      const errs = []; if (!r) errs.push('Choisis une région dans la liste proposée.'); const u = imgf.urlError(); if (u) errs.push(u);
      if (errs.length) { showErrors(box, errs); return; }
      const image = await imgf.commit();
      BA.data.regionPages[r.id] = { short: val('short'), description: val('description'), info: val('info'), image };
      dirty = false; BA.touch(); BA.closeModal(true); BA.toast('Page de région enregistrée.', 'ok');
    });
  };

  /* ---------- Page thématique ---------- */
  BA.openThemeForm = function (id) {
    const isNew = !id, t = isNew ? { id: BA.u.uid(), slug: '', title: '', description: '', keywordIds: [], image: null } : clone(BA.data.themes.find(x => x.id === id));
    const imgf = new ImageField(t.image); let dirty = false;
    const box = BA.openModal(`<form id="tform" novalidate><h3>${isNew ? 'Nouvelle page thématique' : 'Modifier la page'}</h3><div class="errors hidden" role="alert"></div>
      <datalist id="dl-kw">${BA.data.keywords.map(x => `<option value="${esc(x.label)}">`).join('')}</datalist>
      <label>Titre *<input data-f="title" value="${esc(t.title)}" autofocus></label>
      <label>Identifiant d'URL (ex : animaux-nocturnes) <input data-f="slug" value="${esc(t.slug)}" placeholder="généré à partir du titre"></label>
      <p class="hint">Adresse de la page : <code>#/themes/<span id="slugPrev">${esc(t.slug || '…')}</span></code></p>
      <label>Description<textarea data-f="description" rows="4">${esc(t.description || '')}</textarea></label>
      <label>Mots-clés reliés (séparés par des virgules) — les animaux portant l'un de ces mots-clés apparaissent sur la page<input data-f="keywords" list="dl-kw" value="${esc(t.keywordIds.map(k => (BA.kw(k) || {}).label).filter(Boolean).join(', '))}"></label>
      <h4>Image facultative</h4><div id="imgHost">${imgf.html()}</div>
      <div class="foot"><button type="button" class="btn" id="tCancel">Annuler</button><button type="submit" class="btn primary">Enregistrer</button></div></form>`,
    { wide: true, guard: () => !dirty || confirm('Abandonner les modifications non enregistrées ?') });
    const q = s => box.querySelector(s), val = n => q(`[data-f="${n}"]`).value.trim();
    box.addEventListener('input', () => { dirty = true; const s = val('slug') || slugify(val('title')); q('#slugPrev').textContent = s || '…'; });
    imgf.wire(q('#imgHost'), m => showErrors(box, [m]), () => { dirty = true; });
    q('#tCancel').onclick = () => BA.closeModal();
    q('#tform').addEventListener('submit', async ev => {
      ev.preventDefault();
      const errs = []; if (!val('title')) errs.push('Le titre est obligatoire.'); if (!splitList(val('keywords')).length) errs.push('Ajoute au moins un mot-clé pour relier des animaux à cette page.');
      const u = imgf.urlError(); if (u) errs.push(u);
      if (errs.length) { showErrors(box, errs); return; }
      const d = BA.data;
      const o = { id: t.id, title: val('title'), description: val('description'), keywordIds: splitList(val('keywords')).map(l => BA.ensureKeyword(d, l)).filter(Boolean), image: await imgf.commit() };
      o.slug = BA.uniqueSlug(d.themes, val('slug') || o.title, o.id);
      if (isNew) d.themes.push(o); else d.themes[d.themes.findIndex(x => x.id === o.id)] = o;
      dirty = false; BA.touch(); BA.closeModal(true); BA.toast('Page thématique enregistrée.', 'ok');
      if (!isNew && location.hash.startsWith('#/themes/')) location.hash = '#/themes/' + o.slug;
    });
  };
  async function deleteTheme(id) {
    const t = BA.data.themes.find(x => x.id === id); if (!t) return;
    if (!await BA.confirm({ title: 'Supprimer cette page ?', message: '« ' + t.title + ' » sera supprimée. Les animaux et mots-clés ne sont pas touchés.', confirmLabel: 'Supprimer', danger: true })) return;
    if (t.image && t.image.imageId) await BA.img.del(t.image.imageId);
    BA.data.themes = BA.data.themes.filter(x => x.id !== id); BA.touch();
    if (location.hash.startsWith('#/themes/')) location.hash = '#/themes';
  }

  /* ---------- Vue d'administration ---------- */
  BA.adminTab = 'animals';
  const TABS = [['animals', 'Animaux'], ['tax', 'Catégories & familles'], ['regions', 'Régions'], ['themes', 'Thèmes'], ['data', 'Données & sauvegardes']];
  let adminQ = '';
  BA.views.admin = async function (root) {
    const d = BA.data;
    let body = '';
    if (BA.adminTab === 'animals') {
      const list = d.animals.filter(a => !adminQ || BA.hay(a).includes(norm(adminQ))).sort((a, b) => a.common.localeCompare(b.common, 'fr')).slice(0, 200);
      body = `<div class="vtools"><input id="admQ" type="search" placeholder="Filtrer…" value="${esc(adminQ)}" aria-label="Filtrer les fiches"><button type="button" class="btn primary" data-act="new-animal">+ Nouvelle fiche</button></div>
        <table class="tbl"><thead><tr><th>Nom</th><th>Catégorie</th><th>Famille</th><th>Régions</th><th></th></tr></thead><tbody>${list.map(a => `<tr><td><a href="#/animal/${esc(a.slug)}">${esc(a.common)}</a><br><em class="sci">${esc(a.scientific)}</em></td><td>${esc((BA.cat(a.categoryId) || {}).name || '')}</td><td>${esc((BA.fam(a.familyId) || {}).name || '')}</td><td>${a.distribution.length}</td>
        <td class="act"><button type="button" class="btn small" data-act="edit-animal" data-id="${a.id}">✎</button> <button type="button" class="btn small danger" data-act="del-animal" data-id="${a.id}" aria-label="Supprimer ${esc(a.common)}">🗑</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune fiche.</td></tr>'}</tbody></table>
        ${d.animals.length > 200 ? '<p class="note">200 premières fiches affichées : utilise le filtre.</p>' : ''}`;
    } else if (BA.adminTab === 'tax') {
      const used = (k, id) => d.animals.filter(a => a[k] === id).length;
      body = `<p class="hint">Les catégories et familles ne sont pas figées : ajoute-les, renomme-les, ou supprime celles qui ne servent plus.</p>
        <h3>Grandes catégories</h3><ul class="plist">${d.categories.map(c => `<li><input value="${esc(c.name)}" data-tx="cat" data-id="${c.id}" aria-label="Nom de la catégorie"><span class="muted">${used('categoryId', c.id)} fiche(s)</span><button type="button" class="btn small" data-act="tx-save" data-kind="cat" data-id="${c.id}">Renommer</button><button type="button" class="btn small danger" data-act="tx-del" data-kind="cat" data-id="${c.id}">Supprimer</button></li>`).join('')}</ul>
        <div class="distrow"><input id="newCat" placeholder="Nouvelle catégorie…" aria-label="Nouvelle catégorie"><button type="button" class="btn" data-act="tx-add" data-kind="cat">Ajouter</button></div>
        <h3>Familles zoologiques</h3><ul class="plist">${d.families.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(f => `<li><input value="${esc(f.name)}" data-tx="fam" data-id="${f.id}" aria-label="Nom de la famille"><select data-txc="${f.id}" aria-label="Catégorie de la famille"><option value="">(aucune)</option>${d.categories.map(c => `<option value="${c.id}"${f.categoryId === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select><span class="muted">${used('familyId', f.id)} fiche(s)</span><button type="button" class="btn small" data-act="tx-save" data-kind="fam" data-id="${f.id}">Enregistrer</button><button type="button" class="btn small danger" data-act="tx-del" data-kind="fam" data-id="${f.id}">Supprimer</button></li>`).join('')}</ul>
        <div class="distrow"><input id="newFam" placeholder="Nouvelle famille…" aria-label="Nouvelle famille"><select id="newFamCat" aria-label="Catégorie">${d.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button type="button" class="btn" data-act="tx-add" data-kind="fam">Ajouter</button></div>
        <h3>Mots-clés</h3><ul class="plist">${d.keywords.slice().sort((a, b) => a.label.localeCompare(b.label, 'fr')).map(k => `<li><input value="${esc(k.label)}" data-tx="kw" data-id="${k.id}" aria-label="Mot-clé"><span class="muted">${d.animals.filter(a => a.keywordIds.includes(k.id)).length} fiche(s)</span><button type="button" class="btn small" data-act="tx-save" data-kind="kw" data-id="${k.id}">Renommer</button><button type="button" class="btn small danger" data-act="tx-del" data-kind="kw" data-id="${k.id}">Supprimer</button></li>`).join('') || '<li class="muted">Aucun mot-clé.</li>'}</ul>`;
    } else if (BA.adminTab === 'regions') {
      body = `<p class="hint">Chaque pays ou continent a automatiquement sa page (<code>#/regions/nom</code>) listant ses animaux. Ici tu peux ajouter une description et une image.</p>
        ${regionDatalist()}<div class="distrow"><input id="regIn" list="dl-reg" placeholder="Choisir un pays ou un continent…" aria-label="Région"><button type="button" class="btn primary" data-act="reg-new">Créer / modifier sa page</button></div>
        <ul class="plist">${Object.keys(d.regionPages).map(id => `<li><a href="#/regions/${esc((BA.regions.get(id) || {}).slug || '')}">${esc(BA.regionName(id))}</a><span class="muted">${BA.regionCount(id)} animaux</span><button type="button" class="btn small" data-act="edit-region" data-id="${esc(id)}">✎ Modifier</button></li>`).join('') || '<li class="muted">Aucune page personnalisée.</li>'}</ul>`;
    } else if (BA.adminTab === 'themes') {
      body = `<div class="vtools"><button type="button" class="btn primary" data-act="new-theme">+ Nouvelle page thématique</button></div>
        <ul class="plist">${d.themes.map(t => `<li><a href="#/themes/${esc(t.slug)}">${esc(t.title)}</a><span class="muted">${t.keywordIds.map(k => '#' + ((BA.kw(k) || {}).label || '?')).join(' ')} · ${BA.themeAnimals(t).length} animaux</span><button type="button" class="btn small" data-act="edit-theme" data-id="${t.id}">✎</button><button type="button" class="btn small danger" data-act="del-theme" data-id="${t.id}">🗑</button></li>`).join('') || '<li class="muted">Aucune page thématique.</li>'}</ul>`;
    } else {
      const imgs = await BA.storage.listImages();
      body = `<div class="callout"><h3>Où sont mes données ?</h3>
        <p><strong>Mode local (actuel)</strong> : tout est enregistré dans <em>ce navigateur, sur cet appareil</em> (${BA.persistent ? 'IndexedDB' : '⚠ mémoire temporaire : IndexedDB est indisponible, exporte tes données !'}). Rien n'est envoyé sur internet.
        Les visiteurs de ton site GitHub Pages ne voient donc <strong>pas</strong> tes modifications : chacun a sa propre copie locale.</p>
        <p><strong>Mode connecté (plus tard)</strong> : pour partager la bibliothèque entre appareils et visiteurs, il faudra une base de données et un stockage d'images distants avec connexion sécurisée. Le code est organisé pour cela (voir README).</p>
        <p>Contenu actuel : ${d.animals.length} fiches, ${imgs.length} photo(s) stockée(s).</p></div>
        <div class="vtools wrapt"><button type="button" class="btn primary" data-act="export" data-img="1">⬇ Exporter (avec photos)</button><button type="button" class="btn" data-act="export" data-img="0">⬇ Exporter (sans photos, plus léger)</button>
        <label class="btn">⬆ Importer un fichier<input id="impFile" type="file" accept="application/json,.json" hidden></label>
        <button type="button" class="btn" data-act="orphans">🧹 Supprimer les photos inutilisées</button><button type="button" class="btn danger" data-act="reset">Réinitialiser (données de départ)</button></div>`;
    }
    root.innerHTML = `<div class="vhead"><a class="back" href="#/">← Globe</a><h1 tabindex="-1">Administration</h1></div>
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" class="tab${BA.adminTab === k ? ' on' : ''}" aria-selected="${BA.adminTab === k}" data-act="admin-tab" data-v="${k}">${l}</button>`).join('')}</div>${body}`;
    const aq = $('#admQ');
    if (aq) { aq.addEventListener('input', e => { adminQ = e.target.value; clearTimeout(aq._t); aq._t = setTimeout(() => { BA.views.admin(root).then(() => { const n = $('#admQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 200); }); }
    const imp = $('#impFile');
    if (imp) imp.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      let text; try { text = await f.text(); JSON.parse(text); } catch (err) { BA.toast('Ce fichier n\'est pas un JSON valide.', 'error'); return; }
      if (!await BA.confirm({ title: 'Remplacer toutes les données ?', message: 'Le contenu actuel sera remplacé par celui du fichier. Une sauvegarde automatique sera téléchargée avant l\'import.', confirmLabel: 'Importer', danger: true })) return;
      try { await BA.exportData(true); await BA.importData(text); BA.toast('Import terminé.', 'ok'); } catch (err) { BA.toast('Import impossible : ' + err.message, 'error'); }
    });
  };

  /* ---------- Actions (boutons data-act) ---------- */
  Object.assign(BA.actions, {
    'new-animal': d => { const p = {}; if (d.region) p.distribution = [{ region: d.region, status: 'native' }]; else if (BA.currentRegion && !document.body.classList.contains('in-view') && !$('#drawer').classList.contains('hidden')) p.distribution = [{ region: BA.currentRegion, status: 'native' }]; BA.openAnimalForm(null, p); },
    'edit-animal': d => BA.openAnimalForm(d.id),
    'del-animal': d => deleteAnimal(d.id),
    'edit-region': d => BA.openRegionForm(d.id),
    'reg-new': () => { const r = regionByName($('#regIn').value); if (!r) { BA.toast('Choisis un pays ou un continent dans la liste.', 'error'); return; } BA.openRegionForm(r.id); },
    'new-theme': () => BA.openThemeForm(null),
    'edit-theme': d => BA.openThemeForm(d.id),
    'del-theme': d => deleteTheme(d.id),
    'admin-tab': d => { BA.adminTab = d.v; BA.route(); },
    'export': async d => { await BA.exportData(d.img === '1'); BA.toast('Sauvegarde téléchargée.', 'ok'); },
    'orphans': async () => {
      const used = new Set(); const add = i => { if (i && i.imageId) used.add(i.imageId); };
      BA.data.animals.forEach(a => add(a.image)); BA.data.themes.forEach(t => add(t.image)); Object.values(BA.data.regionPages).forEach(p => add(p.image));
      let n = 0; for (const id of await BA.storage.listImages()) if (!used.has(id)) { await BA.img.del(id); n++; }
      BA.toast(n + ' photo(s) inutilisée(s) supprimée(s).'); BA.route();
    },
    'reset': async () => {
      if (!await BA.confirm({ title: 'Tout réinitialiser ?', message: 'Toutes tes fiches, photos et pages seront remplacées par les données de départ. Exporte une sauvegarde d\'abord si tu veux pouvoir revenir en arrière.', confirmLabel: 'Réinitialiser', danger: true, backup: true })) return;
      await BA.resetAll(); BA.toast('Données réinitialisées.');
    },
    'tx-add': d => {
      const D = BA.data;
      if (d.kind === 'cat') { const v = $('#newCat').value.trim(); if (!v) return; BA.ensureCategory(D, v); }
      else { const v = $('#newFam').value.trim(); if (!v) return; BA.ensureFamily(D, v, $('#newFamCat').value); }
      BA.touch();
    },
    'tx-save': d => {
      const D = BA.data, li = document.querySelector(`[data-tx="${d.kind}"][data-id="${d.id}"]`), v = li.value.trim();
      if (!v) { BA.toast('Le nom ne peut pas être vide.', 'error'); return; }
      const list = d.kind === 'cat' ? D.categories : d.kind === 'fam' ? D.families : D.keywords, item = list.find(x => x.id === d.id);
      const key = d.kind === 'kw' ? 'label' : 'name';
      if (list.some(x => x.id !== d.id && norm(x[key]) === norm(v))) { BA.toast('Ce nom existe déjà.', 'error'); return; }
      item[key] = v;
      if (d.kind === 'fam') { const s = document.querySelector(`[data-txc="${d.id}"]`); if (s) item.categoryId = s.value; }
      BA.touch(); BA.toast('Enregistré.', 'ok');
    },
    'tx-del': async d => {
      const D = BA.data;
      if (d.kind === 'cat') { if (D.animals.some(a => a.categoryId === d.id)) { BA.toast('Cette catégorie est utilisée par des fiches : change-les d\'abord.', 'error'); return; } if (!confirm('Supprimer cette catégorie ?')) return; D.categories = D.categories.filter(x => x.id !== d.id); D.families.forEach(f => { if (f.categoryId === d.id) f.categoryId = ''; }); }
      else if (d.kind === 'fam') { if (D.animals.some(a => a.familyId === d.id)) { BA.toast('Cette famille est utilisée par des fiches : change-les d\'abord.', 'error'); return; } if (!confirm('Supprimer cette famille ?')) return; D.families = D.families.filter(x => x.id !== d.id); }
      else { if (!confirm('Supprimer ce mot-clé ? Il sera retiré des fiches et des pages thématiques.')) return; D.keywords = D.keywords.filter(x => x.id !== d.id); D.animals.forEach(a => { a.keywordIds = a.keywordIds.filter(k => k !== d.id); }); D.themes.forEach(t => { t.keywordIds = t.keywordIds.filter(k => k !== d.id); }); }
      BA.touch();
    }
  });
})(window.BA);
