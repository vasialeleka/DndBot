"""Telegram-бот для створення персонажа D&D 5e (2014) через Mini App.

Потік:
1. /start → бот показує кнопку «🎲 Створити персонажа» (reply-keyboard з web_app).
2. Користувач заповнює Mini App (webapp/index.html, розміщений на HTTPS).
3. По кнопці «Готово» Mini App викликає Telegram.WebApp.sendData(json).
4. Telegram сам закриває апку і надсилає боту повідомлення з web_app_data.
5. Бот парсить JSON, генерує PDF-чарник і надсилає його файлом у чат.
"""

from __future__ import annotations

import json
import logging
import os
import re

from dotenv import load_dotenv
from telegram import (
    KeyboardButton,
    ReplyKeyboardMarkup,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from pdf_generator import build_character_pdf

load_dotenv()

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("dndbot")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
WEBAPP_URL = os.environ.get("WEBAPP_URL", "").strip()


def _keyboard() -> ReplyKeyboardMarkup:
    """Reply-клавіатура з кнопкою запуску Mini App.

    Важливо: sendData() працює ЛИШЕ з web_app, відкритого з reply-keyboard кнопки
    (не inline, не menu button) — тому саме такий тип клавіатури.
    """
    button = KeyboardButton(
        text="🎲 Створити персонажа",
        web_app=WebAppInfo(url=WEBAPP_URL),
    )
    return ReplyKeyboardMarkup(
        [[button]],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Натисни «Створити персонажа»",
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "🐉 *Вітаю у створювачі персонажів D&D 5e (2014)!*\n\n"
        "Натисни кнопку нижче — відкриється майстер, де можна обрати:\n"
        "• *Повний режим* — раса, клас, характеристики, навички, спорядження;\n"
        "• *Швидкий режим* — базове, решта підбереться автоматично.\n\n"
        "Наприкінці буде екран-перевірка → натискаєш «Готово» → "
        "я надсилаю тобі готовий *PDF-чарник*. 📜"
    )
    await update.message.reply_markdown(text, reply_markup=_keyboard())


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_markdown(
        "Команди:\n"
        "• /start — почати створення персонажа\n"
        "• /help — ця довідка\n\n"
        "Якщо кнопка не відкриває майстер — переконайся, що `WEBAPP_URL` "
        "у `.env` вказує на робочий HTTPS-адрес (GitHub Pages).",
        reply_markup=_keyboard(),
    )


def _slug(s: str) -> str:
    """Прибирає небезпечні символи й пробіли для частини імені файлу."""
    s = re.sub(r"[^\w\-]", "_", (s or "").strip())
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:40]


def _safe_filename(char: dict) -> str:
    """Ім'я файлу: <Назва персонажа>_<раса>_<ім'я гравця>.pdf."""
    parts = [_slug(char.get("name")), _slug(char.get("race")), _slug(char.get("player"))]
    base = "_".join(p for p in parts if p) or "character"
    return f"{base}.pdf"


async def on_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Приймає JSON персонажа з Mini App і повертає PDF."""
    raw = update.effective_message.web_app_data.data
    try:
        char = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.exception("Не вдалося розпарсити web_app_data")
        await update.message.reply_text(
            "😔 Не вдалося прочитати дані персонажа. Спробуй ще раз через /start."
        )
        return

    if not isinstance(char, dict):
        await update.message.reply_text("😔 Отримано неочікуваний формат даних.")
        return

    # Ім'я гравця з Telegram, якщо в апці не задано власне
    if not char.get("player"):
        char["player"] = update.effective_user.full_name

    name = char.get("name") or "персонаж"
    await update.message.reply_text(f"⚙️ Готую чарник для *{name}*…",
                                    parse_mode="Markdown")

    try:
        pdf_bytes = build_character_pdf(char)
    except Exception:  # noqa: BLE001
        logger.exception("Помилка генерації PDF")
        await update.message.reply_text(
            "😔 Сталася помилка під час створення PDF. Спробуй ще раз."
        )
        return

    await update.message.reply_document(
        document=pdf_bytes,
        filename=_safe_filename(char),
        caption=(
            f"✅ Готово! Твій чарник: *{name}* — "
            f"{char.get('race','')} {char.get('class','')} "
            f"{char.get('level','')} рів."
        ).strip(),
        parse_mode="Markdown",
        reply_markup=_keyboard(),
    )


async def fallback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "Натисни кнопку «🎲 Створити персонажа» нижче або /start.",
        reply_markup=_keyboard(),
    )


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN не задано у .env")
    if not WEBAPP_URL or WEBAPP_URL.startswith("https://example"):
        logger.warning(
            "WEBAPP_URL не налаштовано (%s). Кнопка Mini App не працюватиме, "
            "поки не вкажеш робочий HTTPS-адрес у .env", WEBAPP_URL or "порожньо",
        )

    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, on_webapp_data))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, fallback))

    logger.info("Бот запущено. Очікую повідомлення…")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
