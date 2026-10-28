"""Journal de tous les signaux, avec le résultat qu'aurait eu chacun s'il avait été pris.

Il répond à trois questions : la stratégie seule gagne-t-elle ? Tes choix l'améliorent-ils ?
L'avis de Claude annonce-t-il vraiment les mauvais trades ?
"""

import json
import os
import uuid
from dataclasses import asdict, dataclass, fields

import pandas as pd

from exits import ExitParams, TradeTracker
from strategy import Signal

DECISIONS = ("en attente", "validé", "ignoré", "expiré", "bloqué", "refusé")


@dataclass
class SignalRecord:
    id: str
    symbol: str
    side: str
    candle_time: str
    price: float
    stop: float
    atr: float
    decision: str = "en attente"
    note: str = ""
    verdict: str | None = None
    confidence: int | None = None
    # Trade fictif : entrée au prix du signal, mêmes règles de sortie que le bot
    tracker: dict | None = None
    last_candle: str = ""
    outcome_pct: float | None = None  # net de frais
    outcome_r: float | None = None
    closed_at: str | None = None

    @property
    def open(self) -> bool:
        return self.outcome_r is None


class Journal:
    def __init__(self, path: str, exit_params: ExitParams, fee_pct: float):
        self.path = path
        self.exit_params = exit_params
        self.fee_pct = fee_pct
        self.records: dict[str, SignalRecord] = {}
        if os.path.exists(path):
            names = {f.name for f in fields(SignalRecord)}
            with open(path) as f:
                for raw in json.load(f):
                    rec = SignalRecord(**{k: v for k, v in raw.items() if k in names})
                    self.records[rec.id] = rec

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        kept = list(self.records.values())[-3000:]
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump([asdict(r) for r in kept], f, indent=1)
        os.replace(tmp, self.path)

    def add(self, signal: Signal, decision: str = "en attente", note: str = "", analysis=None) -> SignalRecord:
        tracker = TradeTracker.start(signal.side, signal.price, signal.stop_loss, signal.atr)
        rec = SignalRecord(
            id=uuid.uuid4().hex[:8],
            symbol=signal.symbol,
            side=signal.side,
            candle_time=signal.candle_time.isoformat(),
            price=signal.price,
            stop=signal.stop_loss,
            atr=signal.atr,
            decision=decision,
            note=note,
            verdict=analysis.verdict if analysis else None,
            confidence=analysis.confidence if analysis else None,
            tracker=asdict(tracker),
            last_candle=signal.candle_time.isoformat(),
        )
        self.records[rec.id] = rec
        self.save()
        return rec

    def set_decision(self, record_id: str, decision: str, note: str = "") -> None:
        rec = self.records.get(record_id)
        if rec:
            rec.decision, rec.note = decision, note
            self.save()

    def update(self, symbol: str, closed: pd.DataFrame) -> None:
        """Fait avancer les trades fictifs de `symbol` avec les bougies clôturées pas encore vues."""
        changed = False
        for rec in self.records.values():
            if rec.symbol != symbol or not rec.open:
                continue
            tracker = TradeTracker(**rec.tracker)
            new = closed[closed.index > pd.Timestamp(rec.last_candle)]
            for t, row in new.iterrows():
                exit_price = tracker.on_candle(row["open"], row["high"], row["low"], self.exit_params)
                rec.last_candle = t.isoformat()
                changed = True
                if exit_price is not None:
                    rec.outcome_pct, rec.outcome_r = tracker.result(exit_price, self.fee_pct)
                    rec.closed_at = t.isoformat()
                    break
            rec.tracker = asdict(tracker)
        if changed:
            self.save()

    def stats(self) -> str:
        done = [r for r in self.records.values() if not r.open]
        if not done:
            pending = sum(1 for r in self.records.values() if r.open)
            return f"Aucun trade fictif terminé pour l'instant ({pending} en cours)."

        def line(label: str, recs: list[SignalRecord]) -> str:
            if not recs:
                return f"{label} : —"
            rs = [r.outcome_r for r in recs]
            wins = sum(1 for x in rs if x > 0)
            return f"{label} : {len(rs)} trade{'s' if len(rs) > 1 else ''} · {wins / len(rs) * 100:.0f} % gagnants · {sum(rs) / len(rs):+.2f} R/trade · total {sum(rs):+.1f} R"

        lines = ["<b>Résultats fictifs</b> (tous les signaux, nets de frais)", line("Stratégie seule", done), "", "<b>Selon ta décision</b>"]
        for decision in DECISIONS[1:]:
            recs = [r for r in done if r.decision == decision]
            if recs:
                lines.append(line(decision.capitalize(), recs))
        lines += ["", "<b>Selon l'avis de Claude</b>"]
        for verdict in ("favorable", "neutre", "defavorable"):
            recs = [r for r in done if r.verdict == verdict]
            if recs:
                lines.append(line(verdict.capitalize(), recs))
        lines += ["", "1 R = la perte si le stop initial est touché. Il faut au moins 50 trades pour conclure."]
        return "\n".join(lines)
