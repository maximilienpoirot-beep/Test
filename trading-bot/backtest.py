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
from strategy import StrategyParams, add_indicators, ohlcv_to_df, signal_at


@dataclass
class Trade:
    side: str
    entry_time: pd.Timestamp
    entry: float
    exit_time: pd.Timestamp
    exit: float
    pnl: float
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
    fee_pct: float = 0.1,
) -> tuple[list[Trade], pd.Series]:
    """Entrée à l'ouverture de la bougie suivant le signal ; si stop et objectif sont touchés
    dans la même bougie, on compte le stop (hypothèse pessimiste)."""
    data = add_indicators(df, params)
    trades: list[Trade] = []
    equity = balance
    curve = []
    pos = None  # (side, entry_time, entry, qty, sl, tp)

    for i in range(len(data)):
        row = data.iloc[i]
        if pos is not None:
            side, t0, entry, qty, sl, tp = pos
            hit_sl = row["low"] <= sl if side == "long" else row["high"] >= sl
            hit_tp = row["high"] >= tp if side == "long" else row["low"] <= tp
            if hit_sl or hit_tp:
                exit_price = sl if hit_sl else tp
                direction = 1 if side == "long" else -1
                fees = (entry + exit_price) * qty * fee_pct / 100
                pnl = direction * (exit_price - entry) * qty - fees
                equity += pnl
                trades.append(Trade(side, t0, entry, data.index[i], exit_price, pnl, "stop-loss" if hit_sl else "objectif"))
                pos = None
        curve.append(equity)

        if pos is None and i + 1 < len(data):
            sig = signal_at(data, i, "", params)
            if sig:
                entry = data.iloc[i + 1]["open"]
                sl = entry - (sig.price - sig.stop_loss)
                tp = entry + (sig.take_profit - sig.price)
                qty = min(equity * risk_pct / 100 / abs(entry - sl), min(max_position, equity) / entry)
                pos = (sig.side, data.index[i + 1], entry, qty, sl, tp)

    return trades, pd.Series(curve, index=data.index)


def report(trades: list[Trade], curve: pd.Series, balance: float) -> str:
    if not trades:
        return "Aucun trade sur la période."
    pnls = pd.Series([t.pnl for t in trades])
    gains, losses = pnls[pnls > 0].sum(), -pnls[pnls <= 0].sum()
    drawdown = (curve - curve.cummax()).min()
    days = max((curve.index[-1] - curve.index[0]).total_seconds() / 86400, 1e-9)
    return "\n".join([
        f"Période        : {curve.index[0]:%Y-%m-%d} → {curve.index[-1]:%Y-%m-%d} ({days:.0f} j)",
        f"Trades         : {len(trades)} ({len(trades) / days:.1f}/jour)",
        f"Gagnants       : {(pnls > 0).mean() * 100:.0f} %",
        f"PnL total      : {pnls.sum():+.2f} USDT ({pnls.sum() / balance * 100:+.1f} %)",
        f"Gain moyen     : {pnls[pnls > 0].mean() if (pnls > 0).any() else 0:+.2f} · "
        f"Perte moyenne : {pnls[pnls <= 0].mean() if (pnls <= 0).any() else 0:+.2f}",
        f"Profit factor  : {gains / losses if losses else float('inf'):.2f}",
        f"Drawdown max   : {drawdown:.2f} USDT",
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
    trades, curve = run_backtest(
        df, params, cfg.paper_balance, cfg.risk_per_trade_pct, cfg.max_position_usdt, cfg.fee_pct
    )
    print(report(trades, curve, cfg.paper_balance))


if __name__ == "__main__":
    main()
