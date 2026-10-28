# Bot de trading crypto (Telegram + Claude)

Le bot surveille des paires crypto en continu. Quand il détecte une tendance qui démarre, il t'envoie une alerte Telegram avec l'avis de Claude. Tu valides ou tu ignores d'un clic, et le bot passe l'ordre puis gère seul la sortie avec un stop qui suit le prix.

```
Exchange (ccxt) ──► Stratégie ──► Claude (2e avis) ──► Alerte Telegram ──► ✅ Valider ──► Ordre + stop sur l'exchange
                         │                                                                 │
                         └──► Journal : chaque signal suivi comme un trade fictif    Stop suiveur ◄┘
```

## La stratégie

Suivi de tendance sur bougies de 15 min (par défaut). Un signal **LONG** est émis à la clôture d'une bougie si toutes ces conditions sont réunies :

1. l'EMA 9 croise au-dessus de l'EMA 21 ;
2. le prix est au-dessus de l'EMA 50 (on suit la tendance de fond) ;
3. l'ADX est ≥ 20 (le marché est vraiment en tendance, pas en range) ;
4. le volume vaut au moins 1,2 × la moyenne des 20 dernières bougies ;
5. le mouvement attendu couvre les frais : la distance au stop vaut au moins 2,5 × les frais aller-retour (`MIN_RISK_FEE_MULT`). Avec 0,1 % de frais par ordre, un stop à moins de 0,5 % est ignoré.

