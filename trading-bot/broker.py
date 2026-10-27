"""Exécution des ordres (papier ou réel), suivi des positions et garde-fous de risque."""

import asyncio
import json
import logging
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from strategy import Signal

log = logging.getLogger(__name__)


@dataclass
class Position:
    id: str
    symbol: str
    side: str
    qty: float
    entry_price: float
    stop_loss: float
    take_profit: float
    entry_fee: float
    opened_at: str

    @property
    def notional(self) -> float:
        return self.qty * self.entry_price

    def unrealized_pnl(self, price: float) -> float:
        direction = 1 if self.side == "long" else -1
        return direction * (price - self.entry_price) * self.qty - self.entry_fee


@dataclass
class ClosedTrade:
    symbol: str
    side: str
    qty: float
    entry_price: float
    exit_price: float
    pnl: float
    reason: str
    opened_at: str
    closed_at: str


@dataclass
class State:
    equity: float  # capital de départ + PnL réalisé (mode papier)
    positions: dict[str, Position] = field(default_factory=dict)
    history: list[ClosedTrade] = field(default_factory=list)
    daily_pnl: dict[str, float] = field(default_factory=dict)
    paused: bool = False

    @classmethod
    def load(cls, path: str, default_equity: float) -> "State":
        if not os.path.exists(path):
            return cls(equity=default_equity)
        with open(path) as f:
            raw = json.load(f)
        return cls(
            equity=raw["equity"],
            positions={k: Position(**v) for k, v in raw.get("positions", {}).items()},
            history=[ClosedTrade(**t) for t in raw.get("history", [])],
            daily_pnl=raw.get("daily_pnl", {}),
            paused=raw.get("paused", False),
        )

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(
                {
                    "equity": self.equity,
                    "positions": {k: asdict(v) for k, v in self.positions.items()},
                    "history": [asdict(t) for t in self.history[-500:]],
                    "daily_pnl": self.daily_pnl,
                    "paused": self.paused,
                },
                f,
                indent=2,
            )
        os.replace(tmp, path)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Broker:
    """Ouvre et ferme les positions. En mode papier, rien n'est envoyé à l'exchange."""

    def __init__(self, cfg, exchange):
        self.cfg = cfg
        self.exchange = exchange
        self.state = State.load(cfg.state_file, cfg.paper_balance)
        self._lock = asyncio.Lock()

    # --- Lecture ---------------------------------------------------------

    def save(self) -> None:
        self.state.save(self.cfg.state_file)

    def today_pnl(self) -> float:
        return self.state.daily_pnl.get(_now().date().isoformat(), 0.0)

    def has_position(self, symbol: str) -> bool:
        return any(p.symbol == symbol for p in self.state.positions.values())

    def open_notional(self) -> float:
        return sum(p.notional for p in self.state.positions.values())

    async def equity(self) -> float:
        """Capital servant au dimensionnement des positions."""
        if not self.cfg.live:
            return self.state.equity
        balance = await asyncio.to_thread(self.exchange.fetch_balance)
        quote = self.cfg.symbols[0].split("/")[1]
        return float(balance.get("total", {}).get(quote, 0.0))

    # --- Risque ----------------------------------------------------------

    def risk_block_reason(self, signal: Signal) -> str | None:
        """Raison de refuser un trade, ou None si les garde-fous l'autorisent."""
        if self.state.paused:
            return "le bot est en pause"
        if self.today_pnl() <= -self.cfg.max_daily_loss_usdt:
            return f"perte max du jour atteinte ({self.today_pnl():.2f} USDT)"
        if len(self.state.positions) >= self.cfg.max_open_positions:
            return f"déjà {len(self.state.positions)} positions ouvertes (max {self.cfg.max_open_positions})"
        if self.has_position(signal.symbol):
            return f"une position est déjà ouverte sur {signal.symbol}"
        return None

    def size(self, equity: float, entry: float, stop_loss: float) -> float:
        """Quantité telle qu'un stop-loss touché coûte RISK_PER_TRADE_PCT du capital, plafonnée."""
        stop_distance = abs(entry - stop_loss)
        if stop_distance <= 0 or entry <= 0:
            return 0.0
        risk_amount = equity * self.cfg.risk_per_trade_pct / 100
        qty = risk_amount / stop_distance
        max_notional = min(self.cfg.max_position_usdt, max(equity - self.open_notional(), 0.0))
        return max(min(qty, max_notional / entry), 0.0)

    # --- Exécution -------------------------------------------------------

    async def open(self, signal: Signal, price: float) -> Position:
        async with self._lock:
            reason = self.risk_block_reason(signal)
            if reason:
                raise RuntimeError(reason)

            # Le stop et l'objectif gardent la même distance qu'au moment du signal
            sl = price - (signal.price - signal.stop_loss)
            tp = price + (signal.take_profit - signal.price)
            qty = self.size(await self.equity(), price, sl)

            if self.cfg.live:
                qty, price, fee = await self._live_order(signal.symbol, "buy" if signal.side == "long" else "sell", qty)
            else:
                fee = qty * price * self.cfg.fee_pct / 100
            if qty <= 0:
                raise RuntimeError("quantité calculée nulle (capital insuffisant ou stop trop large)")

            pos = Position(
                id=uuid.uuid4().hex[:8],
                symbol=signal.symbol,
                side=signal.side,
                qty=qty,
                entry_price=price,
                stop_loss=sl,
                take_profit=tp,
                entry_fee=fee,
                opened_at=_now().isoformat(timespec="seconds"),
            )
            self.state.positions[pos.id] = pos
            self.save()
            log.info("Position ouverte %s", pos)
            return pos

    async def close(self, pos_id: str, price: float, reason: str) -> ClosedTrade:
        async with self._lock:
            pos = self.state.positions.get(pos_id)
            if pos is None:
                raise RuntimeError("position introuvable (déjà fermée ?)")

            if self.cfg.live:
                _, price, exit_fee = await self._live_order(pos.symbol, "sell" if pos.side == "long" else "buy", pos.qty)
            else:
                exit_fee = pos.qty * price * self.cfg.fee_pct / 100

            pnl = pos.unrealized_pnl(price) - exit_fee
            trade = ClosedTrade(
                symbol=pos.symbol,
                side=pos.side,
                qty=pos.qty,
                entry_price=pos.entry_price,
                exit_price=price,
                pnl=pnl,
                reason=reason,
                opened_at=pos.opened_at,
                closed_at=_now().isoformat(timespec="seconds"),
            )
            del self.state.positions[pos_id]
            self.state.history.append(trade)
            self.state.equity += pnl
            day = _now().date().isoformat()
            self.state.daily_pnl[day] = self.state.daily_pnl.get(day, 0.0) + pnl
            self.save()
            log.info("Position fermée %s", trade)
            return trade

    async def check_exits(self, symbol: str, price: float) -> list[ClosedTrade]:
        """Ferme les positions de `symbol` dont le stop-loss ou l'objectif est atteint."""
        closed = []
        for pos in list(self.state.positions.values()):
            if pos.symbol != symbol:
                continue
            hit_sl = price <= pos.stop_loss if pos.side == "long" else price >= pos.stop_loss
            hit_tp = price >= pos.take_profit if pos.side == "long" else price <= pos.take_profit
            if hit_sl or hit_tp:
                try:
                    closed.append(await self.close(pos.id, price, "stop-loss" if hit_sl else "objectif"))
                except Exception:
                    log.exception("Échec de la fermeture automatique de %s", pos.id)
        return closed

    async def _live_order(self, symbol: str, side: str, qty: float) -> tuple[float, float, float]:
        """Ordre au marché réel. Renvoie (quantité exécutée, prix moyen, frais en devise de cotation)."""
        amount = float(self.exchange.amount_to_precision(symbol, qty))
        if amount <= 0:
            return 0.0, 0.0, 0.0
        order = await asyncio.to_thread(self.exchange.create_order, symbol, "market", side, amount)
        if not order.get("average") or not order.get("filled"):
            order = await asyncio.to_thread(self.exchange.fetch_order, order["id"], symbol)
        filled = float(order["filled"])
        avg = float(order["average"])
        base, quote = symbol.split("/")
        fee = 0.0
        for f in order.get("fees") or ([order["fee"]] if order.get("fee") else []):
            if not f or not f.get("cost"):
                continue
            if f.get("currency") == base:
                # Frais prélevés sur la crypto reçue : on la possède en moins
                if side == "buy":
                    filled -= float(f["cost"])
                fee += float(f["cost"]) * avg
            elif f.get("currency") == quote:
                fee += float(f["cost"])
        return filled, avg, fee
