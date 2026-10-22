#!/usr/bin/env python3
"""A4 PDF of the same command list as docs/AskAI-commands-A3.png.

One command per row: the full arguments, then the same one-line purpose.
Run: python scripts/build-commands-pdf.py
"""
import importlib.util
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "AskAI-commands.pdf"
POSTER = Path(__file__).with_name("build-commands-a3.py")

NAVY = (20 / 255, 50 / 255, 79 / 255)
TEAL = (26 / 255, 122 / 255, 114 / 255)
ARG = (36 / 255, 58 / 255, 82 / 255)
SLATE = (52 / 255, 66 / 255, 82 / 255)
PAPER = (243 / 255, 246 / 255, 250 / 255)
WHITE = (1, 1, 1)
HAIR = (218 / 255, 226 / 255, 234 / 255)

SIZE = 12
LH = 16


def load_sections():
    spec = importlib.util.spec_from_file_location("askai_poster", POSTER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SECTIONS


def font(path):
    return pymupdf.Font(fontfile=path)


FONTS = {
    "ui": font(r"C:\Windows\Fonts\segoeui.ttf"),
    "uib": font(r"C:\Windows\Fonts\segoeuib.ttf"),
    "cmd": font(r"C:\Windows\Fonts\consolab.ttf"),
    "arg": font(r"C:\Windows\Fonts\consola.ttf"),
}


def wrap(text, face, size, max_w):
    words = text.split(" ")
    lines, cur = [], ""

    def pieces(word):
        if face.text_length(word, fontsize=size) <= max_w:
            return [word]
        out, buf = [], ""
        for bit in word.replace("|", "|\u0001").split("\u0001"):
            trial = buf + bit
            if buf and face.text_length(trial, fontsize=size) > max_w:
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
            if cur and face.text_length(trial, fontsize=size) > max_w:
                lines.append(cur)
                cur = part
            else:
                cur = trial
    if cur:
        lines.append(cur)
    return lines or [""]


def head_rest(usage):
    parts = usage.split(" ")
    if not parts:
        return usage, ""
    if parts[0] == "askai" and len(parts) > 1 and not parts[1].startswith("-"):
        n = 2
    else:
        n = 0
        for p in parts:
            if p.startswith("-") or p[:1] in "\"'|" or p == ".":
                break
            n += 1
        n = n or 1
    head = " ".join(parts[:n])
    return head, " ".join(parts[n:])


class Doc:
    def __init__(self):
        self.doc = pymupdf.open()
        self.page_w, self.page_h = pymupdf.paper_size("a4")
        self.margin = 42
        self.bottom = self.page_h - 36
        self.width = self.page_w - 2 * self.margin
        self.page = None
        self.y = 0
        self.n = 0
        self.current = None

    def add_poster_page(self):
        png = ROOT / "docs" / "AskAI-commands-A3.png"
        w, h = pymupdf.paper_size("a3")
        page = self.doc.new_page(width=w, height=h)
        page.insert_image(page.rect, filename=str(png))
        self.n += 1

    def new_page(self):
        self.page = self.doc.new_page(width=self.page_w, height=self.page_h)
        self.n += 1
        self.page.draw_rect(self.page.rect, color=None, fill=PAPER)
        for name, face in FONTS.items():
            self.page.insert_font(fontname=name, fontbuffer=face.buffer)
        self.y = 32
        self.page.insert_text((self.margin, self.y), "AskAI commands", fontname="uib", fontsize=11, color=NAVY)
        label = str(self.n)
        lw = FONTS["ui"].text_length(label, fontsize=11)
        self.page.insert_text((self.page_w - self.margin - lw, self.y), label, fontname="ui", fontsize=11, color=SLATE)
        self.y = 48
        self.page.draw_line(
            pymupdf.Point(self.margin, self.y),
            pymupdf.Point(self.page_w - self.margin, self.y),
            color=HAIR, width=0.6,
        )
        self.y = 64

    def need(self, h):
        if self.page is None or self.y + h > self.bottom:
            self.new_page()
            return True
        return False

    def text(self, s, face, size, color, x=None):
        self.page.insert_text((self.margin if x is None else x, self.y), s, fontname=face, fontsize=size, color=color)

    def title(self):
        self.new_page()
        self.page.insert_text((self.margin, self.y + 8), "AskAI command list", fontname="uib", fontsize=22, color=NAVY)
        self.y += 36
        intro = "Same sections as the poster on page 1. Start with /askai-cli, then /askai-plugins."
        self.page.insert_text((self.margin, self.y), intro, fontname="ui", fontsize=11, color=SLATE)
        self.y += 18
        legend = "[ ] optional     < > required     a|b pick one     Full detail: askai help <command>"
        self.page.insert_text((self.margin, self.y), legend, fontname="ui", fontsize=11, color=SLATE)
        self.y += 22

    def section(self, title, first_h):
        self.current = title
        bar = 22
        self.need(bar + first_h + 8)
        rect = pymupdf.Rect(self.margin, self.y, self.page_w - self.margin, self.y + bar)
        fill = (176 / 255, 96 / 255, 16 / 255) if title == "Start here" else (TEAL if self.n % 2 else NAVY)
        self.page.draw_rect(rect, color=None, fill=fill)
        self.page.insert_text((self.margin + 8, self.y + 16), title, fontname="uib", fontsize=12, color=WHITE)
        self.y += bar + 10

    def item(self, usage, desc):
        u_lines = wrap(usage, FONTS["cmd"], SIZE, self.width)
        d_lines = wrap(desc, FONTS["ui"], SIZE, self.width)
        h = 4 + (len(u_lines) + len(d_lines)) * LH + 10
        broke = self.page is None or self.y + h > self.bottom
        self.need(h + (18 if broke and self.current else 0))
        if broke and self.current:
            self.text(self.current + "  ·  continued", "uib", 11, TEAL)
            self.y += 18
        start = usage.startswith("/askai-cli") or usage.startswith("/askai-plugins")
        if start:
            self.page.draw_rect(
                pymupdf.Rect(self.margin, self.y - 12, self.page_w - self.margin, self.y - 12 + h),
                color=None, fill=(1, 244 / 255, 224 / 255))
        head, _rest = head_rest(usage)
        first = True
        for line in u_lines:
            if first and line.startswith(head):
                self.text(head, "cmd", SIZE, TEAL)
                shown = line[len(head):].lstrip()
                if shown:
                    hw = FONTS["cmd"].text_length(head + " ", fontsize=SIZE)
                    self.text(shown, "arg", SIZE, ARG, x=self.margin + hw)
            else:
                self.text(line, "arg", SIZE, ARG)
            first = False
            self.y += LH
        self.y += 2
        for line in d_lines:
            self.text(line, "ui", SIZE, SLATE)
            self.y += LH
        self.y += 4
        self.page.draw_line(
            pymupdf.Point(self.margin, self.y),
            pymupdf.Point(self.page_w - self.margin, self.y),
            color=HAIR, width=0.4,
        )
        self.y += 8

    def finish(self):
        note = "askai usage reads Claude Code and Codex only. Cursor, Claude chat, and ChatGPT show usage in their own settings."
        self.need(28)
        self.y += 6
        for line in wrap(note, FONTS["ui"], 10, self.width):
            self.text(line, "ui", 10, SLATE)
            self.y += 13
        self.doc.save(OUT)
        self.doc.close()


def main():
    import importlib.util
    path = Path(__file__).with_name("build-commands-card.py")
    spec = importlib.util.spec_from_file_location("askai_cards", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()
    return
    sections = load_sections()
    doc = Doc()
    doc.add_poster_page()
    doc.title()
    for title, items in sections:
        usage, desc = items[0]
        u_lines = wrap(usage, FONTS["cmd"], SIZE, doc.width)
        d_lines = wrap(desc, FONTS["ui"], SIZE, doc.width)
        first_h = 4 + (len(u_lines) + len(d_lines)) * LH + 10
        doc.section(title, first_h)
        for usage, desc in items:
            doc.item(usage, desc)
    doc.finish()
    check = pymupdf.open(OUT)
    text = "\n".join(page.get_text() for page in check)
    titles = [title for title, _items in sections]
    for title in titles:
        if title not in text:
            raise SystemExit(f"PDF is missing section {title}")
    for banned in ("Install flags", "Also run these"):
        if banned in text:
            raise SystemExit(f"PDF still has old section {banned}")
    print(f"{doc.n} pages, sections: {'; '.join(titles)} -> {OUT}")


if __name__ == "__main__":
    main()
