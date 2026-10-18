/* Globe 3D (Globe.gl + Three.js, chargés depuis un CDN).
   Si la bibliothèque ou WebGL est indisponible, le site reste utilisable (recherche, bibliothèque, continents). */
window.BA = window.BA || {};
(function (BA) {
  let world = null, selected = null, hover = null, resumeTimer = null, ok = false;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);

  function isSelectedFeature(d) {
    if (!selected) return false;
    const r = BA.regions.get(selected);
    return r && r.type === 'continent' ? d.__cont === selected : d.__id === selected;
  }
  function cap(d) {
    if (isSelectedFeature(d)) return 'rgba(214,176,74,0.62)';
    if (hover && d.__id === hover) return 'rgba(140,220,160,0.55)';
    if (BA.regionHasAnimals(d.__id)) return 'rgba(80,160,100,0.30)';
    return 'rgba(255,255,255,0.03)';
  }
  const alt = d => (isSelectedFeature(d) || d.__id === hover) ? 0.03 : 0.004;

  BA.globe = {
    get ok() { return ok; },
    init(el) {
      try {
        if (!window.Globe) throw new Error('Globe.gl indisponible');
        world = Globe()(el)
          .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
          .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
          .backgroundColor('rgba(0,0,0,0)')
          .atmosphereColor('#8fd3a4').atmosphereAltitude(0.18)
          .polygonCapColor(cap).polygonAltitude(alt)
          .polygonSideColor(() => 'rgba(255,255,255,0.05)')
          .polygonStrokeColor(() => 'rgba(255,255,255,0.28)')
          .polygonLabel(d => {
            const n = BA.regionCount(d.__id);
            return '<div class="globe-tip"><b>' + BA.u.esc(BA.regionName(d.__id)) + '</b><br>' + n + ' animal' + (n > 1 ? 'aux' : '') + '</div>';
          })
          .onPolygonHover(d => { hover = d ? d.__id : null; document.body.style.cursor = d ? 'pointer' : ''; BA.globe.refresh(); })
          .onPolygonClick(d => BA.openRegion(d.__id));
        try { world.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); } catch (e) { /* ignore */ }
        const c = world.controls();
        c.enableDamping = true; c.autoRotate = !reduce; c.autoRotateSpeed = 0.45; c.minDistance = 160; c.maxDistance = 600;
        c.addEventListener('start', () => { c.autoRotate = false; clearTimeout(resumeTimer); });
        c.addEventListener('end', () => { clearTimeout(resumeTimer); if (!selected && !reduce) resumeTimer = setTimeout(() => { c.autoRotate = true; }, 2500); });
        const fit = () => world.width(el.clientWidth).height(el.clientHeight);
        addEventListener('resize', fit); fit();
        ok = true;
      } catch (e) {
        console.warn('Globe indisponible :', e);
        ok = false;
        $('#globeFallback').classList.remove('hidden');
      }
      return ok;
    },
    setCountries(feats) { if (world) world.polygonsData(feats); },
    refresh() { if (world) world.polygonCapColor(cap).polygonAltitude(alt); },
    select(id, fly) {
      selected = id;
      if (world) {
        world.controls().autoRotate = false;
        const r = BA.regions.get(id);
        if (fly !== false && r) world.pointOfView({ lat: r.lat, lng: r.lng, altitude: r.type === 'continent' ? 2.0 : 1.5 }, reduce ? 0 : 900);
      }
      this.refresh();
    },
    release() {
      selected = null; this.refresh();
      if (world && !reduce) world.controls().autoRotate = true;
    }
  };
})(window.BA);
