/* =========================================================================
   Генерація PDF-чарника D&D 5e у браузері (порт pdf_generator.py → jsPDF).
   Малює власний український бланк повністю кодом. Вхід — той самий об'єкт
   персонажа, що його раніше формував computeCharacter() для sendData.

   Reportlab має початок координат унизу-зліва (y росте вгору), jsPDF — згори
   -зліва (y росте вниз). Клас Sheet тримає reportlab-подібний API, а метод
   Y() перевертає координату, тож логіка малювання лягла майже дослівно.
   ========================================================================= */
(function () {
  "use strict";

  const MM = 72 / 25.4; // 1 мм у пунктах

  // Палітра (як у pdf_generator.py) — [r,g,b]
  const INK = [26, 26, 26];        // #1a1a1a
  const MUTED = [122, 122, 122];   // #7a7a7a
  const LINE = [58, 58, 58];       // #3a3a3a
  const WHITE = [255, 255, 255];
  const PANEL = [242, 242, 242];   // #f2f2f2
  const ACCENT = INK;

  const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];
  const ABILITY_UA = {
    str: "Сила", dex: "Спритність", con: "Статура",
    int: "Інтелект", wis: "Мудрість", cha: "Харизма",
  };
  const ABIL_ABBR = {
    str: "Сил", dex: "Спр", con: "Ста", int: "Інт", wis: "Мдр", cha: "Хар",
  };
  // Усі 18 навичок у тому ж порядку, що й у pdf_generator.py / webapp
  const UA_SKILLS = [
    ["Акробатика", "dex"], ["Поводження з тваринами", "wis"], ["Магія", "int"],
    ["Атлетика", "str"], ["Обман", "cha"], ["Історія", "int"],
    ["Прозорливість", "wis"], ["Залякування", "cha"], ["Дослідження", "int"],
    ["Медицина", "wis"], ["Природа", "int"], ["Сприйняття", "wis"],
    ["Виступ", "cha"], ["Переконання", "cha"], ["Релігія", "int"],
    ["Спритність рук", "dex"], ["Непомітність", "dex"], ["Виживання", "wis"],
  ];

  function fmtMod(v) {
    if (v === null || v === undefined) return "—";
    return v >= 0 ? "+" + v : String(v);
  }
  function featND(f) {
    if (f && typeof f === "object") return [String(f.name || ""), String(f.desc || "")];
    return [String(f), ""];
  }

  class Sheet {
    constructor(doc, char) {
      this.d = doc;
      this.char = char;
      this.PAGE_W = doc.internal.pageSize.getWidth();
      this.PAGE_H = doc.internal.pageSize.getHeight();
      this.MARGIN = 14 * MM;
    }

    // --- перерахунок y (bottom-left → top-left) ---
    Y(y) { return this.PAGE_H - y; }

    // --- примітиви ---------------------------------------------------------
    sw(s, size, bold) {
      // Ширина рядка в пунктах. jsPDF.getTextWidth не працює для вбудованих TTF,
      // тож міряємо через canvas тим самим шрифтом (FontFace "SheetMeasure").
      // px @ розмір N == pt @ розмір N (той самий файл, ті самі advance-и).
      if (!Sheet._ctx) Sheet._ctx = document.createElement("canvas").getContext("2d");
      const ctx = Sheet._ctx;
      ctx.font = (bold ? "700 " : "400 ") + size + 'px "SheetMeasure", sans-serif';
      return ctx.measureText(s == null ? "" : String(s)).width;
    }

    text(x, y, s, opt) {
      opt = opt || {};
      const size = opt.size == null ? 9 : opt.size;
      const bold = !!opt.bold;
      const color = opt.color || INK;
      s = s == null ? "" : String(s);
      const d = this.d;
      // Вирівнювання рахуємо самі (canvas-ширина), а в jsPDF завжди малюємо
      // зліва — бо jsPDF.text() з align сам рахує ширину вбудованого TTF і падає.
      if (opt.center) x -= this.sw(s, size, bold) / 2;
      else if (opt.right) x -= this.sw(s, size, bold);
      d.setFont("Sheet", bold ? "bold" : "normal");
      d.setFontSize(size);
      d.setTextColor(color[0], color[1], color[2]);
      d.text(s, x, this.Y(y), { baseline: "alphabetic" });
    }

    fitText(x, y, s, maxW, size, opt) {
      opt = opt || {};
      s = s == null ? "" : String(s);
      const bold = !!opt.bold;
      while (size > 6 && this.sw(s, size, bold) > maxW) size -= 0.5;
      this.text(x, y, s, Object.assign({}, opt, { size }));
    }

    box(x, y, w, h, opt) {
      opt = opt || {};
      const radius = opt.radius == null ? 3 : opt.radius;
      const fill = opt.fill || null;
      const stroke = opt.stroke || LINE;
      const lineW = opt.lineW == null ? 0.8 : opt.lineW;
      const d = this.d;
      if (fill) d.setFillColor(fill[0], fill[1], fill[2]);
      d.setDrawColor(stroke[0], stroke[1], stroke[2]);
      d.setLineWidth(lineW);
      // reportlab x,y — нижній-лівий кут; jsPDF — верхній-лівий
      d.roundedRect(x, this.Y(y + h), w, h, radius, radius, fill ? "FD" : "S");
    }

    label(x, y, s, size, center) {
      this.text(x, y, String(s).toUpperCase(),
        { size: size == null ? 6 : size, bold: true, color: MUTED, center: !!center });
    }

    line(x1, y1, x2, y2, color, lineW) {
      const d = this.d;
      const c = color || LINE;
      d.setDrawColor(c[0], c[1], c[2]);
      d.setLineWidth(lineW == null ? 0.5 : lineW);
      d.line(x1, this.Y(y1), x2, this.Y(y2));
    }

    circle(cx, cy, r, opt) {
      opt = opt || {};
      const d = this.d;
      const stroke = opt.stroke;
      const fill = opt.fill;
      let style = "";
      if (fill) { d.setFillColor(fill[0], fill[1], fill[2]); style += "F"; }
      if (stroke) { d.setDrawColor(stroke[0], stroke[1], stroke[2]); style += "D"; }
      if (opt.lineW != null) d.setLineWidth(opt.lineW);
      d.circle(cx, this.Y(cy), r, style || "S");
    }

    profDot(cx, cy, filled) {
      this.circle(cx, cy, 2.5, { stroke: INK, fill: filled ? INK : WHITE, lineW: 0.8 });
    }

    // Число-модифікатор у тонкій рамці («чип») — якір, який легко читати.
    numChip(cx, yBaseline, val) {
      const cw = 18, ch = 12;
      this.box(cx - cw / 2, yBaseline - 3, cw, ch, { radius: 2, lineW: 0.7 });
      this.text(cx, yBaseline, val, { size: 8, bold: true, center: true });
    }

    // Маленький залитий ромб (векторний, без залежності від гліфа у шрифті).
    diamond(cx, cy, r, color) {
      const d = this.d;
      const c = color || MUTED;
      const yc = this.Y(cy);
      d.setFillColor(c[0], c[1], c[2]);
      d.triangle(cx - r, yc, cx, yc - r, cx + r, yc, "F");
      d.triangle(cx - r, yc, cx, yc + r, cx + r, yc, "F");
    }

    // Заголовок секції: назва по центру + підкреслення й ромби з боків.
    sectionTitle(x, y, w, title) {
      this.text(x + w / 2, y - 10, String(title).toUpperCase(),
        { size: 6.5, bold: true, color: ACCENT, center: true });
      this.line(x + 6, y - 14, x + w - 6, y - 14, MUTED, 0.5);
      this.diamond(x + 10, y - 8, 1.6, MUTED);
      this.diamond(x + w - 10, y - 8, 1.6, MUTED);
    }

    // Прямокутник зі скошеними верхніми кутами (нижні — прямі).
    // Вхід — reportlab-координати (x,y — нижній-лівий кут), як у box().
    bevelBox(x, y, w, h, opt) {
      opt = opt || {};
      const c = opt.cut == null ? 6 : opt.cut;
      const fill = opt.fill || null;
      const stroke = opt.stroke || LINE;
      const lineW = opt.lineW == null ? 1 : opt.lineW;
      const d = this.d;
      const Ytop = this.Y(y + h); // верхній-лівий кут у координатах jsPDF
      const segs = [
        [w - 2 * c, 0],   // верх
        [c, c],           // скіс правого верхнього кута
        [0, h - c],       // права сторона
        [-w, 0],          // низ
        [0, -(h - c)],    // ліва сторона
        [c, -c],          // скіс лівого верхнього кута (замикання)
      ];
      if (fill) d.setFillColor(fill[0], fill[1], fill[2]);
      d.setDrawColor(stroke[0], stroke[1], stroke[2]);
      d.setLineWidth(lineW);
      d.lines(segs, x + c, Ytop, [1, 1], fill ? "FD" : "S", true);
    }

    // --- секції ------------------------------------------------------------
    drawHeader() {
      const char = this.char, M = this.MARGIN;
      const top = this.PAGE_H - M;
      const w = this.PAGE_W - 2 * M;
      this.text(M, top - 8, "DUNGEONS & DRAGONS", { size: 13, bold: true, color: INK });
      const nameW = w * 0.42;
      this.line(M, top - 11, M + nameW, top - 11, INK, 0.8);
      this.box(M, top - 42, nameW, 26);
      this.fitText(M + 6, top - 28, char.name || "Без імені", nameW - 12, 13, { bold: true });
      this.label(M + 6, top - 39, "Ім'я персонажа", 5);

      const meta = [
        ["Клас і рівень", (String(char.class || "") + " " + String(char.level || "")).trim()],
        ["Раса", char.race || ""],
        ["Передісторія", char.background || ""],
        ["Світогляд", char.alignment || ""],
        ["Гравець", char.player || ""],
        ["Досвід", char.xp || ""],
      ];
      const mx = M + nameW + 8;
      const mw = w - nameW - 8;
      const cellw = mw / 3;
      for (let i = 0; i < meta.length; i++) {
        const lab = meta[i][0], val = meta[i][1];
        const r = Math.floor(i / 3), col = i % 3;
        const cx = mx + col * cellw;
        const cy = top - 12 - r * 17;
        this.box(cx, cy - 4, cellw - 3, 15, { stroke: LINE, lineW: 0.5 });
        this.fitText(cx + 4, cy + 3, val || "—", cellw - 10, 8.5, { bold: true });
        this.label(cx + 4, cy - 2.5, lab, 5);
      }
      return top - 46;
    }

    drawAbilities(x, top, w, bottom) {
      const char = this.char;
      const ab = char.abilities || {};
      const mods = char.modifiers || {};
      const n = ABILITY_ORDER.length;
      const gap = 14;
      const coinR = 9.5;
      // Розтягуємо 6 блоків на висоту колонки; лишаємо coinR знизу під
      // монету-бал останнього блоку, щоб вона не вилазила за поле сторінки.
      const bh = ((top - bottom - coinR) - gap * (n - 1)) / n;
      let y = top;
      for (const a of ABILITY_ORDER) {
        const cy = y - bh; // нижній край коробки
        this.bevelBox(x, cy, w, bh, { fill: WHITE, cut: 7, lineW: 1 });
        // назва + підкреслення
        this.text(x + w / 2, y - 12, ABILITY_UA[a], { size: 7, bold: true, color: MUTED, center: true });
        this.line(x + 6, y - 16, x + w - 6, y - 16, [216, 216, 216], 0.6);
        // великий модифікатор
        this.text(x + w / 2, cy + bh * 0.40, fmtMod(mods[a]), { size: 28, bold: true, center: true });
        // монета-бал, що звисає з нижнього краю (біла заливка ховає лінію рамки)
        this.circle(x + w / 2, cy, coinR, { stroke: LINE, fill: WHITE, lineW: 1 });
        this.text(x + w / 2, cy - 4, String(ab[a] == null ? "—" : ab[a]), { size: 11, bold: true, center: true });
        y -= bh + gap;
      }
      return y + gap;
    }

    drawSavesSkills(x, top, w, bottom) {
      const char = this.char;
      const mods = char.modifiers || {};
      let y = top;

      const half = (w - 6) / 2;
      const topH = 30;
      this.box(x, y - topH, half, topH, { fill: PANEL });
      this.text(x + half / 2, y - 14, fmtMod(char.proficiencyBonus), { size: 17, bold: true, center: true });
      this.label(x + half / 2, y - 25, "Майстерність", 6, true);
      this.box(x + half + 6, y - topH, half, topH);
      this.label(x + half + 6 + half / 2, y - 25, "Натхнення", 6, true);
      y -= topH;

      // Пасивні характеристики — блок із 3 боксів, прикріплений до низу колонки.
      const skills = char.skills || {};
      const pv = (nm) => { const s = skills[nm]; return s && s.value != null ? 10 + s.value : null; };
      const passives = [
        ["Пасивна уважність", char.passivePerception == null ? pv("Сприйняття") : char.passivePerception],
        ["Пасивна прозорливість", pv("Прозорливість")],
        ["Пасивне дослідження", pv("Дослідження")],
      ];
      const passH = 22, passGap = 5;
      const passBlockH = passives.length * passH + (passives.length - 1) * passGap;

      // Рівномірно розтягуємо рядки рятівних кидків і навичок, щоб заповнити
      // всю висоту між верхнім блоком і пасивними боксами внизу.
      const sectGap = 8;
      const nSave = ABILITY_ORDER.length, nSkill = UA_SKILLS.length;
      const titlesH = 20 + 20; // заголовки двох секцій
      const freeForRows = (y - bottom) - passBlockH - 3 * sectGap - titlesH;
      const rowH = freeForRows / (nSave + nSkill);

      // Рятівні кидки
      y -= sectGap;
      const saves = char.savingThrows || {};
      const savesH = rowH * nSave + 20;
      this.box(x, y - savesH, w, savesH);
      this.sectionTitle(x, y, w, "Рятівні кидки");
      let ry = y - 20 - rowH * 0.62;
      for (const a of ABILITY_ORDER) {
        const s = saves[a] || {};
        const val = s.value == null ? mods[a] : s.value;
        this.profDot(x + 8, ry + 3, s.prof);
        this.numChip(x + 26, ry, fmtMod(val));
        this.text(x + 40, ry, ABILITY_UA[a], { size: 8.5, bold: !!s.prof });
        ry -= rowH;
      }
      y = y - savesH - sectGap;

      // Навички (усі 18)
      const skillsH = rowH * nSkill + 20;
      this.box(x, y - skillsH, w, skillsH);
      this.sectionTitle(x, y, w, "Навички");
      ry = y - 20 - rowH * 0.62;
      const abbrW = 26;
      for (let i = 0; i < UA_SKILLS.length; i++) {
        const name = UA_SKILLS[i][0], abil = UA_SKILLS[i][1];
        const s = skills[name] || {};
        const prof = !!s.prof;
        const val = s.value == null ? mods[abil] : s.value;
        const ab = s.ability || abil;
        this.profDot(x + 8, ry + 3, prof);
        this.numChip(x + 26, ry, fmtMod(val));
        this.fitText(x + 40, ry, name, w - 40 - abbrW, 8.5, { bold: prof });
        this.text(x + w - 6, ry, ABIL_ABBR[ab] || "", { size: 6.5, color: MUTED, right: true });
        ry -= rowH;
      }

      // Пасивні бокси внизу
      let py = bottom + passBlockH;
      for (const p of passives) {
        this.box(x, py - passH, w, passH, { fill: PANEL });
        this.text(x + 17, py - passH / 2 - 3, String(p[1] == null ? "—" : p[1]), { size: 11, bold: true, center: true });
        this.fitText(x + 32, py - passH / 2 - 3, String(p[0]).toUpperCase(), w - 38, 6, { bold: true, color: MUTED });
        py -= passH + passGap;
      }
      return bottom;
    }

    drawCombat(x, top, w) {
      const char = this.char;
      let y = top;
      const third = (w - 12) / 3;
      const stats = [
        ["КЛАС БРОНІ", char.ac],
        ["ІНІЦІАТИВА", fmtMod(char.initiative)],
        ["ШВИДКІСТЬ", char.speed],
      ];
      const stH = 38;
      for (let i = 0; i < stats.length; i++) {
        const lab = stats[i][0], val = stats[i][1];
        const bx = x + i * (third + 6);
        this.box(bx, y - stH, third, stH, { fill: PANEL });
        this.text(bx + third / 2, y - 21, String(val == null ? "—" : val), { size: 18, bold: true, center: true });
        this.text(bx + third / 2, y - 33, lab, { size: 6, bold: true, color: MUTED, center: true });
      }
      y -= stH + 8;

      // HP
      this.box(x, y - 46, w, 46);
      this.label(x + 6, y - 10, "Хіти", 5.5);
      this.text(x + w - 6, y - 11, "макс. " + (char.maxHp == null ? "—" : char.maxHp), { size: 8, bold: true, right: true });
      this.text(x + w / 2, y - 30, String(char.maxHp == null ? "—" : char.maxHp), { size: 20, bold: true, center: true });
      this.text(x + w / 2, y - 41, "ПОТОЧНІ ХІТИ", { size: 5.5, bold: true, color: MUTED, center: true });
      y -= 54;

      // Кості здоров'я + рятівні від смерті
      const half = (w - 6) / 2;
      const bh = 36;
      this.box(x, y - bh, half, bh);
      this.text(x + half / 2, y - 17, String(char.hitDice == null ? "—" : char.hitDice), { size: 13, bold: true, center: true });
      this.text(x + half / 2, y - bh + 5, "КОСТІ ЗДОРОВ'Я", { size: 5, bold: true, color: MUTED, center: true });
      const dx = x + half + 6;
      this.box(dx, y - bh, half, bh);
      this.text(dx + half / 2, y - bh + 5, "РЯТ. ВІД СМЕРТІ", { size: 5, bold: true, color: MUTED, center: true });
      const cx0 = dx + half - 8 - 2 * 7;
      const rows = [[y - 11, "Успіхи"], [y - 21, "Провали"]];
      for (const rr of rows) {
        const row = rr[0], lab = rr[1];
        this.text(dx + 5, row - 2, lab, { size: 6, color: INK });
        for (let i = 0; i < 3; i++) {
          this.circle(cx0 + i * 7, row, 2.3, { stroke: LINE, fill: WHITE, lineW: 0.8 });
        }
      }
      return y - (bh + 8);
    }

    panelFrame(x, top, w, h, title) {
      this.box(x, top - h, w, h);
      this.text(x + w / 2, top - h + 5, String(title).toUpperCase(), { size: 6.5, bold: true, color: INK, center: true });
      return [top - 11, top - h + 15]; // [y, limit]
    }

    drawPanelList(x, top, w, h, title, items) {
      const fr = this.panelFrame(x, top, w, h, title);
      let y = fr[0]; const limit = fr[1];
      for (const it of (items || [])) {
        for (const chunk of this.wrap("• " + it, w - 12, 8)) {
          if (y < limit) return top - h;
          this.text(x + 6, y, chunk, { size: 8 });
          y -= 11;
        }
      }
      return top - h;
    }

    drawPanelText(x, top, w, h, title, text) {
      const fr = this.panelFrame(x, top, w, h, title);
      let y = fr[0]; const limit = fr[1];
      for (const para of String(text || "").split("\n")) {
        for (const chunk of this.wrap(para, w - 12, 8)) {
          if (y < limit) return top - h;
          this.text(x + 6, y, chunk, { size: 8 });
          y -= 11;
        }
      }
      return top - h;
    }

    drawFeaturesPanel(x, top, w, h, features) {
      const fr = this.panelFrame(x, top, w, h, "Риси та здібності");
      let y = fr[0]; const limit = fr[1];
      for (const f of (features || [])) {
        const nd = featND(f); const nm = nd[0], ds = nd[1];
        if (y < limit) break;
        this.circle(x + 8, y + 2.5, 1.6, { fill: ACCENT });
        this.fitText(x + 14, y, nm, w - 20, 8.5, { bold: true });
        y -= 11;
        for (const chunk of this.wrap(ds, w - 20, 7)) {
          if (y < limit) break;
          this.text(x + 14, y, chunk, { size: 7, color: MUTED });
          y -= 9;
        }
        y -= 2;
      }
      return top - h;
    }

    drawAttacksPanel(x, top, w, h) {
      const fr = this.panelFrame(x, top, w, h, "Атаки та закляття");
      let y = fr[0]; const limit = fr[1];
      const nameW = w * 0.50;
      const bonusW = w * 0.18;
      const sep1 = x + nameW;
      const sep2 = x + nameW + bonusW;
      this.text(x + nameW / 2, y - 2, "НАЗВА", { size: 5, bold: true, color: MUTED, center: true });
      this.text(sep1 + bonusW / 2, y - 2, "БОНУС", { size: 5, bold: true, color: MUTED, center: true });
      this.text(sep2 + (x + w - sep2) / 2, y - 2, "ШКОДА / ТИП", { size: 5, bold: true, color: MUTED, center: true });
      const ytab = y - 8;
      const rowsN = 5, rowH = 13;
      for (let r = 0; r <= rowsN; r++) {
        const yy = ytab - r * rowH;
        this.line(x + 4, yy, x + w - 4, yy, LINE, 0.4);
      }
      const tblBottom = ytab - rowsN * rowH;
      for (const sx of [sep1, sep2]) this.line(sx, ytab, sx, tblBottom, LINE, 0.4);
      let yy = tblBottom - rowH;
      while (yy > limit) {
        this.line(x + 4, yy, x + w - 4, yy, LINE, 0.4);
        yy -= rowH;
      }
      // заповнюємо рядки обраними атаками
      const atks = (this.char.attacks || []).slice(0, rowsN);
      atks.forEach((a, i) => {
        const ry = ytab - i * rowH - 8.5;
        this.fitText(x + 5, ry, a.name, nameW - 8, 7.5, { bold: true });
        this.text(sep1 + bonusW / 2, ry, fmtMod(a.atk), { size: 8, bold: true, center: true, color: ACCENT });
        this.fitText(sep2 + 4, ry, a.dmg, (x + w - sep2) - 8, 7.5, {});
      });
      return top - h;
    }

    drawMoney(x, top, w) {
      const coins = ["ММ", "СМ", "ЕМ", "ЗМ", "ПМ"];
      const cw = (w - (coins.length - 1) * 4) / coins.length;
      for (let i = 0; i < coins.length; i++) {
        const bx = x + i * (cw + 4);
        this.box(bx, top - 22, cw, 22, { fill: PANEL });
        this.label(bx + cw / 2, top - 8, coins[i], 5.5, true);
      }
      return top - 22;
    }

    drawSpellPage() {
      const sc = this.char.spellcasting;
      if (!sc) return;
      const d = this.d, M = this.MARGIN;
      d.addPage();
      const top = this.PAGE_H - M;
      const w = this.PAGE_W - 2 * M;
      this.text(M, top - 8, "Закляття", { size: 15, bold: true, color: ACCENT });

      const info = [
        ["Базова характеристика", ABILITY_UA[sc.ability] || sc.ability || "—"],
        ["Складність порятунку (DC)", sc.saveDC == null ? "—" : sc.saveDC],
        ["Бонус на влучання закляттям", fmtMod(sc.attackBonus)],
      ];
      const cw = w / 3;
      let y = top - 24;
      for (let i = 0; i < info.length; i++) {
        const lab = info[i][0], val = info[i][1];
        const bx = M + i * cw;
        this.box(bx, y - 30, cw - 6, 30, { fill: PANEL });
        this.text(bx + (cw - 6) / 2, y - 16, String(val), { size: 14, bold: true, center: true });
        this.text(bx + (cw - 6) / 2, y - 26, String(lab).toUpperCase(), { size: 5, bold: true, color: MUTED, center: true });
      }
      y -= 46;

      const charLevel = this.char.level || 1;
      const maxLvl = Math.max(1, Math.min(9, Math.floor((charLevel + 1) / 2)));
      const colw = (w - 16) / 2;
      const cols = [M, M + colw + 16];
      let colI = 0;
      const ys = [y, y];
      for (let lvl = 0; lvl <= maxLvl; lvl++) {
        const ci = colI % 2;
        let cy = ys[ci];
        const title = lvl === 0 ? "Замовляння (cantrips)" : "Рівень " + lvl;
        this.text(cols[ci], cy, title, { size: 9, bold: true, color: ACCENT });
        cy -= 6;
        const lines = lvl === 0 ? 6 : 5;
        for (let k = 0; k < lines; k++) {
          this.line(cols[ci] + 4, cy - 4, cols[ci] + colw, cy - 4, LINE, 0.5);
          cy -= 13;
        }
        cy -= 6;
        ys[ci] = cy;
        colI++;
      }
    }

    wrap(text, maxW, size) {
      const words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
      const lines = [];
      let cur = "";
      for (const wd of words) {
        const trial = (cur + " " + wd).trim();
        if (this.sw(trial, size, false) <= maxW) cur = trial;
        else { if (cur) lines.push(cur); cur = wd; }
      }
      if (cur) lines.push(cur);
      return lines.length ? lines : [""];
    }

    render() {
      const M = this.MARGIN;
      const top = this.drawHeader() - 8;
      const gutter = 8;
      const abW = 52;
      const rest = (this.PAGE_W - 2 * M) - abW - 3 * gutter;
      const colw = rest / 3;
      const x1 = M;
      const x2 = x1 + abW + gutter;
      const x3 = x2 + colw + gutter;
      const x4 = x3 + colw + gutter;
      const bottom = M;
      const g = 8;

      this.drawAbilities(x1, top, abW, bottom);
      this.drawSavesSkills(x2, top, colw, bottom);

      const y3 = this.drawCombat(x3, top, colw);
      const avail = (y3 - g) - bottom;
      const atkH = (avail - 22 - 2 * g) * 0.5;
      const eqH = avail - 22 - 2 * g - atkH;
      const ya = this.drawAttacksPanel(x3, y3 - g, colw, atkH);
      const ym = this.drawMoney(x3, ya - g, colw);
      this.drawPanelList(x3, ym - g, colw, eqH, "Спорядження", this.char.equipment);

      const availD = top - bottom;
      const featH = availD * 0.50;
      const profH = availD * 0.24;
      const notesH = availD - featH - profH - 2 * g;
      let y4 = this.drawFeaturesPanel(x4, top, colw, featH, this.char.features);
      y4 = this.drawPanelList(x4, y4 - g, colw, profH, "Володіння та мови", this.char.proficiencies_list);
      this.drawPanelText(x4, y4 - g, colw, notesH, "Особистість / нотатки", this.char.notes || "");

      this.drawSpellPage();
    }
  }

  // --- Публічний API --------------------------------------------------------
  function slug(s) {
    s = String(s == null ? "" : s).trim().replace(/[^\wА-Яа-яЇїІіЄєҐґ\-]/g, "_");
    s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    return s.slice(0, 40);
  }
  function safeFilename(char) {
    const parts = [slug(char.name), slug(char.race), slug(char.player)].filter(Boolean);
    return (parts.join("_") || "character") + ".pdf";
  }

  /** Будує PDF-чарник. Повертає { doc, blob, filename }. */
  function buildCharacterPdf(char) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF не завантажено");
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    doc.setProperties({ title: "Чарник — " + (char.name || "персонаж") });
    new Sheet(doc, char).render();
    return { doc: doc, blob: doc.output("blob"), filename: safeFilename(char) };
  }

  window.DndPdf = { build: buildCharacterPdf, safeFilename: safeFilename };
})();
