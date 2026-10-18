/* Stockage local (IndexedDB). Toute la couche "où sont rangées les données" est ici :
   pour passer plus tard à une base distante, il suffira de remplacer BA.storage
   par une version qui parle à un serveur (mêmes méthodes). */
window.BA = window.BA || {};
(function (BA) {
  const mem = { kv: new Map(), images: new Map() };
  let idb = null;
  BA.persistent = false;

  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('biblioanimal', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('images'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = idb.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB'));
    });
  }

  BA.storage = {
    async init() {
      try { if (!window.indexedDB) throw new Error('no idb'); idb = await open(); BA.persistent = true; }
      catch (e) { idb = null; BA.persistent = false; }
    },
    async load() { return idb ? req('kv', 'readonly', s => s.get('data')) : (mem.kv.get('data') || null); },
    async save(d) { if (idb) return req('kv', 'readwrite', s => s.put(d, 'data')); mem.kv.set('data', d); },
    async putImage(id, blob) { if (idb) return req('images', 'readwrite', s => s.put(blob, id)); mem.images.set(id, blob); },
    async getImage(id) { return idb ? req('images', 'readonly', s => s.get(id)) : (mem.images.get(id) || null); },
    async delImage(id) { if (idb) return req('images', 'readwrite', s => s.delete(id)); mem.images.delete(id); },
    async listImages() { return idb ? req('images', 'readonly', s => s.getAllKeys()) : [...mem.images.keys()]; },
    async clearAll() {
      if (idb) { await req('kv', 'readwrite', s => s.clear()); await req('images', 'readwrite', s => s.clear()); }
      else { mem.kv.clear(); mem.images.clear(); }
    }
  };

  /* Images : URL d'aperçu en cache */
  const urlCache = new Map();
  BA.img = {
    async url(id) {
      if (urlCache.has(id)) return urlCache.get(id);
      const blob = await BA.storage.getImage(id);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      urlCache.set(id, u);
      return u;
    },
    async put(blob) { const id = BA.u.uid() + BA.u.uid(); await BA.storage.putImage(id, blob); return id; },
    async del(id) { if (!id) return; if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); } await BA.storage.delImage(id); }
  };
})(window.BA);
