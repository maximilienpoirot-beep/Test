"""Bot survivant (mode papier) : surveille les memecoins Binance et vit sa vie, seul, jour et nuit.

    python survivor_bot.py
"""

import asyncio
import datetime as dt
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import pandas as pd
from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes, filters

from survivor import MEMECOINS, Survivor, SurvivorConfig, surge_signal

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("survivant")

API = "https://data-api.binance.vision/api/v3"


def get_json(path: str):
    with urllib.request.urlopen(f"{API}/{path}", timeout=30) as resp:
        return json.load(resp)


def fetch_prices(coins: list[str]) -> dict[str, float]:
    symbols = urllib.parse.quote(json.dumps([c + "USDT" for c in coins], separators=(",", ":")))
    return {row["symbol"][:-4]: float(row["price"]) for row in get_json(f"ticker/price?symbols={symbols}")}


def fetch_closed_hours(coin: str, current_hour: pd.Timestamp) -> pd.DataFrame:
    """Les ~200 dernières bougies d'1 heure clôturées (celle en cours est retirée)."""
    rows = get_json(f"klines?symbol={coin}USDT&interval=1h&limit=200")
    df = pd.DataFrame([[k[0], float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7])] for k in rows],
                      columns=["time", "open", "high", "low", "close", "volume"])
    df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
    df = df.set_index("time")
    return df[df.index < current_hour]


