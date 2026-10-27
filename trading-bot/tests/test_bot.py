import asyncio
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backtest import report, run_backtest  # noqa: E402
from broker import Broker, State  # noqa: E402
from config import Config  # noqa: E402
from strategy import StrategyParams, add_indicators, ohlcv_to_df, signal_at  # noqa: E402


def make_cfg(tmp_path, **overrides) -> Config:
    base = Config(
        mode="paper", exchange_id="binance", api_key="", api_secret="", sandbox=False,
        symbols=["BTC/USDT"], timeframe="5m", scan_interval=30,
        ema_fast=9, ema_slow=21, ema_trend=50, adx_period=14, adx_min=20, volume_mult=1.2,
        atr_period=14, sl_atr=1.5, tp_atr=3.0, allow_short=False,
        paper_balance=1000, risk_per_trade_pct=1.0, max_position_usdt=200, max_open_positions=2,
        max_daily_loss_usdt=50, fee_pct=0.1, alert_ttl=180, max_slippage_pct=0.3,
        telegram_token="x", telegram_chat_id=1, claude_enabled=False, claude_model="claude-opus-5-5",
        state_file=str(tmp_path / "state.json"),
    )
    return replace(base, **overrides)


def synthetic(n=600, seed=1) -> pd.DataFrame:
    """Marché aléatoire avec des phases de tendance, pour exercer la stratégie."""
    rng = np.random.default_rng(seed)
    drift = np.repeat(rng.choice([-0.002, 0.0, 0.002], size=n // 50 + 1), 50)[:n]
    close = 100 * np.exp(np.cumsum(drift + rng.normal(0, 0.003, n)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.002, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.002, n))
    volume = rng.uniform(50, 150, n) * (1 + 2 * (np.abs(drift) > 0))
    t0 = 1_700_000_000_000
    rows = [[t0 + i * 300_000, open_[i], high[i], low[i], close[i], volume[i]] for i in range(n)]
    return ohlcv_to_df(rows)


def crossover_df() -> pd.DataFrame:
    """Baisse lente puis rebond net avec volume : doit produire un croisement haussier."""
    n = 120
    close = np.concatenate([np.linspace(100, 97, 110), np.linspace(97.5, 101, 10)])
    open_ = np.concatenate([[close[0]], close[:-1]])
    high, low = np.maximum(open_, close) + 0.05, np.minimum(open_, close) - 0.05
    volume = np.full(n, 100.0)
    volume[-10:] = 400
    rows = [[1_700_000_000_000 + i * 300_000, open_[i], high[i], low[i], close[i], volume[i]] for i in range(n)]
    return ohlcv_to_df(rows)


def test_indicators_are_finite():
    df = add_indicators(synthetic(), StrategyParams())
    tail = df.iloc[StrategyParams().warmup:]
    assert tail[["ema_fast", "atr", "adx"]].notna().all().all()
    assert (tail["adx"].between(0, 100)).all()
    assert (tail["atr"] > 0).all()


def test_long_signal_on_bullish_crossover():
    p = StrategyParams(adx_min=0)
    df = add_indicators(crossover_df(), p)
    signals = [s for i in range(len(df)) if (s := signal_at(df, i, "TEST", p))]
    assert signals, "un croisement haussier aurait dû être détecté"
    sig = signals[0]
    assert sig.side == "long"
    assert sig.stop_loss < sig.price < sig.take_profit
    assert sig.risk_reward == pytest.approx(2.0)


def test_no_short_unless_allowed():
    p = StrategyParams(adx_min=0, volume_mult=0)
    df = add_indicators(synthetic(), p)
    sides = {s.side for i in range(len(df)) if (s := signal_at(df, i, "T", p))}
    assert "short" not in sides
    p_short = replace(p, allow_short=True)
    sides = {s.side for i in range(len(df)) if (s := signal_at(df, i, "T", p_short))}
    assert "short" in sides


def _signal():
    p = StrategyParams(adx_min=0)
    df = add_indicators(crossover_df(), p)
    return next(s for i in range(len(df)) if (s := signal_at(df, i, "BTC/USDT", p)))


def test_paper_open_close_pnl(tmp_path):
    broker = Broker(make_cfg(tmp_path), exchange=None)
    sig = _signal()
    pos = asyncio.run(broker.open(sig, sig.price))
    assert pos.notional <= 200 + 1e-9
    # Perte au stop ≈ 1 % du capital (+ frais), sauf si le plafond de taille a réduit la position
    assert abs((pos.entry_price - pos.stop_loss) * pos.qty) <= 10 + 1e-9

    trade = asyncio.run(broker.close(pos.id, pos.entry_price * 1.01, "test"))
    expected = 0.01 * pos.entry_price * pos.qty - 0.001 * pos.qty * pos.entry_price * (1 + 1.01)
    assert trade.pnl == pytest.approx(expected)
    assert broker.state.equity == pytest.approx(1000 + expected)

    reloaded = State.load(broker.cfg.state_file, 0)
    assert reloaded.equity == pytest.approx(broker.state.equity)
    assert reloaded.history[0].reason == "test"


def test_auto_stop_loss(tmp_path):
    broker = Broker(make_cfg(tmp_path), exchange=None)
    sig = _signal()
    pos = asyncio.run(broker.open(sig, sig.price))
    assert asyncio.run(broker.check_exits("BTC/USDT", pos.entry_price)) == []
    closed = asyncio.run(broker.check_exits("BTC/USDT", pos.stop_loss * 0.999))
    assert len(closed) == 1 and closed[0].reason == "stop-loss" and closed[0].pnl < 0
    assert not broker.state.positions


def test_risk_guards(tmp_path):
    broker = Broker(make_cfg(tmp_path), exchange=None)
    sig = _signal()
    asyncio.run(broker.open(sig, sig.price))
    assert "déjà ouverte" in broker.risk_block_reason(sig)

    other = replace(sig, symbol="ETH/USDT")
    broker.state.daily_pnl[pd.Timestamp.now(tz="UTC").date().isoformat()] = -60
    assert "perte max" in broker.risk_block_reason(other)
    with pytest.raises(RuntimeError):
        asyncio.run(broker.open(other, other.price))

    broker.state.daily_pnl.clear()
    broker.state.paused = True
    assert "pause" in broker.risk_block_reason(other)


def test_backtest_runs():
    trades, curve = run_backtest(synthetic(3000), StrategyParams())
    assert len(curve) == 3000
    assert curve.iloc[-1] == pytest.approx(1000 + sum(t.pnl for t in trades))
    assert "Trades" in report(trades, curve, 1000) or not trades
