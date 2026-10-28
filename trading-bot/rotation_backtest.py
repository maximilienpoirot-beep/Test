"""Backtest de la rotation hebdomadaire, comparée à « garder du BTC ».

Chaque semaine (le dimanche à la clôture) :
  1. Filtre de marché : on n'est investi que si BTC est au-dessus de sa moyenne sur REGIME_SMA jours.
  2. Classement : les cryptos de l'univers sont triées par performance sur LOOKBACK jours.
     On garde les TOP_N meilleures, à condition qu'elles montent et soient au-dessus de leur
     propre moyenne sur TREND_SMA jours.
  3. Taille : chaque crypto reçoit un poids inversement proportionnel à sa volatilité.

Exemples :
    python rotation_backtest.py
    python rotation_backtest.py --top 5 --lookback 56
    python rotation_backtest.py --grid          # teste plusieurs réglages pour vérifier la robustesse
"""

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, replace

import ccxt
import numpy as np
import pandas as pd

DEFAULT_UNIVERSE = "BTC,ETH,BNB,SOL,XRP,ADA,DOGE,AVAX,LINK,DOT,LTC,TRX"
DAYS_PER_YEAR = 365


@dataclass(frozen=True)
class RotationParams:
    top_n: int = 3
    lookback: int = 28  # jours de performance pour le classement
    regime_sma: int = 200  # moyenne de BTC pour le filtre de marché
    trend_sma: int = 50  # moyenne propre à chaque crypto
    vol_window: int = 30  # jours pour mesurer la volatilité
    rebalance_day: int = 6  # 0 = lundi … 6 = dimanche
    daily_exit: bool = False  # sortir dès que le filtre de marché casse, sans attendre le dimanche
    band: float = 0.10  # une ligne gardée n'est réajustée que si son poids s'écarte de plus de 10 points
    fee_pct: float = 0.1  # par ordre
    slippage_pct: float = 0.05  # écart de prix estimé par ordre
    btc_only: bool = False  # référence : BTC avec le seul filtre de marché, sans rotation

    @property
    def warmup(self) -> int:
        return max(self.lookback, self.trend_sma, self.vol_window) + 1


# --- Données -----------------------------------------------------------------

def fetch_daily(exchange: ccxt.Exchange, symbol: str, since_ms: int) -> pd.Series:
    rows: list[list] = []
    day_ms = 24 * 3600 * 1000
    while since_ms < exchange.milliseconds() - day_ms:
        batch = exchange.fetch_ohlcv(symbol, "1d", since=since_ms, limit=1000)
        if not batch:
            break
        rows += batch
        since_ms = batch[-1][0] + day_ms
        time.sleep(exchange.rateLimit / 1000)
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True).dt.normalize()
    s = df.drop_duplicates("time").set_index("time")["close"].astype(float)
    return s.iloc[:-1]  # la bougie du jour n'est pas clôturée


BINANCE_PUBLIC_DATA = "https://data-api.binance.vision/api/v3/klines"


def fetch_binance_daily(symbol: str, since_ms: int) -> pd.Series:
    """Clôtures journalières via l'adresse publique de Binance réservée aux données de marché,
    accessible même là où l'API de trading est bloquée."""
    rows: list[list] = []
    day_ms = 24 * 3600 * 1000
    now_ms = int(time.time() * 1000)
    while since_ms < now_ms - day_ms:
        url = f"{BINANCE_PUBLIC_DATA}?symbol={symbol.replace('/', '')}&interval=1d&startTime={since_ms}&limit=1000"
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                batch = json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 400:
                raise ccxt.BadSymbol(symbol) from e
            raise
        if not batch:
            break
        rows += batch
        since_ms = batch[-1][0] + day_ms
    if not rows:
        return pd.Series(dtype=float)
    idx = pd.to_datetime([r[0] for r in rows], unit="ms", utc=True)
    s = pd.Series([float(r[4]) for r in rows], index=idx, name="close")
    return s[~s.index.duplicated()].iloc[:-1]  # la bougie du jour n'est pas clôturée


