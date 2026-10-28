"""Moteur du bot survivant : une poche de memecoins gérée comme une barre de vie.

Les mêmes règles servent au backtest (bougies d'1 heure) et au bot en direct (prix relevés
toutes les quelques minutes). Le moteur ne passe aucun ordre lui-même : il tient les comptes
en mode papier et renvoie des événements à afficher sur Telegram.
"""

from dataclasses import asdict, dataclass, field, fields

import numpy as np
import pandas as pd

MEMECOINS = ("DOGE,SHIB,PEPE,FLOKI,BONK,WIF,BOME,MEME,PEOPLE,TURBO,NEIRO,1000SATS,ACT,PNUT,TRUMP,DOGS,"
             "1000CHEEMS,MUBARAK,BROCCOLI714,TST,1MBABYDOGE,1000CAT,PENGU,BANANAS31,PUMP").split(",")


@dataclass(frozen=True)
class SurvivorConfig:
    start_hp: float = 100.0
    # Entrée : la vague doit être forte (réglages figés avant l'arène, à ne pas retoucher)
    surge_pct: float = 0.30  # hausse sur 24 h
    vol_mult: float = 5.0  # volume de la dernière heure / moyenne horaire sur 7 jours
    # Sortie
    stop_pct: float = 0.20  # stop de départ
    half_at: float = 1.0  # vente de la moitié à ×2
    trail_pct: float = 0.30  # puis stop suiveur sous le plus haut
    # Coûts et limites de l'exchange
    cost_pct: float = 0.002  # frais + glissement par ordre
    min_order: float = 5.0
    # Mécaniques de survie
    cooldown_h: int = 72  # pas de nouvelle attaque sur le même memecoin juste après une sortie
    stun_losses: int = 3  # défaites d'affilée avant d'être sonné
    stun_h: int = 24
    hibernate_days: int = 7
    vault_trigger: float = 1.5  # à 150 PV…
    vault_amount: float = 0.5  # … 50 PV partent au coffre
    hp_rules: bool = True  # False : sans barre de vie (mise fixe), pour comparer


@dataclass(frozen=True)
class Level:
    key: str
    name: str
    icon: str
    min_frac: float  # seuil en part des PV de départ
    stake_frac: float  # mise par attaque, en part des PV actuels
    max_positions: int


LEVELS = [
    Level("healthy", "en forme", "💚", 0.70, 0.30, 3),
    Level("injured", "blessé", "💛", 0.50, 0.20, 2),
    Level("survival", "survie", "🧡", 0.25, 0.10, 1),
    Level("critical", "critique", "❤️‍🩹", 0.10, 0.10, 1),
    Level("dead", "mort", "💀", 0.0, 0.0, 0),
]
LEVEL = {lv.key: lv for lv in LEVELS}


@dataclass
class Position:
    coin: str
    qty: float
    entry: float
    stake: float  # somme engagée, frais d'achat compris
    stop: float
    peak: float
    opened_at: str
    half_sold: bool = False
    proceeds: float = 0.0  # déjà encaissé et versé au cash (vente de la moitié)


@dataclass
class Trade:
    coin: str
    stake: float
    pnl: float
    multiple: float
    reason: str
    opened_at: str
    closed_at: str


@dataclass
class Event:
    kind: str
    text: str


def surge_signal(df: pd.DataFrame, cfg: SurvivorConfig) -> np.ndarray:
    """Pour chaque bougie d'1 heure (clôturée) : True si une vague démarre."""
    ret24 = df["close"] / df["close"].shift(24) - 1
    vol_avg = df["volume"].rolling(168).mean().shift(1)
    sig = (ret24 >= cfg.surge_pct) & (df["volume"] >= cfg.vol_mult * vol_avg)
    sig.iloc[:168] = False
    return sig.to_numpy()


def hp_bar(hp: float, start: float) -> str:
    full = max(0, min(15, round(hp / start * 10)))
    return "█" * full + "░" * max(0, 10 - full)


