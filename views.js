/* Affichage : cartes, bibliothèque, fiches, pages de régions et de thèmes, recherche, fenêtres */
window.BA = window.BA || {};
(function (BA) {
  const { esc, norm } = BA.u;
  const $ = s => document.querySelector(s);
  const nl = s => esc(s).replace(/\n/g, '<br>');
  BA.admin = false;
  BA.actions = {};
  BA.views = {};
  BA.ui = { cat: '', fam: '', kw: '', q: '', region: '', page: 1 };
  const PAGE = 24;

  const PAW = '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="currentColor"><ellipse cx="14" cy="28" rx="7" ry="9"/><ellipse cx="27" cy="16" rx="7" ry="10"/><ellipse cx="42" cy="16" rx="7" ry="10"/><ellipse cx="54" cy="28" rx="7" ry="9"/><path d="M32 30c-9 0-18 10-18 19 0 7 6 9 11 8 4-1 5-2 7-2s3 1 7 2c5 1 11-1 11-8 0-9-9-19-18-19z"/></g></svg>';
  BA.PAW = PAW;

  /* ---------- Petits outils d'interface ---------- */
  BA.toast = function (msg, type) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show ' + (type || '');
    clearTimeout(BA.toast._t); BA.toast._t = setTimeout(() => { t.className = ''; }, 3500);
  };
  let modalGuard = null, lastFocus = null;
  BA.openModal = function (html, opts) {
    opts = opts || {};
    lastFocus = document.activeElement;
    const box = $('#modalBox');
    box.className = 'modal-box' + (opts.wide ? ' wide' : '');
    box.innerHTML = html;
    modalGuard = opts.guard || null;
    $('#modal').classList.remove('hidden');
    const f = box.querySelector('[autofocus],input,textarea,button'); if (f) f.focus();
    return box;
  };
  BA.closeModal = function (force) {
    if (!force && modalGuard && !modalGuard()) return false;
    modalGuard = null; $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
    return true;
  };
  BA.confirm = function (o) {
    return new Promise(res => {
      const box = BA.openModal(`<h3>${esc(o.title)}</h3><p>${esc(o.message)}</p>
        <div class="foot">${o.backup ? '<button type="button" class="btn" id="cfBackup">⬇ Exporter une sauvegarde d\'abord</button>' : ''}
        <button type="button" class="btn" id="cfNo">Annuler</button>
        <button type="button" class="btn ${o.danger ? 'danger solid' : 'primary'}" id="cfYes">${esc(o.confirmLabel || 'Confirmer')}</button></div>`, { guard: () => { res(false); return true; } });
      box.querySelector('#cfNo').onclick = () => { BA.closeModal(true); res(false); };
      box.querySelector('#cfYes').onclick = () => { BA.closeModal(true); res(true); };
      const b = box.querySelector('#cfBackup'); if (b) b.onclick = () => BA.exportData(true);
    });
  };

  /* ---------- Photos ---------- */
  const placeholder = (cls) => `<div class="ph ${cls || ''}" role="img" aria-label="Pas encore de photographie">${PAW}</div>`;
  BA.photo = function (img, alt, opts) {
    opts = opts || {};
    if (opts.previewSrc) return `<img class="photo" src="${esc(opts.previewSrc)}" alt="${esc(alt)}">`;
    if (img && img.imageId) return `<img class="photo" data-imgid="${esc(img.imageId)}" alt="${esc(img.alt || alt)}" loading="lazy">`;
    if (img && img.url) return `<img class="photo" src="${esc(img.url)}" alt="${esc(img.alt || alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    return placeholder();
  };
  BA.hydrate = function (root) {
    (root || document).querySelectorAll('img[data-imgid]').forEach(async im => {
      const id = im.dataset.imgid; im.removeAttribute('data-imgid');
      const u = await BA.img.url(id);
      if (u) im.src = u; else im.replaceWith(Object.assign(document.createElement('div'), { className: 'ph', innerHTML: PAW }));
    });
  };
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('photo')) {
      const d = document.createElement('div'); d.className = 'ph'; d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'Image indisponible'); d.innerHTML = PAW;
      t.replaceWith(d);
    }
  }, true);

  /* ---------- Cartes ---------- */
  BA.cardHTML = function (a) {
    const cat = BA.cat(a.categoryId), fam = BA.fam(a.familyId);
    const region = a.distribution[0] ? BA.regionName(a.distribution[0].region) : '';
    const text = a.cardText || a.summary || '';
    const tools = BA.admin ? `<div class="card-tools"><button type="button" class="btn small" data-act="edit-animal" data-id="${a.id}" aria-label="Modifier ${esc(a.common)}">✎</button><button type="button" class="btn small danger" data-act="del-animal" data-id="${a.id}" aria-label="Supprimer ${esc(a.common)}">🗑</button></div>` : '';
    return `<div class="card-wrap"><a class="card" href="#/animal/${esc(a.slug)}">
      <div class="pic">${BA.photo(a.image, a.common)}</div>
      <div class="body"><h3>${esc(a.common)}</h3>${a.scientific ? `<em class="sci">${esc(a.scientific)}</em>` : ''}
      <div class="meta">${[cat && cat.name, fam && fam.name].filter(Boolean).map(esc).join(' · ')}</div>
      ${region ? `<div class="where">📍 ${esc(region)}</div>` : ''}${text ? `<p>${esc(text)}</p>` : ''}</div></a>${tools}</div>`;
  };
  const sortAnimals = l => l.slice().sort((a, b) => a.common.localeCompare(b.common, 'fr'));

  /* ---------- Bibliothèque ---------- */
  function filtered() {
    const u = BA.ui, q = norm(u.q);
    let list = BA.data.animals;
    if (u.region) { const ids = new Set(BA.animalsInRegion(u.region).map(a => a.id)); list = list.filter(a => ids.has(a.id)); }
    return sortAnimals(list.filter(a =>
      (!u.cat || a.categoryId === u.cat) && (!u.fam || a.familyId === u.fam) && (!u.kw || a.keywordIds.includes(u.kw)) &&
      (!q || BA.hay(a).includes(q))));
  }
  function updateLibrary() {
    const u = BA.ui, d = BA.data, list = filtered();
    const chip = (act, v, label, on, n) => `<button type="button" class="chip${on ? ' on' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`;
    const counts = {}; d.animals.forEach(a => { counts[a.categoryId] = (counts[a.categoryId] || 0) + 1; });
    const fams = d.families.filter(f => (!u.cat || f.categoryId === u.cat) && d.animals.some(a => a.familyId === f.id && (!u.cat || a.categoryId === u.cat)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const active = u.cat || u.fam || u.kw || u.q || u.region;
    $('#libFilters').innerHTML =
      `<div class="chips" role="group" aria-label="Grandes catégories">${chip('lib-cat', '', 'Tout', !u.cat, d.animals.length)}${d.categories.filter(c => counts[c.id] || BA.admin).map(c => chip('lib-cat', c.id, c.name, u.cat === c.id, counts[c.id] || 0)).join('')}</div>` +
      (fams.length ? `<div class="chips small" role="group" aria-label="Familles">${chip('lib-fam', '', 'Toutes les familles', !u.fam)}${fams.map(f => chip('lib-fam', f.id, f.name, u.fam === f.id)).join('')}</div>` : '') +
      `<div class="chips small">${u.kw ? `<button type="button" class="chip kw on" data-act="lib-kw" data-v="">#${esc((BA.kw(u.kw) || {}).label)} ✕</button>` : ''}${u.region ? `<button type="button" class="chip on" data-act="lib-region" data-v="">📍 ${esc(BA.regionName(u.region))} ✕</button>` : ''}${active ? '<button type="button" class="chip reset" data-act="lib-reset">↺ Réinitialiser les filtres</button>' : ''}</div>`;
    const shown = list.slice(0, u.page * PAGE);
    $('#libCount').textContent = list.length + ' animal' + (list.length > 1 ? 'aux' : '') + (list.length > shown.length ? ' · ' + shown.length + ' affichés' : '');
    $('#libGrid').innerHTML = shown.length ? shown.map(BA.cardHTML).join('') :
      `<div class="empty"><p>Aucun animal ne correspond à ces filtres.</p>${active ? '<button type="button" class="btn" data-act="lib-reset">Réinitialiser les filtres</button>' : ''}${BA.admin ? '<button type="button" class="btn primary" data-act="new-animal">+ Ajouter une fiche</button>' : ''}</div>`;
    $('#libMore').innerHTML = list.length > shown.length ? '<button type="button" class="btn" data-act="lib-more">Afficher plus</button>' : '';
    BA.hydrate($('#libGrid'));
  }
  BA.views.library = function (root) {
    root.innerHTML = `<div class="vhead"><a class="back" href="#/">← Globe</a><h1 tabindex="-1">Bibliothèque</h1>
      <div class="vtools"><label class="sr" for="libq">Filtrer la bibliothèque</label><input id="libq" type="search" placeholder="Nom, famille, région, mot-clé…" value="${esc(BA.ui.q)}" autocomplete="off">
      ${BA.admin ? '<button type="button" class="btn primary" data-act="new-animal">+ Nouvelle fiche</button>' : ''}</div></div>
      <div id="libFilters"></div><div id="libCount" class="count" aria-live="polite"></div><div id="libGrid" class="cards"></div><div id="libMore" class="more"></div>`;
    let t; $('#libq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { BA.ui.q = e.target.value; BA.ui.page = 1; updateLibrary(); }, 150); });
    updateLibrary();
  };
  Object.assign(BA.actions, {
    'lib-cat': d => { BA.ui.cat = d.v; BA.ui.fam = ''; BA.ui.page = 1; updateLibrary(); },
    'lib-fam': d => { BA.ui.fam = d.v; BA.ui.page = 1; updateLibrary(); },
    'lib-kw': d => { BA.ui.kw = d.v; BA.ui.page = 1; updateLibrary(); },
    'lib-region': d => { BA.ui.region = d.v; BA.ui.page = 1; updateLibrary(); },
    'lib-reset': () => { BA.ui = { cat: '', fam: '', kw: '', q: '', region: '', page: 1 }; const i = $('#libq'); if (i) i.value = ''; updateLibrary(); },
    'lib-more': () => { BA.ui.page++; updateLibrary(); },
    'open-lib': d => { BA.ui = { cat: d.cat || '', fam: d.fam || '', kw: d.kw || '', q: '', region: d.region || '', page: 1 }; const same = location.hash === '#/bibliotheque'; location.hash = '#/bibliotheque'; if (same) BA.route(); }
  });

  /* ---------- Fiche détaillée ---------- */
  const facts = rows => { rows = rows.filter(r => r[1] && String(r[1]).trim()); return rows.length ? `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${nl(v)}</dd>`).join('')}</dl>` : ''; };
  const sec = (title, inner) => inner ? `<section class="fsec"><h2>${esc(title)}</h2>${inner}</section>` : '';
  const regionLink = id => { const r = BA.regions.get(id); return r ? `<a class="chip" href="#/regions/${esc(r.slug)}">📍 ${esc(r.name)}</a>` : `<span class="chip">${esc(id)}</span>`; };

  BA.ficheHTML = function (a, opts) {
    opts = opts || {};
    const nm = opts.names;
    const cat = nm ? (nm.cat ? { name: nm.cat } : null) : BA.cat(a.categoryId), fam = nm ? (nm.fam ? { name: nm.fam } : null) : BA.fam(a.familyId), f = a.fields || {}, g = a.geo || {}, c = a.conservation || {};
    const im = a.image || {};
    const credit = (im.credit || im.source) ? `<figcaption>${im.credit ? 'Photo : ' + esc(im.credit) : ''}${im.credit && im.source ? ' · ' : ''}${im.source ? 'Source : ' + esc(im.source) : ''}</figcaption>` : '';
    const ident = facts([['Autres noms', (a.otherNames || []).join(', ')], ['Catégorie', cat && cat.name], ['Famille', fam && fam.name], ['Genre', a.genus], ['Ordre', a.order], ['Remarques taxonomiques', a.taxoNote]]);
    const desc = facts(BA.schema.desc.map(([k, l]) => [l, f[k]]));
    let geo = '';
    ['native', 'seasonal', 'introduced'].forEach(s => {
      const items = a.distribution.filter(d => d.status === s);
      if (items.length) geo += `<h3>${esc(BA.schema.statuses[s])}</h3><div class="chips">${items.map(d => regionLink(d.region)).join('')}</div>`;
    });
    geo += facts([['Habitats', g.habitats], ['Aire de répartition', g.range], ['Informations complémentaires', g.more]]);
    if (a.distribution.length) geo += '<p class="note">Répartition saisie manuellement dans BiblioAnimal : elle n\'est pas vérifiée scientifiquement sauf si une source est indiquée.</p>';
    const cons = facts(BA.schema.cons.map(([k, l]) => [l, c[k]]));
    const custom = (a.sections || []).filter(s => (s.title || s.body) && String(s.body || '').trim()).map(s => sec(s.title || 'Section',
      s.kind === 'list' ? `<ul>${String(s.body).split('\n').filter(x => x.trim()).map(x => `<li>${esc(x.replace(/^[-•*]\s*/, ''))}</li>`).join('')}</ul>`
        : String(s.body).split(/\n{2,}/).map(p => `<p>${nl(p)}</p>`).join(''))).join('');
    const kws = nm ? nm.kws.map(l => ({ id: l, label: l })) : a.keywordIds.map(k => BA.kw(k)).filter(Boolean);
    return `<article class="fiche">
      <figure class="hero">${BA.photo(a.image, a.common, opts)}${credit}</figure>
      <div class="fhead"><h1 tabindex="-1">${esc(a.common || 'Sans nom')}</h1>${a.scientific ? `<p class="sci big">${esc(a.scientific)}</p>` : ''}
      <div class="chips">${cat ? `<span class="chip">${esc(cat.name)}</span>` : ''}${fam ? `<span class="chip">${esc(fam.name)}</span>` : ''}
      ${kws.map(k => opts.preview ? `<span class="chip kw">#${esc(k.label)}</span>` : `<button type="button" class="chip kw" data-act="open-lib" data-kw="${esc(k.id)}">#${esc(k.label)}</button>`).join('')}</div>
      ${a.summary ? `<p class="lead">${nl(a.summary)}</p>` : ''}</div>
      ${sec('Identification', ident)}${sec('Description', desc)}${sec('Géographie', geo)}${sec('Conservation', cons)}${custom}</article>`;
  };
  BA.views.animal = function (root, slug) {
    const a = BA.animalBySlug(slug);
    if (!a) return BA.views.notFound(root, 'Cette fiche n\'existe pas (ou plus).');
    root.innerHTML = `<div class="vhead"><a class="back" href="#/bibliotheque">← Bibliothèque</a>
      ${BA.admin ? `<div class="vtools"><button type="button" class="btn" data-act="edit-animal" data-id="${a.id}">✎ Modifier</button><button type="button" class="btn danger" data-act="del-animal" data-id="${a.id}">🗑 Supprimer</button></div>` : ''}</div>${BA.ficheHTML(a)}`;
    BA.hydrate(root);
    document.title = a.common + ' — BiblioAnimal';
  };

  /* ---------- Pages régionales ---------- */
  BA.views.region = function (root, rid) {
    const r = BA.regions.get(rid), page = BA.data.regionPages[rid] || {};
    const list = sortAnimals(BA.animalsInRegion(rid));
    const cats = {}, kws = {};
    list.forEach(a => { cats[a.categoryId] = (cats[a.categoryId] || 0) + 1; a.keywordIds.forEach(k => { kws[k] = (kws[k] || 0) + 1; }); });
    const parent = r.type === 'country' && BA.regions.get(r.continentId);
    root.innerHTML = `<div class="vhead"><a class="back" href="#/">← Globe</a>
      <div class="vtools"><button type="button" class="btn" data-act="show-on-globe" data-id="${rid}">🌍 Voir sur le globe</button>
      ${BA.admin ? `<button type="button" class="btn primary" data-act="edit-region" data-id="${rid}">✎ Modifier cette page</button><button type="button" class="btn" data-act="new-animal" data-region="${rid}">+ Ajouter un animal ici</button>` : ''}</div></div>
      <header class="rhead">${page.image ? `<figure class="hero small">${BA.photo(page.image, r.name)}${page.image.credit || page.image.source ? `<figcaption>${page.image.credit ? 'Photo : ' + esc(page.image.credit) : ''}${page.image.source ? ' · Source : ' + esc(page.image.source) : ''}</figcaption>` : ''}</figure>` : ''}
      <div><p class="eyebrow">${r.type === 'continent' ? 'Continent' : 'Pays'}${parent ? ' · <a href="#/regions/' + esc(parent.slug) + '">' + esc(parent.name) + '</a>' : ''}</p>
      <h1 tabindex="-1">${esc(r.name)}</h1><p class="count">${list.length} animal${list.length > 1 ? 'aux' : ''} référencé${list.length > 1 ? 's' : ''}</p>
      ${page.description ? `<p class="lead">${nl(page.description)}</p>` : (BA.admin ? '<p class="note">Aucune description : utilise « Modifier cette page ».</p>' : '')}</div></header>
      ${page.info ? sec('Informations géographiques', `<p>${nl(page.info)}</p>`) : ''}
      ${Object.keys(cats).length ? `<h2>Catégories et familles représentées</h2><div class="chips">${Object.keys(cats).map(id => `<button type="button" class="chip" data-act="open-lib" data-cat="${esc(id)}" data-region="${esc(rid)}">${esc((BA.cat(id) || {}).name || '?')} <span class="n">${cats[id]}</span></button>`).join('')}</div>
      <div class="chips small">${[...new Set(list.map(a => a.familyId).filter(Boolean))].map(id => `<button type="button" class="chip" data-act="open-lib" data-fam="${esc(id)}" data-region="${esc(rid)}">${esc((BA.fam(id) || {}).name || '?')}</button>`).join('')}</div>` : ''}
      ${Object.keys(kws).length ? `<h2>Mots-clés</h2><div class="chips">${Object.keys(kws).map(k => `<button type="button" class="chip kw" data-act="open-lib" data-kw="${esc(k)}" data-region="${esc(rid)}">#${esc((BA.kw(k) || {}).label)} <span class="n">${kws[k]}</span></button>`).join('')}</div>` : ''}
      <h2>Animaux</h2><div class="cards">${list.map(BA.cardHTML).join('') || `<div class="empty"><p>Aucun animal n'est encore associé à cette région.</p>${BA.admin ? `<button type="button" class="btn primary" data-act="new-animal" data-region="${rid}">+ Ajouter une fiche</button>` : '<p class="note">Active le mode édition (✎) pour ajouter des fiches.</p>'}</div>`}</div>`;
    BA.hydrate(root);
    document.title = r.name + ' — BiblioAnimal';
  };

  /* ---------- Pages thématiques ---------- */
  BA.views.themes = function (root) {
    root.innerHTML = `<div class="vhead"><a class="back" href="#/">← Globe</a><h1 tabindex="-1">Pages thématiques</h1>
      ${BA.admin ? '<div class="vtools"><button type="button" class="btn primary" data-act="new-theme">+ Nouvelle page thématique</button></div>' : ''}</div>
      <div class="cards">${BA.data.themes.map(t => `<div class="card-wrap"><a class="card" href="#/themes/${esc(t.slug)}"><div class="pic">${BA.photo(t.image, t.title)}</div><div class="body"><h3>${esc(t.title)}</h3><div class="meta">${BA.themeAnimals(t).length} animaux</div>${t.description ? `<p>${esc(t.description)}</p>` : ''}</div></a></div>`).join('') || '<div class="empty"><p>Aucune page thématique pour l\'instant.</p></div>'}</div>`;
    BA.hydrate(root);
  };
  BA.views.theme = function (root, slug) {
    const t = BA.themeBySlug(slug);
    if (!t) return BA.views.notFound(root, 'Cette page thématique n\'existe pas.');
    const list = sortAnimals(BA.themeAnimals(t));
    root.innerHTML = `<div class="vhead"><a class="back" href="#/themes">← Thèmes</a>
      ${BA.admin ? `<div class="vtools"><button type="button" class="btn primary" data-act="edit-theme" data-id="${t.id}">✎ Modifier</button><button type="button" class="btn danger" data-act="del-theme" data-id="${t.id}">🗑 Supprimer</button></div>` : ''}</div>
      <header class="rhead">${t.image ? `<figure class="hero small">${BA.photo(t.image, t.title)}</figure>` : ''}<div><p class="eyebrow">Thème</p><h1 tabindex="-1">${esc(t.title)}</h1>
      <p class="count">${list.length} animal${list.length > 1 ? 'aux' : ''}</p>${t.description ? `<p class="lead">${nl(t.description)}</p>` : ''}
      <div class="chips">${t.keywordIds.map(k => `<button type="button" class="chip kw" data-act="open-lib" data-kw="${esc(k)}">#${esc((BA.kw(k) || {}).label)}</button>`).join('')}</div></div></header>
      <div class="cards">${list.map(BA.cardHTML).join('') || '<div class="empty"><p>Aucun animal ne porte encore ces mots-clés.</p></div>'}</div>`;
    BA.hydrate(root);
    document.title = t.title + ' — BiblioAnimal';
  };
  BA.views.notFound = function (root, msg) {
    root.innerHTML = `<div class="vhead"><a class="back" href="#/">← Globe</a></div><div class="empty"><h1 tabindex="-1">Page introuvable</h1><p>${esc(msg || '')}</p><a class="btn" href="#/bibliotheque">Ouvrir la bibliothèque</a></div>`;
  };

  /* ---------- Recherche globale ---------- */
  BA.search = function (raw) {
    const q = norm(raw), d = BA.data;
    if (!q) return null;
    const has = s => norm(s).includes(q);
    const animals = d.animals.filter(a => BA.hay(a).includes(q)).sort((a, b) => (norm(a.common).startsWith(q) ? 0 : 1) - (norm(b.common).startsWith(q) ? 0 : 1)).slice(0, 8);
    const regions = [...BA.regions.values()].filter(r => has(r.name)).slice(0, 6);
    const cats = d.categories.filter(c => has(c.name)).slice(0, 4);
    const fams = d.families.filter(f => has(f.name)).slice(0, 5);
    const kws = d.keywords.filter(k => has(k.label)).slice(0, 5);
    const themes = d.themes.filter(t => has(t.title)).slice(0, 4);
    return { animals, regions, cats, fams, kws, themes, total: animals.length + regions.length + cats.length + fams.length + kws.length + themes.length };
  };
  BA.searchHTML = function (r, raw) {
    if (!r) return '';
    if (!r.total) return `<div class="sr-empty">Aucun résultat pour « ${esc(raw)} ». Essaie un nom commun, scientifique, une famille ou un pays.${BA.admin ? ' <button type="button" class="chip" data-act="new-animal">+ Créer cette fiche</button>' : ''}</div>`;
    const item = (act, attrs, label, sub) => `<button type="button" class="item" role="option" data-act="${act}" ${attrs}>${label}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
    let h = '';
    if (r.animals.length) h += '<div class="group">Animaux</div>' + r.animals.map(a => item('go-animal', `data-slug="${esc(a.slug)}"`, esc(a.common), a.scientific || (BA.fam(a.familyId) || {}).name)).join('');
    if (r.regions.length) h += '<div class="group">Pays et régions</div>' + r.regions.map(x => item('go-region', `data-id="${esc(x.id)}"`, '📍 ' + esc(x.name), BA.regionCount(x.id) + ' animaux')).join('');
    if (r.cats.length) h += '<div class="group">Catégories</div>' + r.cats.map(x => item('open-lib', `data-cat="${esc(x.id)}"`, esc(x.name))).join('');
    if (r.fams.length) h += '<div class="group">Familles</div>' + r.fams.map(x => item('open-lib', `data-fam="${esc(x.id)}"`, esc(x.name))).join('');
    if (r.kws.length) h += '<div class="group">Mots-clés</div>' + r.kws.map(x => item('open-lib', `data-kw="${esc(x.id)}"`, '#' + esc(x.label))).join('');
    if (r.themes.length) h += '<div class="group">Pages thématiques</div>' + r.themes.map(x => item('go-theme', `data-slug="${esc(x.slug)}"`, esc(x.title))).join('');
    return h;
  };
})(window.BA);
