# BiblioAnimal

Encyclopédie animalière personnelle, centrée sur un globe 3D interactif. Site 100 % statique (HTML/CSS/JS), compatible GitHub Pages.

## Mettre en ligne (GitHub Pages)
1. Crée un dépôt GitHub et envoie tout le contenu de ce dossier à la racine (`index.html`, `css/`, `js/`).
2. *Settings → Pages* : branche `main`, dossier `/ (root)`.
3. Le site est disponible sur `https://ton-pseudo.github.io/nom-du-depot/`.

En local : ouvre simplement `index.html` dans le navigateur (internet requis pour le globe).

## Adresses des pages
GitHub Pages ne sait pas réécrire les URL côté serveur : le site utilise donc des adresses avec `#` qui fonctionnent partout, y compris en rechargeant la page :

| Page | Adresse |
| --- | --- |
| Globe | `#/` |
| Bibliothèque | `#/bibliotheque` |
| Fiche d'un animal | `#/animal/lion` |
| Région / pays | `#/regions/madagascar`, `#/regions/afrique` |
| Thèmes | `#/themes`, `#/themes/animaux-nocturnes` |
| Administration | `#/admin` |

Limite : ces adresses ne sont pas indexées individuellement par les moteurs de recherche. Des adresses « propres » (`/regions/madagascar`) demanderaient un hébergeur avec réécriture d'URL.

## Où sont les données ?
- **Mode local (actuel)** : les fiches sont dans IndexedDB, les photos aussi (réduites à 1600 px max). Tout reste dans *ton* navigateur : les visiteurs de ton site public ne voient pas tes modifications. Vider les données du navigateur efface la bibliothèque : fais des **exports** réguliers (Édition → Administration → Données & sauvegardes, « avec photos »).
- **Mode connecté (futur)** : pour partager entre appareils/visiteurs il faut une base de données + un stockage d'images distants + une connexion sécurisée (ex. Supabase ou Firebase). Aucune clé privée ne doit être dans le code public : seules les clés « publiques » prévues pour le navigateur, protégées par des règles de sécurité côté service.
  Le code est prêt pour ça : tout l'accès aux données passe par `BA.storage` (`js/storage.js`). Il suffira d'écrire une version distante avec les mêmes méthodes (`load`, `save`, `putImage`, `getImage`, `delImage`, `listImages`, `clearAll`).

## Modèle de données (JSON exportable)
Animaux, catégories, familles, mots-clés, thèmes et pages de région ont chacun un identifiant stable. Régions : `C-AF`, `C-AS`… pour les continents, code ISO à 3 lettres (`MDG`, `FRA`) pour les pays. Une fiche relie des régions via `distribution: [{ region, status }]` (`native`, `seasonal`, `introduced`).
Les répartitions sont saisies à la main : elles ne sont pas vérifiées scientifiquement. Les données de départ sont des exemples à vérifier.

## Bibliothèques externes (CDN)
- Globe.gl / Three.js (unpkg.com) : le globe 3D.
- Textures de la Terre (three-globe, unpkg.com) et contours des pays Natural Earth (raw.githubusercontent.com, domaine public).
Si l'une est indisponible, le site reste utilisable : continents cliquables, recherche et bibliothèque fonctionnent sans le globe.

## Photographies
Aucune image n'est générée : tu choisis chaque photo (fichier ou URL), avec crédit et source facultatifs. Sans photo, une image de remplacement sobre est affichée.
