"""Règles de sortie communes au bot, au backtest et au journal : stop initial, point mort, stop suiveur."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ExitParams:
    trail_atr: float = 2.5  # distance du stop suiveur sous le plus haut, en ATR (0 = désactivé)
    breakeven_r: float = 1.0  # gain (en multiples du risque) à partir duquel le stop passe au prix d'entrée (0 = désactivé)


def next_stop(side: str, entry: float, initial_stop: float, atr: float, extreme: float,
              current_stop: float, p: ExitParams) -> float:
    """Nouveau stop après un nouveau plus haut (long) ou plus bas (short). Le stop ne recule jamais."""
    direction = 1 if side == "long" else -1
    risk = abs(entry - initial_stop)
    candidates = [current_stop]
    if p.breakeven_r > 0 and direction * (extreme - entry) >= p.breakeven_r * risk:
        candidates.append(entry)
    if p.trail_atr > 0 and atr > 0:
        candidates.append(extreme - direction * p.trail_atr * atr)
    return max(candidates) if side == "long" else min(candidates)


def is_stop_hit(side: str, stop: float, price: float) -> bool:
    return price <= stop if side == "long" else price >= stop


def exit_reason(side: str, entry: float, stop: float) -> str:
    direction = 1 if side == "long" else -1
    gain = direction * (stop - entry)
    if gain > 0:
        return "stop suiveur"
    if gain == 0:
        return "point mort"
    return "stop-loss"


@dataclass
class TradeTracker:
    """Suit un trade bougie par bougie (backtest et trades fictifs du journal)."""

    side: str
    entry: float
    initial_stop: float
    atr: float
    stop: float
    extreme: float

    @classmethod
    def start(cls, side: str, entry: float, stop: float, atr: float) -> "TradeTracker":
        return cls(side, entry, stop, atr, stop, entry)

    def on_candle(self, open_: float, high: float, low: float, p: ExitParams) -> float | None:
        """Renvoie le prix de sortie si le stop est touché pendant la bougie, sinon met le stop à jour.
        Hypothèse prudente : on vérifie le stop avant de profiter du plus haut de la bougie."""
        if self.side == "long":
            if open_ <= self.stop:
                return open_  # ouverture sous le stop : sortie au prix d'ouverture
            if low <= self.stop:
                return self.stop
            self.extreme = max(self.extreme, high)
        else:
            if open_ >= self.stop:
                return open_
            if high >= self.stop:
                return self.stop
            self.extreme = min(self.extreme, low)
        self.stop = next_stop(self.side, self.entry, self.initial_stop, self.atr, self.extreme, self.stop, p)
        return None

    def result(self, exit_price: float, fee_pct: float) -> tuple[float, float]:
        """(résultat en % net de frais, résultat en multiples du risque net de frais)."""
        direction = 1 if self.side == "long" else -1
        pct = direction * (exit_price - self.entry) / self.entry * 100 - 2 * fee_pct
        risk_pct = abs(self.entry - self.initial_stop) / self.entry * 100
        return pct, pct / risk_pct if risk_pct else 0.0
