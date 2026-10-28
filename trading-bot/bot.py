"""Bot Telegram : surveille le marché, envoie les signaux, exécute ceux que tu valides."""

import asyncio
import html
import logging
import time
import uuid
from dataclasses import dataclass

import ccxt
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, filters

from analyst import Analysis, Analyst
from broker import Broker, ClosedTrade, Position
from config import Config, load_config
from journal import Journal
from strategy import Signal, StrategyParams, add_indicators, ohlcv_to_df, signal_at

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("bot")

VERDICT_ICON = {"favorable": "🟢", "neutre": "🟡", "defavorable": "🔴"}


@dataclass
class PendingAlert:
    signal: Signal
    created: float
    message_id: int
    record_id: str


def make_exchange(cfg: Config) -> ccxt.Exchange:
    exchange = getattr(ccxt, cfg.exchange_id)(
        {"apiKey": cfg.api_key or None, "secret": cfg.api_secret or None, "enableRateLimit": True}
    )
    if cfg.sandbox:
        exchange.set_sandbox_mode(True)
    exchange.load_markets()
    missing = [s for s in cfg.symbols if s not in exchange.markets]
    if missing:
        raise ValueError(f"Paires inconnues sur {cfg.exchange_id} : {', '.join(missing)}")
    return exchange


def fmt(x: float) -> str:
    return f"{x:,.6g}".replace(",", " ")


def format_alert(cfg: Config, sig: Signal, analysis: Analysis | None) -> str:
    icon = "📈" if sig.side == "long" else "📉"
    lines = [
        f"{icon} <b>{sig.side.upper()} {html.escape(sig.symbol)}</b> ({cfg.timeframe})"
        + ("" if cfg.live else "  <i>[papier]</i>"),
        f"Entrée ≈ <code>{fmt(sig.price)}</code>",
        f"Stop-loss <code>{fmt(sig.stop_loss)}</code> (−{sig.risk_pct:.2f} %)",
        f"Sortie : stop au prix d'entrée dès +{cfg.breakeven_r:g} R, puis stop suiveur à {cfg.trail_atr:g} ATR",
        "",
        *[f"• {html.escape(r)}" for r in sig.reasons],
    ]
    if analysis:
        lines += [
            "",
            f"{VERDICT_ICON[analysis.verdict]} <b>Claude : {analysis.verdict}</b> ({analysis.confidence}/100)",
            html.escape(analysis.summary),
            *[f"⚠️ {html.escape(r)}" for r in analysis.risks[:3]],
        ]
    elif cfg.claude_enabled:
        lines += ["", "<i>Analyse Claude indisponible</i>"]
    lines += ["", f"⏳ Valable {cfg.alert_ttl // 60} min"]
    return "\n".join(lines)


def format_position(pos: Position, price: float | None = None) -> str:
    text = (
        f"<b>{pos.side.upper()} {html.escape(pos.symbol)}</b> · {fmt(pos.qty)} @ <code>{fmt(pos.entry_price)}</code>\n"
        f"Stop <code>{fmt(pos.stop_loss)}</code>"
        + (" (posé sur l'exchange)" if pos.stop_order_id else "")
    )
    if price is not None:
        text += f"\nPrix <code>{fmt(price)}</code> · PnL {pos.unrealized_pnl(price):+.2f} USDT"
    return text


def format_closed(t: ClosedTrade) -> str:
    icon = "✅" if t.pnl >= 0 else "❌"
    return (
        f"{icon} <b>{html.escape(t.symbol)} fermé</b> ({t.reason})\n"
        f"{fmt(t.entry_price)} → {fmt(t.exit_price)} · PnL <b>{t.pnl:+.2f} USDT</b>"
    )


def close_button(pos: Position) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("🔒 Fermer la position", callback_data=f"close:{pos.id}")]])


