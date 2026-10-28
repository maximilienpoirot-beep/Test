"""Teste la stratégie sur l'historique, sans Claude ni validation manuelle.

Exemples :
    python backtest.py --symbol BTC/USDT --days 30
    python backtest.py --csv data/BTC_USDT_5m.csv
"""

import argparse
import os
import time
from dataclasses import dataclass

import ccxt
import pandas as pd

from config import load_config
from exits import TradeTracker, exit_reason
from strategy import StrategyParams, add_indicators, ohlcv_to_df, signal_at


@dataclass
class Trade:
    side: str
    entry_time: pd.Timestamp
    entry: float
    exit_time: pd.Timestamp
    exit: float
    pnl: float
    r: float  # résultat net de frais, en multiples du risque initial
    reason: str


def fetch_history(exchange_id: str, symbol: str, timeframe: str, days: int) -> pd.DataFrame:
    exchange = getattr(ccxt, exchange_id)({"enableRateLimit": True})
    tf_ms = exchange.parse_timeframe(timeframe) * 1000
    since = exchange.milliseconds() - days * 24 * 3600 * 1000
    rows: list[list] = []
    while since < exchange.milliseconds() - tf_ms:
        batch = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)
        if not batch:
            break
        rows += batch
        since = batch[-1][0] + tf_ms
        time.sleep(exchange.rateLimit / 1000)
    df = ohlcv_to_df(rows)
    return df[~df.index.duplicated()].iloc[:-1]  # dernière bougie pas encore clôturée


def run_backtest(
    df: pd.DataFrame,
    params: StrategyParams,
    balance: float = 1000,
    risk_pct: float = 1.0,
    max_position: float = 200,
) -> tuple[list[Trade], pd.Series]:
    """Entrée à l'ouverture de la bougie suivant le signal, puis mêmes règles de sortie que le bot
    (stop initial, point mort, stop suiveur). Dans chaque bougie, le stop est vérifié avant
    de profiter du plus haut : hypothèse prudente."""
    data = add_indicators(df, params)
    trades: list[Trade] = []
    equity = balance
    curve = []
    pos = None  # (tracker, entry_time, qty)

    for i in range(len(data)):
        row = data.iloc[i]
        if pos is not None:
            tracker, t0, qty = pos
            exit_price = tracker.on_candle(row["open"], row["high"], row["low"], params.exits)
            if exit_price is not None:
                direction = 1 if tracker.side == "long" else -1
                fees = (tracker.entry + exit_price) * qty * params.fee_pct / 100
                pnl = direction * (exit_price - tracker.entry) * qty - fees
                equity += pnl
                _, r = tracker.result(exit_price, params.fee_pct)
                reason = exit_reason(tracker.side, tracker.entry, exit_price)
                trades.append(Trade(tracker.side, t0, tracker.entry, data.index[i], exit_price, pnl, r, reason))
                pos = None
        curve.append(equity)

        if pos is None and i + 1 < len(data):
            sig = signal_at(data, i, "", params)
            if sig:
                entry = data.iloc[i + 1]["open"]
                sl = entry - (sig.price - sig.stop_loss)
                qty = min(equity * risk_pct / 100 / abs(entry - sl), min(max_position, equity) / entry)
                pos = (TradeTracker.start(sig.side, entry, sl, sig.atr), data.index[i + 1], qty)

    return trades, pd.Series(curve, index=data.index)


def report(trades: list[Trade], curve: pd.Series, balance: float) -> str:
    if not trades:
        return "Aucun trade sur la période."
    pnls = pd.Series([t.pnl for t in trades])
    rs = pd.Series([t.r for t in trades])
    gains, losses = pnls[pnls > 0].sum(), -pnls[pnls <= 0].sum()
    drawdown = (curve - curve.cummax()).min()
    days = max((curve.index[-1] - curve.index[0]).total_seconds() / 86400, 1e-9)
    reasons = pd.Series([t.reason for t in trades]).value_counts()
    return "\n".join([
        f"Période        : {curve.index[0]:%Y-%m-%d} → {curve.index[-1]:%Y-%m-%d} ({days:.0f} j)",
        f"Trades         : {len(trades)} ({len(trades) / days:.1f}/jour)",
        f"Gagnants       : {(pnls > 0).mean() * 100:.0f} %",
        f"PnL total      : {pnls.sum():+.2f} USDT ({pnls.sum() / balance * 100:+.1f} %)",
        f"Par trade      : {rs.mean():+.2f} R en moyenne · meilleur {rs.max():+.1f} R · pire {rs.min():+.1f} R",
        f"Profit factor  : {gains / losses if losses else float('inf'):.2f}",
        f"Drawdown max   : {drawdown:.2f} USDT",
        "Sorties        : " + " · ".join(f"{name} {count}" for name, count in reasons.items()),
    ])


def main() -> None:
    cfg = load_config(require_telegram=False)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--symbol", default=cfg.symbols[0])
    parser.add_argument("--timeframe", default=cfg.timeframe)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--csv", help="CSV time,open,high,low,close,volume (time en ms) au lieu de télécharger")
    args = parser.parse_args()

    if args.csv:
        df = ohlcv_to_df(pd.read_csv(args.csv).values.tolist())
    else:
        print(f"Téléchargement de {args.days} j de {args.symbol} {args.timeframe} sur {cfg.exchange_id}…")
        df = fetch_history(cfg.exchange_id, args.symbol, args.timeframe, args.days)
        os.makedirs("data", exist_ok=True)
        path = f"data/{args.symbol.replace('/', '_')}_{args.timeframe}.csv"
        out = df.reset_index()
        out["time"] = (out["time"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1)
        out.to_csv(path, index=False)
        print(f"Données enregistrées dans {path}")

    params = StrategyParams.from_config(cfg)
    trades, curve = run_backtest(df, params, cfg.paper_balance, cfg.risk_per_trade_pct, cfg.max_position_usdt)
    print(report(trades, curve, cfg.paper_balance))


if __name__ == "__main__":
    main()
