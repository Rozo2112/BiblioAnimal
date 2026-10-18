/* Modèle de données, régions, requêtes, données de départ, migration depuis l'ancien Atlas */
window.BA = window.BA || {};
(function (BA) {
  /* ---------- Utilitaires ---------- */
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
  const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const slugify = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-titre';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  BA.u = { uid, norm, slugify, esc };

  const listeners = {};
  BA.on = (e, f) => (listeners[e] = listeners[e] || []).push(f);
  BA.emit = e => (listeners[e] || []).forEach(f => { try { f(); } catch (err) { console.error(err); } });

  /* ---------- Schéma des fiches ---------- */
  BA.schema = {
    desc: [['appearance', 'Apparence physique'], ['size', 'Taille et poids'], ['longevity', 'Longévité'], ['diet', 'Alimentation'],
      ['behavior', 'Comportement'], ['reproduction', 'Reproduction'], ['habitat', 'Habitat'], ['lifestyle', 'Mode de vie'], ['adaptations', 'Adaptations particulières']],
    cons: [['status', 'Statut de conservation (si connu)'], ['threats', 'Menaces'], ['protection', 'Mesures de protection'], ['sources', 'Sources ou références consultées']],
    statuses: { native: 'Aire de répartition naturelle', seasonal: 'Présence saisonnière / migratoire', introduced: 'Zone d\'introduction' }
  };

  BA.newAnimal = () => ({
    id: uid(), slug: '', common: '', scientific: '', otherNames: [], categoryId: '', familyId: '', genus: '', order: '', taxoNote: '',
    cardText: '', summary: '', fields: {}, geo: { habitats: '', range: '', more: '' }, conservation: {},
    distribution: [], keywordIds: [], sections: [], image: null, created: Date.now(), updated: Date.now()
  });

  /* ---------- Régions (identifiants stables) ----------
     continents : C-AF, C-AS…  |  pays : code ISO à 3 lettres (MDG, FRA…) */
  const CONTINENTS = [
    { id: 'C-AF', name: 'Afrique', en: 'Africa', lat: 2, lng: 20 },
    { id: 'C-AS', name: 'Asie', en: 'Asia', lat: 35, lng: 90 },
    { id: 'C-EU', name: 'Europe', en: 'Europe', lat: 52, lng: 15 },
    { id: 'C-NA', name: 'Amérique du Nord', en: 'North America', lat: 45, lng: -100 },
    { id: 'C-SA', name: 'Amérique du Sud', en: 'South America', lat: -15, lng: -60 },
    { id: 'C-OC', name: 'Océanie', en: 'Oceania', lat: -25, lng: 140 },
    { id: 'C-AN', name: 'Antarctique', en: 'Antarctica', lat: -80, lng: 0 }
  ];
  BA.CONTINENTS = CONTINENTS;
  BA.regions = new Map();
  BA.regionSlugs = new Map();
  BA.geo = null;

  function registerRegion(r) {
    let slug = slugify(r.name), n = 2;
    while (BA.regionSlugs.has(slug) && BA.regionSlugs.get(slug) !== r.id) slug = slugify(r.name) + '-' + n++;
    r.slug = slug;
    BA.regions.set(r.id, r);
    BA.regionSlugs.set(slug, r.id);
  }
  CONTINENTS.forEach(c => registerRegion({ id: c.id, name: c.name, type: 'continent', lat: c.lat, lng: c.lng }));
  BA.regionName = id => (BA.regions.get(id) || {}).name || id;

  function bboxCenter(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    let best = null, bestArea = -1;
    polys.forEach(p => {
      let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
      p[0].forEach(([x, y]) => { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); });
      const area = (c - a) * (d - b);
      if (area > bestArea) { bestArea = area; best = { lat: (b + d) / 2, lng: (a + c) / 2 }; }
    });
    return best || { lat: 0, lng: 0 };
  }

  const GEO_URL = 'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';
  BA.loadCountries = async function () {
    const r = await fetch(GEO_URL);
    if (!r.ok) throw new Error('geojson ' + r.status);
    const geo = await r.json();
    let dn = null; try { dn = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch (e) { /* ignore */ }
    const byEn = Object.fromEntries(CONTINENTS.map(c => [c.en, c]));
    const feats = [];
    geo.features.forEach(f => {
      const p = f.properties, cont = byEn[p.CONTINENT];
      if (!cont) return;
      const id = p.ADM0_A3 || p.ISO_A3;
      if (!id || id === '-99') return;
      const a2 = [p.ISO_A2_EH, p.ISO_A2].find(x => x && x !== '-99' && x.length === 2);
      let name = p.NAME_FR;
      if (!name && a2 && dn) { try { name = dn.of(a2); } catch (e) { /* ignore */ } }
      if (!name || name === a2) name = p.NAME || p.ADMIN || id;
      const c = bboxCenter(f.geometry);
      registerRegion({ id, name, type: 'country', continentId: cont.id, lat: c.lat, lng: c.lng });
      f.__id = id; f.__cont = cont.id;
      feats.push(f);
    });
    BA.geo = feats;
    BA.touchIndex();
    return feats;
  };

  /* ---------- Données ---------- */
  BA.data = null;
  let saveTimer = null;
  BA.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(BA.saveNow, 200);
  };
  BA.saveNow = async function () {
    clearTimeout(saveTimer);
    try { await BA.storage.save(JSON.parse(JSON.stringify(BA.data))); }
    catch (e) { console.error(e); BA.toast && BA.toast('Impossible d\'enregistrer dans le navigateur. Exporte une sauvegarde !', 'error'); }
  };
  BA.touch = function () { BA.touchIndex(); BA.data.updated = Date.now(); BA.save(); BA.emit('data'); };

  /* Index (régions → animaux, texte de recherche) recalculé à la demande */
  let idx = null;
  BA.touchIndex = () => { idx = null; };
  function index() {
    if (idx) return idx;
    const byRegion = new Map(), hay = new Map();
    const d = BA.data;
    d.animals.forEach(a => {
      a.distribution.forEach(x => { if (!byRegion.has(x.region)) byRegion.set(x.region, new Set()); byRegion.get(x.region).add(a.id); });
      const cat = BA.cat(a.categoryId), fam = BA.fam(a.familyId);
      hay.set(a.id, norm([a.common, a.scientific, (a.otherNames || []).join(' '), cat && cat.name, fam && fam.name, a.genus, a.order,
        a.keywordIds.map(k => (BA.kw(k) || {}).label).join(' '), a.distribution.map(x => BA.regionName(x.region)).join(' '), a.cardText, a.summary].join(' ')));
    });
    idx = { byRegion, hay };
    return idx;
  }
  BA.hay = a => index().hay.get(a.id) || '';
  BA.animalsInRegion = function (rid) {
    const ids = new Set([rid]), r = BA.regions.get(rid);
    if (r && r.type === 'continent') BA.regions.forEach(x => { if (x.continentId === rid) ids.add(x.id); });
    const out = new Set();
    ids.forEach(i => (index().byRegion.get(i) || new Set()).forEach(a => out.add(a)));
    return BA.data.animals.filter(a => out.has(a.id));
  };
  BA.regionHasAnimals = rid => (index().byRegion.get(rid) || { size: 0 }).size > 0;
  BA.regionCount = rid => BA.animalsInRegion(rid).length;

  BA.cat = id => BA.data.categories.find(c => c.id === id);
  BA.fam = id => BA.data.families.find(f => f.id === id);
  BA.kw = id => BA.data.keywords.find(k => k.id === id);
  BA.animal = id => BA.data.animals.find(a => a.id === id);
  BA.animalBySlug = s => BA.data.animals.find(a => a.slug === s);
  BA.themeBySlug = s => BA.data.themes.find(t => t.slug === s);
  BA.themeAnimals = t => BA.data.animals.filter(a => a.keywordIds.some(k => t.keywordIds.includes(k)));

  function uniqueSlug(list, base, selfId) {
    let s = slugify(base), n = 2;
    while (list.some(x => x.slug === s && x.id !== selfId)) s = slugify(base) + '-' + n++;
    return s;
  }
  BA.uniqueSlug = uniqueSlug;

  /* Création à la volée (par nom, sans doublon) */
  BA.ensureCategory = (d, name) => {
    name = String(name || '').trim(); if (!name) return '';
    let c = d.categories.find(x => norm(x.name) === norm(name));
    if (!c) { c = { id: 'cat-' + slugify(name) + '-' + uid().slice(0, 3), name }; d.categories.push(c); }
    return c.id;
  };
  BA.ensureFamily = (d, name, catId) => {
    name = String(name || '').trim(); if (!name) return '';
    let f = d.families.find(x => norm(x.name) === norm(name));
    if (!f) { f = { id: 'fam-' + slugify(name) + '-' + uid().slice(0, 3), name, categoryId: catId || '' }; d.families.push(f); }
    else if (!f.categoryId && catId) f.categoryId = catId;
    return f.id;
  };
  BA.ensureKeyword = (d, label) => {
    label = String(label || '').trim().replace(/^#/, ''); if (!label) return '';
    let k = d.keywords.find(x => norm(x.label) === norm(label));
    if (!k) { k = { id: 'kw-' + slugify(label) + '-' + uid().slice(0, 3), label }; d.keywords.push(k); }
    return k.id;
  };

  /* ---------- Données de départ ---------- */
  const SEED = [
    // [nom, nom scientifique, catégorie, famille, régions, mots-clés, texte]
    ['Lion', 'Panthera leo', 'Mammifères', 'Félidés', ['C-AF'], ['félins', 'savane', 'prédateur'], 'Le roi de la savane vit en groupes sociaux appelés fières.'],
    ['Tigre', 'Panthera tigris', 'Mammifères', 'Félidés', ['C-AS', 'IND'], ['félins', 'forêt', 'prédateur'], 'Le plus grand des félins actuels, solitaire et bon nageur.'],
    ['Jaguar', 'Panthera onca', 'Mammifères', 'Félidés', ['C-SA'], ['félins', 'forêt', 'prédateur'], 'Félin puissant des forêts d\'Amérique, souvent lié aux zones humides.'],
    ['Éléphant d\'Afrique', 'Loxodonta africana', 'Mammifères', 'Éléphantidés', ['C-AF'], ['savane', 'herbivore'], 'Le plus grand animal terrestre actuel.'],
    ['Renard roux', 'Vulpes vulpes', 'Mammifères', 'Canidés', ['C-EU', 'C-AS', 'C-NA'], ['omnivore'], 'Canidé très adaptable, présent dans de nombreux milieux, y compris près des villes.'],
    ['Panda géant', 'Ailuropoda melanoleuca', 'Mammifères', 'Ursidés', ['CHN', 'C-AS'], ['forêt', 'herbivore'], 'Se nourrit presque exclusivement de bambou.'],
    ['Ours polaire', 'Ursus maritimus', 'Mammifères', 'Ursidés', ['C-NA', 'C-EU', 'C-AS'], ['arctique', 'prédateur'], 'Vit sur la banquise de l\'Arctique et chasse surtout les phoques.'],
    ['Kangourou roux', 'Osphranter rufus', 'Mammifères', 'Macropodidés', ['AUS', 'C-OC'], ['marsupial'], 'Se déplace par bonds pouvant dépasser 8 mètres.'],
    ['Aigle royal', 'Aquila chrysaetos', 'Oiseaux', 'Accipitridés', ['C-EU', 'C-AS', 'C-NA', 'C-AF'], ['montagne', 'prédateur'], 'Rapace majestueux des zones ouvertes et montagneuses.'],
    ['Manchot empereur', 'Aptenodytes forsteri', 'Oiseaux', 'Spheniscidés', ['C-AN'], ['polaire'], 'Le plus grand des manchots, il couve son œuf pendant l\'hiver austral.'],
    ['Toucan', '', 'Oiseaux', 'Ramphastidés', ['C-SA'], ['forêt'], 'Reconnaissable à son énorme bec coloré.'],
    ['Iguane vert', 'Iguana iguana', 'Reptiles', 'Iguanidés', ['C-SA', 'C-NA'], ['forêt', 'herbivore'], 'Grand lézard arboricole des forêts tropicales d\'Amérique.'],
    ['Crocodile du Nil', 'Crocodylus niloticus', 'Reptiles', 'Crocodylidés', ['C-AF'], ['prédateur', 'fleuve'], 'Grand prédateur des fleuves et lacs africains.'],
    ['Grenouille rousse', 'Rana temporaria', 'Amphibiens', 'Ranidés', ['C-EU', 'C-AS'], ['mare'], 'Commune dans les prairies humides et les forêts.'],
    ['Requin blanc', 'Carcharodon carcharias', 'Poissons', 'Lamnidés', ['C-OC', 'C-AF', 'C-NA'], ['marin', 'prédateur'], 'Grand prédateur des océans tempérés.'],
    ['Papillon monarque', 'Danaus plexippus', 'Invertébrés', 'Nymphalidés', ['C-NA', 'C-SA'], ['migration'], 'Célèbre pour sa migration sur plusieurs milliers de kilomètres.']
  ];

  function emptyData() {
    return { version: 2, settings: {}, categories: [], families: [], keywords: [], animals: [], themes: [], regionPages: {}, updated: Date.now() };
  }
  function addBaseCategories(d) { ['Mammifères', 'Oiseaux', 'Reptiles', 'Amphibiens', 'Poissons', 'Invertébrés'].forEach(n => BA.ensureCategory(d, n)); }
  function addSeedAnimal(d, row) {
    const [common, sci, cat, fam, regs, kws, text] = row;
    const a = BA.newAnimal();
    const catId = BA.ensureCategory(d, cat);
    Object.assign(a, { common, scientific: sci, categoryId: catId, familyId: BA.ensureFamily(d, fam, catId), cardText: text, summary: text,
      distribution: regs.map(r => ({ region: r, status: 'native' })), keywordIds: kws.map(k => BA.ensureKeyword(d, k)) });
    a.geo.range = 'Répartition indicative saisie à titre d\'exemple : à vérifier et préciser.';
    a.slug = uniqueSlug(d.animals, common, a.id);
    d.animals.push(a);
  }
  function addSeedThemes(d) {
    const t = (title, desc, kws) => d.themes.push({ id: uid(), slug: uniqueSlug(d.themes, title), title, description: desc, keywordIds: kws.map(k => BA.ensureKeyword(d, k)), image: null });
    t('Félins', 'Tous les félins de la bibliothèque, reliés par le mot-clé « félins ».', ['félins']);
    t('Grands froids', 'Les animaux des régions polaires et glacées.', ['arctique', 'polaire']);
  }
  BA.buildSeed = function () {
    const d = emptyData(); addBaseCategories(d);
    SEED.forEach(r => addSeedAnimal(d, r)); addSeedThemes(d);
    return d;
  };

  /* ---------- Migration depuis l'ancien Atlas (localStorage "atlas-animaux-v1") ---------- */
  const LEGACY_REG = { 'Afrique': 'C-AF', 'Asie': 'C-AS', 'Europe': 'C-EU', 'Amérique du Nord': 'C-NA', 'Amérique du Sud': 'C-SA', 'Océanie': 'C-OC', 'Antarctique': 'C-AN' };
  const LEGACY_CAT = { 'Insectes': 'Invertébrés', 'Arachnides': 'Invertébrés', 'Mollusques': 'Invertébrés', 'Crustacés': 'Invertébrés' };
  BA.migrateLegacy = async function (old) {
    const d = emptyData(); addBaseCategories(d);
    for (const o of (old.animals || [])) {
      const a = BA.newAnimal();
      const catName = LEGACY_CAT[o.category] || o.category || 'Autres';
      const catId = BA.ensureCategory(d, catName);
      Object.assign(a, { common: o.name || o.common || 'Sans nom', categoryId: catId, familyId: BA.ensureFamily(d, o.family, catId),
        cardText: o.text || '', summary: o.text || '',
        distribution: (o.regions || []).map(r => LEGACY_REG[r]).filter(Boolean).map(r => ({ region: r, status: 'native' })),
        keywordIds: (o.tags || []).map(t => BA.ensureKeyword(d, t)) });
      if (o.category && LEGACY_CAT[o.category]) a.keywordIds.push(BA.ensureKeyword(d, o.category.toLowerCase()));
      a.slug = uniqueSlug(d.animals, a.common, a.id);
      if (o.image && /^data:image\//.test(o.image)) {
        try { const blob = await (await fetch(o.image)).blob(); a.image = { imageId: await BA.img.put(blob), url: '', alt: a.common, credit: '', source: '' }; } catch (e) { /* ignore */ }
      } else if (o.image) a.image = { imageId: null, url: o.image, alt: a.common, credit: '', source: '' };
      d.animals.push(a);
    }
    (old.keywords || []).forEach(k => {
      const kws = [k.name, ...(k.tagMatch || [])].map(x => BA.ensureKeyword(d, x));
      d.themes.push({ id: uid(), slug: uniqueSlug(d.themes, k.name), title: k.name, description: k.text || '', keywordIds: kws, image: null });
      (k.regions || []).forEach(r => { const rid = LEGACY_REG[r]; if (!rid) return;
        d.animals.forEach(a => { if (a.distribution.some(x => x.region === rid) && !a.keywordIds.includes(kws[0])) a.keywordIds.push(kws[0]); }); });
    });
    // On s'assure que les animaux cités dans le cahier des charges existent
    SEED.forEach(r => { if (!d.animals.some(a => norm(a.common) === norm(r[0]))) addSeedAnimal(d, r); });
    return d;
  };

  BA.loadAll = async function () {
    await BA.storage.init();
    let d = await BA.storage.load();
    if (!d || !Array.isArray(d.animals)) {
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem('atlas-animaux-v1')); } catch (e) { /* ignore */ }
      d = legacy && Array.isArray(legacy.animals) ? await BA.migrateLegacy(legacy) : BA.buildSeed();
      BA.data = d; await BA.saveNow();
    }
    BA.data = d;
    d.regionPages = d.regionPages || {}; d.themes = d.themes || []; d.keywords = d.keywords || []; d.settings = d.settings || {};
  };

  /* ---------- Import / Export ---------- */
  function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
  BA.exportData = async function (withImages) {
    const out = { format: 'biblioanimal', version: 2, exportedAt: new Date().toISOString(), data: BA.data, images: {} };
    if (withImages) {
      for (const id of await BA.storage.listImages()) {
        const b = await BA.storage.getImage(id);
        if (b) out.images[id] = await blobToDataURL(b);
      }
    }
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'biblioanimal-' + new Date().toISOString().slice(0, 10) + (withImages ? '-avec-photos' : '') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  BA.importData = async function (text) {
    const o = JSON.parse(text);
    let d;
    if (o && o.format === 'biblioanimal' && o.data && Array.isArray(o.data.animals)) {
      d = o.data;
      for (const [id, url] of Object.entries(o.images || {})) { await BA.storage.putImage(id, await (await fetch(url)).blob()); }
    } else if (o && Array.isArray(o.animals) && o.animals[0] && 'name' in o.animals[0]) {
      d = await BA.migrateLegacy(o);
    } else throw new Error('Format de fichier non reconnu.');
    BA.data = d;
    d.regionPages = d.regionPages || {}; d.themes = d.themes || []; d.keywords = d.keywords || []; d.settings = d.settings || {};
    BA.touchIndex(); await BA.saveNow(); BA.emit('data');
  };
  BA.resetAll = async function () { await BA.storage.clearAll(); BA.data = BA.buildSeed(); BA.touchIndex(); await BA.saveNow(); BA.emit('data'); };
})(window.BA);
