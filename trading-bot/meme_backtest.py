"""Backtest « poche casino » sur les memecoins cotés sur Binance (bougies d'1 heure).

Entrée : un memecoin « démarre » quand il a pris au moins SURGE_PCT en 24 h ET que le volume
de la dernière heure vaut au moins VOL_MULT fois sa moyenne horaire des 7 derniers jours.
On achète à l'ouverture de l'heure suivante.

Sorties (trois jeux de règles comparés) :
  A. stop de départ, vente de la moitié à ×2, puis stop suiveur sur le reste
  B. pareil, mais le stop suiveur est actif dès l'entrée
  C. version rapide : stop serré, moitié vendue à +50 %, stop suiveur serré

Contrôle : les mêmes règles avec des entrées tirées au hasard. Si la détection de vagues
ne fait pas mieux que le hasard, elle n'apporte rien.

    python meme_backtest.py
"""

import argparse
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import pandas as pd

API = "https://data-api.binance.vision/api/v3/klines"
MEMES = ("DOGE,SHIB,PEPE,FLOKI,BONK,WIF,BOME,MEME,PEOPLE,TURBO,NEIRO,1000SATS,ACT,PNUT,TRUMP,DOGS,"
         "1000CHEEMS,MUBARAK,BROCCOLI714,TST,1MBABYDOGE,1000CAT,PENGU,BANANAS31,PUMP")
HOUR_MS = 3600 * 1000


@dataclass(frozen=True)
class Rules:
    name: str
    stop: float  # stop de départ (0.20 = −20 %)
    half_at: float  # vente de la moitié à ce gain (1.0 = ×2)
    trail: float  # stop suiveur : distance sous le plus haut
    trail_from_start: bool


RULES = [
    Rules("A · moitié à ×2, puis suiveur 30 %", 0.20, 1.0, 0.30, False),
    Rules("B · suiveur 25 % dès l'entrée", 0.20, 1.0, 0.25, True),
    Rules("C · rapide (−10 %, moitié à +50 %)", 0.10, 0.5, 0.15, True),
]


def fetch_hourly(coin: str) -> pd.DataFrame:
    path = f"data/hourly/{coin}_USDT.csv"
    if os.path.exists(path):
        return pd.read_csv(path, index_col=0, parse_dates=True)
    rows, start = [], 0
    while True:
        url = f"{API}?symbol={urllib.parse.quote(coin + 'USDT')}&interval=1h&startTime={start}&limit=1000"
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:
                    batch = json.load(resp)
                break
            except (OSError, urllib.error.URLError):
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)  # coupure réseau : on réessaie un peu plus tard
        if not batch:
            break
        rows += batch
        start = batch[-1][0] + HOUR_MS
        if len(batch) < 1000:
            break
        time.sleep(0.05)
    df = pd.DataFrame(
        [[k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7])] for k in rows],
        columns=["time", "open", "high", "low", "close", "volume"],
    )
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    df = df.drop_duplicates("time").set_index("time").iloc[:-1]
    df.to_csv(path)
    return df


def surge_signals(df: pd.DataFrame, surge_pct: float, vol_mult: float) -> np.ndarray:
    ret24 = df["close"] / df["close"].shift(24) - 1
    vol_avg = df["volume"].rolling(168).mean().shift(1)
    sig = (ret24 >= surge_pct) & (df["volume"] >= vol_mult * vol_avg)
    sig.iloc[:168] = False
    return np.flatnonzero(sig.to_numpy())


def simulate_trade(o, h, l, entry_i: int, r: Rules, cost: float):
    """Suit un trade heure par heure. Renvoie (indice de sortie, multiple obtenu net de frais)."""
    entry = o[entry_i]
    stop, peak = entry * (1 - r.stop), entry
    remaining, proceeds = 1.0, 0.0
    for i in range(entry_i, len(o)):
        if o[i] <= stop:  # ouverture sous le stop
            return i, proceeds + remaining * o[i] / entry * (1 - cost)
        if l[i] <= stop:
            return i, proceeds + remaining * stop / entry * (1 - cost)
        target = entry * (1 + r.half_at)
        if remaining == 1.0 and h[i] >= target:
            proceeds += 0.5 * target / entry * (1 - cost)
            remaining = 0.5
        peak = max(peak, h[i])
        if r.trail_from_start or remaining < 1.0:
            stop = max(stop, peak * (1 - r.trail))
    last = len(o) - 1  # encore en cours à la fin des données : valorisé au dernier prix
    return last, proceeds + remaining * o[last] / entry * (1 - cost)


