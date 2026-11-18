# Bot Day Trader — cahier des charges (v0.8)

## Choix actés
- Objectif prioritaire : le meilleur rendement monétaire (capital + coffre à l'arrivée). Le choix entre les variantes se fera sur données réelles. La mort sous 65 % de PV reste une contrainte dure.
- Marché : crypto (spot, long uniquement au départ), bougies de 4 h (15 min abandonné, voir « Leçons »)
- Positions gardées la nuit : oui
- Capital de départ : 100 € (fictif d'abord, réel ensuite)
- Le bot est lancé par Maximilien avec ses propres clés API (sans droit de retrait ni de transfert), testnet Binance d'abord
- Règle du jeu fixe : mort sous 65 % de PV
- Les clés API ne passent jamais par le chat ; variables d'environnement sur la machine de Maximilien
- Mise en direct : à rediscuter plus tard ; on se concentre d'abord sur la stratégie

## Accès aux données Binance (lecture seule)
- Claude lit lui-même les données de marché Binance : historique des bougies (backtests) et, plus tard, prix récents (suivi).
- Données publiques uniquement, sans clé API : lecture seule, aucun ordre, aucun accès au compte.
- Domaines à autoriser (un par ligne) :
  - `api.binance.com` (API principale, endpoint `/api/v3/klines`)
  - `data-api.binance.vision` (même API, réservée aux données de marché publiques)
  - `data.binance.vision` (archives CSV des bougies, idéal pour plusieurs années d'historique)
  - `data.binance.com` (demandé par Maximilien)
- Décision du 18/11/2026 : l'environnement du projet claude.ai ne peut pas être réglé (accès Binance refusé, erreur 403). Le travail sur données réelles continue dans une session Claude Code, dont l'environnement cloud autorise ces domaines (Network access = Custom + liste par défaut des gestionnaires de paquets).
- Passation : fichier « Bot Day Trader – passation Claude Code.md » (cahier des charges + code + instructions de démarrage), à joindre au premier message de la session Claude Code. Copie dans ce projet : claude/passation-claude-code.md.
- Point d'attention : `api.binance.com` peut refuser les requêtes venant de certains pays (« restricted location ») ; les domaines `.binance.vision` servent de repli.
- Plan B si l'accès bloque encore : Maximilien lance donnees_binance.py sur son PC et envoie le CSV.
- Constat du 18/11/2026 (session Claude Code) : `api.binance.com` → 451 « restricted location » ; `data-api.binance.vision` et `data.binance.vision` → OK. Les données sont téléchargées via `data-api.binance.vision`.
- Données dans `donnees/` : BTCUSDT et ETHUSDT 4 h, 17/08/2017 → 18/11/2026, 20 264 bougies chacune. 0 doublon, 0 bougie incohérente, 8 trous identiques sur les deux paires (17 bougies, maintenances Binance 2018-2020) comblés par le dernier prix connu.

## Système de survie (survie.py)
- PV = capital de trading / plus haut depuis la dernière mise au coffre
- Zones par défaut : vert ≥ 90 % (taille ×1) · orange 80–90 % (×0,5) · rouge 65–80 % (×0,25, signaux forts seulement) · mort < 65 % (tout fermé, arrêt)
- Régénération (`regen`) et coffre (+10 % → 50 % du gain au coffre, inaccessible au bot)

## Stratégie v2 (strategie.py) — suivi de tendance + ciblage de volatilité
1. Signal : vote de 4 moyennes mobiles (60, 120, 240, 480 bougies de 4 h ≈ 10 à 80 jours). Signal = part de moyennes dépassées par le prix (0 à 1). Long uniquement.
2. Taille : volatilité cible 30 % annuelle → taille = min(1, 0,30 / vol récente sur 60 bougies). Pas de levier.
3. Frais : on ne retouche la position que si l'écart à la cible dépasse 25 % du capital.
4. Survie : le multiplicateur de zone s'applique par-dessus.
5. Exécution : décision prise avec la bougie précédente (aucun regard dans le futur).
Pourquoi cette forme : très peu de paramètres (donc peu de sur-apprentissage), horizons multiples (robuste au choix d'un horizon), trades rares (les frais mangent le day trading rapide).

## Banc de test (banc_de_test.py, marches.py)
Deux marchés synthétiques de 3 ans, 300 marchés neufs chacun, frais 0,1 % : marche aléatoire (aucun avantage possible) et marché à régimes haussier/baissier/range symétriques.

| Médiane (€, départ 100) | Aléatoire | Régimes | Drawdown médian |
|---|---|---|---|
| Acheter-garder | 107 | 121 | 69 % |
| v1 croisement + survie | 92 | 99 | 20 % |
| v2 + survie | 96 | 112 | 19 % / 18 % |
| v2 sans survie | 100 | 126 | 32 % / 30 % |

- Aléatoire : la v2 ne fabrique pas de gain (≈ –4 % de frais), 0 mort ; c'est le résultat attendu.
- Régimes : la v2 passe de 99 (v1) à 112 et gagne dans 67 % des cas, avec un drawdown ~4× plus faible qu'acheter-garder.
- La survie a un coût : ~14 € de médiane en moins sur les régimes, en échange d'un drawdown de 30 % → 18 %. C'est le prix de l'assurance.
- Sensibilité (sensibilite.py, 100 marchés) : plateau, pas de pic ; horizons, volatilité cible et bande changent peu le résultat → pas de sur-réglage visible.
- Moteur vérifié : sans frais et tout investi = acheter-garder exactement ; jamais investi = 100 € ; un aller-retour coûte 0,2 %.

## Limites à ne pas oublier
- Ces marchés sont inventés : ils valident le code et le protocole, pas la rentabilité réelle. Le « gain » sur les régimes existe parce qu'on a mis des régimes persistants dans le simulateur.
- Réglages choisis au milieu du plateau de sensibilité (légère influence des marchés synthétiques).
- Pas de slippage ni de spread modélisés au-delà des 0,1 % de frais.
- Un historique BTC réel n'est qu'un seul chemin : un gagnant sur ce chemin peut être de la chance.

## Leçons
- Sur un marché sans motif, l'évolution génétique apprend le bruit (sur-apprentissage). Le gain réel vient de trader moins et de gérer le risque.
- Le day trading à 15 min est dominé par les frais et le bruit : horizon 4 h retenu.

## Protocole de choix sur données réelles (objectif : rendement)
- Variantes candidates, liste fixée AVANT de regarder les données : acheter-garder · v2 + survie (vol cible 30 %) · v2 survie allégée (mort à 65 % gardée, zones orange/rouge moins pénalisantes) · v2 vol cible plus haute (50 %, 70 %).
- Découpage dans le temps : entraînement → validation (on choisit la variante au meilleur total) → test final, ouvert une seule fois pour confirmer.
- Critère : capital + coffre à l'arrivée ; bot mort = éliminé. On affiche aussi le pire repli pour savoir ce que coûte le rendement.
- Robustesse : vérifier que la variante choisie reste bonne sur ETH et sur des points de départ décalés, pas seulement sur BTC.

## Résultats sur données réelles (18/11/2026)
Protocole figé et commité avant tout résultat (`protocole_reel.md`) ; script `test_reel.py` (phases selection / robustesse / test, test verrouillé après ouverture). Graphes dans `resultats/`.

Variantes : A acheter-garder · B v2 + survie (vol 30 %) · C v2 survie allégée (orange ×0,75, rouge ×0,5, mort 65 %) · D vol 50 % · E vol 70 % · (R) v2 sans survie, référence hors concours.

**Validation 2021-2023 (choix)** — total € (pire repli)
| | A | B | C | D | E | (R) |
|---|---|---|---|---|---|---|
| BTC | 144 (77 %) | 110 (18 %) | **149 (22 %)** | 116 (18 %) | 126 (17 %) | 154 (29 %) |
| ETH | 306 (81 %) | 174 (12 %) | 157 (19 %) | 148 (16 %) | 185 (16 %) | 200 (21 %) |
→ Choix : **C**. Aucun bot mort.

**Robustesse** (17 fenêtres de 2 ans, départs tous les 3 mois 12/2017 → 12/2021) : C médian 147 € (BTC) / 144 € (ETH) contre 165 € / 214 € pour acheter-garder ; C bat A dans 53 % (BTC) / 41 % (ETH) des fenêtres ; 0 mort. Les bots gagnent quand le marché baisse et sont largement distancés dans les fortes hausses (meilleure fenêtre BTC : A 1 203 € contre C 301 €).

**Test 2024 → 18/11/2026 (ouvert une fois)** — total € (pire repli, trades)
| | A | B | C (choisi) | D | E | (R) |
|---|---|---|---|---|---|---|
| BTC (prix ×1,52) | 152 (53 %, 1) | 147 (13 %) | **165 (18 %, 190)** | 139 | 125 | 171 (27 %) |
| ETH (prix ×0,79) | 79 (68 %, 1) | 138 (17 %) | **175 (17 %, 104)** | 118 | 118 | 153 (28 %) |
Régression ln(capital) = a + b·t (t en années) : BTC A b = 0,099 (+10 %/an), C b = 0,111 (+12 %/an) ; ETH A b = –0,118 (–11 %/an), C b = 0,176 (+19 %/an).

**Verdict** : le critère du protocole est rempli (C bat acheter-garder sur le test, BTC et ETH, sans mourir, avec un repli 3 à 4 fois plus faible). Mais :
- sur BTC l'écart est faible (+8 %) et dépend de la date de fin : acheter-garder valait ~290 € en 10/2025 ;
- sur l'ensemble des fenêtres 2017-2023, acheter-garder a un meilleur total médian : la v2 n'est pas une machine à rendement, c'est une assurance contre les krachs, payée par un gros retard dans les hausses ;
- acheter-garder franchirait le seuil de mort (–35 %) dans toutes les périodes : avec la règle des 65 %, il n'est pas jouable tel quel.
- La survie par défaut (B) coûte cher : en entraînement BTC, B finit à 100 € contre 240 € pour C. Hypothèse : piège « plus haut figé » (après un repli, la taille est réduite, donc le capital remonte trop lentement pour sortir de la zone orange). À vérifier.

## Altcoins et achat à la baisse (18/11/2026)
Protocole figé avant téléchargement : `protocole_altcoins.md` ; scripts `univers.py`, `test_altcoins.py`.
- Univers : 12 premières paires USDT par volume de janvier 2020, paires retirées comprises (contre le biais du survivant) : BCH, ETC, EOS (retiré le 26/05/2025), XRP, LTC, BNB, DASH, TRX, LINK, ADA, ZEC, XLM. Période 2020 → 18/11/2026. Données propres (≤ 5 bougies manquantes par paire).
- Nouvelles variantes (réglages de C) : F achat à la baisse pur (Bollinger 60 bougies, 2σ : entrée sous MM60 − 2σ, sortie au-dessus de MM60) ; G = C + pleine taille sur les creux quand le prix > MM480.

| 12 paires, 2020-2026 | A | B | C | D | E | (R) | F | G |
|---|---|---|---|---|---|---|---|---|
| total médian € | 387 | 155 | 165 | 199 | 142 | 342 | 88 | 158 |
| paires où > A | – | 4 | 4 | 5 | 5 | 6 | 3 | 5 |
| morts | (12 ×) | 0 | 0 | 0 | 0 | 0 | 4 | 3 |
| repli médian | 93 % | 17 % | 21 % | 16 % | 16 % | 38 % | 31 % | 23 % |

Fenêtres de 2 ans (234) : C médian 120 € contre 117 € pour A, C bat A dans 50 % des cas.
Régression sur les fenêtres : ln(C/100) = 0,151 + 0,202·ln(A/100), R² = 0,60.
→ C encaisse ~20 % des mouvements du marché (en log) plus un bonus fixe de +16 % (e^0,151). C bat A quand A fait moins de 100·e^(0,151/0,798) ≈ 121 € sur 2 ans.

Conclusions (selon les critères fixés à l'avance) :
1. C contre A : A gagne nettement sur la période complète (387 € contre 165 € en médiane). Sur 2 ans, c'est pile ou face. C = assurance, pas rendement.
2. G n'est pas retenue (médiane 158 € < 165 €, bat C sur 5/12 paires seulement, 3 morts).
3. F (achat à la baisse pur) est rejetée : 88 € médian, 4 morts. Acheter les creux sans filtre de tendance = rattraper un couteau qui tombe.
4. Constat majeur : (R) sans survie ni coffre bat C sur 12/12 paires (342 € contre 165 €), mais son repli médian de 38 % dépasse le seuil de mort. Ce qui coûte du rendement, c'est la règle des 65 % + le coffre (la moitié de chaque gain sort du jeu et ne compose plus), pas le signal.

## Rendement et risque : critère de Kelly (kelly.py)
Avec une fraction f fixe investie (rééquilibrée à chaque bougie), la croissance annuelle (log) est une parabole :
g(f) = f·μ − f²·σ²/2, maximale en f* = μ/σ² (μ : rendement moyen annuel, σ : volatilité annuelle). La théorie colle à la simulation sur données réelles.
- BTC 2017-2023 : g(f) = 0,64·f − 0,28·f², f* = 1,13 ; ETH : g(f) = 0,75·f − 0,43·f², f* = 0,86. Sur les 12 altcoins 2020-2026, f* est entre 0,28 et 1,43 (médiane ≈ 0,7). Pour EOS, tout investi donne −22 %/an en log alors que f* donne +4 %/an.
- Ces f* sont calculés après coup : l'erreur sur μ (≈ σ/√années ≈ ±0,3) rend f* très incertain. D'où l'usage d'une fraction de Kelly.
- Fraction c de Kelly : croissance = c(2 − c) du maximum ; P(passer un jour sous 65 % du plus haut) = 0,65^(2/c − 1) (marche brownienne, horizon infini, queues fines : optimiste pour la crypto). c = 1 → 65 % de mort ; c = 0,5 → 75 % de la croissance, 27 % de mort ; c = 0,25 → 44 %, 5 %.
- La vol cible 30 % de la v2 correspond à c ≈ 0,35 sur BTC (0,30/0,75 = 0,40 investi, f* = 1,13).

## Prochaines étapes
- ~~Accès Binance, données, protocole de choix~~ : fait le 18/11/2026 (voir Résultats). Variante retenue : C.
- Décider avec Maximilien : garder la mort à 65 % et le coffre à 50 %, ou les assouplir (c'est là qu'est le rendement perdu)
- Comprendre le piège de la survie par défaut (zone orange qui dure) ; la période de test étant consommée, toute nouvelle variante devra être jugée sur des données futures (suivi en papier) ou d'autres paires.
- Suivi en papier de C sur les prix récents avant tout argent réel
- Ensuite seulement : algorithme génétique sur 3-4 réglages max, avec validation en marche avant
- Règle du coffre définitive ; mise en direct (testnet puis réel)
