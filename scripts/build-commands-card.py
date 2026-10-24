#!/usr/bin/env python3
"""Redraw the formatted command reference in its card layout.

The poster is one A3 portrait page. The PDF is A3 landscape, two columns,
the same cards. Both open with Start here: /askai-cli, then /askai-plugins.
"""
import importlib.util
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
POSTER = Path(__file__).with_name("build-commands-a3.py")
PNG_OUT = ROOT / "docs" / "AskAI-commands-A3.png"
PDF_OUT = ROOT / "docs" / "AskAI-commands.pdf"

NAVY = (20, 45, 69)
TEAL = (18, 126, 118)
PAPER = (244, 247, 250)
WHITE = (255, 255, 255)
MINT = (233, 245, 243)
DESC = (35, 59, 79)
AMBER = (176, 96, 16)
CREAM = (255, 244, 224)
WARM = (255, 236, 210)
CMD_AMBER = (140, 72, 8)
MUTED = (210, 227, 234)
FOOT = (81, 100, 117)

NOTES = [
    "askai savings reads Claude Code and Codex only. Cursor, Claude chat, and ChatGPT show usage in their own settings.",
    "~/.claude/askai is AskAI's folder on every install, including Cursor-only.",
]
LEGEND = "[ ] optional     < > required     a|b pick one     Full detail: askai help <command>"


