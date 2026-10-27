"""Second avis de Claude sur un signal, joint à l'alerte Telegram."""

import logging
from typing import Literal

import anthropic
import pandas as pd
from pydantic import BaseModel

from strategy import Signal

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """Tu es l'assistant d'un trader crypto qui suit les tendances en unités de temps courtes.
Un algorithme vient de détecter un signal technique. Ton rôle : juger si le contexte du graphique
rend ce trade raisonnable, en t'appuyant uniquement sur les données fournies.

Regarde notamment : mouvement déjà très étendu (entrée tardive), bougie d'entrée anormalement grande,
mèches de rejet, range/consolidation qui rend le croisement peu fiable, volatilité qui rend le stop
trop serré ou trop large, signaux contradictoires entre les indicateurs.

Tu n'as accès ni aux news ni au carnet d'ordres : ne les invente pas. Sois bref, concret et honnête ;
si le signal est banal, dis-le. Réponds en français."""


class Analysis(BaseModel):
    verdict: Literal["favorable", "neutre", "defavorable"]
    confidence: int  # 0 à 100
    summary: str  # 1 à 2 phrases
    risks: list[str]  # 0 à 3 points d'attention courts


def _format_candles(df: pd.DataFrame, n: int = 40) -> str:
    cols = ["open", "high", "low", "close", "volume", "ema_fast", "ema_slow", "ema_trend", "adx", "atr"]
    tail = df[[c for c in cols if c in df.columns]].tail(n)
    lines = ["time," + ",".join(tail.columns)]
    for t, row in tail.iterrows():
        lines.append(t.strftime("%m-%d %H:%M") + "," + ",".join(f"{v:.6g}" for v in row.values))
    return "\n".join(lines)


class Analyst:
    def __init__(self, model: str):
        self.model = model
        self.client = anthropic.AsyncAnthropic(timeout=60, max_retries=1)

    async def analyze(self, signal: Signal, df: pd.DataFrame, timeframe: str) -> Analysis | None:
        """Renvoie l'avis de Claude, ou None si l'appel échoue (l'alerte part quand même)."""
        prompt = (
            f"Signal {signal.side.upper()} sur {signal.symbol} ({timeframe})\n"
            f"Prix d'entrée : {signal.price:.6g}\n"
            f"Stop-loss : {signal.stop_loss:.6g} | Objectif : {signal.take_profit:.6g} "
            f"(R/R {signal.risk_reward:.1f})\n"
            f"Déclencheurs : {'; '.join(signal.reasons)}\n\n"
            f"Dernières bougies clôturées (CSV) :\n{_format_candles(df)}"
        )
        try:
            response = await self.client.beta.messages.parse(
                model=self.model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
                output_format=Analysis,
                # Effort bas : en trading rapide, une réponse en quelques secondes vaut mieux
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as e:
            log.warning("Analyse Claude indisponible : %s", e)
            return None

        if response.stop_reason == "refusal":
            log.warning("Claude a refusé d'analyser le signal %s", signal.symbol)
            return None
        analysis = response.parsed_output
        if analysis is not None:
            analysis.confidence = max(0, min(100, analysis.confidence))
        return analysis