def run_portfolio(data: dict, entries: dict, r: Rules, budget: float, max_pos: int,
                  cost: float, cooldown_h: int = 72):
    """Rejoue toutes les entrées dans l'ordre chronologique avec un budget commun."""
    candidates = sorted((data[c].index[i], c, i) for c, idxs in entries.items() for i in idxs)
    cash, open_pos, trades = budget, [], []
    busy_until: dict[str, pd.Timestamp] = {}
    for t, coin, i in candidates:
        # Encaisse les positions terminées avant ce signal
        for p in [p for p in open_pos if p["exit_time"] <= t]:
            cash += p["stake"] * p["multiple"]
            open_pos.remove(p)
        if len(open_pos) >= max_pos or busy_until.get(coin, t) > t or i + 1 >= len(data[coin]):
            continue
        equity = cash + sum(p["stake"] for p in open_pos)
        if equity < budget * 0.1:
            break  # barre de vie à moins de 10 % : la poche est morte
        stake = min(cash, equity / max_pos)
        if stake < 5:
            continue
        o, h, l = (data[coin][k].to_numpy() for k in ("open", "high", "low"))
        exit_i, multiple = simulate_trade(o, h, l, i + 1, r, cost)
        exit_time = data[coin].index[exit_i]
        cash -= stake * (1 + cost)
        open_pos.append({"stake": stake, "multiple": multiple, "exit_time": exit_time})
        busy_until[coin] = exit_time + pd.Timedelta(hours=cooldown_h)
        trades.append({"coin": coin, "entry": data[coin].index[i + 1], "exit": exit_time,
                       "stake": stake, "multiple": multiple, "pnl": stake * (multiple - 1 - cost)})
    final = cash + sum(p["stake"] * p["multiple"] for p in open_pos)
    return final, pd.DataFrame(trades)


def describe(final: float, trades: pd.DataFrame, budget: float) -> str:
    if trades.empty:
        return "aucun trade"
    m = trades["multiple"] - 1
    best = trades.loc[trades["pnl"].idxmax()]
    return (f"{final:>7.0f} $ ({final / budget - 1:+.0%}) · {len(trades)} trades · "
            f"{(m > 0).mean():.0%} gagnants · médiane {m.median():+.0%} · "
            f"meilleur {best['coin']} {best['multiple'] - 1:+.0%}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--coins", default=MEMES)
    parser.add_argument("--budget", type=float, default=100)
    parser.add_argument("--max-pos", type=int, default=3)
    parser.add_argument("--surge", type=float, default=0.20, help="hausse sur 24 h pour déclencher (0.20 = +20 %%)")
    parser.add_argument("--vol-mult", type=float, default=5.0)
    parser.add_argument("--cost", type=float, default=0.002, help="frais + glissement par ordre (0.002 = 0,2 %%)")
    parser.add_argument("--random-runs", type=int, default=30)
    args = parser.parse_args()

    os.makedirs("data/hourly", exist_ok=True)
    coins = [c.strip().upper() for c in args.coins.split(",") if c.strip()]
    print(f"Téléchargement des bougies d'1 h de {len(coins)} memecoins (mis en cache dans data/hourly/)…")
    with ThreadPoolExecutor(4) as ex:
        data = dict(zip(coins, ex.map(fetch_hourly, coins)))
    data = {c: d for c, d in data.items() if len(d) > 200}

    signals = {c: surge_signals(d, args.surge, args.vol_mult) for c, d in data.items()}
    n_sig = sum(len(s) for s in signals.values())
    first = min(d.index[0] for d in data.values())
    print(f"Période : {first:%Y-%m-%d} → aujourd'hui · {n_sig} heures de « vague » détectées "
          f"(+{args.surge:.0%} en 24 h et volume ×{args.vol_mult:g})\n")
    print(f"Budget {args.budget:.0f} $, {args.max_pos} positions max, frais + glissement {args.cost:.1%} par ordre\n")

    rng = np.random.default_rng(0)
    for r in RULES:
        final, trades = run_portfolio(data, signals, r, args.budget, args.max_pos, args.cost)
        print(r.name)
        print(f"  Vagues détectées : {describe(final, trades, args.budget)}")
        # Contrôle : autant d'entrées, mais à des heures tirées au hasard sur chaque memecoin
        finals = []
        for _ in range(args.random_runs):
            rand = {c: np.sort(rng.choice(np.arange(168, len(d) - 1), size=min(len(signals[c]), len(d) - 169), replace=False))
                    for c, d in data.items()}
            finals.append(run_portfolio(data, rand, r, args.budget, args.max_pos, args.cost)[0])
        finals = np.array(finals)
        print(f"  Entrées au hasard : médiane {np.median(finals):.0f} $ · "
              f"de {finals.min():.0f} $ à {finals.max():.0f} $ selon le tirage · "
              f"la détection fait mieux que {(final > finals).mean():.0%} des tirages")
        if not trades.empty:
            by_year = trades.groupby(trades["entry"].dt.year)["pnl"].sum()
            print("  Gain par année : " + " · ".join(f"{y} {v:+.0f} $" for y, v in by_year.items()))
        print()


if __name__ == "__main__":
    main()
