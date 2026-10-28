import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from survivor import Survivor, SurvivorConfig, surge_signal  # noqa: E402

T0 = pd.Timestamp("2026-01-01", tz="UTC")
H = pd.Timedelta(hours=1)


def new(**overrides):
    return Survivor.new(replace(SurvivorConfig(), **overrides), T0)


def lose(s, coin, t):
    s.attack(coin, 1.0, t, {})
    return s.on_bar(coin, 1.0, 1.0, 0.7, t + H)


def test_attack_sizes_on_current_hp():
    s = new()
    ev = s.attack("PEPE", 2.0, T0, {})
    assert ev and "PEPE" in ev.text
    assert s.positions["PEPE"].stake == pytest.approx(30)
    assert s.cash == pytest.approx(70)
    assert s.positions["PEPE"].stop == pytest.approx(1.6)
    assert s.attack("PEPE", 2.0, T0, {}) is None  # déjà en position
    s.attack("WIF", 1.0, T0, {})
    s.attack("BONK", 1.0, T0, {})
    assert s.attack("DOGE", 1.0, T0, {}) is None  # 3 attaques max en forme


def test_double_then_trailing_stop():
    s = new()
    s.attack("PEPE", 1.0, T0, {})
    qty = s.positions["PEPE"].qty
    ev = s.on_bar("PEPE", 1.0, 2.0, 1.0, T0 + H)
    assert ev and "doublé" in ev[0].text
    assert s.positions["PEPE"].qty == pytest.approx(qty / 2)
    # La moitié encaissée compte tout de suite dans les PV
    assert s.hp({"PEPE": 2.0}) == pytest.approx(70 + qty / 2 * 2 * 0.998 + qty / 2 * 2)
    s.on_bar("PEPE", 2.0, 4.0, 2.0, T0 + 2 * H)
    assert s.positions["PEPE"].stop == pytest.approx(2.8)  # 30 % sous le plus haut
    ev = s.on_bar("PEPE", 3.0, 3.0, 2.7, T0 + 3 * H)
    assert "stop suiveur" in ev[0].text
    trade = s.history[-1]
    assert trade.pnl == pytest.approx(qty / 2 * 2 * 0.998 + qty / 2 * 2.8 * 0.998 - 30)
    assert not s.positions and s.cash == pytest.approx(70 + trade.pnl + 30)


def test_gap_below_stop_exits_at_open():
    s = new()
    s.attack("PEPE", 1.0, T0, {})
    s.on_bar("PEPE", 0.5, 0.6, 0.4, T0 + H)
    assert s.history[-1].multiple == pytest.approx(0.5 * 0.998 * 0.998)


def test_three_losses_stun_and_cooldown():
    s = new()
    t = T0
    for coin in ("A", "B", "C"):
        ev = lose(s, coin, t)
        t += 2 * H
    assert "sonné" in ev[0].text
    assert s.block_reason("D", t) == "sonné"
    assert s.block_reason("D", t + pd.Timedelta(hours=25)) is None
    assert "récupère" in s.block_reason("A", t + pd.Timedelta(hours=25))


def test_vault_locks_gains():
    s = new()
    s.cash = 160
    ev = s.check({}, T0)
    assert any("coffre" in e.text for e in ev)
    assert s.vault == 50 and s.cash == pytest.approx(110)
    assert new(hp_rules=False).check({}, T0) == []


def test_levels_hibernation_and_wake_up():
    s = new()
    s.cash = 60
    ev = s.check({}, T0)
    assert s.level == "injured" and "faiblit" in ev[0].text
    s.cash = 20
    ev = s.check({}, T0)
    assert s.level == "critical" and "hibernation" in ev[0].text
    assert s.block_reason("PEPE", T0 + H) == "en hibernation"
    ev = s.check({}, T0 + pd.Timedelta(days=7, hours=1))
    assert "Fin de l'hibernation" in ev[0].text
    ev = s.attack("PEPE", 1.0, T0 + pd.Timedelta(days=8), {})
    assert ev and s.positions["PEPE"].stake == pytest.approx(5)  # mise minimale de l'exchange
    s.cash += 15  # remonte vers 35 PV : zone survie
    s.check({"PEPE": 1.0}, T0 + pd.Timedelta(days=9))
    assert s.level == "survival" and not s.woke_from_hibernation


def test_death_closes_everything():
    s = new()
    s.attack("PEPE", 1.0, T0, {})
    s.cash = 2
    ev = s.check({"PEPE": 0.1}, T0 + H)
    assert s.dead and not s.positions
    assert "mort" in ev[-1].text
    assert s.attack("WIF", 1.0, T0 + 2 * H, {}) is None


def test_flat_variant_stakes_a_third():
    s = new(hp_rules=False)
    s.attack("PEPE", 1.0, T0, {})
    assert s.positions["PEPE"].stake == pytest.approx(100 / 3)


def test_roundtrip():
    s = new()
    s.attack("PEPE", 1.0, T0, {})
    s.on_bar("PEPE", 1.0, 2.0, 1.0, T0 + H)
    back = Survivor.from_dict(s.cfg, s.to_dict())
    assert back.positions["PEPE"].half_sold and back.cash == pytest.approx(s.cash)


def test_surge_signal():
    n = 300
    close = np.full(n, 1.0)
    close[-1] = 1.4
    volume = np.full(n, 100.0)
    volume[-1] = 600
    df = pd.DataFrame({"close": close, "volume": volume})
    sig = surge_signal(df, SurvivorConfig())
    assert sig[-1] and not sig[:-1].any()
    df.loc[n - 1, "volume"] = 300
    assert not surge_signal(df, SurvivorConfig())[-1]
