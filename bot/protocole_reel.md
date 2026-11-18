# Protocole sur données réelles — figé le 18/11/2026 AVANT tout résultat

Ce fichier est commité avant le premier lancement de `test_reel.py`.
Il ne doit plus être modifié ensuite (sinon : le dire et dater le changement).

## Données
- BTCUSDT et ETHUSDT, bougies de 4 h, Binance spot, du 17/08/2017 au 18/11/2026
  (`data-api.binance.vision`, sans clé API).
- Contrôles : 0 doublon, 0 bougie incohérente. 8 trous identiques sur les deux paires
  (17 bougies, maintenances Binance 2018-2020) comblés par le dernier prix connu.
- Frais 0,1 % par ordre (comme le banc synthétique), pas de slippage.

## Variantes candidates (liste fermée)
| Code | Variante | Réglages |
|---|---|---|
| A | Acheter-garder | achat à l'ouverture de la période, vente à la fin |
| B | v2 + survie | vol cible 30 %, survie par défaut (90/80/65, ×0,5 / ×0,25) |
| C | v2 survie allégée | vol cible 30 %, mort à 65 % gardée, orange ×0,75, rouge ×0,5 |
| D | v2 + survie, vol 50 % | vol cible 50 %, survie par défaut |
| E | v2 + survie, vol 70 % | vol cible 70 %, survie par défaut |
| (R) | v2 sans survie, vol 30 % | référence hors concours : mesure le coût de la survie, ne peut pas être choisie |

Partout ailleurs : horizons (60, 120, 240, 480), fenêtre de vol 60, bande 25 %, coffre +10 % → 50 %.

## Découpage dans le temps
- Entraînement : 17/08/2017 → 31/12/2020 (les 480 premières bougies servent de chauffe).
- Validation : 01/01/2021 → 31/12/2023.
- Test final : 01/01/2024 → 18/11/2026, ouvert UNE seule fois.
- Chaque période repart de 100 € avec un coffre vide. Les indicateurs utilisent l'historique
  précédent (ils ne regardent que le passé), donc pas de chauffe perdue en validation/test.
- Aucun paramètre n'est ajusté : l'« entraînement » sert seulement de contrôle de cohérence.

## Règle de choix
1. Critère : total à l'arrivée (capital + coffre) sur la validation **BTC**. Bot mort = éliminé.
2. La variante choisie est le meilleur bot (B à E). Acheter-garder sert d'étalon : s'il est devant,
   on le note, et le test dira si l'écart tient.
3. Robustesse (avant le test, sans toucher 2024-2026) :
   - même classement sur ETH (validation) ;
   - départs décalés : fenêtres de 2 ans démarrant tous les 3 mois de 12/2017 à 12/2021, sur BTC et ETH.
   - Si la variante choisie meurt dans plus de 25 % des fenêtres décalées (BTC + ETH), on prend la suivante.
4. Test : on lance la variante choisie ET toutes les autres (pour information) sur 2024-2026, une seule fois.

## Verdict
- Si la variante choisie ne bat pas acheter-garder sur le test (BTC et ETH), on ne passe pas en direct.
- On affiche toujours le pire repli (drawdown) à côté du total.