class TradingBot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.params = StrategyParams.from_config(cfg)
        self.exchange = make_exchange(cfg)
        self.broker = Broker(cfg, self.exchange)
        self.journal = Journal(cfg.journal_file, self.broker.exit_params, cfg.fee_pct)
        self.analyst = Analyst(cfg.claude_model) if cfg.claude_enabled else None
        self.pending: dict[str, PendingAlert] = {}
        self.last_candle: dict[str, object] = {}

    async def send(self, app: Application, text: str, markup=None):
        return await app.bot.send_message(
            self.cfg.telegram_chat_id, text, parse_mode=ParseMode.HTML, reply_markup=markup
        )

    async def price(self, symbol: str) -> float:
        ticker = await asyncio.to_thread(self.exchange.fetch_ticker, symbol)
        return float(ticker["last"])

    # --- Boucle de surveillance -------------------------------------------

    async def scan(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        app = context.application
        await self.expire_alerts(app)
        for symbol in self.cfg.symbols:
            try:
                await self.scan_symbol(app, symbol)
            except ccxt.NetworkError as e:
                log.warning("%s : erreur réseau %s", symbol, e)
            except Exception:
                log.exception("%s : erreur pendant l'analyse", symbol)

    async def scan_symbol(self, app: Application, symbol: str) -> None:
        limit = self.params.warmup + 150
        ohlcv = await asyncio.to_thread(self.exchange.fetch_ohlcv, symbol, self.cfg.timeframe, None, limit)
        df = ohlcv_to_df(ohlcv)
        last_price = float(df["close"].iloc[-1])

        update = await self.broker.update(symbol, last_price)
        for note in update.notes:
            await self.send(app, note)
        for trade in update.closed:
            await self.send(app, format_closed(trade))
            await self.warn_if_daily_limit(app)

        # La dernière bougie est en cours de formation : on ne regarde que les bougies clôturées
        closed = add_indicators(df.iloc[:-1], self.params)
        self.journal.update(symbol, closed)
        candle_time = closed.index[-1]
        if self.last_candle.get(symbol) == candle_time:
            return
        first_scan = symbol not in self.last_candle
        self.last_candle[symbol] = candle_time
        if first_scan:
            return  # au démarrage, on ne déclenche pas sur une bougie déjà ancienne

        signal = signal_at(closed, len(closed) - 1, symbol, self.params)
        if signal is None:
            return
        blocked = self.broker.risk_block_reason(signal)
        if blocked:
            log.info("Signal %s %s ignoré : %s", signal.side, symbol, blocked)
            self.journal.add(signal, "bloqué", blocked)
            return

        analysis = await self.analyst.analyze(signal, closed, self.cfg.timeframe) if self.analyst else None
        alert_id = uuid.uuid4().hex[:8]
        markup = InlineKeyboardMarkup(
            [[
                InlineKeyboardButton("✅ Valider", callback_data=f"ok:{alert_id}"),
                InlineKeyboardButton("❌ Ignorer", callback_data=f"no:{alert_id}"),
            ]]
        )
        record = self.journal.add(signal, analysis=analysis)
        msg = await self.send(app, format_alert(self.cfg, signal, analysis), markup)
        self.pending[alert_id] = PendingAlert(signal, time.time(), msg.message_id, record.id)

    async def expire_alerts(self, app: Application) -> None:
        now = time.time()
        for alert_id, alert in list(self.pending.items()):
            if now - alert.created > self.cfg.alert_ttl:
                del self.pending[alert_id]
                self.journal.set_decision(alert.record_id, "expiré")
                await self.edit_suffix(app, alert.message_id, "⌛ <i>Expirée</i>")

    async def edit_suffix(self, app: Application, message_id: int, suffix: str, markup=None) -> None:
        """Remplace les boutons d'une alerte par un statut."""
        try:
            await app.bot.edit_message_reply_markup(self.cfg.telegram_chat_id, message_id, reply_markup=markup)
            await app.bot.send_message(
                self.cfg.telegram_chat_id, suffix, parse_mode=ParseMode.HTML, reply_to_message_id=message_id
            )
        except Exception:
            log.exception("Impossible de mettre à jour le message %s", message_id)

    async def warn_if_daily_limit(self, app: Application) -> None:
        if self.broker.today_pnl() <= -self.cfg.max_daily_loss_usdt:
            await self.send(
                app,
                f"🛑 Perte max du jour atteinte ({self.broker.today_pnl():+.2f} USDT). "
                "Plus aucune alerte jusqu'à demain (UTC).",
            )

    # --- Boutons ---------------------------------------------------------

    async def on_button(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        if query.message.chat.id != self.cfg.telegram_chat_id:
            await query.answer("Non autorisé")
            return
        action, _, ref = query.data.partition(":")
        app = context.application

        if action == "close":
            await query.answer("Fermeture…")
            pos = self.broker.state.positions.get(ref)
            if pos is None:
                await query.edit_message_reply_markup(None)
                await self.send(app, "Cette position est déjà fermée.")
                return
            try:
                trade = await self.broker.close(ref, await self.price(pos.symbol), "manuelle")
            except Exception as e:
                await self.send(app, f"⚠️ Échec de la fermeture : {html.escape(str(e))}")
                return
            await query.edit_message_reply_markup(None)
            await self.send(app, format_closed(trade))
            return

        alert = self.pending.pop(ref, None)
        if alert is None:
            await query.answer("Alerte expirée ou déjà traitée")
            await query.edit_message_reply_markup(None)
            return

        if action == "no":
            await query.answer("Ignorée")
            self.journal.set_decision(alert.record_id, "ignoré")
            await self.edit_suffix(app, alert.message_id, "❌ <i>Ignorée</i>")
            return

        await query.answer("Exécution…")
        sig = alert.signal
        try:
            price = await self.price(sig.symbol)
            drift = (price - sig.price) / sig.price * 100 * (1 if sig.side == "long" else -1)
            if drift > self.cfg.max_slippage_pct:
                raise RuntimeError(f"le prix a déjà bougé de {drift:+.2f} % (max {self.cfg.max_slippage_pct} %)")
            beyond_stop = price <= sig.stop_loss if sig.side == "long" else price >= sig.stop_loss
            if beyond_stop:
                raise RuntimeError("le prix a déjà dépassé le stop-loss")
            pos = await self.broker.open(sig, price)
        except Exception as e:
            self.journal.set_decision(alert.record_id, "refusé", str(e))
            await self.edit_suffix(app, alert.message_id, f"⚠️ Non exécuté : {html.escape(str(e))}")
            return
        self.journal.set_decision(alert.record_id, "validé")
        await self.edit_suffix(app, alert.message_id, "✅ <b>Position ouverte</b>\n" + format_position(pos))
        await self.send(app, format_position(pos), close_button(pos))
        if self.broker.uses_exchange_stops and not pos.stop_order_id:
            await self.send(
                app,
                "⚠️ L'exchange a refusé le stop-loss : c'est le bot qui le surveille. "
                "S'il s'arrête, la position n'est plus protégée.",
            )

    # --- Commandes -------------------------------------------------------

    async def cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.message.reply_html(
            "<b>Bot de trading</b> "
            + ("🔴 <b>LIVE</b>" if self.cfg.live else "🧪 papier")
            + f"\nSurveille {', '.join(self.cfg.symbols)} en {self.cfg.timeframe}.\n\n"
            "/statut : capital, PnL du jour, positions\n"
            "/pause : arrêter les alertes\n"
            "/reprendre : relancer les alertes\n"
            "/fermer_tout : fermer toutes les positions\n"
            "/historique : derniers trades\n"
            "/stats : résultats fictifs de tous les signaux (stratégie, tes choix, Claude)"
        )

    async def cmd_status(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        state = self.broker.state
        lines = [
            ("🔴 LIVE" if self.cfg.live else "🧪 Papier") + (" · ⏸ en pause" if state.paused else " · ▶️ actif"),
            f"Capital : <b>{await self.broker.equity():.2f} USDT</b>",
            f"PnL du jour : {self.broker.today_pnl():+.2f} USDT (limite −{self.cfg.max_daily_loss_usdt:g})",
            f"Positions : {len(state.positions)}/{self.cfg.max_open_positions}",
        ]
        await update.message.reply_html("\n".join(lines))
        for pos in list(state.positions.values()):
            await update.message.reply_html(format_position(pos, await self.price(pos.symbol)), reply_markup=close_button(pos))

    async def cmd_pause(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        self.broker.state.paused = True
        self.broker.save()
        await update.message.reply_text("⏸ Alertes en pause. Les positions ouvertes et leurs stops restent suivis.")

    async def cmd_resume(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        self.broker.state.paused = False
        self.broker.save()
        await update.message.reply_text("▶️ Alertes relancées.")

    async def cmd_close_all(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        positions = list(self.broker.state.positions.values())
        if not positions:
            await update.message.reply_text("Aucune position ouverte.")
            return
        for pos in positions:
            try:
                trade = await self.broker.close(pos.id, await self.price(pos.symbol), "manuelle")
                await update.message.reply_html(format_closed(trade))
            except Exception as e:
                await update.message.reply_text(f"⚠️ {pos.symbol} : {e}")

    async def cmd_stats(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.message.reply_html(self.journal.stats())

    async def cmd_history(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        trades = self.broker.state.history[-10:]
        if not trades:
            await update.message.reply_text("Aucun trade pour l'instant.")
            return
        total = sum(t.pnl for t in self.broker.state.history)
        wins = sum(1 for t in self.broker.state.history if t.pnl > 0)
        lines = [f"{'✅' if t.pnl >= 0 else '❌'} {t.closed_at[5:16]} {t.symbol} {t.side} {t.pnl:+.2f} ({t.reason})" for t in trades]
        lines.append(f"\nTotal : {total:+.2f} USDT · {wins}/{len(self.broker.state.history)} gagnants")
        await update.message.reply_text("\n".join(lines))


def main() -> None:
    cfg = load_config()
    bot = TradingBot(cfg)

    async def on_startup(app: Application) -> None:
        mode = "🔴 <b>MODE LIVE : ordres réels</b>" if cfg.live else "🧪 Mode papier"
        await bot.send(app, f"🤖 Bot démarré · {mode}\n{', '.join(cfg.symbols)} · {cfg.timeframe}")

    app = Application.builder().token(cfg.telegram_token).post_init(on_startup).build()
    me = filters.Chat(chat_id=cfg.telegram_chat_id)
    app.add_handler(CommandHandler(["start", "aide"], bot.cmd_start, filters=me))
    app.add_handler(CommandHandler("statut", bot.cmd_status, filters=me))
    app.add_handler(CommandHandler("pause", bot.cmd_pause, filters=me))
    app.add_handler(CommandHandler("reprendre", bot.cmd_resume, filters=me))
    app.add_handler(CommandHandler("fermer_tout", bot.cmd_close_all, filters=me))
    app.add_handler(CommandHandler("historique", bot.cmd_history, filters=me))
    app.add_handler(CommandHandler("stats", bot.cmd_stats, filters=me))
    app.add_handler(CallbackQueryHandler(bot.on_button))
    app.job_queue.run_repeating(bot.scan, interval=cfg.scan_interval, first=1)

    log.info("Démarrage en mode %s sur %s", cfg.mode, cfg.exchange_id)
    app.run_polling()


if __name__ == "__main__":
    main()
