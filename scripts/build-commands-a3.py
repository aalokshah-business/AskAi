#!/usr/bin/env python3
"""A3 landscape poster: every AskAI command, its arguments, and what it is for.

Usage strings match lib/help.js. Run: python scripts/build-commands-a3.py
"""
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\aalok\Desktop\Projects\repo\AskAi\docs\AskAI-commands-A3.png"
W, H = 4961, 3508
DPI = 300

NAVY = (20, 50, 79)
TEAL = (26, 122, 114)
ARG = (36, 58, 82)
SLATE = (52, 66, 82)
PAPER = (243, 246, 250)
WHITE = (255, 255, 255)
HAIR = (218, 226, 234)
RULE = (196, 208, 218)

SECTIONS = [
    ("Start here", [
        ("/askai-cli Codex: $askai-cli",
         "1. Start here. Looks at this folder, prepares it, and opens the terminal."),
        ("/askai-plugins Codex: $askai-plugins",
         "2. Then this. Looks at this folder and finishes the plugin setup still left."),
    ]),
    ("Set up the machine", [
        ("askai install [--dry-run] [--yes]",
         "Install the token-saving setup. Skip what is already healthy. Flags below are this command."),
        ("askai install --profile minimal|code|docs|full|experimental",
         "Tool set. Default is lean. code was coding. experimental was max."),
        ("askai install --target auto|claude|codex|agy|cursor|all",
         "Apps to wire. auto is Claude Code plus every app found."),
        ("askai install --dry-run | --yes",
         "Show the plan and change nothing, or skip the confirmation."),
        ("askai install --only ID,ID | --skip ID,ID | --project DIR",
         "Limit components, leave some out, or attach one repository."),
        ("askai install --lsp ts,py,kotlin,ruby,swift",
         "Claude Code language servers. They do not run inside Cursor."),
        ("askai install --main-model M | --subagent-model M",
         "Models when unset. Default main model is claude-haiku-5-5."),
        ("askai install --add ID",
         "Add one tool. graphify, rtk, and context-mode stay off the default set."),
        ("graphify update .",
         "One time per repo: build the code graph. askai install --add graphify. No tokens."),
        ("graphify query \"question\"",
         "Uses the graph from that install. Ask how two parts of the code connect."),
        ("serena project create --language LANG --index",
         "One time per repo: build the symbol index. Profiles code, full, and experimental."),
        ("askai update | askai upgrade [--dry-run] [--agents]",
         "Fetch the latest AskAI from GitHub and re-apply the recorded profile."),
        ("askai tools update [--target T]",
         "Upgrade the tools AskAI installed. This does not update AskAI itself."),
        ("askai uninstall [--only ID,ID] [--dry-run]",
         "Remove only what AskAI added. Backups are kept."),
        ("askai restore [file]",
         "List backups, or put one backed-up file back."),
        ("askai profiles | askai profiles migrate",
         "What each profile installs. migrate renames a recorded max to experimental."),
        ("askai suggest [dir]",
         "Recommend a profile from the files in a folder."),
        ("askai shell init powershell|bash|zsh | install SHELL --path PROFILE | uninstall",
         "Remember the selected project in PowerShell, bash, or zsh."),
        ("askai version [--all]",
         "Print the version. --all adds OS, shell, Node, git, and container."),
    ]),
    ("See what is set up", [
        ("askai setup [dir] [--yes] [--dry-run]",
         "Hosts, check counts, and the file check. --yes installs. A pipe continues."),
        ("askai status",
         "Per-tool state against your profile, and any reported savings."),
        ("askai doctor",
         "Same rows as askai check."),
        ("askai check [dir] [--fix] [--json] [--env] [--brief]",
         "Audit this machine and a repo. --env prints the platform block only."),
        ("askai why <finding-id>",
         "The message and the fix for one finding. An unknown id is one line."),
        ("askai next [dir]",
         "At most 3 to do now and 2 for later."),
        ("askai infra [dir] [--json]",
         "What is set up. working means called. configured means not yet."),
        ("askai audit [dir] [--json]",
         "Memory, tools, model, hooks, subagents, scheduled work, cache."),
        ("askai report [days]",
         "askai usage --full, plus one line from askai check --brief."),
        ("askai savings",
         "Same as askai usage --plugins. One line per installed plugin."),
        ("askai todo [dir] [--all] | done <id> | undo <id>",
         "Steps only you can do. done marks one after you did it."),
        ("askai plugins [list | ready [dir] | info <id> | install <id> | decisions]",
         "What a tool does, if it is installed, and how to turn it off."),
    ]),
    ("Project pack", [
        ("askai cli [--prepare] [--launch] [--path DIR] [--about TEXT]",
         "From a chat: prepare the project, then open the terminal."),
        ("tmux attach -t askai",
         "Resume the session. tmux is installed by askai install, update, or setup on headless Linux. Or run askai cli here."),
        ("askai init [dir] [--name NAME] [--path DIR] [--about TEXT] [--type T] [--yes] [--refresh] [--offline] [--dry-run] [--build CMD] [--test CMD]",
         "Scan the repo, write the project pack, and register the path."),
        ("askai review [status|done] [--project NAME] [--json] [--all]",
         "What changed since the review, or record that it is done."),
        ("askai map [dir] [--dry-run]",
         "Rebuild the project map. Keep purposes you edited."),
        ("askai scaffold [dir] [--dry-run]",
         "Write the starter files every agent reads. Never overwrites."),
        ("askai project [dir] [--print|--remove] | list | show | rename | refresh | hide-local [--undo]",
         "Register a project, refresh its pack, or hide local paths. --undo removes that block."),
        ("askai set project NAME | project --clear | default NAME | default --clear",
         "Select the project for this terminal, or set the fallback."),
        ("askai docs [install|architecture|projects|guide|cheatsheet|changelog|preview|check] [--print]",
         "Open one AskAI document, or check generated docs for drift."),
        ("askai graph [dir]",
         "Print the architecture diagram and open it in a browser."),
        ("askai diff [dir]",
         "Diff summary and the whitespace check before a handoff."),
    ]),
    ("Do the work", [
        ("askai go <claude|codex|cursor|agy|task> [--tier lead|build|chore] [\"task\"] [--dry-run]",
         "Start that app. No host uses Claude. Opus only after two failed Sonnet runs."),
        ("askai route \"task\"",
         "Print the tier and model. Does not launch an agent."),
        ("askai prompt \"ask\" [--tier T] [--kind bug|feature|design|risky] [--files a,b] [--done TEXT] [--mode blunt,brutal,assume,counter,contrast] [--copy]",
         "Turn a rough ask into goal, files, done-when, and a tier."),
        ("askai prompt --output-safe \"cmd\" | --resume",
         "Plan a noisy command first, or print the resume prompt."),
        ("askai models [set <tool>.<tier> <model>[:<effort>] | verify [tool]]",
         "Show or set lead, build, and chore. verify lists plan IDs."),
        ("askai mcp [list | on <name> | off <name>] [--tool claude|codex|cursor|agy] [--dry-run]",
         "List MCP servers, or turn one off between sessions."),
        ("askai start --tool T --task TEXT [--repo DIR]",
         "Ledger entry: tool, task, branch, and last commit."),
        ("askai session init|pause|status|finish|measure|report [--repo DIR]",
         "The other ledger actions. pause records a boundary without the break checklist."),
        ("askai break [--summary TEXT] [--next TEXT] [--repo DIR] [--dry-run]",
         "Before a break: checklist, handoff reminder, and the time."),
        ("askai snapshot [dir] [--include-untracked]",
         "Write a git diff. Does not commit or stash."),
        ("askai run -- <command> | askai run --save NAME -- <command>",
         "Keep the log. A successful run offers --save. flash, reboot, and copy_dut need --yes."),
        ("askai stop [--yes]",
         "List running agent CLIs. --yes stops them. Never this process, tmux, sshd, or Cursor."),
        ("askai resume [--copy] [--repo DIR]",
         "Time away, continue or start fresh, and the resume prompt."),
        ("askai clear [compact] [--tool claude|codex|cursor|agy] [--repo DIR]",
         "Whether /clear or /compact is safe, and the command to type."),
        ("askai context <percent> | --used N --window M",
         "What to do at this context level. 60% is a warning."),
    ]),
    ("Look up, measure, other apps", [
        ("askai chat [claude|chatgpt|gemini|code]",
         "Where to paste the short instruction: Claude, ChatGPT, Gemini."),
        ("askai ask <words>",
         "Offline answer: the rule, why, and the command. No model call."),
        ("askai guide [moment|all]",
         "No topic prints the current moment. all prints every moment."),
        ("askai tips [claude|codex|agy|cursor|session|habits|peak]",
         "The short cheat sheet for one app. peak is Claude's peak hours now."),
        ("askai help [command|all]",
         "Command names, one command in detail, or every command."),
        ("askai usage [days] [--cache] [--plugins] [--full] [--import-cursor FILE.csv]",
         "Claude Code and Codex spend. --import-cursor reads tokens, not dollars."),
        ("askai convert <file|url> | askai convert scan [dir] [--yes] [--ignore-originals]",
         "PDF, Office, a web page, or a YouTube URL to Markdown. scan lists them."),
        ("askai test [--out FILE] [--json]",
         "Run each safe command and write one capture. Skips install, update, and agents."),
        ("askai statusline",
         "Claude Code's one line: model, context, and cache."),
    ]),
]


