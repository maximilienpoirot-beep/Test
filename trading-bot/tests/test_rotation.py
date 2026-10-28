import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rotation_backtest import RotationParams, buy_and_hold, metrics, run, target_weights, yearly  # noqa: E402

START = pd.Timestamp("2021-01-01", tz="UTC")


def market(seed: int = 0) -> pd.DataFrame:
    """Marché simulé : 1 an de hausse, un krach de 6 mois, puis une reprise.
    ALT1 monte plus vite que les autres, ALT3 n'est cotée qu'à partir de 2022."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2020-01-01", "2023-06-30", freq="D", tz="UTC")
    n = len(dates)
    phase = np.where(dates < "2021-11-01", 0.003, np.where(dates < "2022-05-01", -0.006, 0.002))
    cols = {}
    for name, beta, extra, noise in [("BTC", 1.0, 0.0, 0.02), ("ALT1", 1.3, 0.002, 0.04),
                                     ("ALT2", 1.1, -0.001, 0.03), ("ALT3", 1.2, 0.0, 0.05)]:
        r = beta * phase + extra + rng.normal(0, noise, n)
        cols[name] = 100 * np.exp(np.cumsum(r))
    closes = pd.DataFrame(cols, index=dates)
    closes.loc[closes.index < "2022-01-01", "ALT3"] = np.nan
    return closes


def test_regime_off_means_cash():
    closes = market()
    p = RotationParams()
    i = closes.index.get_loc(pd.Timestamp("2022-04-24", tz="UTC"))  # au cœur du krach
    assert target_weights(closes, i, p) == {}


def test_picks_strongest_and_weights_sum_to_one():
    closes = market()
    p = RotationParams(top_n=2)
    i = closes.index.get_loc(pd.Timestamp("2021-06-06", tz="UTC"))
    weights = target_weights(closes, i, p)
    assert 0 < len(weights) <= 2
    assert sum(weights.values()) == pytest.approx(1.0)
    assert "ALT3" not in weights  # pas encore cotée


def test_inverse_volatility_sizing():
    dates = pd.date_range("2020-01-01", periods=400, freq="D", tz="UTC")
    t = np.arange(400)
    zigzag = np.where(t % 2 == 0, 1.0, -1.0)  # hausse régulière, oscillation d'amplitude fixe
    calm = 100 * np.exp(0.004 * t + 0.01 * zigzag)
    wild = 100 * np.exp(0.004 * t + 0.03 * zigzag)
    closes = pd.DataFrame({"BTC": calm, "WILD": wild}, index=dates)
    w = target_weights(closes, 399, RotationParams(top_n=2))
    assert set(w) == {"BTC", "WILD"}
    assert w["BTC"] > 2 * w["WILD"]


def test_rotation_limits_crash_drawdown():
    closes = market()
    rot = metrics(run(closes, RotationParams(), START).equity)
    btc = metrics(buy_and_hold(closes, "BTC", START))
    assert btc["max_dd"] < -0.5
    assert rot["max_dd"] > btc["max_dd"] + 0.2


def test_accounting_and_fees():
    closes = market()
    res = run(closes, RotationParams(), START)
    assert res.trades > 0 and res.fees > 0
    assert res.equity.index[0] == START
    no_fee = run(closes, RotationParams(fee_pct=0, slippage_pct=0), START)
    assert no_fee.equity.iloc[-1] > res.equity.iloc[-1]
    # Toujours en cash : le capital ne bouge pas
    never = run(closes, RotationParams(regime_sma=10_000), START)
    assert never.trades == 0 and never.equity.iloc[-1] == pytest.approx(1000)


def test_daily_exit_leaves_faster():
    closes = market()
    weekly = run(closes, RotationParams(), START)
    daily = run(closes, RotationParams(daily_exit=True), START)
    crash = (weekly.equity.index >= "2021-10-15") & (weekly.equity.index <= "2022-01-15")
    assert daily.invested[crash].sum() <= weekly.invested[crash].sum()


def test_btc_only_reference():
    closes = market()
    res = run(closes, replace(RotationParams(), btc_only=True), START)
    assert all(set(w) <= {"BTC"} for _, w in res.holdings_log)


def test_yearly_returns_chain_to_total():
    eq = buy_and_hold(market(), "BTC", START)
    total = (1 + yearly(eq)).prod() - 1
    assert total == pytest.approx(eq.iloc[-1] / eq.iloc[0] - 1)
