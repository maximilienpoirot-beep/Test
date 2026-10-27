"""Configuration du bot, lue depuis les variables d'environnement (fichier .env)."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv


def _str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "oui", "on")


def _int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value and value.strip() else default


def _float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value and value.strip() else default


@dataclass(frozen=True)
class Config:
    # Mode : "paper" (argent fictif) ou "live" (ordres réels)
    mode: str

    # Exchange (via ccxt)
    exchange_id: str
    api_key: str
    api_secret: str
    sandbox: bool

    # Marchés surveillés
    symbols: list[str]
    timeframe: str
    scan_interval: int

    # Stratégie
    ema_fast: int
    ema_slow: int
    ema_trend: int
    adx_period: int
    adx_min: float
    volume_mult: float
    atr_period: int
    sl_atr: float
    tp_atr: float
    allow_short: bool

    # Gestion du risque
    paper_balance: float
    risk_per_trade_pct: float
    max_position_usdt: float
    max_open_positions: int
    max_daily_loss_usdt: float
    fee_pct: float

    # Alertes
    alert_ttl: int
    max_slippage_pct: float

    # Telegram
    telegram_token: str
    telegram_chat_id: int

    # Claude
    claude_enabled: bool
    claude_model: str

    state_file: str

    @property
    def live(self) -> bool:
        return self.mode == "live"


def load_config(require_telegram: bool = True) -> Config:
    load_dotenv()

    mode = _str("MODE", "paper").lower()
    if mode not in ("paper", "live"):
        raise ValueError(f"MODE doit valoir 'paper' ou 'live', pas '{mode}'")

    symbols = [s.strip().upper() for s in _str("SYMBOLS", "BTC/USDT,ETH/USDT,SOL/USDT").split(",") if s.strip()]

    chat_id = _str("TELEGRAM_CHAT_ID")
    cfg = Config(
        mode=mode,
        exchange_id=_str("EXCHANGE", "binance").lower(),
        api_key=_str("EXCHANGE_API_KEY"),
        api_secret=_str("EXCHANGE_API_SECRET"),
        sandbox=_bool("EXCHANGE_SANDBOX", False),
        symbols=symbols,
        timeframe=_str("TIMEFRAME", "5m"),
        scan_interval=_int("SCAN_INTERVAL", 30),
        ema_fast=_int("EMA_FAST", 9),
        ema_slow=_int("EMA_SLOW", 21),
        ema_trend=_int("EMA_TREND", 50),
        adx_period=_int("ADX_PERIOD", 14),
        adx_min=_float("ADX_MIN", 20),
        volume_mult=_float("VOLUME_MULT", 1.2),
        atr_period=_int("ATR_PERIOD", 14),
        sl_atr=_float("SL_ATR", 1.5),
        tp_atr=_float("TP_ATR", 3.0),
        allow_short=_bool("ALLOW_SHORT", False),
        paper_balance=_float("PAPER_BALANCE", 1000),
        risk_per_trade_pct=_float("RISK_PER_TRADE_PCT", 1.0),
        max_position_usdt=_float("MAX_POSITION_USDT", 200),
        max_open_positions=_int("MAX_OPEN_POSITIONS", 3),
        max_daily_loss_usdt=_float("MAX_DAILY_LOSS_USDT", 50),
        fee_pct=_float("FEE_PCT", 0.1),
        alert_ttl=_int("ALERT_TTL", 180),
        max_slippage_pct=_float("MAX_SLIPPAGE_PCT", 0.3),
        telegram_token=_str("TELEGRAM_TOKEN"),
        telegram_chat_id=int(chat_id) if chat_id else 0,
        claude_enabled=_bool("CLAUDE_ENABLED", True),
        claude_model=_str("CLAUDE_MODEL", "claude-opus-5-5"),
        state_file=_str("STATE_FILE", "data/state.json"),
    )

    if require_telegram and (not cfg.telegram_token or not cfg.telegram_chat_id):
        raise ValueError("TELEGRAM_TOKEN et TELEGRAM_CHAT_ID sont obligatoires")
    if cfg.live and (not cfg.api_key or not cfg.api_secret):
        raise ValueError("En mode live, EXCHANGE_API_KEY et EXCHANGE_API_SECRET sont obligatoires")
    if cfg.live and cfg.allow_short:
        raise ValueError("Les ventes à découvert ne sont pas gérées en live (spot uniquement) : mets ALLOW_SHORT=false")
    if cfg.ema_fast >= cfg.ema_slow:
        raise ValueError("EMA_FAST doit être plus petit que EMA_SLOW")
    return cfg