def load_sections():
    spec = importlib.util.spec_from_file_location("askai_poster", POSTER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SECTIONS


def wrap(text, length, max_w):
    words = text.split(" ")
    lines, cur = [], ""

    def pieces(word):
        if length(word) <= max_w:
            return [word]
        out, buf = [], ""
        for bit in word.replace("|", "|\u0001").split("\u0001"):
            trial = buf + bit
            if buf and length(trial) > max_w:
                out.append(buf)
                buf = bit
            else:
                buf = trial
        if buf:
            out.append(buf)
        return out or [word]

    for word in words:
        for part in pieces(word):
            trial = part if not cur else cur + " " + part
            if cur and length(trial) > max_w:
                lines.append(cur)
                cur = part
            else:
                cur = trial
    if cur:
        lines.append(cur)
    return lines or [""]


def highlight(usage):
    return usage.startswith("/askai-cli") or usage.startswith("/askai-plugins")


def card_height(n_cmd, n_desc, base, extra_cmd, extra_desc):
    h = base
    if n_cmd > 1:
        h += extra_cmd * (n_cmd - 1)
    if n_desc > 1:
        h += extra_desc * (n_desc - 1)
    return h


def layout(sections, measure, geom):
    """Flow section bars and cards down two columns, then onto the next page."""
    col_w = geom["col_w"]
    text_w = col_w - geom["pad"] * 2
    pages = []
    columns = [[], []]
    col = 0
    y = geom["top"]
    bottom = geom["bottom"]

    def new_page():
        nonlocal columns, col, y
        pages.append(columns)
        columns = [[], []]
        col = 0
        y = geom["top"]

    def advance():
        nonlocal col, y
        col += 1
        y = geom["top"]
        if col > 1:
            new_page()

    def ensure(h):
        if y + h > bottom:
            advance()

    for title, items in sections:
        first = True
        pending = list(items)
        while pending or first:
            label = title if first else title + "  ·  continued"
            bar = geom["section_h"]
            if pending:
                usage, desc = pending[0]
                cmd_lines = wrap(usage, measure["cmd"], text_w)
                desc_lines = wrap(desc, measure["desc"], text_w)
                ch = card_height(
                    len(cmd_lines), len(desc_lines),
                    geom["card_h"], geom["extra_cmd"], geom["extra_desc"],
                )
                need = bar + geom["after_bar"] + ch
            else:
                need = bar
            ensure(need)
            columns[col].append(("section", label, title == "Start here"))
            y += bar + geom["after_bar"]
            first = False
            while pending:
                usage, desc = pending[0]
                cmd_lines = wrap(usage, measure["cmd"], text_w)
                desc_lines = wrap(desc, measure["desc"], text_w)
                ch = card_height(
                    len(cmd_lines), len(desc_lines),
                    geom["card_h"], geom["extra_cmd"], geom["extra_desc"],
                )
                if y + ch > bottom:
                    break
                columns[col].append((
                    "card", usage, desc, cmd_lines, desc_lines, highlight(usage), ch,
                ))
                y += ch + geom["gap"]
                pending.pop(0)
            if pending:
                advance()

    note_h = geom["note_h"]
    ensure(note_h)
    columns[col].append(("notes", NOTES))
    pages.append(columns)
    return pages


def pdf_measure():
    cmd = pymupdf.Font(fontfile=r"C:\Windows\Fonts\consola.ttf")
    desc = pymupdf.Font(fontfile=r"C:\Windows\Fonts\segoeui.ttf")
    return {
        "cmd": lambda t, f=cmd: f.text_length(t, fontsize=11.3),
        "desc": lambda t, f=desc: f.text_length(t, fontsize=11.1),
    }


PDF_GEOM = {
    "page": (1190.55, 841.89),
    "cols": (42.0, 606.3),
    "col_w": 542.3,
    "top": 112.0,
    "bottom": 786.0,
    "section_h": 27.0,
    "after_bar": 4.0,
    "card_h": 49.3,
    "extra_cmd": 15.0,
    "extra_desc": 14.3,
    "gap": 5.0,
    "pad": 15.0,
    "note_h": 78.0,
    "header_h": 91.0,
}


def render_pdf(sections):
    pages = layout(sections, pdf_measure(), PDF_GEOM)
    doc = pymupdf.open()
    pw, ph = PDF_GEOM["page"]
    fonts = {
        "ui": r"C:\Windows\Fonts\segoeui.ttf",
        "uib": r"C:\Windows\Fonts\segoeuib.ttf",
        "cmd": r"C:\Windows\Fonts\consola.ttf",
    }

    def rgb(c):
        return tuple(v / 255 for v in c)

    for pi, columns in enumerate(pages):
        page = doc.new_page(width=pw, height=ph)
        for name, path in fonts.items():
            page.insert_font(fontname=name, fontfile=path)
        page.draw_rect(page.rect, color=None, fill=rgb(PAPER), width=0)
        page.draw_rect(pymupdf.Rect(0, 0, pw, PDF_GEOM["header_h"]), color=None, fill=rgb(NAVY), width=0)

        def line(x, top, text, fontname, fontsize, color):
            page.insert_text((x, top + fontsize * 0.82), text, fontname=fontname, fontsize=fontsize, color=color)

        page._line = line
        line(42, 26, "AskAI command reference", "uib", 27, rgb(WHITE))
        line(42, 62, LEGEND, "ui", 10.5, rgb(MUTED))
        line(42, 804, "ASKAI  /  QUICK REFERENCE", "ui", 9.5, rgb(FOOT))
        label = f"{pi + 1:02d}"
        lw = pymupdf.Font(fontfile=fonts["ui"]).text_length(label, fontsize=9.5)
        page._line(pw - 42 - lw, 804, label, "ui", 9.5, rgb(FOOT))

        for ci, ops in enumerate(columns):
            x = PDF_GEOM["cols"][ci]
            y = PDF_GEOM["top"]
            w = PDF_GEOM["col_w"]
            for op in ops:
                if op[0] == "section":
                    _, label, hot = op
                    fill = AMBER if hot else TEAL
                    page.draw_rect(pymupdf.Rect(x, y, x + w, y + 27), color=None, fill=rgb(fill), width=0)
                    page._line(x + 12, y + 6, label, "uib", 13, rgb(WHITE))
                    y += 27 + 4
                elif op[0] == "card":
                    _, usage, _desc, cmd_lines, desc_lines, hot, ch = op
                    page.draw_rect(
                        pymupdf.Rect(x, y, x + w, y + ch),
                        color=None, fill=rgb(CREAM if hot else WHITE), width=0,
                    )
                    page.draw_rect(
                        pymupdf.Rect(x, y, x + 3, y + ch),
                        color=None, fill=rgb(AMBER if hot else TEAL), width=0,
                    )
                    band_h = 25 + 15 * (len(cmd_lines) - 1)
                    page.draw_rect(
                        pymupdf.Rect(x + 3, y + 2, x + w - 3, y + 2 + band_h),
                        color=None, fill=rgb(WARM if hot else MINT), width=0,
                    )
                    cmd_color = CMD_AMBER if hot else TEAL
                    ty = y + 6
                    for cmd_line in cmd_lines:
                        page._line(x + 15, ty, cmd_line, "cmd", 11.3, rgb(cmd_color))
                        ty += 15
                    dy = y + 4 + band_h
                    for desc_line in desc_lines:
                        page._line(x + 15, dy, desc_line, "ui", 11.1, rgb(DESC))
                        dy += 14.3
                    y += ch + 5
                else:
                    _, lines = op
                    page._line(x + 12, y + 4, "Reference notes", "uib", 10.5, rgb(NAVY))
                    ny = y + 20
                    for note in lines:
                        page._line(x + 12, ny, note, "ui", 9.5, rgb(FOOT))
                        ny += 14

    doc.save(PDF_OUT)
    doc.close()
    check = pymupdf.open(PDF_OUT)
    text = "\n".join(p.get_text() for p in check).replace("\ufd3e", "(").replace("\ufd3f", ")")
    for title, _items in sections:
        if title not in text:
            raise SystemExit(f"PDF is missing section {title}")
    for banned in ("Install flags", "Also run these"):
        if banned in text:
            raise SystemExit(f"PDF still has old section {banned}")
    norm = "".join(
        " " if ch.isspace() else ("-" if ch in "-\u2010\u2011\u2013\u2014" else ch)
        for ch in text
    )
    head = norm.split(sections[1][0], 1)[0]
    cli_at = head.find("/askai-cli")
    plug_at = head.find("/askai-plugins")
    if cli_at < 0 or plug_at < 0 or cli_at > plug_at:
        raise SystemExit("/askai-cli and /askai-plugins must lead the setup, in that order")
    if norm.count("/askai-cli") != 1 or norm.count("/askai-plugins") != 1:
        raise SystemExit("each slash command should appear once")
    print(f"{check.page_count} pages -> {PDF_OUT}")


def png_layout(sections, scale):
    """scale multiplies the PDF point sizes onto the portrait point grid."""
    cmd = pymupdf.Font(fontfile=r"C:\Windows\Fonts\consola.ttf")
    desc = pymupdf.Font(fontfile=r"C:\Windows\Fonts\segoeui.ttf")
    size_cmd = 11.3 * scale
    size_desc = 11.1 * scale
    # Portrait A3, two columns, same outer margin as the formatted poster.
    pw, ph = 841.89, 1190.55
    margin = 20.4
    gutter = 15.0
    col_w = (pw - 2 * margin - gutter) / 2
    geom = {
        "page": (pw, ph),
        "cols": (margin, margin + col_w + gutter),
        "col_w": col_w,
        "top": 53 * scale + 16 * scale,
        "bottom": ph - 42 * scale,
        "section_h": 27 * scale,
        "after_bar": 4 * scale,
        "card_h": 49.3 * scale,
        "extra_cmd": 15 * scale,
        "extra_desc": 14.3 * scale,
        "gap": 5 * scale,
        "pad": 12 * scale,
        "note_h": 78 * scale,
        "header_h": 53 * scale,
        "scale": scale,
    }
    measure = {
        "cmd": lambda t, f=cmd, s=size_cmd: f.text_length(t, fontsize=s),
        "desc": lambda t, f=desc, s=size_desc: f.text_length(t, fontsize=s),
    }
    pages = layout(sections, measure, geom)
    return pages, geom


def render_png(sections):
    chosen = None
    for step in range(100, 45, -1):
        scale = step / 100
        pages, geom = png_layout(sections, scale)
        if len(pages) == 1:
            chosen = (pages, geom, scale)
            break
    if not chosen:
        raise SystemExit("poster content does not fit one A3 portrait page")
    pages, geom, scale = chosen
    # Match the formatted file's pixel size (A3 portrait, about 600 dpi).
    W, H = 7016, 9933
    pw, ph = geom["page"]

    def px(x, y=None):
        if y is None:
            return x / pw * W
        return x / pw * W, y / ph * H

    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    sy = H / ph

    def font(path, pt):
        return ImageFont.truetype(path, max(8, int(round(pt * sy))))

    ui = font(r"C:\Windows\Fonts\segoeui.ttf", 10.5 * scale)
    uib_title = font(r"C:\Windows\Fonts\segoeuib.ttf", 22 * scale)
    uib_sec = font(r"C:\Windows\Fonts\segoeuib.ttf", 13 * scale)
    cmd_f = font(r"C:\Windows\Fonts\consola.ttf", 11.3 * scale)
    desc_f = font(r"C:\Windows\Fonts\segoeui.ttf", 11.1 * scale)
    note_f = font(r"C:\Windows\Fonts\segoeui.ttf", 9.5 * scale)
    foot_f = font(r"C:\Windows\Fonts\segoeui.ttf", 9.5 * scale)

    header_h = px(geom["header_h"])
    d.rectangle((0, 0, W, header_h), fill=NAVY)
    d.text(px(geom["cols"][0], 14 * scale), "AskAI command reference", font=uib_title, fill=WHITE)
    d.text(px(geom["cols"][0], 36 * scale), LEGEND, font=ui, fill=MUTED)
    d.rectangle((0, H - px(28 * scale), W, H), fill=NAVY)
    d.text(px(geom["cols"][0], ph - 24 * scale), "ASKAI  /  QUICK REFERENCE", font=foot_f, fill=WHITE)

    for ci, ops in enumerate(pages[0]):
        x = geom["cols"][ci]
        y = geom["top"]
        w = geom["col_w"]
        for op in ops:
            if op[0] == "section":
                _, label, hot = op
                x0, y0 = px(x, y)
                x1, y1 = px(x + w, y + geom["section_h"])
                d.rectangle((x0, y0, x1, y1), fill=AMBER if hot else TEAL)
                d.text(px(x + 10 * scale, y + 5 * scale), label, font=uib_sec, fill=WHITE)
                y += geom["section_h"] + geom["after_bar"]
            elif op[0] == "card":
                _, _usage, _desc, cmd_lines, desc_lines, hot, ch = op
                x0, y0 = px(x, y)
                x1, y1 = px(x + w, y + ch)
                d.rectangle((x0, y0, x1, y1), fill=CREAM if hot else WHITE)
                d.rectangle((x0, y0, px(x + 3 * scale), y1), fill=AMBER if hot else TEAL)
                band_h = (25 + 15 * (len(cmd_lines) - 1)) * scale
                d.rectangle(
                    (px(x + 3 * scale), px(y + 2 * scale), px(x + w - 3 * scale), px(y + 2 * scale + band_h)),
                    fill=WARM if hot else MINT,
                )
                ty = y + 7 * scale
                for line in cmd_lines:
                    d.text(px(x + 12 * scale, ty), line, font=cmd_f, fill=CMD_AMBER if hot else TEAL)
                    ty += 15 * scale
                dy = y + 6 * scale + band_h
                for line in desc_lines:
                    d.text(px(x + 12 * scale, dy), line, font=desc_f, fill=DESC)
                    dy += 14.3 * scale
                y += ch + geom["gap"]
            else:
                _, lines = op
                d.text(px(x + 10 * scale, y + 2 * scale), "Reference notes", font=uib_sec, fill=NAVY)
                ny = y + 18 * scale
                for line in lines:
                    wrapped = wrap(line, lambda t, f=note_f: d.textlength(t, font=f), px(w - 24 * scale))
                    for bit in wrapped:
                        d.text(px(x + 10 * scale, ny), bit, font=note_f, fill=FOOT)
                        ny += 13 * scale
    img.save(PNG_OUT, dpi=(600, 600), optimize=True)
    print(f"scale={scale:.2f} -> {PNG_OUT}")


def main():
    sections = load_sections()
    render_png(sections)
    render_pdf(sections)


if __name__ == "__main__":
    main()
