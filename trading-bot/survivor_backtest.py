"""Backtest de survie : le bot survivant lâché à de nombreuses dates de départ, avec et sans barre de vie.

    python survivor_backtest.py              # départs mensuels depuis 2020, 1 an de vie chacun
    python survivor_backtest.py --months 6   # vies de 6 mois
"""

import argparse
from dataclasses import replace

import numpy as np
import pandas as pd

from meme_backtest import fetch_hourly
from survivor import MEMECOINS, Survivor, SurvivorConfig, surge_signal


def prepare(cfg: SurvivorConfig):
    data = {c: fetch_hourly(c) for c in MEMECOINS}
    data = {c: d for c, d in data.items() if len(d) > 200}
    arrays = {c: (d.index, d[["open", "high", "low", "close"]].to_numpy()) for c, d in data.items()}
    row_of = {c: {t: i for i, t in enumerate(idx)} for c, (idx, _) in arrays.items()}
    signals: dict[pd.Timestamp, list[str]] = {}
    for c, d in data.items():
        for t in d.index[surge_signal(d, cfg)]:
            signals.setdefault(t, []).append(c)
    return arrays, row_of, signals


def live_one(arrays, row_of, signals, cfg: SurvivorConfig, start: pd.Timestamp, end: pd.Timestamp) -> Survivor:
    """Fait vivre un survivant heure par heure. Entrée au prix de clôture de la bougie qui donne le signal."""
    s = Survivor.new(cfg, start)
    s.lowest_total = cfg.start_hp
    last: dict[str, float] = {}
    for t in pd.date_range(start, end, freq="h", inclusive="left"):
        for coin in list(s.positions):
            i = row_of[coin].get(t)
            if i is None:
                continue
            o, h, l, c = arrays[coin][1][i]
            s.on_bar(coin, o, h, l, t)
            last[coin] = c
        s.check(last, t)
        s.lowest_total = min(s.lowest_total, s.hp(last) + s.vault)
        if s.dead:
            break
        for coin in signals.get(t, []):
            i = row_of[coin][t]
            price = arrays[coin][1][i][3]
            last[coin] = price
            s.attack(coin, price, t, last)
    s.check(last, end)
    s.final_prices = last
    return s


def summarize(lives: list[Survivor]) -> dict[str, float]:
    totals = np.array([s.hp(s.final_prices) + s.vault for s in lives])
    return {
        "morts": np.mean([s.dead for s in lives]),
        "mediane": np.median(totals),
        "au_dessus": np.mean(totals > 100),
        "plus_bas": np.median([s.lowest_total for s in lives]),
        "coffre": np.mean([s.vault > 0 for s in lives]),
        "combats": np.median([len(s.history) for s in lives]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--months", type=int, default=12, help="durée de chaque vie")
    args = parser.parse_args()

    cfg = SurvivorConfig()
    arrays, row_of, signals = prepare(cfg)
    data_end = max(idx[-1] for idx, _ in arrays.values()).floor("D")
    starts = pd.date_range(pd.Timestamp("2020-01-01", tz=data_end.tz), data_end - pd.DateOffset(months=args.months), freq="MS")
    print(f"{len(starts)} vies de {args.months} mois, une par mois de départ entre "
          f"{starts[0]:%Y-%m} et {starts[-1]:%Y-%m}\n")

    variants = {"Avec barre de vie": cfg, "Sans barre de vie (mise fixe 33 %)": replace(cfg, hp_rules=False)}
    print(f"{'':36}{'Morts':>7}{'Total médian':>14}{'Finit > 100 $':>15}{'Plus bas médian':>17}{'Coffre rempli':>15}{'Combats':>9}")
    for name, c in variants.items():
        lives = [live_one(arrays, row_of, signals, c, t0, t0 + pd.DateOffset(months=args.months)) for t0 in starts]
        r = summarize(lives)
        print(f"{name:36}{r['morts']:>7.0%}{r['mediane']:>12.0f} ${r['au_dessus']:>14.0%}"
              f"{r['plus_bas']:>15.0f} ${r['coffre']:>14.0%}{r['combats']:>9.0f}")

    print("\nUne vie complète depuis 2020, puis depuis 2024 (avec barre de vie) :")
    for t0 in (pd.Timestamp("2020-01-01", tz=data_end.tz), pd.Timestamp("2024-01-01", tz=data_end.tz)):
        s = live_one(arrays, row_of, signals, cfg, t0, data_end)
        end = s.died_at[:10] if s.dead else "aujourd'hui"
        print(f"  {t0:%Y-%m-%d} → {end} : {s.hp(s.final_prices):.0f} PV + {s.vault:.0f} $ au coffre · "
              f"{len(s.history)} combats · total au plus bas {s.lowest_total:.0f} $" + (" · 💀 mort" if s.dead else ""))


if __name__ == "__main__":
    main()