**Sorties (pas d'objectif fixe) :**
- **Stop initial :** 1,5 × ATR sous l'entrée. Cette distance vaut « 1 R », le risque du trade.
- **Point mort :** dès que le gain atteint 1 R, le stop remonte au prix d'entrée (`BREAKEVEN_R`).
- **Stop suiveur :** ensuite, le stop suit le plus haut atteint à 2,5 × ATR de distance (`TRAIL_ATR`). Il ne redescend jamais.

Les grosses tendances peuvent ainsi rapporter 5 ou 10 R au lieu d'être coupées à 2 R.

**Taille de position :** un stop touché coûte 1 % du capital, avec un plafond de 200 USDT par position.

Tous ces réglages se changent dans le `.env`.

## Le rôle de Claude

Claude n'émet pas les signaux. Il donne un **second avis** sur chacun : verdict (favorable / neutre / défavorable), confiance, résumé et points d'attention (entrée tardive, range, mèches de rejet…). Il ne regarde que les 40 dernières bougies et les indicateurs, pas les news. Si l'appel échoue, l'alerte part quand même.

## Garde-fous

| Garde-fou | Réglage |
|---|---|
| Alerte périmée au bout de 3 min | `ALERT_TTL` |
| Refus si le prix a déjà bougé de plus de 0,3 % à la validation | `MAX_SLIPPAGE_PCT` |
| Positions ouvertes max | `MAX_OPEN_POSITIONS` |
| Perte max par jour : plus d'alertes ensuite | `MAX_DAILY_LOSS_USDT` |
| Une seule position par paire | — |
| Stop-loss posé sur l'exchange en live, déplacé quand le stop suiveur bouge d'au moins 0,25 ATR | `EXCHANGE_STOPS`, `STOP_UPDATE_ATR` |
| Signaux trop petits par rapport aux frais ignorés | `MIN_RISK_FEE_MULT` |
| Bot réservé à ton compte Telegram | `TELEGRAM_CHAT_ID` |

## Installation

```bash
cd trading-bot
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # puis remplis-le
```

**Telegram :**
1. Crée un bot avec [@BotFather](https://t.me/BotFather) (`/newbot`) et récupère le token → `TELEGRAM_TOKEN`.
2. Envoie un message à ton bot, puis ouvre `https://api.telegram.org/bot<TOKEN>/getUpdates` et récupère `chat.id` → `TELEGRAM_CHAT_ID`.

**Claude :** crée une clé sur [platform.claude.com](https://platform.claude.com) → `ANTHROPIC_API_KEY`.

## Utilisation

```bash
# 1. Backtest sur 30 jours (télécharge l'historique et l'enregistre dans data/)
python backtest.py --symbol BTC/USDT --days 30

# 2. Le bot, en mode papier par défaut
python bot.py
```

Commandes Telegram : `/statut`, `/pause`, `/reprendre`, `/fermer_tout`, `/historique`, `/stats`.

L'état (capital fictif, positions, historique) est enregistré dans `data/state.json` et survit aux redémarrages.

## Le journal des signaux (`/stats`)

Chaque signal est enregistré dans `data/journal.json`, même ceux que tu ignores, qui expirent ou que les garde-fous bloquent. Le bot suit chacun comme un trade fictif, avec les mêmes règles de sortie, jusqu'à ce que son stop soit touché. `/stats` compare ensuite les résultats en R, nets de frais :

- **Stratégie seule** (tous les signaux) : la stratégie a-t-elle un avantage ?
- **Selon ta décision** (validé, ignoré, expiré, bloqué, refusé) : tes choix font-ils mieux que la stratégie ?
- **Selon l'avis de Claude** (favorable, neutre, défavorable) : les signaux « défavorables » perdent-ils vraiment plus souvent ?

Il faut au moins 50 trades terminés avant de tirer une conclusion.

## Passer en réel

1. Fais tourner le mode papier assez longtemps pour avoir un échantillon de trades significatif.
2. Crée une clé API **sans droit de retrait**, idéalement restreinte à l'IP de ta machine.
3. Mets `MODE=live`, garde des plafonds bas (`MAX_POSITION_USDT`, `MAX_DAILY_LOSS_USDT`), puis supprime `data/state.json` pour repartir de zéro.

**Limites :**
- **Spot uniquement, long uniquement en réel.** Le short ne fonctionne qu'en mode papier.
- **Le stop sur l'exchange protège contre une panne, mais il ne suit plus le prix si le bot est arrêté.** Le stop suiveur est calculé par le bot : s'il s'arrête, le dernier stop posé reste en place. Si l'exchange refuse l'ordre stop, le bot te prévient sur Telegram et surveille le stop lui-même.
- **Teste les stops sur le testnet de l'exchange avant le réel** (`EXCHANGE_SANDBOX=true`). Ils n'ont été vérifiés qu'avec un exchange simulé, et chaque exchange gère les ordres stop à sa façon.
- Le stop suiveur en direct se base sur le prix relevé toutes les `SCAN_INTERVAL` secondes, alors que le backtest et le journal utilisent le plus haut de chaque bougie. Les résultats réels peuvent donc différer un peu.
- Le capital pris en compte en live est le solde total de la devise de cotation (USDT par défaut). Toutes les paires doivent donc être cotées dans la même devise.
- Les frais payés dans une autre devise (BNB par exemple) ne sont pas comptés dans le PnL.

## Backtest de la rotation hebdomadaire

`rotation_backtest.py` teste une autre approche, sans toucher au bot ni passer d'ordre. Chaque dimanche :

1. **Filtre de marché :** on n'est investi que si BTC est au-dessus de sa moyenne 200 jours. Sinon, tout est en cash.
2. **Classement :** on garde les 3 cryptos qui ont le plus monté sur 28 jours, si elles sont aussi au-dessus de leur propre moyenne 50 jours.
3. **Taille :** plus une crypto est volatile, moins elle reçoit d'argent.

Le script compare la rotation à « garder du BTC » et à « BTC avec le seul filtre de marché ». Cette deuxième référence montre ce qu'apporte la rotation elle-même, au-delà du filtre.

```bash
python rotation_backtest.py                    # 2020 à aujourd'hui, 12 cryptos liquides
python rotation_backtest.py --grid             # + 18 combinaisons de réglages (robustesse)
python rotation_backtest.py --daily-exit       # sortir dès que BTC casse sa moyenne, sans attendre dimanche
```

- **Par an :** le rendement annuel moyen.
- **Pire baisse :** la plus grosse chute subie depuis un sommet.
- **Sharpe :** le rendement divisé par les secousses subies. Plus il est haut, meilleur est le rapport gain/stress. Au-dessus de 1, c'est bon.

Limite : l'univers est choisi aujourd'hui, donc il ne contient pas les cryptos qui se sont effondrées entre-temps. Ça embellit le résultat.

## Tests

```bash
pytest -q tests
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `strategy.py` | Indicateurs (EMA, ATR, ADX), détection des signaux et filtre des frais |
| `exits.py` | Règles de sortie (stop initial, point mort, stop suiveur), communes au bot, au backtest et au journal |
| `journal.py` | Journal de tous les signaux, trades fictifs et statistiques `/stats` |
| `analyst.py` | Avis de Claude (sortie structurée) |
| `broker.py` | Ordres papier ou réels, stops sur l'exchange, positions, garde-fous, sauvegarde |
| `bot.py` | Bot Telegram : surveillance, alertes, boutons, commandes |
| `backtest.py` | Test de la stratégie sur l'historique |
| `config.py` | Lecture du `.env` |
