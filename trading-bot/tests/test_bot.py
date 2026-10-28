import asyncio
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import ccxt  # noqa: E402

from backtest import report, run_backtest  # noqa: E402
from broker import Broker, State  # noqa: E402
from config import Config  # noqa: E402
from exits import ExitParams, TradeTracker, next_stop  # noqa: E402
from journal import Journal  # noqa: E402
from strategy import StrategyParams, add_indicators, ohlcv_to_df, signal_at  # noqa: E402


def make_cfg(tmp_path, **overrides) -> Config:
    base = Config(
        mode="paper", exchange_id="binance", api_key="", api_secret="", sandbox=False,
        symbols=["BTC/USDT"], timeframe="15m", scan_interval=30,
        ema_fast=9, ema_slow=21, ema_trend=50, adx_period=14, adx_min=20, volume_mult=1.2,
        atr_period=14, sl_atr=1.5, trail_atr=2.5, breakeven_r=1.0, allow_short=False, min_risk_fee_mult=2.5,
        paper_balance=1000, risk_per_trade_pct=1.0, max_position_usdt=200, max_open_positions=2,
        max_daily_loss_usdt=50, fee_pct=0.1, exchange_stops=True, stop_update_atr=0.25,
        alert_ttl=180, max_slippage_pct=0.3,
        telegram_token="x", telegram_chat_id=1, claude_enabled=False, claude_model="claude-opus-5-5",
        state_file=str(tmp_path / "state.json"), journal_file=str(tmp_path / "journal.json"),
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


NO_FEE_FILTER = StrategyParams(adx_min=0, min_risk_fee_mult=0)


def test_indicators_are_finite():
    df = add_indicators(synthetic(), StrategyParams())
    tail = df.iloc[StrategyParams().warmup:]
    assert tail[["ema_fast", "atr", "adx"]].notna().all().all()
    assert (tail["adx"].between(0, 100)).all()
    assert (tail["atr"] > 0).all()


def _signals(df, p):
    data = add_indicators(df, p)
    return [s for i in range(len(data)) if (s := signal_at(data, i, "BTC/USDT", p))]


def test_long_signal_on_bullish_crossover():
    sig = _signals(crossover_df(), NO_FEE_FILTER)[0]
    assert sig.side == "long"
    assert sig.stop_loss < sig.price
    assert sig.risk_pct == pytest.approx((sig.price - sig.stop_loss) / sig.price * 100)


def test_fee_filter_rejects_small_moves():
    # Sur ce jeu de données, le stop est à ~0,2 % : moins de 2,5× les 0,2 % de frais aller-retour
    assert _signals(crossover_df(), replace(NO_FEE_FILTER, min_risk_fee_mult=2.5)) == []
    assert _signals(crossover_df(), replace(NO_FEE_FILTER, min_risk_fee_mult=2.5, fee_pct=0.02))


def test_no_short_unless_allowed():
    p = replace(NO_FEE_FILTER, volume_mult=0)
    assert "short" not in {s.side for s in _signals(synthetic(), p)}
    assert "short" in {s.side for s in _signals(synthetic(), replace(p, allow_short=True))}


def test_next_stop_breakeven_then_trailing():
    p = ExitParams(trail_atr=2.5, breakeven_r=1.0)
    # Entrée 100, stop 97 (risque 3), ATR 2
    assert next_stop("long", 100, 97, 2, 102, 97, p) == 97  # pas encore +1 R
    assert next_stop("long", 100, 97, 2, 103, 97, p) == 100  # +1 R : point mort
    assert next_stop("long", 100, 97, 2, 110, 100, p) == 105  # 110 − 2,5 × 2
    assert next_stop("long", 100, 97, 2, 104, 105, p) == 105  # le stop ne recule jamais
    assert next_stop("short", 100, 103, 2, 90, 103, p) == 95


def test_tracker_lets_winners_run():
    p = ExitParams(trail_atr=2.5, breakeven_r=1.0)
    t = TradeTracker.start("long", 100, 97, 2)
    for price in (102, 105, 110, 120, 130):
        assert t.on_candle(price - 1, price, price - 1.5, p) is None
    assert t.stop == 125
    assert t.on_candle(126, 126, 124, p) == 125
    pct, r = t.result(125, fee_pct=0.1)
    assert pct == pytest.approx(24.8)
    assert r == pytest.approx(24.8 / 3)


def _signal():
    return _signals(crossover_df(), NO_FEE_FILTER)[0]


def test_paper_open_close_pnl(tmp_path):
    broker = Broker(make_cfg(tmp_path), exchange=None)
    sig = _signal()
    pos = asyncio.run(broker.open(sig, sig.price))
    assert pos.notional <= 200 + 1e-9
    assert abs((pos.entry_price - pos.stop_loss) * pos.qty) <= 10 + 1e-9

    trade = asyncio.run(broker.close(pos.id, pos.entry_price * 1.01, "test"))
    expected = 0.01 * pos.entry_price * pos.qty - 0.001 * pos.qty * pos.entry_price * (1 + 1.01)
    assert trade.pnl == pytest.approx(expected)
    assert broker.state.equity == pytest.approx(1000 + expected)

    reloaded = State.load(broker.cfg.state_file, 0)
    assert reloaded.equity == pytest.approx(broker.state.equity)
    assert reloaded.history[0].reason == "test"


def test_paper_trailing_stop(tmp_path):
    broker = Broker(make_cfg(tmp_path), exchange=None)
    sig = _signal()
    pos = asyncio.run(broker.open(sig, sig.price))
    risk = pos.entry_price - pos.stop_loss

    res = asyncio.run(broker.update("BTC/USDT", pos.entry_price + risk))
    assert not res.closed and pos.stop_loss == pytest.approx(pos.entry_price)
    assert any("prix d'entrée" in n for n in res.notes)

    high = pos.entry_price + 10 * pos.atr
    asyncio.run(broker.update("BTC/USDT", high))
    assert pos.stop_loss == pytest.approx(high - 2.5 * pos.atr)

    res = asyncio.run(broker.update("BTC/USDT", pos.stop_loss - 0.01))
    assert len(res.closed) == 1
    assert res.closed[0].reason == "stop suiveur" and res.closed[0].pnl > 0
    assert not broker.state.positions


def test_paper_initial_stop(tmp_path):
    broker = Broker(make_cfg(tmp_path), exchange=None)
    sig = _signal()
    pos = asyncio.run(broker.open(sig, sig.price))
    assert asyncio.run(broker.update("BTC/USDT", pos.entry_price)).closed == []
    closed = asyncio.run(broker.update("BTC/USDT", pos.stop_loss * 0.999)).closed
    assert len(closed) == 1 and closed[0].reason == "stop-loss" and closed[0].pnl < 0


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


class FakeLiveExchange:
    """Exchange simulé : ordres au marché exécutés au prix courant, stops en attente."""

    def __init__(self, price):
        self.price = price
        self.orders = {}
        self.stops = []
        self.reject_stops = False

    def _new(self, **order):
        order["id"] = str(len(self.orders) + 1)
        self.orders[order["id"]] = order
        return order

    def amount_to_precision(self, symbol, qty):
        return f"{qty:.6f}"

    def price_to_precision(self, symbol, price):
        return f"{price:.6f}"

    def fetch_balance(self):
        return {"total": {"USDT": 1000.0}}

    def create_order(self, symbol, type_, side, amount):
        return self._new(side=side, status="closed", filled=amount, average=self.price,
                         fee={"cost": amount * self.price * 0.001, "currency": "USDT"})

    def create_stop_loss_order(self, symbol, type_, side, amount, price, stop):
        if self.reject_stops:
            raise ccxt.NotSupported("stop non géré")
        order = self._new(side=side, status="open", amount=amount, stop=stop)
        self.stops.append(order)
        return order

    def cancel_order(self, order_id, symbol):
        order = self.orders[order_id]
        if order["status"] != "open":
            raise ccxt.OrderNotFound(order_id)
        order["status"] = "canceled"

    def fetch_order(self, order_id, symbol):
        return self.orders[order_id]

    def trigger(self, order, price):
        order.update(status="closed", filled=order["amount"], average=price, fee=None)


def _live(tmp_path, sig):
    ex = FakeLiveExchange(sig.price)
    cfg = make_cfg(tmp_path, mode="live", api_key="k", api_secret="s")
    return ex, Broker(cfg, ex)


def test_live_stop_on_exchange_follows_and_fills(tmp_path):
    sig = _signal()
    ex, broker = _live(tmp_path, sig)
    pos = asyncio.run(broker.open(sig, sig.price))
    first = ex.orders[pos.stop_order_id]
    assert first["status"] == "open" and float(first["stop"]) == pytest.approx(pos.stop_loss, rel=1e-6)

    # Le prix monte de 10 ATR : l'ancien stop est annulé et un nouveau est posé plus haut
    asyncio.run(broker.update("BTC/USDT", pos.entry_price + 10 * pos.atr))
    assert first["status"] == "canceled"
    second = ex.orders[pos.stop_order_id]
    assert float(second["stop"]) == pytest.approx(pos.stop_loss, rel=1e-6) and pos.stop_loss > pos.entry_price

    # L'exchange exécute le stop : le bot l'apprend au relevé suivant, sans revendre une 2e fois
    ex.trigger(second, pos.stop_loss)
    sells = sum(1 for o in ex.orders.values() if o["side"] == "sell" and "stop" not in o)
    res = asyncio.run(broker.update("BTC/USDT", pos.stop_loss - 1))
    assert len(res.closed) == 1 and res.closed[0].reason == "stop suiveur"
    assert sum(1 for o in ex.orders.values() if o["side"] == "sell" and "stop" not in o) == sells
    assert not broker.state.positions


def test_live_manual_close_cancels_stop(tmp_path):
    sig = _signal()
    ex, broker = _live(tmp_path, sig)
    pos = asyncio.run(broker.open(sig, sig.price))
    stop = ex.orders[pos.stop_order_id]
    asyncio.run(broker.close(pos.id, sig.price, "manuelle"))
    assert stop["status"] == "canceled"
    assert any(o["side"] == "sell" and o["status"] == "closed" and "stop" not in o for o in ex.orders.values())


def test_live_rejected_stop_falls_back_to_bot(tmp_path):
    sig = _signal()
    ex, broker = _live(tmp_path, sig)
    ex.reject_stops = True
    pos = asyncio.run(broker.open(sig, sig.price))
    assert pos.stop_order_id is None
    res = asyncio.run(broker.update("BTC/USDT", pos.stop_loss * 0.99))
    assert len(res.closed) == 1 and res.closed[0].reason == "stop-loss"


def test_journal_shadow_trades_and_stats(tmp_path):
    df = crossover_df()
    data = add_indicators(df, NO_FEE_FILTER)
    i, sig = next((i, s) for i in range(len(data)) if (s := signal_at(data, i, "BTC/USDT", NO_FEE_FILTER)))

    journal = Journal(str(tmp_path / "journal.json"), NO_FEE_FILTER.exits, fee_pct=0.1)
    kept = journal.add(sig)
    skipped = journal.add(sig, "bloqué", "test")
    journal.set_decision(kept.id, "validé")

    # Bougies suivantes : forte hausse puis chute sous le stop suiveur
    t = data.index[i]
    step = pd.Timedelta(minutes=5)
    rows, prev = [], sig.price
    for k, close in enumerate([sig.price + 2, sig.price + 6, sig.price + 10, sig.price - 5], start=1):
        rows.append([t + k * step, prev, max(prev, close) + 0.2, min(prev, close) - 0.2, close, 100])
        prev = close
    later = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"]).set_index("time")
    journal.update("BTC/USDT", pd.concat([data[["open", "high", "low", "close", "volume"]].iloc[: i + 1], later]))

    reloaded = Journal(str(tmp_path / "journal.json"), NO_FEE_FILTER.exits, fee_pct=0.1)
    rec = reloaded.records[kept.id]
    assert rec.outcome_r is not None and rec.outcome_r > 0 and rec.decision == "validé"
    assert reloaded.records[skipped.id].outcome_r == pytest.approx(rec.outcome_r)
    text = reloaded.stats()
    assert "Stratégie seule : 2 trades" in text and "Validé : 1 trade ·" in text and "Bloqué : 1 trade ·" in text


def test_backtest_runs():
    trades, curve = run_backtest(synthetic(3000), StrategyParams())
    assert len(curve) == 3000
    assert curve.iloc[-1] == pytest.approx(1000 + sum(t.pnl for t in trades))
    assert "Trades" in report(trades, curve, 1000) or not trades
