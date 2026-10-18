/* Démarrage, routage (adresses en #/…), tiroir de région, recherche, mode édition */
window.BA = window.BA || {};
(function (BA) {
  const { esc } = BA.u;
  const $ = s => document.querySelector(s);
  BA.currentRegion = null;
  BA.pending = null;
  let drawerCat = '';
  let routeTok = 0;

  /* ---------- Mode édition ---------- */
  function setAdmin(on) {
    BA.admin = on;
    try { sessionStorage.setItem('ba-admin', on ? '1' : ''); } catch (e) { /* ignore */ }
    $('#adminBar').classList.toggle('hidden', !on);
    const b = $('#btnAdmin'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✔ Quitter l\'édition' : '✎ Édition';
    document.body.classList.toggle('admin', on);
    BA.route({ keep: true }); renderDrawer();
  }

  /* ---------- Routage ---------- */
  BA.route = async function (opts) {
    opts = opts || {};
    const tok = ++routeTok;
    const parts = (location.hash || '#/').slice(1).split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    const view = $('#view'), home = !parts.length;
    document.body.classList.toggle('in-view', !home);
    view.classList.toggle('hidden', home);
    document.title = 'BiblioAnimal';
    if (home) {
      view.innerHTML = '';
      if (BA.pending) { const r = BA.pending; BA.pending = null; showDrawer(r); }
      return;
    }
    const top = view.scrollTop;
    const [a, b] = parts;
    try {
      if (a === 'bibliotheque') BA.views.library(view);
      else if (a === 'animal') BA.views.animal(view, b);
      else if (a === 'regions') {
        let rid = BA.regionSlugs.get(b);
        if (!rid && !BA.geo && BA.geoPending) { view.innerHTML = '<p class="loading">Chargement des régions…</p>'; await BA.geoPending.catch(() => {}); if (tok !== routeTok) return; rid = BA.regionSlugs.get(b); }
        if (rid) BA.views.region(view, rid); else BA.views.notFound(view, 'Cette région est inconnue' + (BA.geo ? '.' : ' (la liste des pays n\'a pas pu être chargée).'));
      } else if (a === 'themes') { if (b) BA.views.theme(view, b); else BA.views.themes(view); }
      else if (a === 'admin') { if (!BA.admin) setAdmin(true); await BA.views.admin(view); }
      else BA.views.notFound(view, 'Cette page n\'existe pas.');
    } catch (err) {
      console.error(err);
      view.innerHTML = '<div class="empty"><h1>Oups</h1><p>Une erreur est survenue en affichant cette page.</p><a class="btn" href="#/">Retour au globe</a></div>';
    }
    if (tok !== routeTok) return;
    if (opts.keep) view.scrollTop = top; else { view.scrollTop = 0; const h = view.querySelector('h1'); if (h && opts.focus) h.focus({ preventScroll: true }); }
  };

  /* ---------- Tiroir de région ---------- */
  BA.openRegion = function (id) {
    const h = location.hash;
    if (h && h !== '#/' && h !== '#') { BA.pending = id; location.hash = '#/'; } else showDrawer(id);
  };
  function showDrawer(rid) {
    if (!BA.regions.get(rid)) return;
    if (BA.currentRegion !== rid) drawerCat = '';
    BA.currentRegion = rid;
    BA.globe.select(rid);
    renderDrawer();
    $('#drawer').classList.remove('hidden');
    const h = $('#dName'); if (h) h.focus({ preventScroll: true });
  }
  function closeDrawer() {
    BA.currentRegion = null; $('#drawer').classList.add('hidden'); BA.globe.release();
  }
  function renderDrawer() {
    const rid = BA.currentRegion; if (!rid) return;
    const r = BA.regions.get(rid), page = BA.data.regionPages[rid] || {};
    let list = BA.animalsInRegion(rid).sort((a, b) => a.common.localeCompare(b.common, 'fr'));
    const catCounts = {}; list.forEach(a => { catCounts[a.categoryId] = (catCounts[a.categoryId] || 0) + 1; });
    const total = list.length;
    if (drawerCat) list = list.filter(a => a.categoryId === drawerCat);
    const parent = r.type === 'country' && BA.regions.get(r.continentId);
    $('#drawer').innerHTML = `<div class="panel-head"><div><p class="eyebrow">${r.type === 'continent' ? 'Continent' : 'Pays'}${parent ? ' · ' + esc(parent.name) : ''}</p><h2 id="dName" tabindex="-1">${esc(r.name)}</h2></div>
      <button type="button" class="btn icon" data-act="close-drawer" aria-label="Fermer le panneau">✕</button></div>
      <p class="count">${total} animal${total > 1 ? 'aux' : ''} référencé${total > 1 ? 's' : ''}</p>
      ${page.short ? `<p class="short">${esc(page.short)}</p>` : ''}
      <a class="btn primary full" href="#/regions/${esc(r.slug)}">Ouvrir la page de ${esc(r.name)} →</a>
      ${Object.keys(catCounts).length > 1 ? `<div class="chips small" role="group" aria-label="Filtrer par catégorie"><button type="button" class="chip${!drawerCat ? ' on' : ''}" data-act="drawer-cat" data-v="" aria-pressed="${!drawerCat}">Tout</button>${Object.keys(catCounts).map(id => `<button type="button" class="chip${drawerCat === id ? ' on' : ''}" data-act="drawer-cat" data-v="${esc(id)}" aria-pressed="${drawerCat === id}">${esc((BA.cat(id) || {}).name || '?')} <span class="n">${catCounts[id]}</span></button>`).join('')}</div>` : ''}
      <div class="cards compact">${list.map(BA.cardHTML).join('') || `<div class="empty"><p>Aucun animal n'est encore associé à cette région.</p>${BA.admin ? '<button type="button" class="btn primary" data-act="new-animal">+ Ajouter une fiche</button>' : '<p class="note">Active le mode édition (✎) pour ajouter une fiche.</p>'}</div>`}</div>
      ${BA.admin && list.length ? '<button type="button" class="btn full" data-act="new-animal">+ Ajouter un animal ici</button>' : ''}
      ${r.type === 'country' && parent && BA.regionCount(parent.id) ? `<p class="note">Les animaux reliés seulement au continent apparaissent sur la page <a href="#/regions/${esc(parent.slug)}">${esc(parent.name)}</a>.</p>` : ''}`;
    BA.hydrate($('#drawer'));
  }

  /* ---------- Continents (accès sans globe) ---------- */
  function renderContinents() {
    $('#continents').innerHTML = '<span class="sr">Explorer par continent :</span>' + BA.CONTINENTS.map(c => `<button type="button" class="chip" data-act="go-region" data-id="${c.id}">${esc(c.name)} <span class="n">${BA.regionCount(c.id)}</span></button>`).join('');
  }

  /* ---------- Recherche ---------- */
  const sr = () => $('#searchResults');
  function closeSearch(clear) { sr().classList.add('hidden'); $('#search').setAttribute('aria-expanded', 'false'); if (clear) $('#search').value = ''; }
  function doSearch() {
    const raw = $('#search').value.trim();
    if (!raw) { closeSearch(); return; }
    sr().innerHTML = BA.searchHTML(BA.search(raw), raw);
    sr().classList.remove('hidden'); $('#search').setAttribute('aria-expanded', 'true');
  }

  /* ---------- Actions globales ---------- */
  Object.assign(BA.actions, {
    'close-drawer': () => closeDrawer(),
    'drawer-cat': d => { drawerCat = d.v; renderDrawer(); },
    'go-animal': d => { closeSearch(true); location.hash = '#/animal/' + d.slug; },
    'go-region': d => { closeSearch(true); BA.openRegion(d.id); },
    'go-theme': d => { closeSearch(true); location.hash = '#/themes/' + d.slug; },
    'show-on-globe': d => { BA.pending = d.id; location.hash = '#/'; }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && BA.actions[b.dataset.act]) {
      e.preventDefault();
      if (b.dataset.act === 'open-lib') closeSearch(true);
      BA.actions[b.dataset.act](b.dataset, b);
      return;
    }
    if (!e.target.closest('.search')) closeSearch();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').classList.contains('hidden')) { BA.closeModal(); return; }
    if (!sr().classList.contains('hidden')) { closeSearch(); return; }
    if (BA.currentRegion && !document.body.classList.contains('in-view')) closeDrawer();
  });
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') BA.closeModal(); });

  /* ---------- Démarrage ---------- */
  async function init() {
    try { await BA.loadAll(); }
    catch (e) {
      console.error(e);
      $('#view').classList.remove('hidden'); document.body.classList.add('in-view');
      $('#view').innerHTML = '<div class="empty"><h1>Impossible de charger les données</h1><p>' + esc(e.message) + '</p></div>';
      return;
    }
    try { BA.admin = sessionStorage.getItem('ba-admin') === '1'; } catch (e) { BA.admin = false; }
    BA.globe.init($('#globe'));
    renderContinents();

    $('#btnAdmin').onclick = () => setAdmin(!BA.admin);
    $('#adminBar').addEventListener('click', () => {});
    let st; $('#search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(doSearch, 120); });
    $('#search').addEventListener('focus', doSearch);
    $('#search').addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = sr().querySelector('.item'); if (first) first.click(); }
      if (e.key === 'ArrowDown') { const first = sr().querySelector('.item'); if (first) { e.preventDefault(); first.focus(); } }
    });
    sr().addEventListener('keydown', e => {
      const items = [...sr().querySelectorAll('.item')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && items[i + 1]) { e.preventDefault(); items[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || $('#search')).focus(); }
    });
    BA.on('data', () => { BA.route({ keep: true }); renderDrawer(); renderContinents(); BA.globe.refresh(); });
    window.addEventListener('hashchange', () => BA.route({ focus: true }));

    BA.geoPending = BA.loadCountries().then(feats => {
      BA.globe.setCountries(feats); BA.globe.refresh(); renderContinents();
      if (BA.currentRegion) renderDrawer();
      BA.route({ keep: true });
    });
    BA.geoPending.catch(err => {
      console.warn('Pays indisponibles :', err);
      if (BA.globe.ok) { const f = $('#globeFallback'); f.textContent = 'Les contours des pays n\'ont pas pu être chargés (connexion ?). Utilise les continents ci-dessous, la recherche ou la bibliothèque.'; f.classList.remove('hidden'); }
    });
    setAdmin(BA.admin);
    BA.route();
  }
  init();
})(window.BA);