def load_closes(exchange_id: str, coins: list[str], quote: str, start: pd.Timestamp, refresh: bool) -> pd.DataFrame:
    """Clôtures journalières, une colonne par crypto (NaN avant sa cotation). Mises en cache dans data/daily/."""
    os.makedirs("data/daily", exist_ok=True)
    exchange = None if exchange_id == "binance" else getattr(ccxt, exchange_id)({"enableRateLimit": True})
    since_ms = int((start - pd.Timedelta(days=400)).timestamp() * 1000)
    series = {}
    for coin in coins:
        path = f"data/daily/{coin}_{quote}.csv"
        if os.path.exists(path) and not refresh:
            s = pd.read_csv(path, index_col=0, parse_dates=True)["close"]
            s.index = pd.to_datetime(s.index, utc=True)
        else:
            print(f"Téléchargement de {coin}/{quote}…")
            try:
                symbol = f"{coin}/{quote}"
                s = fetch_binance_daily(symbol, since_ms) if exchange is None else fetch_daily(exchange, symbol, since_ms)
            except ccxt.BadSymbol:
                print(f"  {coin}/{quote} n'existe pas sur {exchange_id}, ignoré")
                continue
            s.rename("close").to_csv(path)
        series[coin] = s
    closes = pd.DataFrame(series).sort_index()
    # Comble les rares jours manquants, sans prolonger une crypto après sa dernière cotation
    return closes.ffill(limit=3)


# --- Stratégie ---------------------------------------------------------------

def target_weights(closes: pd.DataFrame, i: int, p: RotationParams) -> dict[str, float]:
    """Poids visés au jour d'indice i (vide = tout en cash)."""
    btc = closes["BTC"].iloc[: i + 1].dropna()
    if len(btc) < p.regime_sma or btc.iloc[-1] <= btc.iloc[-p.regime_sma:].mean():
        return {}
    if p.btc_only:
        return {"BTC": 1.0}

    scores = {}
    for coin in closes.columns:
        hist = closes[coin].iloc[: i + 1].dropna()
        if len(hist) < p.warmup or hist.index[-1] != closes.index[i]:
            continue
        momentum = hist.iloc[-1] / hist.iloc[-1 - p.lookback] - 1
        above_trend = hist.iloc[-1] > hist.iloc[-p.trend_sma:].mean()
        if momentum > 0 and above_trend:
            vol = hist.pct_change().iloc[-p.vol_window:].std()
            scores[coin] = (momentum, vol)

    chosen = sorted(scores, key=lambda c: scores[c][0], reverse=True)[: p.top_n]
    if not chosen:
        return {}
    inv_vol = {c: 1 / scores[c][1] for c in chosen if scores[c][1] > 0}
    total = sum(inv_vol.values())
    return {c: v / total for c, v in inv_vol.items()}


@dataclass
class Result:
    equity: pd.Series
    invested: pd.Series  # part du capital investie chaque jour
    trades: int
    fees: float
    holdings_log: list[tuple[pd.Timestamp, dict[str, float]]]


