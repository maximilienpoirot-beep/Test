"""Stratégie de suivi de tendance rapide : croisement d'EMA filtré par la tendance, l'ADX et le volume."""

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class StrategyParams:
    ema_fast: int = 9
    ema_slow: int = 21
    ema_trend: int = 50
    adx_period: int = 14
    adx_min: float = 20
    volume_mult: float = 1.2
    atr_period: int = 14
    sl_atr: float = 1.5
    tp_atr: float = 3.0
    allow_short: bool = False

    @classmethod
    def from_config(cls, cfg) -> "StrategyParams":
        return cls(**{name: getattr(cfg, name) for name in cls.__dataclass_fields__})

    @property
    def warmup(self) -> int:
        """Nombre de bougies nécessaires avant que les indicateurs soient fiables."""
        return max(self.ema_trend, self.adx_period * 3, self.atr_period * 2) + 2


@dataclass
class Signal:
    symbol: str
    side: str  # "long" ou "short"
    price: float
    stop_loss: float
    take_profit: float
    atr: float
    adx: float
    candle_time: pd.Timestamp
    reasons: list[str] = field(default_factory=list)

    @property
    def risk_reward(self) -> float:
        return abs(self.take_profit - self.price) / abs(self.price - self.stop_loss)


def ohlcv_to_df(ohlcv: list[list]) -> pd.DataFrame:
    """Convertit la sortie de ccxt.fetch_ohlcv en DataFrame indexé par date (UTC)."""
    df = pd.DataFrame(ohlcv, columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    return df.set_index("time").astype(float)


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def _wilder(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(alpha=1 / period, adjust=False).mean()


def atr(df: pd.DataFrame, period: int) -> pd.Series:
    prev_close = df["close"].shift(1)
    true_range = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return _wilder(true_range, period)


def adx(df: pd.DataFrame, period: int) -> pd.Series:
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    tr = atr(df, period)
    plus_di = 100 * _wilder(plus_dm, period) / tr
    minus_di = 100 * _wilder(minus_dm, period) / tr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return _wilder(dx.fillna(0), period)


def add_indicators(df: pd.DataFrame, p: StrategyParams) -> pd.DataFrame:
    df = df.copy()
    df["ema_fast"] = ema(df["close"], p.ema_fast)
    df["ema_slow"] = ema(df["close"], p.ema_slow)
    df["ema_trend"] = ema(df["close"], p.ema_trend)
    df["atr"] = atr(df, p.atr_period)
    df["adx"] = adx(df, p.adx_period)
    df["vol_avg"] = df["volume"].rolling(20).mean()
    return df


def signal_at(df: pd.DataFrame, i: int, symbol: str, p: StrategyParams) -> Signal | None:
    """Cherche un signal sur la bougie (clôturée) d'indice i. df doit contenir les indicateurs."""
    if i < p.warmup or i >= len(df):
        return None
    row, prev = df.iloc[i], df.iloc[i - 1]

    crossed_up = prev["ema_fast"] <= prev["ema_slow"] and row["ema_fast"] > row["ema_slow"]
    crossed_down = prev["ema_fast"] >= prev["ema_slow"] and row["ema_fast"] < row["ema_slow"]
    if not (crossed_up or (crossed_down and p.allow_short)):
        return None

    side = "long" if crossed_up else "short"
    price = row["close"]
    if side == "long" and price <= row["ema_trend"]:
        return None
    if side == "short" and price >= row["ema_trend"]:
        return None
    if row["adx"] < p.adx_min:
        return None
    if not row["volume"] >= p.volume_mult * row["vol_avg"]:
        return None

    distance = row["atr"] * p.sl_atr
    if side == "long":
        stop_loss, take_profit = price - distance, price + row["atr"] * p.tp_atr
    else:
        stop_loss, take_profit = price + distance, price - row["atr"] * p.tp_atr

    trend_word = "au-dessus" if side == "long" else "en dessous"
    return Signal(
        symbol=symbol,
        side=side,
        price=float(price),
        stop_loss=float(stop_loss),
        take_profit=float(take_profit),
        atr=float(row["atr"]),
        adx=float(row["adx"]),
        candle_time=df.index[i],
        reasons=[
            f"EMA {p.ema_fast} croise {'au-dessus' if side == 'long' else 'en dessous'} de l'EMA {p.ema_slow}",
            f"Prix {trend_word} de l'EMA {p.ema_trend} (tendance de fond)",
            f"ADX {row['adx']:.0f} ≥ {p.adx_min:g} (tendance marquée)",
            f"Volume ×{row['volume'] / row['vol_avg']:.1f} par rapport à la moyenne",
        ],
    )


def detect_signal(df: pd.DataFrame, symbol: str, p: StrategyParams) -> Signal | None:
    """Signal sur la dernière bougie de df. df ne doit contenir que des bougies clôturées."""
    with_ind = add_indicators(df, p)
    return signal_at(with_ind, len(with_ind) - 1, symbol, p)
