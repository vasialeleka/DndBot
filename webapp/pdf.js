/* =========================================================================
   Генерація PDF-чарника D&D 5e у браузері (порт pdf_generator.py → jsPDF).
   Розкладка наближена до офіційного бланку WotC (українською).

   Reportlab має початок координат унизу-зліва (y росте вгору), jsPDF — згори
   -зліва (y росте вниз). Клас Sheet тримає reportlab-подібний API, а метод
   Y() перевертає координату, тож логіка малювання лягла майже дослівно.
   ========================================================================= */
(function () {
  "use strict";

  const MM = 72 / 25.4; // 1 мм у пунктах

  // Палітра — [r,g,b]
  const INK = [26, 26, 26];        // #1a1a1a
  const MUTED = [122, 122, 122];   // #7a7a7a
  const LINE = [58, 58, 58];       // #3a3a3a
  const HAIR = [210, 210, 210];    // тонкі роздільники
  const WHITE = [255, 255, 255];
  const PANEL = [244, 244, 244];   // #f4f4f4
  const ACCENT = INK;

  const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];
  const ABILITY_UA = {
    str: "Сила", dex: "Спритність", con: "Статура",
    int: "Інтелект", wis: "Мудрість", cha: "Харизма",
  };
  const ABIL_ABBR = {
    str: "Сил", dex: "Спр", con: "Ста", int: "Інт", wis: "Мдр", cha: "Хар",
  };
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
      this.MARGIN = 12 * MM;
    }

    Y(y) { return this.PAGE_H - y; }

    // --- примітиви ---------------------------------------------------------
    sw(s, size, bold) {
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
      while (size > 5 && this.sw(s, size, bold) > maxW) size -= 0.5;
      this.text(x, y, s, Object.assign({}, opt, { size }));
    }

    box(x, y, w, h, opt) {
      opt = opt || {};
      const radius = opt.radius == null ? 6 : opt.radius;
      const fill = opt.fill || null;
      const stroke = opt.stroke || LINE;
      const lineW = opt.lineW == null ? 1 : opt.lineW;
      const d = this.d;
      if (fill) d.setFillColor(fill[0], fill[1], fill[2]);
      d.setDrawColor(stroke[0], stroke[1], stroke[2]);
      d.setLineWidth(lineW);
      d.roundedRect(x, this.Y(y + h), w, h, radius, radius, fill ? "FD" : "S");
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
      this.circle(cx, cy, 2.6, { stroke: INK, fill: filled ? INK : WHITE, lineW: 0.8 });
    }

    // Підпис секції по центру внизу коробки (як в офіційному бланку).
    footLabel(x, bottomY, w, title) {
      this.text(x + w / 2, bottomY + 5, String(title).toUpperCase(),
        { size: 6, bold: true, color: MUTED, center: true });
    }

    // --- ШАПКА -------------------------------------------------------------
    drawHeader() {
      const char = this.char, M = this.MARGIN;
      const top = this.PAGE_H - M;
      const w = this.PAGE_W - 2 * M;

      // вордмарк
      const wm = "DUNGEONS & DRAGONS";
      this.text(M + 2, top - 10, wm, { size: 13, bold: true });
      this.line(M + 2, top - 14, M + 2 + this.sw(wm, 13, true), top - 14, MUTED, 0.7);

      const nbTop = top - 20;
      const nbH = 30;
      const nameW = w * 0.40;
      this.box(M, nbTop - nbH, nameW, nbH, { radius: 9 });
      this.fitText(M + 9, nbTop - nbH + 12, char.name || "Без імені", nameW - 18, 15, { bold: true });
      this.text(M + 9, nbTop - nbH + 4, "ІМ'Я ПЕРСОНАЖА", { size: 5.5, bold: true, color: MUTED });

      const fx = M + nameW + 10;
      const fw = w - nameW - 10;
      const fbH = 44;
      this.box(fx, nbTop - fbH, fw, fbH, { radius: 9 });
      const meta = [
        ["Клас і рівень", (String(char.class || "") + " " + String(char.level || "")).trim()],
        ["Передісторія", char.background || ""],
        ["Ім'я гравця", char.player || ""],
        ["Раса", char.race || ""],
        ["Світогляд", char.alignment || ""],
        ["Досвід", char.xp || ""],
      ];
      const cw = fw / 3;
      for (let i = 0; i < 6; i++) {
        const r = Math.floor(i / 3), col = i % 3;
        const cxp = fx + col * cw + 7;
        const cyp = nbTop - 10 - r * 21;
        this.fitText(cxp, cyp, meta[i][1] || "—", cw - 14, 9, { bold: true });
        this.line(cxp, cyp - 3, cxp + cw - 14, cyp - 3, HAIR, 0.4);
        this.text(cxp, cyp - 10, String(meta[i][0]).toUpperCase(), { size: 5.5, bold: true, color: MUTED });
      }
      return nbTop - fbH;
    }

    // --- ХАРАКТЕРИСТИКИ ----------------------------------------------------
    drawAbilities(x, top, w, bottom) {
      const char = this.char, ab = char.abilities || {}, mods = char.modifiers || {};
      const n = 6, gap = 9, coinR = 9;
      const bh = ((top - bottom - coinR) - gap * (n - 1)) / n;
      let y = top;
      for (const a of ABILITY_ORDER) {
        const cy = y - bh;
        this.box(x, cy, w, bh, { radius: 9, fill: PANEL });
        this.text(x + w / 2, y - 11, ABILITY_UA[a], { size: 6.5, bold: true, color: MUTED, center: true });
        this.text(x + w / 2, cy + bh * 0.42, fmtMod(mods[a]), { size: 24, bold: true, center: true });
        this.circle(x + w / 2, cy, coinR, { stroke: LINE, fill: WHITE, lineW: 1 });
        this.text(x + w / 2, cy - 4, String(ab[a] == null ? "—" : ab[a]), { size: 11, bold: true, center: true });
        y -= bh + gap;
      }
    }

    // --- НАТХНЕННЯ / МАЙСТЕРНІСТЬ / РЯТІВНІ / НАВИЧКИ ----------------------
    drawSavesSkillsCol(x, top, w, bottom) {
      const char = this.char, mods = char.modifiers || {};
      let y = top;
      const gap = 6;

      // Натхнення
      const inspH = 24;
      this.box(x, y - inspH, w, inspH, { radius: 8 });
      this.circle(x + 13, y - inspH / 2, 5, { stroke: LINE, fill: WHITE, lineW: 0.9 });
      this.text(x + 24 + (w - 24) / 2 - 6, y - inspH / 2 - 2, "НАТХНЕННЯ", { size: 7, bold: true, color: MUTED, center: true });
      y -= inspH + gap;

      // Бонус майстерності
      const profH = 24;
      this.box(x, y - profH, w, profH, { radius: 8, fill: PANEL });
      this.text(x + 16, y - profH / 2 - 2, fmtMod(char.proficiencyBonus), { size: 15, bold: true, center: true });
      this.text(x + 30 + (w - 30) / 2, y - profH / 2 - 2, "БОНУС МАЙСТЕРНОСТІ", { size: 6, bold: true, color: MUTED, center: true });
      y -= profH + gap;

      // Рятівні + навички заповнюють решту
      const nSave = 6, nSkill = 18, labelH = 14;
      const avail = (y - bottom) - gap;
      const rowH = (avail - 2 * labelH) / (nSave + nSkill);

      // Рятівні кидки
      const saves = char.savingThrows || {};
      const savesH = nSave * rowH + labelH;
      this.box(x, y - savesH, w, savesH, { radius: 8 });
      let ry = y - 12;
      for (const a of ABILITY_ORDER) {
        const s = saves[a] || {};
        const val = s.value == null ? mods[a] : s.value;
        this.profDot(x + 10, ry + 3, s.prof);
        this.text(x + 19, ry, fmtMod(val), { size: 8.5, bold: true });
        this.fitText(x + 35, ry, ABILITY_UA[a], w - 40, 8.5, { bold: !!s.prof });
        ry -= rowH;
      }
      this.footLabel(x, y - savesH, w, "Рятівні кидки");
      y -= savesH + gap;

      // Навички
      const skills = char.skills || {};
      const skillsH = nSkill * rowH + labelH;
      this.box(x, y - skillsH, w, skillsH, { radius: 8 });
      ry = y - 12;
      const abbrW = 20;
      for (let i = 0; i < UA_SKILLS.length; i++) {
        const name = UA_SKILLS[i][0], abil = UA_SKILLS[i][1];
        const s = skills[name] || {};
        const prof = !!s.prof;
        const val = s.value == null ? mods[abil] : s.value;
        const ab = s.ability || abil;
        this.profDot(x + 10, ry + 3, prof);
        this.text(x + 19, ry, fmtMod(val), { size: 8, bold: true });
        this.fitText(x + 35, ry, name, w - 35 - abbrW, 8, { bold: prof });
        this.text(x + w - 6, ry, ABIL_ABBR[ab] || "", { size: 6, color: MUTED, right: true });
        ry -= rowH;
      }
      this.footLabel(x, y - skillsH, w, "Навички");
    }

    // Пасивні характеристики (широкий блок) + інші володіння
    drawLeftBottom(x, w, bottom, passiveH, otherH) {
      const char = this.char, skills = char.skills || {};
      const pv = (nm) => { const s = skills[nm]; return s && s.value != null ? 10 + s.value : null; };
      // Пасивні — 3 значення в один ряд
      let py = bottom + otherH + 7 + passiveH;
      this.box(x, py - passiveH, w, passiveH, { radius: 8, fill: PANEL });
      const pass = [
        ["Уважність", char.passivePerception == null ? pv("Сприйняття") : char.passivePerception],
        ["Прозорл.", pv("Прозорливість")],
        ["Дослідж.", pv("Дослідження")],
      ];
      const pcw = w / 3;
      for (let i = 0; i < 3; i++) {
        const bx = x + i * pcw;
        if (i > 0) this.line(bx, py - 5, bx, py - passiveH + 5, HAIR, 0.4);
        this.text(bx + 11, py - passiveH / 2 - 3, String(pass[i][1] == null ? "—" : pass[i][1]), { size: 11, bold: true, center: true });
        this.text(bx + 20, py - passiveH / 2 - 3, pass[i][0].toUpperCase(), { size: 5.5, bold: true, color: MUTED });
      }
      // Інші володіння та мови
      this.box(x, bottom, w, otherH, { radius: 8 });
      let ty = bottom + otherH - 8;
      const limit = bottom + 12;
      for (const it of (char.proficiencies_list || [])) {
        for (const chunk of this.wrap("• " + it, w - 12, 8)) {
          if (ty < limit) break;
          this.text(x + 6, ty, chunk, { size: 8 });
          ty -= 11;
        }
      }
      this.footLabel(x, bottom, w, "Інші володіння та мови");
    }

    // --- ЦЕНТР: БІЙ / АТАКИ / СПОРЯДЖЕННЯ ---------------------------------
    drawShield(x, top, w, h, val, label) {
      const d = this.d;
      const pad = 1.5;
      const L = x + pad, R = x + w - pad, cxc = x + w / 2;
      const T = this.Y(top);
      const botY = this.Y(top - h + 1);
      const H = botY - T;
      d.setDrawColor(LINE[0], LINE[1], LINE[2]);
      d.setLineWidth(1.4);
      // heater-щит: рівний верх, боки плавно звужуються до вістря
      d.lines([
        [R - L, 0],                                                   // верхній край
        [0, H * 0.42, -(R - cxc) * 0.35, H * 0.86, -(R - cxc), H],    // права крива → вістря
        [-(cxc - L) * 0.65, -H * 0.14, -(cxc - L), -H * 0.58, -(cxc - L), -H], // ліва крива → верх
      ], L, T, [1, 1], "S", true);
      this.text(cxc, top - 10, String(label).toUpperCase(), { size: 5.5, bold: true, color: MUTED, center: true });
      this.text(cxc, top - h * 0.56, String(val == null ? "—" : val), { size: 20, bold: true, center: true });
    }

    miniStat(x, top, w, h, val, label) {
      this.box(x, top - h, w, h, { radius: 8 });
      this.text(x + w / 2, top - 10, String(label).toUpperCase(), { size: 5.5, bold: true, color: MUTED, center: true });
      this.text(x + w / 2, top - h * 0.66, String(val == null ? "—" : val), { size: 20, bold: true, center: true });
    }

    drawCenterRegion(x, top, w, bottom) {
      const char = this.char;
      let y = top;
      const gap = 7;

      // Трійка: щит КБ / Ініціатива / Швидкість
      const t3 = (w - 2 * gap) / 3, trioH = 52;
      this.drawShield(x, y, t3, trioH, char.ac, "Клас броні");
      this.miniStat(x + t3 + gap, y, t3, trioH, fmtMod(char.initiative), "Ініціатива");
      this.miniStat(x + 2 * (t3 + gap), y, t3, trioH, char.speed, "Швидкість");
      y -= trioH + gap;

      // Поточні хіти
      const hpH = 50;
      this.box(x, y - hpH, w, hpH, { radius: 8 });
      this.text(x + w / 2, y - 11, "Максимум хітів: " + (char.maxHp == null ? "—" : char.maxHp), { size: 6.5, color: MUTED, center: true });
      this.line(x + 8, y - 15, x + w - 8, y - 15, HAIR, 0.4);
      this.text(x + w / 2, y - 38, String(char.maxHp == null ? "—" : char.maxHp), { size: 26, bold: true, center: true });
      this.footLabel(x, y - hpH, w, "Поточні хіти");
      y -= hpH + gap;

      // Тимчасові хіти
      const tH = 26;
      this.box(x, y - tH, w, tH, { radius: 8 });
      this.footLabel(x, y - tH, w, "Тимчасові хіти");
      y -= tH + gap;

      // Кості здоров'я + рятівні від смерті
      const bH = 40, hdW = (w - gap) * 0.4, dsW = (w - gap) - hdW;
      this.box(x, y - bH, hdW, bH, { radius: 8 });
      this.text(x + hdW / 2, y - 20, String(char.hitDice == null ? "—" : char.hitDice), { size: 15, bold: true, center: true });
      this.footLabel(x, y - bH, hdW, "Кості здоров'я");
      const dx = x + hdW + gap;
      this.box(dx, y - bH, dsW, bH, { radius: 8 });
      this.text(dx + 8, y - 14, "Успіхи", { size: 6.5, color: INK });
      for (let i = 0; i < 3; i++) this.circle(dx + 48 + i * 8, y - 12.5, 2.6, { stroke: LINE, fill: WHITE, lineW: 0.8 });
      this.text(dx + 8, y - 25, "Провали", { size: 6.5, color: INK });
      for (let i = 0; i < 3; i++) this.circle(dx + 48 + i * 8, y - 23.5, 2.6, { stroke: LINE, fill: WHITE, lineW: 0.8 });
      this.footLabel(dx, y - bH, dsW, "Рятівні від смерті");
      y -= bH + gap;

      // Спорядження (з монетами) — прикріплене до низу, більше місця
      const eqH = 150;
      this.drawEquipment(x, bottom + eqH, w, eqH);

      // Атаки — заповнюють проміжок між боєм і спорядженням
      const atkTop = y;
      const atkH = atkTop - (bottom + eqH + gap);
      this.drawAttacks(x, atkTop, w, atkH);
    }

    drawAttacks(x, top, w, h) {
      this.box(x, top - h, w, h, { radius: 8 });
      const y = top - 10;
      const nameW = w * 0.52, bonusW = w * 0.16;
      const sep1 = x + nameW, sep2 = x + nameW + bonusW;
      this.text(x + nameW / 2, y - 2, "НАЗВА", { size: 5, bold: true, color: MUTED, center: true });
      this.text(sep1 + bonusW / 2, y - 2, "БОНУС", { size: 5, bold: true, color: MUTED, center: true });
      this.text(sep2 + (x + w - sep2) / 2, y - 2, "ШКОДА / ТИП", { size: 5, bold: true, color: MUTED, center: true });
      const ytab = y - 8;
      const rowH = 13;
      const tblBottom = top - h + 14;
      let yy = ytab;
      while (yy > tblBottom) { this.line(x + 4, yy, x + w - 4, yy, HAIR, 0.4); yy -= rowH; }
      for (const sx of [sep1, sep2]) this.line(sx, ytab, sx, tblBottom, HAIR, 0.4);
      const rowsN = Math.floor((ytab - tblBottom) / rowH);
      const atks = (this.char.attacks || []).slice(0, rowsN);
      atks.forEach((a, i) => {
        const ry = ytab - i * rowH - 8.5;
        this.fitText(x + 6, ry, a.name, nameW - 10, 7.5, { bold: true });
        this.text(sep1 + bonusW / 2, ry, fmtMod(a.atk), { size: 8, bold: true, center: true });
        this.fitText(sep2 + 4, ry, a.dmg, (x + w - sep2) - 8, 7.5, {});
      });
      this.footLabel(x, top - h, w, "Атаки та закляття");
    }

    drawEquipment(x, top, w, h) {
      this.box(x, top - h, w, h, { radius: 8 });
      // Монети — вертикально зліва
      const coins = ["ЗМ", "СМ", "ММ", "ЕМ", "ПМ"];
      const cbW = 34, cbH = 13, cgap = 3;
      let cy = top - 8;
      for (let i = 0; i < coins.length; i++) {
        this.box(x + 6, cy - cbH, cbW, cbH, { radius: 3, lineW: 0.6, stroke: HAIR });
        this.text(x + 6 + cbW + 4, cy - cbH / 2 - 2.5, coins[i], { size: 6.5, bold: true, color: MUTED });
        cy -= cbH + cgap;
      }
      // Список спорядження — справа
      const lx = x + 6 + cbW + 22;
      let ly = top - 12;
      const limit = top - h + 12;
      for (const it of (this.char.equipment || [])) {
        for (const chunk of this.wrap("• " + it, x + w - lx - 6, 8)) {
          if (ly < limit) break;
          this.text(lx, ly, chunk, { size: 8 });
          ly -= 11;
        }
      }
      this.footLabel(x, top - h, w, "Спорядження");
    }

    // --- ПРАВОРУЧ: ОСОБИСТІСТЬ + РИСИ -------------------------------------
    drawRightRegion(x, top, w, bottom) {
      const gap = 7;
      const boxes = [["Риси характеру", 66], ["Ідеали", 52], ["Узи", 52], ["Вади", 52]];
      let y = top;
      for (const b of boxes) {
        this.box(x, y - b[1], w, b[1], { radius: 8 });
        this.footLabel(x, y - b[1], w, b[0]);
        y -= b[1] + gap;
      }
      this.drawFeatures(x, y, w, y - bottom);
    }

    drawFeatures(x, top, w, h) {
      this.box(x, top - h, w, h, { radius: 8 });
      let y = top - 9;
      const limit = top - h + 12;
      for (const f of (this.char.features || [])) {
        const nd = featND(f); const nm = nd[0], ds = nd[1];
        if (y < limit) break;
        this.circle(x + 8, y + 2.5, 1.5, { fill: ACCENT });
        this.fitText(x + 13, y, nm, w - 18, 8, { bold: true });
        y -= 10;
        for (const chunk of this.wrap(ds, w - 16, 6.5)) {
          if (y < limit) break;
          this.text(x + 13, y, chunk, { size: 6.5, color: MUTED });
          y -= 8;
        }
        y -= 3;
      }
      this.footLabel(x, top - h, w, "Риси та здібності");
    }

    // --- Закляття (2-га сторінка) -----------------------------------------
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
        const bx = M + i * cw;
        this.box(bx, y - 30, cw - 6, 30, { fill: PANEL });
        this.text(bx + (cw - 6) / 2, y - 16, String(info[i][1]), { size: 14, bold: true, center: true });
        this.text(bx + (cw - 6) / 2, y - 26, String(info[i][0]).toUpperCase(), { size: 5, bold: true, color: MUTED, center: true });
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

    // --- Розкладка ---------------------------------------------------------
    render() {
      const M = this.MARGIN;
      const bottom = M;
      const top = this.drawHeader() - 8;
      const w = this.PAGE_W - 2 * M;
      const gap = 8;
      const LW = (w - 2 * gap) * 0.40;
      const CW = (w - 2 * gap) * 0.33;
      const RW = (w - 2 * gap) - LW - CW;
      const lx = M, cx = lx + LW + gap, rx = cx + CW + gap;

      // Ліва зона: характеристики + рятівні/навички зверху, пасивні + володіння знизу
      const passiveH = 26, otherH = 112;
      const leftBottomH = passiveH + 7 + otherH;
      const colBottom = bottom + leftBottomH + 8;
      const aw = 54;
      this.drawAbilities(lx, top, aw, colBottom);
      this.drawSavesSkillsCol(lx + aw + 6, top, LW - aw - 6, colBottom);
      this.drawLeftBottom(lx, LW, bottom, passiveH, otherH);

      // Центр і право
      this.drawCenterRegion(cx, top, CW, bottom);
      this.drawRightRegion(rx, top, RW, bottom);

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