def run(closes: pd.DataFrame, p: RotationParams, start: pd.Timestamp, capital: float = 1000.0) -> Result:
    cost = (p.fee_pct + p.slippage_pct) / 100
    units: dict[str, float] = {}
    cash = capital
    trades, fees = 0, 0.0
    equity, invested, log = [], [], []
    dates = closes.index

    for i, day in enumerate(dates):
        if day < start:
            continue
        prices = closes.iloc[i]
        value = cash + sum(u * prices[c] for c, u in units.items())

        rebalance = day.dayofweek == p.rebalance_day
        if p.daily_exit and units and not rebalance and not target_weights(closes, i, replace(p, btc_only=True)):
            rebalance = True  # le filtre de marché vient de casser : on sort sans attendre
        if rebalance:
            target = target_weights(closes, i, p)
            if p.daily_exit and day.dayofweek != p.rebalance_day:
                target = {}
            current = {c: u * prices[c] / value for c, u in units.items()}
            # Ventes d'abord : lignes sorties du panier ou trop lourdes
            for c in list(units):
                goal = target.get(c, 0.0)
                if goal == 0.0 or current[c] - goal > p.band:
                    sell_value = (current[c] - goal) * value
                    units[c] -= sell_value / prices[c]
                    cash += sell_value * (1 - cost)
                    fees += sell_value * cost
                    trades += 1
                    if goal == 0.0:
                        del units[c]
            # Puis achats : nouvelles lignes ou lignes trop légères
            for c, goal in target.items():
                have = current.get(c, 0.0) if c in units else 0.0
                if c not in units or goal - have > p.band:
                    buy_value = min((goal - have) * value, cash / (1 + cost))
                    if buy_value <= 0:
                        continue
                    units[c] = units.get(c, 0.0) + buy_value / prices[c]
                    cash -= buy_value * (1 + cost)
                    fees += buy_value * cost
                    trades += 1
            value = cash + sum(u * prices[c] for c, u in units.items())
            log.append((day, {c: u * prices[c] / value for c, u in units.items()}))

        equity.append(value)
        invested.append(1 - cash / value if value else 0.0)

    idx = dates[dates >= start]
    return Result(pd.Series(equity, index=idx), pd.Series(invested, index=idx), trades, fees, log)


def buy_and_hold(closes: pd.DataFrame, coin: str, start: pd.Timestamp, capital: float = 1000.0) -> pd.Series:
    s = closes[coin][closes.index >= start].dropna()
    return s / s.iloc[0] * capital


# --- Mesures -----------------------------------------------------------------

def metrics(equity: pd.Series) -> dict[str, float]:
    returns = equity.pct_change().dropna()
    years = max((equity.index[-1] - equity.index[0]).days / DAYS_PER_YEAR, 1e-9)
    total = equity.iloc[-1] / equity.iloc[0] - 1
    return {
        "total": total,
        "cagr": (1 + total) ** (1 / years) - 1,
        "max_dd": (equity / equity.cummax() - 1).min(),
        "vol": returns.std() * np.sqrt(DAYS_PER_YEAR),
        "sharpe": returns.mean() / returns.std() * np.sqrt(DAYS_PER_YEAR) if returns.std() else 0.0,
    }


def yearly(equity: pd.Series) -> pd.Series:
    """Performance de chaque année civile (la première depuis le début du test)."""
    year_end = equity.groupby(equity.index.year).last()
    previous = year_end.shift(1)
    previous.iloc[0] = equity.iloc[0]
    return year_end / previous - 1


def pct(x: float) -> str:
    return f"{x * 100:+.0f} %"


def summary_table(curves: dict[str, pd.Series]) -> str:
    rows = [f"{'':28}{'Total':>10}{'Par an':>10}{'Pire baisse':>13}{'Sharpe':>8}"]
    for name, eq in curves.items():
        m = metrics(eq)
        rows.append(f"{name:28}{pct(m['total']):>10}{pct(m['cagr']):>10}{pct(m['max_dd']):>13}{m['sharpe']:>8.2f}")
    return "\n".join(rows)


def yearly_table(curves: dict[str, pd.Series]) -> str:
    years = {name: yearly(eq) for name, eq in curves.items()}
    all_years = sorted(set().union(*[y.index for y in years.values()]))
    header = f"{'Année':8}" + "".join(f"{name[:16]:>18}" for name in curves)
    rows = [header]
    for y in all_years:
        cells = [pct(years[n][y]) if y in years[n].index else "—" for n in curves]
        rows.append(f"{y:<8}" + "".join(f"{cell:>18}" for cell in cells))
    return "\n".join(rows)


