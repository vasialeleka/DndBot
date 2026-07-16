"""Генерація PDF-чарника D&D 5e (2014) з готового об'єкта персонажа.

Вхід — dict, який надсилає Mini App через WebApp.sendData (див. схему в README).
Усі похідні значення (модифікатори, HP, AC, кидки) вже пораховані на клієнті;
тут ми лише акуратно розкладаємо їх на аркуші.
"""

from __future__ import annotations

import io
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# --- Реєстрація Unicode-шрифту (кирилиця) --------------------------------
# Helvetica з коробки не має кирилиці, тож шукаємо TTF на системі.
_FONT_CANDIDATES = [
    # (regular, bold)
    ("/System/Library/Fonts/Supplemental/Arial.ttf",
     "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/Library/Fonts/DejaVuSans.ttf",
     "/Library/Fonts/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
     "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
]

FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"

for _reg, _bold in _FONT_CANDIDATES:
    if os.path.exists(_reg) and os.path.exists(_bold):
        try:
            pdfmetrics.registerFont(TTFont("Sheet", _reg))
            pdfmetrics.registerFont(TTFont("Sheet-Bold", _bold))
            FONT = "Sheet"
            FONT_BOLD = "Sheet-Bold"
            break
        except Exception:  # noqa: BLE001 — шрифт битий, пробуємо наступний
            continue

# --- Палітра ------------------------------------------------------------
# Монохромна палітра — як на офіційному бланку (жодних кольорів).
INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#7a7a7a")
LINE = colors.HexColor("#3a3a3a")
ACCENT = INK                          # без окремого кольору — чорний
PANEL = colors.HexColor("#f2f2f2")    # ледь сірий фон для полів

PAGE_W, PAGE_H = A4
MARGIN = 14 * mm

ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"]
ABILITY_UA = {
    "str": "Сила",
    "dex": "Спритність",
    "con": "Статура",
    "int": "Інтелект",
    "wis": "Мудрість",
    "cha": "Харизма",
}
ABIL_ABBR = {
    "str": "Сил", "dex": "Спр", "con": "Ста",
    "int": "Інт", "wis": "Мдр", "cha": "Хар",
}
# Повний перелік навичок у тому ж порядку, що й у webapp (назва, характеристика)
UA_SKILLS = [
    ("Акробатика", "dex"), ("Поводження з тваринами", "wis"), ("Магія", "int"),
    ("Атлетика", "str"), ("Обман", "cha"), ("Історія", "int"),
    ("Прозорливість", "wis"), ("Залякування", "cha"), ("Дослідження", "int"),
    ("Медицина", "wis"), ("Природа", "int"), ("Сприйняття", "wis"),
    ("Виступ", "cha"), ("Переконання", "cha"), ("Релігія", "int"),
    ("Спритність рук", "dex"), ("Непомітність", "dex"), ("Виживання", "wis"),
]


def _fmt_mod(value: int | None) -> str:
    """+2 / -1 / +0 з явним знаком."""
    if value is None:
        return "—"
    return f"+{value}" if value >= 0 else str(value)


def _feat_nd(f) -> tuple[str, str]:
    """Нормалізує рису до (назва, опис). Приймає рядок або {name, desc}."""
    if isinstance(f, dict):
        return str(f.get("name", "") or ""), str(f.get("desc", "") or "")
    return str(f), ""


def _g(d: dict, *keys, default=None):
    """Безпечний доступ до вкладених ключів."""
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


class _Sheet:
    """Власний український чарник (генерується повністю кодом).
    Заповнює ВСІ поля: 6 характеристик, 6 рятівних кидків, усі 18 навичок,
    бойові показники, HP, спорядження, риси, володіння та сторінку заклять."""

    def __init__(self, c, char: dict):
        self.c = c
        self.char = char

    # ------------------------------------------------------------------ примітиви
    def text(self, x, y, s, size=9, font=FONT, color=INK, center=False, right=False):
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        s = "" if s is None else str(s)
        if center:
            self.c.drawCentredString(x, y, s)
        elif right:
            self.c.drawRightString(x, y, s)
        else:
            self.c.drawString(x, y, s)

    def fit_text(self, x, y, s, max_w, size, font=FONT, color=INK, center=False):
        s = "" if s is None else str(s)
        while size > 6 and pdfmetrics.stringWidth(s, font, size) > max_w:
            size -= 0.5
        self.text(x, y, s, size=size, font=font, color=color, center=center)

    def box(self, x, y, w, h, radius=3, fill=None, stroke=LINE, line_w=0.8):
        if fill is not None:
            self.c.setFillColor(fill)
        self.c.setStrokeColor(stroke)
        self.c.setLineWidth(line_w)
        self.c.roundRect(x, y, w, h, radius, stroke=1, fill=1 if fill is not None else 0)

    def label(self, x, y, s, size=6, center=False):
        self.text(x, y, s.upper(), size=size, font=FONT_BOLD, color=MUTED, center=center)

    def panel(self, x, y, w, h, title):
        """Рамка з заголовком-стрічкою внизу. Повертає верхній y для контенту."""
        self.box(x, y, w, h, fill=None)
        self.text(x + w / 2, y + 4, title.upper(), size=6.5, font=FONT_BOLD,
                  color=ACCENT, center=True)
        return y + h - 4  # де починати контент (згори)

    def prof_dot(self, cx, cy, filled):
        self.c.setLineWidth(0.8)
        self.c.setStrokeColor(INK)
        self.c.setFillColor(INK if filled else colors.white)
        self.c.circle(cx, cy, 2.5, stroke=1, fill=1)

    # ------------------------------------------------------------------ секції
    def draw_header(self):
        top = PAGE_H - MARGIN
        w = PAGE_W - 2 * MARGIN
        self.text(MARGIN, top - 8, "DUNGEONS & DRAGONS", size=13,
                  font=FONT_BOLD, color=INK)
        # Ім'я
        name_w = w * 0.42
        # тонка лінія під титулом (лише над іменем, не чіпає мета-блок)
        self.c.setStrokeColor(INK)
        self.c.setLineWidth(0.8)
        self.c.line(MARGIN, top - 11, MARGIN + name_w, top - 11)
        self.box(MARGIN, top - 42, name_w, 26, fill=None)
        self.fit_text(MARGIN + 6, top - 28, self.char.get("name") or "Без імені",
                      name_w - 12, 13, FONT_BOLD)
        self.label(MARGIN + 6, top - 39, "Ім'я персонажа", size=5)

        # Мета-блок праворуч (2×3)
        meta = [
            ("Клас і рівень", f"{self.char.get('class','')} {self.char.get('level','')}".strip()),
            ("Раса", self.char.get("race", "")),
            ("Передісторія", self.char.get("background", "")),
            ("Світогляд", self.char.get("alignment", "")),
            ("Гравець", self.char.get("player", "")),
            ("Досвід", self.char.get("xp", "")),
        ]
        mx = MARGIN + name_w + 8
        mw = w - name_w - 8
        cellw = mw / 3
        for i, (lab, val) in enumerate(meta):
            r, col = divmod(i, 3)
            cx = mx + col * cellw
            cy = top - 12 - r * 17
            self.box(cx, cy - 4, cellw - 3, 15, fill=None, stroke=LINE, line_w=0.5)
            self.fit_text(cx + 4, cy + 3, val or "—", cellw - 10, 8.5, FONT_BOLD)
            self.label(cx + 4, cy - 2.5, lab, size=5)
        return top - 46

    def draw_abilities(self, x, top, w):
        char = self.char
        ab = char.get("abilities", {}) or {}
        mods = char.get("modifiers", {}) or {}
        bh, gap = 70, 10
        y = top
        for a in ABILITY_ORDER:
            self.box(x, y - bh, w, bh, fill=PANEL)
            self.text(x + w / 2, y - 13, ABILITY_UA[a], size=6.5,
                      font=FONT_BOLD, color=MUTED, center=True)
            self.text(x + w / 2, y - 38, _fmt_mod(mods.get(a)), size=22,
                      font=FONT_BOLD, center=True)
            # кружок зі значенням
            self.c.setStrokeColor(LINE)
            self.c.setFillColor(colors.white)
            self.c.setLineWidth(0.8)
            self.c.circle(x + w / 2, y - bh + 13, 10, stroke=1, fill=1)
            self.text(x + w / 2, y - bh + 10, str(ab.get(a, "—")), size=11,
                      font=FONT_BOLD, center=True)
            y -= bh + gap
        return y

    def draw_saves_skills(self, x, top, w):
        char = self.char
        mods = char.get("modifiers", {}) or {}
        y = top

        # Бонус майстерності + натхнення
        half = (w - 6) / 2
        self.box(x, y - 22, half, 22, fill=PANEL)
        self.text(x + half / 2, y - 10, _fmt_mod(char.get("proficiencyBonus")),
                  size=12, font=FONT_BOLD, center=True)
        self.label(x + half / 2, y - 18, "Майстерність", size=5, center=True)
        self.box(x + half + 6, y - 22, half, 22, fill=None)
        self.label(x + half + 6 + half / 2, y - 18, "Натхнення", size=5, center=True)
        y -= 30

        # Рятівні кидки
        saves = char.get("savingThrows", {}) or {}
        srh = 16
        rows_h = srh * 6 + 20
        self.box(x, y - rows_h, w, rows_h, fill=None)
        self.text(x + w / 2, y - 11, "РЯТІВНІ КИДКИ", size=6.5, font=FONT_BOLD,
                  color=ACCENT, center=True)
        ry = y - 26
        for a in ABILITY_ORDER:
            s = saves.get(a, {}) or {}
            val = s.get("value", mods.get(a))
            self.prof_dot(x + 9, ry + 3, s.get("prof"))
            self.text(x + 18, ry, _fmt_mod(val), size=8.5, font=FONT_BOLD)
            self.text(x + 38, ry, ABILITY_UA[a], size=8.5)
            ry -= srh
        y = y - rows_h - 8

        # Навички (усі 18)
        skills = char.get("skills", {}) or {}
        skh = 15
        srows_h = skh * len(UA_SKILLS) + 20
        self.box(x, y - srows_h, w, srows_h, fill=None)
        self.text(x + w / 2, y - 11, "НАВИЧКИ", size=6.5, font=FONT_BOLD,
                  color=ACCENT, center=True)
        ry = y - 26
        abbr_w = 26
        for i, (name, abil) in enumerate(UA_SKILLS):
            s = skills.get(name, {}) or {}
            prof = s.get("prof", False)
            val = s.get("value", mods.get(abil))
            ab = s.get("ability", abil)
            self.prof_dot(x + 9, ry + 3, prof)
            self.text(x + 18, ry, _fmt_mod(val), size=8.5, font=FONT_BOLD)
            self.fit_text(x + 38, ry, name, w - 38 - abbr_w, 8.5)
            self.text(x + w - 6, ry, f"({ABIL_ABBR.get(ab, '')})", size=6.5,
                      color=MUTED, right=True)
            ry -= skh
        y = y - srows_h - 8

        # Пасивна уважність
        self.box(x, y - 20, w, 20, fill=PANEL)
        self.text(x + 16, y - 13, str(char.get("passivePerception", "—")),
                  size=11, font=FONT_BOLD, center=True)
        self.label(x + 30, y - 13, "Пасивна уважність")
        return y - 20

    def draw_combat(self, x, top, w):
        char = self.char
        y = top
        third = (w - 12) / 3
        stats = [
            ("КЛАС БРОНІ", char.get("ac")),
            ("ІНІЦІАТИВА", _fmt_mod(char.get("initiative"))),
            ("ШВИДКІСТЬ", char.get("speed")),
        ]
        for i, (lab, val) in enumerate(stats):
            bx = x + i * (third + 6)
            self.box(bx, y - 30, third, 30, fill=PANEL)
            self.text(bx + third / 2, y - 17, str(val if val is not None else "—"),
                      size=14, font=FONT_BOLD, center=True)
            self.text(bx + third / 2, y - 26, lab, size=5.5, font=FONT_BOLD,
                      color=MUTED, center=True)
        y -= 38

        # HP
        self.box(x, y - 46, w, 46, fill=None)
        self.label(x + 6, y - 10, "Хіти", size=5.5)
        self.text(x + w - 6, y - 11, f"макс. {char.get('maxHp','—')}", size=8,
                  font=FONT_BOLD, right=True)
        self.text(x + w / 2, y - 30, str(char.get("maxHp", "—")), size=20,
                  font=FONT_BOLD, center=True)
        self.text(x + w / 2, y - 41, "ПОТОЧНІ ХІТИ", size=5.5, font=FONT_BOLD,
                  color=MUTED, center=True)
        y -= 54

        # Кості здоров'я + рятівні від смерті
        half = (w - 6) / 2
        bh = 36
        # кості здоров'я
        self.box(x, y - bh, half, bh, fill=None)
        self.text(x + half / 2, y - 17, str(char.get("hitDice", "—")), size=13,
                  font=FONT_BOLD, center=True)
        self.text(x + half / 2, y - bh + 5, "КОСТІ ЗДОРОВ'Я", size=5,
                  font=FONT_BOLD, color=MUTED, center=True)
        # рятівні від смерті
        dx = x + half + 6
        self.box(dx, y - bh, half, bh, fill=None)
        self.text(dx + half / 2, y - bh + 5, "РЯТ. ВІД СМЕРТІ", size=5,
                  font=FONT_BOLD, color=MUTED, center=True)
        cx0 = dx + half - 8 - 2 * 7  # три кружечки, вирівняні праворуч
        for row, lab in ((y - 11, "Успіхи"), (y - 21, "Провали")):
            self.text(dx + 5, row - 2, lab, size=6, color=INK)
            self.c.setStrokeColor(LINE)
            self.c.setFillColor(colors.white)
            self.c.setLineWidth(0.8)
            for i in range(3):
                self.c.circle(cx0 + i * 7, row, 2.3, stroke=1, fill=1)
        return y - (bh + 8)

    def _panel_frame(self, x, top, w, h, title):
        """Рамка + чорний підпис знизу по центру (як на офіційному бланку)."""
        self.box(x, top - h, w, h, fill=None)
        self.text(x + w / 2, top - h + 5, title.upper(), size=6.5, font=FONT_BOLD,
                  color=INK, center=True)
        return top - 11, top - h + 15

    def draw_panel_list(self, x, top, w, h, title, items):
        y, limit = self._panel_frame(x, top, w, h, title)
        for it in (items or []):
            for chunk in _wrap(f"• {it}", w - 12, 8):
                if y < limit:
                    return top - h
                self.text(x + 6, y, chunk, size=8)
                y -= 11
        return top - h

    def draw_panel_text(self, x, top, w, h, title, text):
        y, limit = self._panel_frame(x, top, w, h, title)
        for para in (text or "").split("\n"):
            for chunk in _wrap(para, w - 12, 8):
                if y < limit:
                    return top - h
                self.text(x + 6, y, chunk, size=8)
                y -= 11
        return top - h

    def draw_features_panel(self, x, top, w, h, features):
        """Риси: назва (жирним) + опис (дрібним, приглушеним) під нею."""
        y, limit = self._panel_frame(x, top, w, h, title="Риси та здібності")
        for f in (features or []):
            nm, ds = _feat_nd(f)
            if y < limit:
                break
            # маркер + назва
            self.c.setFillColor(ACCENT)
            self.c.circle(x + 8, y + 2.5, 1.6, stroke=0, fill=1)
            self.fit_text(x + 14, y, nm, w - 20, 8.5, font=FONT_BOLD)
            y -= 11
            for chunk in _wrap(ds, w - 20, 7):
                if y < limit:
                    break
                self.text(x + 14, y, chunk, size=7, color=MUTED)
                y -= 9
            y -= 2
        return top - h

    def draw_attacks_panel(self, x, top, w, h):
        """Таблиця атак у стилі офіційного бланка: колонки НАЗВА / БОНУС / ШКОДА,
        кілька рядків із роздільниками, далі вільні лінії для заклять."""
        y, limit = self._panel_frame(x, top, w, h, title="Атаки та закляття")
        name_w = w * 0.50
        bonus_w = w * 0.18
        sep1 = x + name_w
        sep2 = x + name_w + bonus_w
        # заголовки колонок
        self.text(x + name_w / 2, y - 2, "НАЗВА", size=5, font=FONT_BOLD,
                  color=MUTED, center=True)
        self.text(sep1 + bonus_w / 2, y - 2, "БОНУС", size=5, font=FONT_BOLD,
                  color=MUTED, center=True)
        self.text(sep2 + (x + w - sep2) / 2, y - 2, "ШКОДА / ТИП", size=5,
                  font=FONT_BOLD, color=MUTED, center=True)
        ytab = y - 8
        rows = 5
        row_h = 13
        # горизонтальні лінії + вертикальні роздільники таблиці
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.4)
        for r in range(rows + 1):
            yy = ytab - r * row_h
            self.c.line(x + 4, yy, x + w - 4, yy)
        tbl_bottom = ytab - rows * row_h
        for sx in (sep1, sep2):
            self.c.line(sx, ytab, sx, tbl_bottom)
        # далі — вільні лінії для нотаток про закляття
        yy = tbl_bottom - row_h
        while yy > limit:
            self.c.line(x + 4, yy, x + w - 4, yy)
            yy -= row_h
        return top - h

    def draw_money(self, x, top, w):
        coins = ["ММ", "СМ", "ЕМ", "ЗМ", "ПМ"]  # мідь/срібло/електрум/золото/платина
        cw = (w - (len(coins) - 1) * 4) / len(coins)
        for i, cn in enumerate(coins):
            bx = x + i * (cw + 4)
            self.box(bx, top - 22, cw, 22, fill=PANEL)
            self.label(bx + cw / 2, top - 8, cn, size=5.5, center=True)
        return top - 22

    # ------------------------------------------------------------------ сторінка заклять
    def draw_spell_page(self):
        sc = self.char.get("spellcasting")
        if not sc:
            return
        c = self.c
        c.showPage()
        top = PAGE_H - MARGIN
        w = PAGE_W - 2 * MARGIN
        self.text(MARGIN, top - 8, "Закляття", size=15, font=FONT_BOLD, color=ACCENT)

        info = [
            ("Базова характеристика", ABILITY_UA.get(sc.get("ability"), sc.get("ability", "—"))),
            ("Складність порятунку (DC)", sc.get("saveDC", "—")),
            ("Бонус на влучання закляттям", _fmt_mod(sc.get("attackBonus"))),
        ]
        cw = w / 3
        y = top - 24
        for i, (lab, val) in enumerate(info):
            bx = MARGIN + i * cw
            self.box(bx, y - 30, cw - 6, 30, fill=PANEL)
            self.text(bx + (cw - 6) / 2, y - 16, str(val), size=14,
                      font=FONT_BOLD, center=True)
            self.text(bx + (cw - 6) / 2, y - 26, lab.upper(), size=5,
                      font=FONT_BOLD, color=MUTED, center=True)
        y -= 46

        # Порожні секції за рівнями (закляття не обираємо — лишаємо для запису від руки)
        char_level = self.char.get("level", 1) or 1
        max_lvl = max(1, min(9, (char_level + 1) // 2))
        colw = (w - 16) / 2
        cols = [MARGIN, MARGIN + colw + 16]
        col_i = 0
        ys = [y, y]
        for lvl in range(0, max_lvl + 1):
            ci = col_i % 2
            cy = ys[ci]
            title = "Замовляння (cantrips)" if lvl == 0 else f"Рівень {lvl}"
            self.text(cols[ci], cy, title, size=9, font=FONT_BOLD, color=ACCENT)
            cy -= 6
            lines = 6 if lvl == 0 else 5
            for _ in range(lines):
                c.setStrokeColor(LINE)
                c.setLineWidth(0.5)
                c.line(cols[ci] + 4, cy - 4, cols[ci] + colw, cy - 4)
                cy -= 13
            cy -= 6
            ys[ci] = cy
            col_i += 1

    # ------------------------------------------------------------------ збірка
    def render(self):
        top = self.draw_header() - 8
        gutter = 8
        ab_w = 52
        rest = (PAGE_W - 2 * MARGIN) - ab_w - 3 * gutter
        colw = rest / 3
        x1 = MARGIN
        x2 = x1 + ab_w + gutter
        x3 = x2 + colw + gutter
        x4 = x3 + colw + gutter
        bottom = MARGIN
        g = 8

        # Колонка 1 — характеристики
        self.draw_abilities(x1, top, ab_w)
        # Колонка 2 — майстерність / рятівні / навички / пасивна
        self.draw_saves_skills(x2, top, colw)

        # Колонка 3 — бій, атаки, гроші, спорядження (тягнемо до низу)
        y3 = self.draw_combat(x3, top, colw)
        avail = (y3 - g) - bottom
        atk_h = (avail - 22 - 2 * g) * 0.5
        eq_h = avail - 22 - 2 * g - atk_h
        ya = self.draw_attacks_panel(x3, y3 - g, colw, atk_h)
        ym = self.draw_money(x3, ya - g, colw)
        self.draw_panel_list(x3, ym - g, colw, eq_h, "Спорядження",
                             self.char.get("equipment"))

        # Колонка 4 — риси, володіння, нотатки (тягнемо до низу)
        availD = top - bottom
        feat_h = availD * 0.50
        prof_h = availD * 0.24
        notes_h = availD - feat_h - prof_h - 2 * g
        y4 = self.draw_features_panel(x4, top, colw, feat_h,
                                      self.char.get("features"))
        y4 = self.draw_panel_list(x4, y4 - g, colw, prof_h, "Володіння та мови",
                                  self.char.get("proficiencies_list"))
        self.draw_panel_text(x4, y4 - g, colw, notes_h, "Особистість / нотатки",
                             self.char.get("notes", ""))

        self.draw_spell_page()


def _wrap(text: str, max_w: float, size: float) -> list[str]:
    """Простий перенос за шириною в пунктах для поточного шрифту."""
    words = str(text).split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(trial, FONT, size) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def _build_native_pdf(char: dict) -> bytes:
    """Основний рендер: власний український бланк, намальований кодом."""
    buf = io.BytesIO()
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Чарник — {char.get('name','персонаж')}")
    _Sheet(c, char).render()
    c.showPage()
    c.save()
    return buf.getvalue()


# =========================================================================
#  ЗАПОВНЕННЯ ОФІЦІЙНОГО БЛАНКА WotC (5E_CharacterSheet)
#  Текст накладаємо своїм Unicode-шрифтом поверх полів форми (за їх
#  координатами), тож кирилиця гарантовано рендериться в будь-якому
#  переглядачі. Працює і з англійським бланком, і з локалізованим
#  (укр./рос.) похідним — доки збігаються імена полів форми.
# =========================================================================

# Шлях до бланка-шаблону. Типово генеруємо ВЛАСНИЙ український бланк (кодом);
# офіційний англійський автоматично НЕ використовуємо (лишається лише як джерело
# координат для сплющеного локалізованого файлу). Щоб малювати поверх готового
# бланка — поклади його як templates/sheet.pdf або задай DND_SHEET_TEMPLATE.
_TEMPLATE_ENV = os.environ.get("DND_SHEET_TEMPLATE")
_TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
_TEMPLATE_CANDIDATES = [
    _TEMPLATE_ENV,
    os.path.join(_TEMPLATE_DIR, "sheet.pdf"),  # локалізований бланк (підкласти сюди)
]

# Ability → (поле рахунку, поле модифікатора) на бланку
_ABIL_FIELDS = {
    "str": ("STR", "STRmod"),
    "dex": ("DEX", "DEXmod "),
    "con": ("CON", "CONmod"),
    "int": ("INT", "INTmod"),
    "wis": ("WIS", "WISmod"),
    "cha": ("CHA", "CHamod"),
}
_SAVE_FIELDS = {
    "str": "ST Strength", "dex": "ST Dexterity", "con": "ST Constitution",
    "int": "ST Intelligence", "wis": "ST Wisdom", "cha": "ST Charisma",
}
# Українська назва навички (як у webapp) → поле бланка
_SKILL_FIELDS = {
    "Акробатика": "Acrobatics", "Поводження з тваринами": "Animal",
    "Магія": "Arcana", "Атлетика": "Athletics", "Обман": "Deception ",
    "Історія": "History ", "Прозорливість": "Insight", "Залякування": "Intimidation",
    "Дослідження": "Investigation ", "Медицина": "Medicine", "Природа": "Nature",
    "Сприйняття": "Perception ", "Виступ": "Performance", "Переконання": "Persuasion",
    "Релігія": "Religion", "Спритність рук": "SleightofHand",
    "Непомітність": "Stealth ", "Виживання": "Survival",
}


def _find_template() -> str | None:
    for p in _TEMPLATE_CANDIDATES:
        if p and os.path.exists(p):
            return p
    return None


def _reference_template() -> str | None:
    """Бланк із полями форми — джерело координат, коли фоновий шаблон
    «сплющений» (перекладені бланки часто без AcroForm)."""
    for p in [os.path.join(_TEMPLATE_DIR, "5E_CharacterSheet_Fillable.pdf"),
              os.path.join(_TEMPLATE_DIR, "DnD_5E_CharacterSheet_FormFillable.pdf")]:
        if os.path.exists(p):
            return p
    return None


def _collect_widgets(reader):
    """{ім'я поля: [(page_idx, x0, y0, x1, y1, is_btn)]}."""
    out: dict = {}
    for pi, page in enumerate(reader.pages):
        for a in page.get("/Annots", []) or []:
            o = a.get_object()
            if o.get("/Subtype") != "/Widget":
                continue
            name = o.get("/T")
            parent = o.get("/Parent")
            while name is None and parent is not None:
                po = parent.get_object()
                name = po.get("/T")
                parent = po.get("/Parent")
            if name is None:
                continue
            ft = o.get("/FT") or (o.get("/Parent").get_object().get("/FT") if o.get("/Parent") else None)
            rc = [float(v) for v in o["/Rect"]]
            x0, y0, x1, y1 = min(rc[0], rc[2]), min(rc[1], rc[3]), max(rc[0], rc[2]), max(rc[1], rc[3])
            out.setdefault(str(name), []).append((pi, x0, y0, x1, y1, ft == "/Btn"))
    return out


def _prof_checkbox_map(widgets):
    """Для кожного поля-значення рятівного/навички знаходимо чекбокс майстерності
    (той самий рядок, зліва) — суто за геометрією, тож стійко до заміни шаблону."""
    btns = [(n, w) for n, ws in widgets.items() for w in ws if w[5]]
    mapping = {}
    targets = list(_SAVE_FIELDS.values()) + list(_SKILL_FIELDS.values())
    for fname in targets:
        ws = widgets.get(fname)
        if not ws:
            continue
        _, fx0, fy0, fx1, fy1, _ = ws[0]
        fcx, fcy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
        best, bd = None, 1e9
        for bn, (_, bx0, by0, bx1, by1, _) in btns:
            bcx, bcy = (bx0 + bx1) / 2, (by0 + by1) / 2
            if bcx < fcx and abs(bcy - fcy) < 6:
                d = abs(bcy - fcy) + (fcx - bcx) * 0.01
                if d < bd:
                    bd, best = d, (bx0, by0, bx1, by1)
        if best:
            mapping[fname] = best
    return mapping


class _Overlay:
    """Малює значення поверх сторінок бланка (одна reportlab-канва на весь документ)."""

    def __init__(self, widgets, page_sizes):
        self.widgets = widgets
        self.page_sizes = page_sizes  # [(w,h), ...]
        self.buf = io.BytesIO()
        from reportlab.pdfgen import canvas
        self.c = canvas.Canvas(self.buf, pagesize=page_sizes[0])
        self._page = 0

    def _goto(self, pi):
        while self._page < pi:
            self.c.showPage()
            self._page += 1
            self.c.setPageSize(self.page_sizes[self._page])

    def field(self, name, value, *, size=10, center=None, multiline=False, color=INK):
        if value is None or value == "":
            return
        ws = self.widgets.get(name)
        if not ws:
            return
        s = str(value)
        for (pi, x0, y0, x1, y1, _btn) in ws:
            self._goto(pi)
            w, h = x1 - x0, y1 - y0
            if multiline:
                self._multiline(x0, y0, x1, y1, s, size, color)
            else:
                do_center = center if center is not None else (w <= 70)
                fs = size
                while fs > 5 and pdfmetrics.stringWidth(s, FONT, fs) > w - 3:
                    fs -= 0.5
                self.c.setFont(FONT, fs)
                self.c.setFillColor(color)
                ty = y0 + (h - fs) / 2 + fs * 0.18
                if do_center:
                    self.c.drawCentredString((x0 + x1) / 2, ty, s)
                else:
                    self.c.drawString(x0 + 2, ty, s)

    def _multiline(self, x0, y0, x1, y1, s, size, color):
        self.c.setFillColor(color)
        max_w = (x1 - x0) - 6
        line = size + 2
        y = y1 - size - 1
        self.c.setFont(FONT, size)
        for para in s.split("\n"):
            for chunk in _wrap(para, max_w, size):
                if y < y0 + 1:
                    return
                self.c.drawString(x0 + 3, y, chunk)
                y -= line

    def check(self, rect, color=INK):
        if not rect:
            return
        x0, y0, x1, y1 = rect
        self._goto(0)  # чекбокси майстерності — на стор. 1
        fs = min(x1 - x0, y1 - y0) * 1.05
        self.c.setFont(FONT_BOLD, fs)
        self.c.setFillColor(color)
        self.c.drawCentredString((x0 + x1) / 2, (y0 + y1) / 2 - fs * 0.34, "X")

    def finish(self):
        self.c.showPage()
        self.c.save()
        self.buf.seek(0)
        return self.buf


def _build_from_template(char: dict, template: str) -> bytes:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(template)          # фон, на якому малюємо
    widgets = _collect_widgets(reader)
    if not widgets:
        # Фоновий бланк «сплющений» (напр., перекладений укр./рос.) — беремо
        # координати полів з еталонного бланка тієї ж верстки WotC.
        ref = _reference_template()
        if ref and os.path.abspath(ref) != os.path.abspath(template):
            widgets = _collect_widgets(PdfReader(ref))
    page_sizes = [(float(p.mediabox.width), float(p.mediabox.height)) for p in reader.pages]
    ov = _Overlay(widgets, page_sizes)

    # --- Сторінка 1: шапка ---
    ov.field("CharacterName", char.get("name"), size=13, center=False)
    ov.field("ClassLevel", f"{char.get('class','')} {char.get('level','')}".strip())
    ov.field("Background", char.get("background"))
    ov.field("PlayerName", char.get("player"))
    ov.field("Race ", char.get("race"))
    ov.field("Alignment", char.get("alignment"))

    # --- Характеристики + модифікатори ---
    ab = char.get("abilities", {}) or {}
    mods = char.get("modifiers", {}) or {}
    for a, (fscore, fmod) in _ABIL_FIELDS.items():
        ov.field(fscore, ab.get(a), size=14, center=True)
        ov.field(fmod, _fmt_mod(mods.get(a)), size=11, center=True)

    ov.field("ProfBonus", _fmt_mod(char.get("proficiencyBonus")), center=True)
    ov.field("AC", char.get("ac"), size=13, center=True)
    ov.field("Initiative", _fmt_mod(char.get("initiative")), size=13, center=True)
    ov.field("Speed", char.get("speed"), size=13, center=True)
    ov.field("HPMax", char.get("maxHp"), center=False)
    ov.field("HPCurrent", char.get("maxHp"), size=15, center=True)
    ov.field("HD", char.get("hitDice"), center=True)
    ov.field("HDTotal", char.get("hitDice"), center=True)
    ov.field("Passive", char.get("passivePerception"), center=True)

    # --- Рятівні кидки ---
    saves = char.get("savingThrows", {}) or {}
    prof_cb = _prof_checkbox_map(widgets)
    for a, fname in _SAVE_FIELDS.items():
        s = saves.get(a, {}) or {}
        ov.field(fname, _fmt_mod(s.get("value")), size=8, center=True)
        if s.get("prof"):
            ov.check(prof_cb.get(fname))

    # --- Навички ---
    skills = char.get("skills", {}) or {}
    for uk, fname in _SKILL_FIELDS.items():
        s = skills.get(uk, {}) or {}
        if not s:
            continue
        ov.field(fname, _fmt_mod(s.get("value")), size=8, center=True)
        if s.get("prof"):
            ov.check(prof_cb.get(fname))

    # --- Списки ---
    ov.field("ProficienciesLang", "\n".join(char.get("proficiencies_list", []) or []),
             size=8, multiline=True)
    ov.field("Equipment", "\n".join(char.get("equipment", []) or []), size=8, multiline=True)
    feat_lines = []
    for f in char.get("features", []) or []:
        nm, ds = _feat_nd(f)
        feat_lines.append(f"{nm} — {ds}" if ds else nm)
    ov.field("Features and Traits", "\n".join(feat_lines), size=9, multiline=True)
    if char.get("notes"):
        ov.field("PersonalityTraits ", char.get("notes"), size=8, multiline=True)

    # --- Сторінка 2 ---
    ov.field("CharacterName 2", char.get("name"), size=13, center=False)
    if char.get("notes"):
        ov.field("Backstory", char.get("notes"), size=9, multiline=True)

    # --- Сторінка 3: закляття ---
    # Список заклять свідомо лишаємо порожнім (закляття не обираємо).
    # Для заклиначів заповнюємо лише шапку: характеристика, DC рятівного кидка
    # проти закляття і бонус на влучання закляттям.
    sc = char.get("spellcasting")
    if sc:
        ov.field("Spellcasting Class 2", char.get("class"), size=12, center=True)
        ov.field("SpellcastingAbility 2", ABILITY_UA.get(sc.get("ability"), sc.get("ability", "")),
                 size=11, center=True)
        ov.field("SpellSaveDC  2", sc.get("saveDC"), size=13, center=True)
        ov.field("SpellAtkBonus 2", _fmt_mod(sc.get("attackBonus")), size=13, center=True)

    # --- Злиття накладки з бланком + «сплющення» (прибираємо поля форми) ---
    overlay_reader = PdfReader(ov.finish())
    writer = PdfWriter()
    for i, page in enumerate(reader.pages):
        if i < len(overlay_reader.pages):
            page.merge_page(overlay_reader.pages[i])
        if "/Annots" in page:
            del page["/Annots"]
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def build_character_pdf(char: dict) -> bytes:
    """Повертає PDF-чарник як bytes. Типово малюємо власний український бланк;
    якщо покладено локалізований шаблон (templates/sheet.pdf чи DND_SHEET_TEMPLATE)
    — заповнюємо його поверх."""
    template = _find_template()
    if template:
        try:
            return _build_from_template(char, template)
        except Exception as e:  # noqa: BLE001 — не валимо бота через проблему з шаблоном
            print(f"[pdf] template fill failed ({e}); fallback to native UA sheet")
    return _build_native_pdf(char)


if __name__ == "__main__":
    # Демо-персонаж для перевірки верстки
    demo = {
        "name": "Тордек Камінь",
        "player": "Vasyl",
        "race": "Дwarf (Гірський)",
        "class": "Воїн",
        "level": 3,
        "background": "Солдат",
        "alignment": "Законно-нейтральний",
        "abilities": {"str": 17, "dex": 13, "con": 16, "int": 10, "wis": 12, "cha": 8},
        "modifiers": {"str": 3, "dex": 1, "con": 3, "int": 0, "wis": 1, "cha": -1},
        "proficiencyBonus": 2,
        "maxHp": 28,
        "ac": 18,
        "initiative": 1,
        "speed": 25,
        "hitDice": "3d10",
        "passivePerception": 11,
        "savingThrows": {
            "str": {"prof": True, "value": 5}, "dex": {"prof": False, "value": 1},
            "con": {"prof": True, "value": 5}, "int": {"prof": False, "value": 0},
            "wis": {"prof": False, "value": 1}, "cha": {"prof": False, "value": -1},
        },
        "skills": {
            "Атлетика": {"prof": True, "value": 5, "ability": "str"},
            "Залякування": {"prof": True, "value": 1, "ability": "cha"},
            "Сприйняття": {"prof": False, "value": 1, "ability": "wis"},
        },
        "features": ["Другий подих", "Сплеск дій", "Бойовий стиль: Оборона",
                     "Темнобачення 60 фт", "Стійкість дворфа"],
        "equipment": ["Кольчуга", "Щит", "Бойова сокира", "Ручний арбалет",
                      "Похідний набір", "Знак полку"],
        "proficiencies_list": ["Уся броня, щити", "Прості й військові зброї",
                               "Спільна, Дворфська"],
        "notes": "Ветеран прикордонної варти. Небагатослівний, вірний побратимам.",
        "spellcasting": None,
    }
    data = build_character_pdf(demo)
    with open("demo_sheet.pdf", "wb") as f:
        f.write(data)
    print(f"OK: demo_sheet.pdf ({len(data)} bytes)")
