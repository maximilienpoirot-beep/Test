# Protocole altcoins — figé le 18/11/2026 AVANT tout téléchargement d'altcoin

But : vérifier sur des cryptos jamais vues (1) si la variante C tient face à acheter-garder,
(2) si l'achat à la baisse (F, G) apporte quelque chose.

## Univers (règle objective, contre le biais du survivant)
- Paires spot Binance cotées en USDT qui avaient des bougies en janvier 2020
  (liste lue dans les archives `data.binance.vision`, paires retirées depuis comprises).
- Exclus : BTC et ETH (déjà utilisés), stablecoins et monnaies (USDC, TUSD, PAX/USDP, BUSD, USDS,
  USDSB, DAI, EUR, GBP, AUD, TRY…), jetons à levier (…UP, …DOWN, …BULL, …BEAR).
- On garde les **12 premières par volume échangé (en USDT) sur janvier 2020**. Le classement
  utilise uniquement le volume de janvier 2020, jamais les rendements ultérieurs.
- Une paire retirée de la cote : on s'arrête à sa dernière bougie (vente au dernier prix).

## Période
- Du 01/01/2020 (ou dès la fin de la chauffe de 480 bougies) au 18/11/2026.
- Robustesse : fenêtres de 2 ans démarrant tous les 3 mois, de 01/2020 à 10/2024.
- Mêmes frais (0,1 %), mêmes trous comblés par le dernier prix connu.

## Variantes (aucun réglage modifié)
A acheter-garder · B v2 + survie · C v2 survie allégée (choisie sur BTC) · D vol 50 % · E vol 70 %
· (R) v2 sans survie · F achat à la baisse pur · G tendance + achat des creux.
F et G : Bollinger 60 bougies, 2 écarts-types, réglages de survie et de volatilité de C.
Essai préalable de F et G sur BTC/ETH 2017-2023 uniquement : F perd partout et meurt une fois
sur ETH ; G est devant C en entraînement et derrière en validation.

## Questions et critères, fixés à l'avance
1. C contre A : total médian sur les 12 paires, part des paires où C > A, nombre de morts de C.
2. G contre C : total médian, part des paires où G > C. G n'est retenue que si elle bat C
   sur les deux mesures (médiane ET plus de la moitié des paires), sans plus de morts.
3. F : attendu perdant ; il ne serait retenu que s'il battait C sur les deux mesures.
