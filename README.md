# Météo vivante 🌦️

Une application météo complète, en ligne sur **https://maximilienpoirot-beep.github.io/Test/**.

Site statique (HTML, CSS, JavaScript), sans étape de compilation, alimenté par des API gratuites et sans clé.

## Fonctionnalités

- **Ciel animé** selon la météo et l'heure : soleil et rayons, nuit étoilée avec étoiles filantes, nuages qui dérivent avec le vent, pluie avec éclaboussures, neige, brouillard, orage avec éclairs, lumière dorée au lever et au coucher du soleil
- **Conditions actuelles** avec un résumé en français (« Pluie probable vers 17h… ») et la pluie prévue dans les 2 prochaines heures, par tranches de 15 minutes
- **Heure par heure** sur 24 h, avec le lever et le coucher du soleil
- **Tuiles détaillées** : vent (boussole et échelle de Beaufort), course du soleil, indice UV, qualité de l'air (indice européen, PM2.5, PM10, NO₂, O₃), humidité et point de rosée, pression et tendance, visibilité, phase de la Lune, pollens
- **Graphiques interactifs sur 48 h** : température et ressenti, risque de pluie (nuits ombrées)
- **Prévisions sur 10 jours** avec des barres de températures colorées
- **Radar de pluie animé** sur une carte
- **Conseils du jour** : parapluie, crème solaire, tenue, meilleur moment pour sortir…
- Recherche avec suggestions, géolocalisation, **favoris** avec leur température, °C/°F, lien de partage
- **Installable** sur l'écran d'accueil du téléphone (PWA) et utilisable hors ligne avec les dernières données
- Menu « Aperçu des ambiances » pour voir toutes les animations du ciel

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `css/style.css` | Styles (cartes en verre dépoli, adaptation mobile) |
| `js/app.js` | Données, rendu, recherche, favoris, carte |
| `js/sky.js` | Animation du ciel (canvas) |
| `js/charts.js` | Graphiques SVG |
| `sw.js`, `manifest.webmanifest`, `icons/` | Application installable et mode hors ligne |
| `vendor/leaflet/` | Bibliothèque de carte [Leaflet](https://leafletjs.com/) 1.9.4 |

## Sources des données

[Open-Meteo](https://open-meteo.com/) (prévisions, qualité de l'air, pollens, recherche de villes) ·
[RainViewer](https://www.rainviewer.com/) (radar) · [OpenStreetMap](https://www.openstreetmap.org/copyright) et [CARTO](https://carto.com/) (fond de carte) ·
[BigDataCloud](https://www.bigdatacloud.com/) (nom du lieu à partir de la position)

## Lancer en local

Les modules JavaScript ne fonctionnent pas en ouvrant directement le fichier : il faut un petit serveur.

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