def font_set(size):
    return {
        "title": ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 78),
        "sub": ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 32),
        "sec": ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", size + 2),
        "cmd": ImageFont.truetype(r"C:\Windows\Fonts\consolab.ttf", size),
        "arg": ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", size),
        "desc": ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", size),
    }


def wrap(draw, text, fnt, max_w):
    words = text.split(" ")
    lines, cur = [], ""

    def pieces(word):
        if draw.textlength(word, font=fnt) <= max_w:
            return [word]
        out, buf = [], ""
        for bit in word.replace("|", "|\u0001").split("\u0001"):
            trial = buf + bit
            if buf and draw.textlength(trial, font=fnt) > max_w:
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
            if cur and draw.textlength(trial, font=fnt) > max_w:
                lines.append(cur)
                cur = part
            else:
                cur = trial
    if cur:
        lines.append(cur)
    return lines or [""]


def head_rest(usage):
    """Command name, then its arguments. A leading word stops at a flag, a quote, or a pipe."""
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


def measure(size, page_w=W, page_h=H, split_ratio=0.58):
    fonts = font_set(size)
    margin, gutter = 56, 40
    header_h, footer_h = 196, 64
    col_w = (page_w - 2 * margin - gutter) // 2
    split = int(col_w * split_ratio)
    gap = 20
    usage_w = split - 28
    desc_w = col_w - split - gap - 16
    lh = size + 8
    col_h = page_h - header_h - footer_h - 8
    probe = ImageDraw.Draw(Image.new("RGB", (4, 4)))
    bar_h = size + 18
    rows = []
    for title, items in SECTIONS:
        block = []
        for usage, desc in items:
            u = wrap(probe, usage, fonts["cmd"], usage_w)
            d = wrap(probe, desc, fonts["desc"], desc_w)
            ih = 12 + max(len(u), len(d)) * lh + 8
            block.append((usage, desc, ih, u, d))
        rows.append((title, bar_h, block))
    # Pack, splitting a section across columns when needed.
    columns = [[], []]
    used = [0, 0]
    col = 0
    for title, bar_h, block in rows:
        pending = list(block)
        first = True
        while pending:
            if col > 1:
                return None
            room = col_h - used[col]
            need_bar = bar_h + 8
            if room < need_bar + pending[0][2]:
                col += 1
                if col > 1:
                    return None
                continue
            take = []
            spent = need_bar
            for item in pending:
                if spent + item[2] > room and take:
                    break
                if spent + item[2] > room and not take:
                    return None
                take.append(item)
                spent += item[2]
            label = title if first else title + "  ·  continued"
            columns[col].append((label, bar_h, take, spent))
            used[col] += spent + 14
            pending = pending[len(take):]
            first = False
            if pending:
                col += 1
    return dict(fonts=fonts, size=size, margin=margin, gutter=gutter, header_h=header_h,
                footer_h=footer_h, col_w=col_w, split=split, gap=gap, lh=lh,
                columns=columns, used=used, page=(page_w, page_h))