def _ts(t: pd.Timestamp) -> str:
    return t.isoformat(timespec="minutes")


@dataclass
class Survivor:
    cfg: SurvivorConfig = field(default_factory=SurvivorConfig)
    cash: float = 0.0
    vault: float = 0.0
    positions: dict[str, Position] = field(default_factory=dict)
    history: list[Trade] = field(default_factory=list)
    level: str = "healthy"
    lowest_hp: float = 0.0
    losses_in_row: int = 0
    stunned_until: str = ""
    hibernate_until: str = ""
    woke_from_hibernation: bool = False
    cooldowns: dict[str, str] = field(default_factory=dict)
    paused: bool = False
    dead: bool = False
    born_at: str = ""
    died_at: str = ""

    @classmethod
    def new(cls, cfg: SurvivorConfig, now: pd.Timestamp) -> "Survivor":
        return cls(cfg=cfg, cash=cfg.start_hp, lowest_hp=cfg.start_hp, born_at=_ts(now),
                   level="healthy" if cfg.hp_rules else "flat")

    # --- Lecture ---------------------------------------------------------

    def hp(self, prices: dict[str, float]) -> float:
        """Points de vie = cash + positions au prix actuel (le coffre n'en fait plus partie)."""
        return self.cash + sum(p.qty * prices.get(c, p.entry) for c, p in self.positions.items())

    def level_for(self, hp: float) -> Level:
        if not self.cfg.hp_rules:
            return Level("flat", "sans barre de vie", "⚪", 0.10, 1 / 3, 3) if hp >= 0.10 * self.cfg.start_hp else LEVEL["dead"]
        for lv in LEVELS:
            if hp >= lv.min_frac * self.cfg.start_hp:
                return lv
        return LEVEL["dead"]

    def block_reason(self, coin: str, now: pd.Timestamp) -> str | None:
        """Pourquoi le bot ne peut pas attaquer `coin` maintenant (None = il peut)."""
        if self.dead:
            return "mort"
        if self.paused:
            return "en pause"
        if coin in self.positions:
            return "déjà en position"
        if self.hibernate_until and now < pd.Timestamp(self.hibernate_until):
            return "en hibernation"
        if self.stunned_until and now < pd.Timestamp(self.stunned_until):
            return "sonné"
        if coin in self.cooldowns and now < pd.Timestamp(self.cooldowns[coin]):
            return "récupère après son dernier combat sur ce memecoin"
        return None

    # --- Actions ---------------------------------------------------------

    def attack(self, coin: str, price: float, now: pd.Timestamp, prices: dict[str, float]) -> Event | None:
        if self.block_reason(coin, now):
            return None
        hp = self.hp(prices)
        lv = self.level_for(hp)
        if self.level == "critical" and self.woke_from_hibernation:
            lv = LEVEL["survival"]  # réveillé : il retente sa chance, prudemment
        if lv.key in ("critical", "dead") or len(self.positions) >= lv.max_positions:
            return None
        stake = min(self.cash, max(lv.stake_frac * hp, self.cfg.min_order))
        if stake < self.cfg.min_order or stake > 0.35 * hp:
            return None  # trop faible pour attaquer sans risquer sa vie
        qty = stake * (1 - self.cfg.cost_pct) / price
        self.cash -= stake
        self.positions[coin] = Position(coin, qty, price, stake, price * (1 - self.cfg.stop_pct), price, _ts(now))
        return Event("attack", f"⚔️ <b>Attaque sur {coin}</b> : {stake:.2f} $ à {price:.6g}\n"
                               f"Stop à {price * (1 - self.cfg.stop_pct):.6g} (−{self.cfg.stop_pct:.0%}) · "
                               f"moitié vendue à ×{1 + self.cfg.half_at:g}")

    def on_bar(self, coin: str, open_: float, high: float, low: float, now: pd.Timestamp) -> list[Event]:
        """Applique les règles de sortie sur une bougie (ou sur un simple prix : open = high = low)."""
        pos = self.positions.get(coin)
        if pos is None:
            return []
        if open_ <= pos.stop:
            return [self._close(pos, open_, now, "stop touché à l'ouverture")]
        if low <= pos.stop:
            return [self._close(pos, pos.stop, now, "stop suiveur" if pos.half_sold else "stop de départ")]
        events = []
        target = pos.entry * (1 + self.cfg.half_at)
        if not pos.half_sold and high >= target:
            half = pos.qty / 2
            amount = half * target * (1 - self.cfg.cost_pct)
            self.cash += amount
            pos.proceeds += amount
            pos.qty -= half
            pos.half_sold = True
            events.append(Event("half", f"💰 <b>{coin} a doublé</b> : moitié vendue à {target:.6g}, "
                                        f"{pos.proceeds:.2f} $ encaissés (la mise est récupérée)"))
        pos.peak = max(pos.peak, high)
        if pos.half_sold:
            pos.stop = max(pos.stop, pos.peak * (1 - self.cfg.trail_pct))
        return events

    def _close(self, pos: Position, price: float, now: pd.Timestamp, reason: str) -> Event:
        last = pos.qty * price * (1 - self.cfg.cost_pct)
        received = pos.proceeds + last
        pnl = received - pos.stake
        self.cash += last
        del self.positions[pos.coin]
        self.history.append(Trade(pos.coin, pos.stake, pnl, received / pos.stake, reason, pos.opened_at, _ts(now)))
        self.cooldowns[pos.coin] = _ts(now + pd.Timedelta(hours=self.cfg.cooldown_h))
        self.losses_in_row = self.losses_in_row + 1 if pnl < 0 else 0
        icon = "🏆" if pnl >= 0 else "🩸"
        text = f"{icon} <b>{pos.coin} terminé</b> ({reason}) : {pnl:+.2f} $ (×{received / pos.stake:.2f})"
        if self.cfg.hp_rules and self.losses_in_row >= self.cfg.stun_losses:
            self.stunned_until = _ts(now + pd.Timedelta(hours=self.cfg.stun_h))
            self.losses_in_row = 0
            text += f"\n😵 {self.cfg.stun_losses} défaites d'affilée : <b>sonné</b>, repos {self.cfg.stun_h} h"
        return Event("close", text)

    def check(self, prices: dict[str, float], now: pd.Timestamp) -> list[Event]:
        """Coffre, changements d'état, hibernation et mort. À appeler après chaque mise à jour."""
        if self.dead:
            return []
        events = []
        hp = self.hp(prices)
        self.lowest_hp = min(self.lowest_hp, hp)
        start = self.cfg.start_hp

        if self.cfg.hp_rules and hp >= self.cfg.vault_trigger * start and self.cash >= self.cfg.vault_amount * start:
            amount = self.cfg.vault_amount * start
            self.cash -= amount
            self.vault += amount
            hp -= amount
            events.append(Event("vault", f"🏦 <b>{amount:.0f} PV mis au coffre</b>, définitivement à l'abri "
                                         f"(coffre : {self.vault:.0f} $)"))

        lv = self.level_for(hp)
        if lv.key == "dead":
            for coin, pos in list(self.positions.items()):
                self._close(pos, prices.get(coin, pos.entry), now, "dernier souffle")
            self.dead, self.died_at, self.level = True, _ts(now), "dead"
            events.append(Event("death", self.autopsy()))
            return events

        if lv.key != self.level:
            old = LEVEL.get(self.level)
            if lv.key == "critical" and self.cfg.hp_rules:
                if not self.woke_from_hibernation:
                    self.hibernate_until = _ts(now + pd.Timedelta(days=self.cfg.hibernate_days))
                    events.append(Event("level", f"❤️‍🩹 <b>État critique</b> ({hp:.0f} PV) : hibernation "
                                                 f"{self.cfg.hibernate_days} jours, aucune nouvelle attaque"))
            elif old is not None:
                worse = lv.min_frac < old.min_frac
                events.append(Event("level", f"{lv.icon} {'Il faiblit' if worse else 'Il reprend des forces'} : "
                                             f"<b>{lv.name}</b> ({hp:.0f} PV) · mise {lv.stake_frac:.0%}, "
                                             f"{lv.max_positions} attaque(s) max"))
            if lv.min_frac >= LEVEL["survival"].min_frac:
                self.woke_from_hibernation = False
            self.level = lv.key

        if self.hibernate_until and not self.woke_from_hibernation and now >= pd.Timestamp(self.hibernate_until):
            self.hibernate_until = ""
            self.woke_from_hibernation = True
            events.append(Event("level", f"🌅 <b>Fin de l'hibernation</b> ({hp:.0f} PV) : il reprend en mode survie"))
        return events

    # --- Affichage -------------------------------------------------------

    def status(self, prices: dict[str, float], now: pd.Timestamp) -> str:
        hp = self.hp(prices)
        lv = LEVEL.get(self.level, self.level_for(hp))
        lines = [f"{lv.icon} <b>{hp:.1f} / {self.cfg.start_hp:.0f} PV</b>  {hp_bar(hp, self.cfg.start_hp)}",
                 f"État : {lv.name} · 🏦 coffre : {self.vault:.0f} $ · total : {hp + self.vault:.1f} $"]
        if self.dead:
            lines.append(f"💀 Mort le {self.died_at[:10]}")
        for flag, until in (("hibernation", self.hibernate_until), ("sonné", self.stunned_until)):
            if until and now < pd.Timestamp(until):
                lines.append(f"💤 {flag} jusqu'au {until[:16].replace('T', ' ')} UTC")
        if self.paused:
            lines.append("⏸ en pause")
        for c, p in self.positions.items():
            price = prices.get(c, p.entry)
            lines.append(f"• {c} : ×{price / p.entry:.2f} depuis l'entrée · stop {p.stop:.6g}"
                         + (" · moitié déjà vendue" if p.half_sold else ""))
        wins = sum(1 for t in self.history if t.pnl > 0)
        lines.append(f"Combats : {len(self.history)} ({wins} victoires) · plus bas : {self.lowest_hp:.0f} PV")
        return "\n".join(lines)

    def autopsy(self) -> str:
        n = len(self.history)
        wins = [t for t in self.history if t.pnl > 0]
        best = max(self.history, key=lambda t: t.pnl, default=None)
        worst = min(self.history, key=lambda t: t.pnl, default=None)
        fees = sum(t.stake for t in self.history) * self.cfg.cost_pct * 2
        lines = [f"💀 <b>Le survivant est mort</b> (né le {self.born_at[:10]}, mort le {self.died_at[:10]})",
                 f"Combats : {n} · victoires : {len(wins)}",
                 f"Frais payés (la faim) : environ {fees:.2f} $"]
        if best:
            lines.append(f"Meilleur coup : {best.coin} {best.pnl:+.2f} $ · pire : {worst.coin} {worst.pnl:+.2f} $")
        lines.append(f"🏦 Ce qui reste au coffre : {self.vault:.0f} $")
        return "\n".join(lines)

    # --- Sauvegarde ------------------------------------------------------

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("cfg")
        return d

    @classmethod
    def from_dict(cls, cfg: SurvivorConfig, raw: dict) -> "Survivor":
        names = {f.name for f in fields(cls)} - {"cfg"}
        s = cls(cfg=cfg, **{k: v for k, v in raw.items() if k in names})
        s.positions = {c: Position(**p) for c, p in s.positions.items()}
        s.history = [Trade(**t) for t in s.history]
        return s
