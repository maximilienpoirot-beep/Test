# Protocole ½ Kelly — figé le 18/11/2026 AVANT de télécharger les paires 13 à 24

Décision de Maximilien : viser ½ Kelly (on accepte un risque de mort plus élevé pour plus de rendement).

## Taille de position ½ Kelly
f = min(1, ½ · μ / σ²), avec σ = volatilité réalisée sur 60 bougies (annualisée), pas de levier.
- Avec tendance : μ = μ1 · s, s = vote des 4 MM (0 à 1), **μ1 = 1,40** (estimé par `estimer_mu.py`
  sur les données déjà vues : BTC/ETH 2017-2023 + altcoins 1-12 2020-2026 ; erreur type ≈ 0,21).
- Sans tendance : μ = **μ0 = 0,64** constant (même estimation), toujours investi selon f.
- Bande de rééquilibrage 25 %, frais 0,1 %, décision sur la bougie précédente : inchangés.

## Variantes (liste fermée)
| Code | Taille | Survie | Coffre |
|---|---|---|---|
| A | acheter-garder | – | – |
| C | v2 vol 30 % (choix précédent, référence) | allégée (orange ×0,75, rouge ×0,5, mort 65 %) | 50 % des gains à +10 % |
| K0 | ½ Kelly sans tendance (μ0) | mort 65 % seule (pas de zones) | 50 % |
| K1 | ½ Kelly tendance | allégée, comme C | 50 % |
| K2 | ½ Kelly tendance | mort 65 % seule | 50 % |
| K3 | ½ Kelly tendance | mort 65 % seule | 20 % |
| (RK) | ½ Kelly tendance | aucune | aucun — référence hors concours |

## Univers
Places 13 à 24 du classement par volume USDT de janvier 2020 (`univers.py`, même règle que pour 1-12 :
paires retirées comprises, BTC/ETH, stablecoins, monnaies et jetons à levier exclus).
Période 01/01/2020 → 18/11/2026 ; fenêtres de 2 ans tous les 3 mois de 01/2020 à 10/2024.

## Règle de décision (fixée à l'avance)
1. Variante retenue = meilleur total médian sur les 12 paires (période complète) parmi K0-K3.
   Un bot mort garde ce qu'il avait à sa mort (capital + coffre) : la mort est déjà dans le total.
2. Elle remplace C seulement si elle bat C (a) en total médian ET (b) sur au moins 7 paires sur 12.
3. On affiche le nombre de morts et le pire repli. Les fenêtres de 2 ans servent de contrôle.
4. Biais à garder en tête : choisir le meilleur de 4 sur les mêmes paires favorise un peu le gagnant.