def pick():
    best = None
    for page in ((W, H), (H, W)):
        for ratio in (0.50, 0.56, 0.62, 0.68, 0.74):
            for size in range(52, 27, -1):
                got = measure(size, page[0], page[1], ratio)
                if got:
                    if best is None or size > best["size"]:
                        best = got
                        best["ratio"] = ratio
                    break
    if not best:
        raise SystemExit("content does not fit A3")
    return best


def main():
    import importlib.util
    path = __import__("pathlib").Path(__file__).with_name("build-commands-card.py")
    spec = importlib.util.spec_from_file_location("askai_cards", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()
    return
    spec = pick()
    f = spec["fonts"]
    size = spec["size"]
    page_w, page_h = spec["page"]
    img = Image.new("RGB", (page_w, page_h), PAPER)
    d = ImageDraw.Draw(img)
    hh = spec["header_h"]
    d.rectangle((0, 0, page_w, hh - 14), fill=NAVY)
    d.text((spec["margin"], 26), "AskAI command reference", font=f["title"], fill=WHITE)
    orient = "portrait" if page_h > page_w else "landscape"
    d.text((spec["margin"], 118),
           f"A3 {orient}, print at 100%.      [ ] optional      < > required      a|b pick one      One command in full:  askai help <command>",
           font=f["sub"], fill=(214, 226, 234))
    d.text((spec["margin"], 156),
           "Start with /askai-cli, then /askai-plugins.    Left: what you type.    Right: what it is for.",
           font=f["sub"], fill=(170, 198, 206))

    for ci, col in enumerate(spec["columns"]):
        x = spec["margin"] + ci * (spec["col_w"] + spec["gutter"])
        y = hh
        for si, (title, bar_h, items, _spent) in enumerate(col):
            color = (176, 96, 16) if title == "Start here" else (TEAL if (ci + si) % 2 == 0 else NAVY)
            d.rounded_rectangle((x, y, x + spec["col_w"], y + bar_h), radius=8, fill=color)
            d.text((x + 16, y + 6), title, font=f["sec"], fill=WHITE)
            y += bar_h + 6
            for i, (usage, _desc, ih, u_lines, d_lines) in enumerate(items):
                start = usage.startswith("/askai-cli") or usage.startswith("/askai-plugins")
                if start:
                    d.rectangle((x, y, x + spec["col_w"], y + ih), fill=(255, 244, 224))
                    d.rectangle((x, y, x + 8, y + ih), fill=(176, 96, 16))
                elif i % 2 == 0:
                    d.rectangle((x, y, x + spec["col_w"], y + ih), fill=WHITE)
                head, rest = head_rest(usage)
                uy = y + 7
                first = True
                for line in u_lines:
                    if first and line.startswith(head):
                        d.text((x + 14, uy), head, font=f["cmd"], fill=TEAL)
                        shown = line[len(head):].lstrip()
                        if shown:
                            hw = d.textlength(head + " ", font=f["cmd"])
                            d.text((x + 14 + hw, uy), shown, font=f["arg"], fill=ARG)
                    else:
                        d.text((x + 14, uy), line, font=f["arg"], fill=ARG)
                    first = False
                    uy += spec["lh"]
                dy = y + 7
                for line in d_lines:
                    d.text((x + spec["split"] + spec["gap"], dy), line, font=f["desc"], fill=SLATE)
                    dy += spec["lh"]
                y += ih
                d.line((x + 14, y - 1, x + spec["col_w"] - 12, y - 1), fill=HAIR)
            y += 12

    fy = page_h - spec["footer_h"]
    d.rectangle((0, fy, page_w, page_h), fill=NAVY)
    d.text((spec["margin"], fy + 16),
           "askai usage reads Claude Code and Codex only. Cursor, Claude chat, and ChatGPT show usage in their own settings.     ~/.claude/askai is AskAI's folder on every install, including Cursor-only.",
           font=f["sub"], fill=WHITE)
    img.save(OUT, dpi=(DPI, DPI), optimize=True)
    pt = round(size / DPI * 72, 1)
    orient = "landscape" if page_w > page_h else "portrait"
    print(f"font={size}px ({pt}pt) {orient} ratio={spec['ratio']} fill={spec['used']} -> {OUT}")


if __name__ == "__main__":
    main()
