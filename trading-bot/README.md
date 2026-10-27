# Bot de trading crypto (Telegram + Claude)

Le bot surveille des paires crypto en continu. Quand il détecte une tendance qui démarre, il t'envoie une alerte Telegram avec l'avis de Claude. Tu valides ou tu ignores d'un clic, et le bot passe l'ordre puis gère le stop-loss et l'objectif.

```
Exchange (ccxt) ──► Stratégie ──► Claude (2e avis) ──► Alerte Telegram ──► ✅ Valider ──► Ordre
                                                                                         │
                                       Stop-loss / objectif surveillés en continu ◄──────┘
```

## La stratégie

Suivi de tendance rapide (5 min par défaut). Un signal **LONG** est émis à la clôture d'une bougie si les quatre conditions sont réunies :

1. l'EMA 9 croise au-dessus de l'EMA 21 ;
2. le prix est au-dessus de l'EMA 50 (on suit la tendance de fond) ;
3. l'ADX est ≥ 20 (le marché est vraiment en tendance, pas en range) ;
4. le volume vaut au moins 1,2 × la moyenne des 20 dernières bougies.

- **Stop-loss :** 1,5 × ATR sous l'entrée. **Objectif :** 3 × ATR au-dessus (R/R de 2).
- **Taille de position :** un stop touché coûte 1 % du capital, avec un plafond de 200 USDT par position.

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

Commandes Telegram : `/statut`, `/pause`, `/reprendre`, `/fermer_tout`, `/historique`.

L'état (capital fictif, positions, historique) est enregistré dans `data/state.json` et survit aux redémarrages.

## Passer en réel

1. Fais tourner le mode papier assez longtemps pour avoir un échantillon de trades significatif.
2. Crée une clé API **sans droit de retrait**, idéalement restreinte à l'IP de ta machine.
3. Mets `MODE=live`, garde des plafonds bas (`MAX_POSITION_USDT`, `MAX_DAILY_LOSS_USDT`), puis supprime `data/state.json` pour repartir de zéro.

**Limites de la v1 :**
- **Spot uniquement, long uniquement en réel.** Le short ne fonctionne qu'en mode papier.
- **Stops gérés par le bot, pas par l'exchange.** Le stop-loss et l'objectif sont vérifiés toutes les `SCAN_INTERVAL` secondes et exécutés au marché. Si le bot est arrêté, les positions ouvertes ne sont plus protégées : fais-le tourner sur une machine allumée en permanence (VPS, Raspberry Pi…).
- Le capital pris en compte en live est le solde total de la devise de cotation (USDT par défaut). Toutes les paires doivent donc être cotées dans la même devise.
- Les frais payés dans une autre devise (BNB par exemple) ne sont pas comptés dans le PnL.

## Tests

```bash
pytest -q tests
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `strategy.py` | Indicateurs (EMA, ATR, ADX) et détection des signaux |
| `analyst.py` | Avis de Claude (sortie structurée) |
| `broker.py` | Ordres papier ou réels, positions, garde-fous, sauvegarde |
| `bot.py` | Bot Telegram : surveillance, alertes, boutons, commandes |
| `backtest.py` | Test de la stratégie sur l'historique |
| `config.py` | Lecture du `.env` |
