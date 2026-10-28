"""Exécution des ordres (papier ou réel), suivi des positions et garde-fous de risque."""

import asyncio
import json
import logging
import os
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone

import ccxt

from exits import ExitParams, exit_reason, is_stop_hit, next_stop
from strategy import Signal

log = logging.getLogger(__name__)


@dataclass
class Position:
    id: str
    symbol: str
    side: str
    qty: float
    entry_price: float
    stop_loss: float  # stop actuel (remonte avec le point mort et le stop suiveur)
    entry_fee: float
    opened_at: str
    initial_stop: float = 0.0
    atr: float = 0.0  # ATR au moment du signal, sert au stop suiveur
    extreme: float = 0.0  # plus haut (long) ou plus bas (short) depuis l'entrée
    stop_order_id: str | None = None  # stop posé sur l'exchange (mode live)
    stop_order_price: float = 0.0

    def __post_init__(self):
        self.initial_stop = self.initial_stop or self.stop_loss
        self.extreme = self.extreme or self.entry_price

    @property
    def notional(self) -> float:
        return self.qty * self.entry_price

    @property
    def close_side(self) -> str:
        return "sell" if self.side == "long" else "buy"

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
class UpdateResult:
    closed: list[ClosedTrade] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _only_fields(cls, raw: dict) -> dict:
    names = {f.name for f in fields(cls)}
    return {k: v for k, v in raw.items() if k in names}


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
            positions={k: Position(**_only_fields(Position, v)) for k, v in raw.get("positions", {}).items()},
            history=[ClosedTrade(**_only_fields(ClosedTrade, t)) for t in raw.get("history", [])],
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
        self.exit_params = ExitParams(cfg.trail_atr, cfg.breakeven_r)
        self.state = State.load(cfg.state_file, cfg.paper_balance)
        self._lock = asyncio.Lock()

    @property
    def uses_exchange_stops(self) -> bool:
        return self.cfg.live and self.cfg.exchange_stops

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
        """Ouvre la position. En live, pose aussi le stop sur l'exchange ; si c'est impossible,
        la position est ouverte quand même et `stop_order_id` reste vide (le bot gère alors le stop)."""
        async with self._lock:
            reason = self.risk_block_reason(signal)
            if reason:
                raise RuntimeError(reason)

            # Le stop garde la même distance qu'au moment du signal
            sl = price - (signal.price - signal.stop_loss)
            qty = self.size(await self.equity(), price, sl)

            if self.cfg.live:
                qty, price, fee = await self._market_order(signal.symbol, "buy" if signal.side == "long" else "sell", qty)
                sl = price - (signal.price - signal.stop_loss)
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
                entry_fee=fee,
                opened_at=_now().isoformat(timespec="seconds"),
                atr=signal.atr,
            )
            if self.uses_exchange_stops:
                await self._place_stop(pos)
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
                filled_stop = await self._cancel_stop(pos)
                if filled_stop is not None:
                    # Le stop de l'exchange a été exécuté juste avant : la position est déjà fermée
                    _, avg, fee = self._fill(filled_stop, pos.symbol, pos.close_side)
                    return self._record_close(pos, avg, fee, exit_reason(pos.side, pos.entry_price, pos.stop_order_price))
                _, price, exit_fee = await self._market_order(pos.symbol, pos.close_side, pos.qty)
            else:
                exit_fee = pos.qty * price * self.cfg.fee_pct / 100
            return self._record_close(pos, price, exit_fee, reason)

    async def update(self, symbol: str, price: float) -> UpdateResult:
        """À appeler à chaque relevé de prix : fait suivre le stop et ferme les positions touchées."""
        result = UpdateResult()
        for pos in [p for p in self.state.positions.values() if p.symbol == symbol]:
            try:
                await self._update_position(pos, price, result)
            except ccxt.NetworkError as e:
                log.warning("%s : erreur réseau pendant le suivi : %s", pos.symbol, e)
            except Exception:
                log.exception("Échec du suivi de la position %s", pos.id)
        return result

    async def _update_position(self, pos: Position, price: float, result: UpdateResult) -> None:
        # 1. En live, le stop de l'exchange a peut-être déjà été exécuté
        if self.uses_exchange_stops and pos.stop_order_id:
            async with self._lock:
                order = await asyncio.to_thread(self.exchange.fetch_order, pos.stop_order_id, pos.symbol)
                status = order.get("status")
                if status == "closed":
                    _, avg, fee = self._fill(order, pos.symbol, pos.close_side)
                    result.closed.append(self._record_close(pos, avg, fee, exit_reason(pos.side, pos.entry_price, pos.stop_order_price)))
                    return
                if status in ("canceled", "expired", "rejected"):
                    pos.stop_order_id = None
                    result.notes.append(f"⚠️ Le stop de {pos.symbol} a été annulé sur l'exchange : le bot le surveille lui-même.")
                    self.save()

        # 2. Stop touché alors qu'il n'est pas posé sur l'exchange : le bot ferme lui-même
        if not pos.stop_order_id and is_stop_hit(pos.side, pos.stop_loss, price):
            reason = exit_reason(pos.side, pos.entry_price, pos.stop_loss)
            result.closed.append(await self.close(pos.id, price, reason))
            return

        # 3. Nouveau plus haut (ou plus bas) : le stop suit
        pos.extreme = max(pos.extreme, price) if pos.side == "long" else min(pos.extreme, price)
        new_stop = next_stop(pos.side, pos.entry_price, pos.initial_stop, pos.atr, pos.extreme, pos.stop_loss, self.exit_params)
        if new_stop == pos.stop_loss:
            self.save()
            return

        direction = 1 if pos.side == "long" else -1
        reached_breakeven = direction * (pos.stop_loss - pos.entry_price) < 0 <= direction * (new_stop - pos.entry_price)
        pos.stop_loss = new_stop
        if reached_breakeven:
            result.notes.append(f"🔐 {pos.symbol} : stop remonté au prix d'entrée, le trade ne peut plus perdre (hors frais).")

        if self.uses_exchange_stops and pos.stop_order_id:
            moved = abs(new_stop - pos.stop_order_price)
            if moved >= self.cfg.stop_update_atr * pos.atr or reached_breakeven:
                async with self._lock:
                    filled = await self._cancel_stop(pos)
                    if filled is not None:
                        _, avg, fee = self._fill(filled, pos.symbol, pos.close_side)
                        result.closed.append(self._record_close(pos, avg, fee, exit_reason(pos.side, pos.entry_price, pos.stop_order_price)))
                        return
                    if not await self._place_stop(pos):
                        result.notes.append(f"⚠️ Impossible de déplacer le stop de {pos.symbol} sur l'exchange : le bot le surveille lui-même.")
        self.save()

    def _record_close(self, pos: Position, price: float, exit_fee: float, reason: str) -> ClosedTrade:
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
        self.state.positions.pop(pos.id, None)
        self.state.history.append(trade)
        self.state.equity += pnl
        day = _now().date().isoformat()
        self.state.daily_pnl[day] = self.state.daily_pnl.get(day, 0.0) + pnl
        self.save()
        log.info("Position fermée %s", trade)
        return trade

    # --- Ordres réels ----------------------------------------------------

    async def _place_stop(self, pos: Position) -> bool:
        """Pose un ordre stop-loss au marché sur l'exchange. Renvoie False si l'exchange refuse."""
        try:
            amount = float(self.exchange.amount_to_precision(pos.symbol, pos.qty))
            stop = float(self.exchange.price_to_precision(pos.symbol, pos.stop_loss))
            order = await asyncio.to_thread(
                self.exchange.create_stop_loss_order, pos.symbol, "market", pos.close_side, amount, None, stop
            )
        except Exception as e:
            log.error("Stop non posé sur l'exchange pour %s : %s", pos.symbol, e)
            pos.stop_order_id = None
            return False
        pos.stop_order_id = order["id"]
        pos.stop_order_price = stop
        return True

    async def _cancel_stop(self, pos: Position) -> dict | None:
        """Annule le stop posé sur l'exchange. S'il a déjà été exécuté, renvoie l'ordre exécuté."""
        if not pos.stop_order_id:
            return None
        order_id = pos.stop_order_id
        try:
            await asyncio.to_thread(self.exchange.cancel_order, order_id, pos.symbol)
            filled = None
        except ccxt.OrderNotFound:
            order = await asyncio.to_thread(self.exchange.fetch_order, order_id, pos.symbol)
            filled = order if order.get("status") == "closed" else None
        pos.stop_order_id = None
        return filled

    async def _market_order(self, symbol: str, side: str, qty: float) -> tuple[float, float, float]:
        """Ordre au marché réel. Renvoie (quantité exécutée, prix moyen, frais en devise de cotation)."""
        amount = float(self.exchange.amount_to_precision(symbol, qty))
        if amount <= 0:
            return 0.0, 0.0, 0.0
        order = await asyncio.to_thread(self.exchange.create_order, symbol, "market", side, amount)
        if not order.get("average") or not order.get("filled"):
            order = await asyncio.to_thread(self.exchange.fetch_order, order["id"], symbol)
        return self._fill(order, symbol, side)

    @staticmethod
    def _fill(order: dict, symbol: str, side: str) -> tuple[float, float, float]:
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