class SurvivorBot:
    def __init__(self):
        load_dotenv()
        if os.getenv("SURVIVOR_MODE", "paper").strip().lower() != "paper":
            raise SystemExit("Le bot survivant ne fonctionne qu'en mode papier pour l'instant (SURVIVOR_MODE=paper).")
        self.token = (os.getenv("SURVIVOR_TELEGRAM_TOKEN") or os.getenv("TELEGRAM_TOKEN", "")).strip()
        self.chat_id = int(os.getenv("TELEGRAM_CHAT_ID", "0") or 0)
        if not self.token or not self.chat_id:
            raise SystemExit("TELEGRAM_TOKEN (ou SURVIVOR_TELEGRAM_TOKEN) et TELEGRAM_CHAT_ID sont obligatoires dans le .env")
        self.state_file = os.getenv("SURVIVOR_STATE_FILE", "data/survivor.json")
        self.scan_seconds = int(os.getenv("SURVIVOR_SCAN_SECONDS", "300"))
        hh, mm = os.getenv("SURVIVOR_REPORT_TIME", "20:00").split(":")
        self.report_time = dt.time(int(hh), int(mm), tzinfo=ZoneInfo("Europe/Paris"))
        self.cfg = SurvivorConfig()
        self.coins = list(MEMECOINS)
        self.prices: dict[str, float] = {}
        self.failures = 0
        self.last_hour = ""
        self.is_new = not os.path.exists(self.state_file)
        if self.is_new:
            self.s = Survivor.new(self.cfg, pd.Timestamp.now(tz="UTC"))
        else:
            with open(self.state_file) as f:
                raw = json.load(f)
            self.s = Survivor.from_dict(self.cfg, raw["survivor"])
            self.last_hour = raw.get("last_hour", "")
        self.save()

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.state_file) or ".", exist_ok=True)
        tmp = self.state_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"survivor": self.s.to_dict(), "last_hour": self.last_hour}, f, indent=1)
        os.replace(tmp, self.state_file)

    async def send(self, app: Application, text: str) -> None:
        try:
            await app.bot.send_message(self.chat_id, text, parse_mode=ParseMode.HTML)
        except Exception:
            log.exception("Envoi Telegram impossible")

    # --- Boucle de vie ---------------------------------------------------

    async def tick(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        app = context.application
        now = pd.Timestamp.now(tz="UTC")
        if self.s.dead:
            return
        try:
            self.prices = await asyncio.to_thread(fetch_prices, self.coins)
            events = []
            for coin in list(self.s.positions):
                p = self.prices.get(coin)
                if p:
                    events += self.s.on_bar(coin, p, p, p, now)
            events += self.s.check(self.prices, now)

            hour = now.floor("h")
            if self.last_hour != (hour - pd.Timedelta(hours=1)).isoformat():
                events += await self.hunt(hour, now)
                self.last_hour = (hour - pd.Timedelta(hours=1)).isoformat()
            self.failures = 0
        except (urllib.error.URLError, OSError, ValueError) as e:
            self.failures += 1
            log.warning("Lecture du marché impossible (%s échec(s) d'affilée) : %s", self.failures, e)
            if self.failures == 6:
                await self.send(app, "⚠️ Je n'arrive plus à lire le marché depuis 30 minutes. "
                                     "Je réessaie en continu ; mes positions ne sont pas surveillées pendant ce temps.")
            return
        self.save()
        for e in events:
            await self.send(app, e.text)

    async def hunt(self, hour: pd.Timestamp, now: pd.Timestamp) -> list:
        """À chaque nouvelle heure : cherche les vagues sur la bougie qui vient de se clôturer."""
        candidates = []
        for coin in self.coins:
            if self.s.block_reason(coin, now):
                continue
            try:
                df = await asyncio.to_thread(fetch_closed_hours, coin, hour)
            except (urllib.error.URLError, OSError, ValueError) as e:
                log.warning("%s : bougies indisponibles (%s)", coin, e)
                continue
            if len(df) > 170 and surge_signal(df, self.cfg)[-1]:
                candidates.append((df["close"].iloc[-1] / df["close"].iloc[-25] - 1, coin))
        events = []
        for surge, coin in sorted(candidates, reverse=True):  # la vague la plus forte d'abord
            log.info("Vague détectée sur %s (+%.0f %% en 24 h)", coin, surge * 100)
            price = self.prices.get(coin)
            event = self.s.attack(coin, price, now, self.prices) if price else None
            if event:
                event.text = f"🌊 Vague sur {coin} : +{surge:.0%} en 24 h avec un volume ×{self.cfg.vol_mult:g}\n" + event.text
                events.append(event)
        return events

    async def daily_report(self, context: ContextTypes.DEFAULT_TYPE) -> None:
        now = pd.Timestamp.now(tz="UTC")
        today = [t for t in self.s.history if t.closed_at[:10] == now.isoformat()[:10]]
        extra = f"\nAujourd'hui : {len(today)} combat(s), {sum(t.pnl for t in today):+.2f} $" if today else "\nAujourd'hui : calme plat"
        await self.send(context.application, "📊 <b>Bilan du soir</b>\n" + self.s.status(self.prices, now) + extra)

    # --- Commandes -------------------------------------------------------

    async def cmd_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.message.reply_html(
            "🐾 <b>Bot survivant</b> (mode papier)\n"
            f"Il surveille {len(self.coins)} memecoins Binance toutes les heures et vit seul, jour et nuit.\n\n"
            "/pv : sa barre de vie et ses positions\n"
            "/historique : ses derniers combats\n"
            "/pause et /reprendre : bloquer ou autoriser les nouvelles attaques\n"
            "/fermer_tout : tout vendre maintenant\n"
            "/renaitre : recommencer une nouvelle vie (seulement s'il est mort)")

    async def cmd_hp(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await update.message.reply_html(self.s.status(self.prices, pd.Timestamp.now(tz="UTC")))

    async def cmd_history(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self.s.history:
            await update.message.reply_text("Aucun combat pour l'instant. Il attend une vraie vague.")
            return
        lines = [f"{'🏆' if t.pnl >= 0 else '🩸'} {t.closed_at[5:16].replace('T', ' ')} {t.coin} {t.pnl:+.2f} $ ({t.reason})"
                 for t in self.s.history[-10:]]
        total = sum(t.pnl for t in self.s.history)
        lines.append(f"\nTotal : {total:+.2f} $ sur {len(self.s.history)} combats")
        await update.message.reply_text("\n".join(lines))

    async def cmd_pause(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        self.s.paused = True
        self.save()
        await update.message.reply_text("⏸ Plus de nouvelles attaques. Les positions ouvertes restent surveillées.")

    async def cmd_resume(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        self.s.paused = False
        self.save()
        await update.message.reply_text("▶️ Il repart en chasse.")

    async def cmd_close_all(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self.s.positions:
            await update.message.reply_text("Aucune position ouverte.")
            return
        now = pd.Timestamp.now(tz="UTC")
        prices = await asyncio.to_thread(fetch_prices, self.coins)
        for coin, pos in list(self.s.positions.items()):
            event = self.s._close(pos, prices.get(coin, pos.entry), now, "fermeture manuelle")
            await update.message.reply_html(event.text)
        self.save()

    async def cmd_reborn(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not self.s.dead:
            await update.message.reply_text("Il est encore en vie : pas de renaissance possible.")
            return
        archive = self.state_file.replace(".json", f"-vie-{self.s.born_at[:10]}.json")
        os.replace(self.state_file, archive)
        self.s = Survivor.new(self.cfg, pd.Timestamp.now(tz="UTC"))
        self.save()
        await update.message.reply_html(f"🐣 <b>Une nouvelle vie commence</b> avec {self.cfg.start_hp:.0f} PV.\n"
                                        f"L'ancienne vie est archivée dans {archive}.")


def main() -> None:
    bot = SurvivorBot()

    async def on_startup(app: Application) -> None:
        bot.prices = await asyncio.to_thread(fetch_prices, bot.coins)
        hello = "🐣 <b>Le survivant est né</b>" if bot.is_new else "🔄 <b>Le survivant se réveille</b>"
        await bot.send(app, f"{hello} · mode papier\n" + bot.s.status(bot.prices, pd.Timestamp.now(tz="UTC")))

    app = Application.builder().token(bot.token).post_init(on_startup).build()
    me = filters.Chat(chat_id=bot.chat_id)
    for names, handler in ((["start", "aide"], bot.cmd_help), ("pv", bot.cmd_hp), ("historique", bot.cmd_history),
                           ("pause", bot.cmd_pause), ("reprendre", bot.cmd_resume),
                           ("fermer_tout", bot.cmd_close_all), ("renaitre", bot.cmd_reborn)):
        app.add_handler(CommandHandler(names, handler, filters=me))
    app.job_queue.run_repeating(bot.tick, interval=bot.scan_seconds, first=5)
    app.job_queue.run_daily(bot.daily_report, time=bot.report_time)
    log.info("Survivant en vie, vérification toutes les %s s", bot.scan_seconds)
    app.run_polling()


if __name__ == "__main__":
    main()