def grid(closes: pd.DataFrame, base: RotationParams, start: pd.Timestamp) -> str:
    btc = metrics(buy_and_hold(closes, "BTC", start))
    rows = [f"{'Top':>4}{'Période':>9}{'Filtre BTC':>12}{'Par an':>9}{'Pire baisse':>13}{'Sharpe':>8}"]
    better = total = 0
    for top in (2, 3, 5):
        for lookback in (14, 28, 56):
            for regime in (100, 200):
                p = replace(base, top_n=top, lookback=lookback, regime_sma=regime)
                m = metrics(run(closes, p, start).equity)
                total += 1
                better += m["sharpe"] > btc["sharpe"]
                rows.append(f"{top:>4}{lookback:>8}j{regime:>11}j{pct(m['cagr']):>9}{pct(m['max_dd']):>13}{m['sharpe']:>8.2f}")
    rows.append(f"\nRéglages qui battent « garder du BTC » au ratio de Sharpe ({btc['sharpe']:.2f}) : {better}/{total}")
    return "\n".join(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", default="2020-01-01", help="début de la période testée")
    parser.add_argument("--universe", default=DEFAULT_UNIVERSE, help="cryptos, séparées par des virgules")
    parser.add_argument("--quote", default="USDT")
    parser.add_argument("--exchange", default="binance")
    parser.add_argument("--top", type=int, default=3)
    parser.add_argument("--lookback", type=int, default=28)
    parser.add_argument("--regime", type=int, default=200)
    parser.add_argument("--daily-exit", action="store_true", help="sortir dès que BTC casse sa moyenne, sans attendre dimanche")
    parser.add_argument("--fee", type=float, default=0.1, help="frais par ordre en %%")
    parser.add_argument("--grid", action="store_true", help="tester 18 combinaisons de réglages")
    parser.add_argument("--refresh", action="store_true", help="retélécharger les données")
    args = parser.parse_args()

    coins = [c.strip().upper() for c in args.universe.split(",") if c.strip()]
    if "BTC" not in coins:
        coins.insert(0, "BTC")
    start = pd.Timestamp(args.since, tz="UTC")
    closes = load_closes(args.exchange, coins, args.quote, start, args.refresh)

    p = RotationParams(top_n=args.top, lookback=args.lookback, regime_sma=args.regime,
                       daily_exit=args.daily_exit, fee_pct=args.fee)
    result = run(closes, p, start)
    btc_filtered = run(closes, replace(p, btc_only=True), start)
    curves = {
        f"Rotation (top {p.top_n})": result.equity,
        "BTC avec filtre seul": btc_filtered.equity,
        "Garder du BTC": buy_and_hold(closes, "BTC", start),
    }

    eq = result.equity
    print(f"\nPériode : {eq.index[0]:%Y-%m-%d} → {eq.index[-1]:%Y-%m-%d} · univers : {', '.join(closes.columns)}")
    print(f"Réglages : top {p.top_n}, performance sur {p.lookback} j, filtre BTC {p.regime_sma} j"
          + (", sortie quotidienne" if p.daily_exit else "") + f", frais {p.fee_pct} % + glissement {p.slippage_pct} %\n")
    print(summary_table(curves))
    print(f"\nRotation : {result.trades} ordres ({result.trades / max(len(eq) / 7, 1):.1f}/semaine) · "
          f"frais payés {result.fees:.0f} pour un capital de départ de 1 000 · investie {result.invested.mean() * 100:.0f} % du temps\n")
    print(yearly_table(curves))

    last = result.holdings_log[-1] if result.holdings_log else None
    if last:
        held = ", ".join(f"{c} {w * 100:.0f} %" for c, w in sorted(last[1].items(), key=lambda x: -x[1])) or "100 % en cash"
        print(f"\nDernier rééquilibrage ({last[0]:%Y-%m-%d}) : {held}")

    if args.grid:
        print("\nRobustesse : les mêmes années avec d'autres réglages\n")
        print(grid(closes, p, start))

    print("\n⚠️  L'univers est choisi aujourd'hui : il ne contient pas les cryptos qui se sont effondrées entre-temps,"
          "\n   ce qui embellit le résultat. Un écart faible avec BTC n'est donc pas une preuve.")


if __name__ == "__main__":
    main()
