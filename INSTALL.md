# Installing AskAI

AskAI installs straight from GitHub: nothing to download first. Run **one command per project**. It fetches AskAI into `~/.claude/askai/src` (so `askai upgrade` can refresh it later), installs or refreshes it for Claude Code, Codex, Antigravity and Cursor with the `coding` profile by default, writes the project's knowledge pack, and ends with the list of things only you can do. Running it again for another project keeps the recorded profile and skips what is already set up. Add `-Workflow max` (PowerShell) or `--profile max` (shell) when you want every optimiser.

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Project C:\code\myapp -Yes
```

macOS, Linux or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --project ~/code/myapp --yes
```

Then run `askai setup --project NAME` for status, audit, infra, plugin readiness, to-dos and the file validator. Restart each tool. `/askai-cli` (Codex: `$askai-cli`) reviews the project pack; `/askai-plugins` finishes one-time plugin setup. Add `-DryRun` / `--dry-run` for a preview.

**Or ask your agent to do it.** Paste this into Claude Code, Codex, Antigravity or Cursor, opened in the project:

```text
Set up AskAI for this repository. From the repository root, run the one command for this OS and wait for it to finish (it asks no questions):
- macOS, Linux or WSL: curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --project . --yes
- Windows: powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Project . -Yes"
Then run: askai setup .   (if askai is not found yet, use its full path: ~/.claude/askai/bin/askai, or askai.cmd on Windows)
Reply with what was installed, anything that failed, the plugin-ready report, and my to-do list. Change no other files. Remind me to restart this session, then run /askai-plugins once.
```

**Other ways to get it.** Clone it (`git clone https://github.com/aalokshah-business/AskAi ~/tools/AskAI`) or download the ZIP from GitHub (Code, Download ZIP), then run the installer in that folder with the same options: `bash ~/tools/AskAI/install.sh --target all --project ~/code/myapp --yes`, or on Windows `powershell -ExecutionPolicy Bypass -File C:\tools\AskAI\install.ps1 -Target all -Project C:\code\myapp -Yes`. With Node.js and git installed, `npx github:aalokshah-business/AskAi install --target all --project . --yes` works too.

**Keeping it current.** `askai upgrade` fetches the latest AskAI from GitHub and re-applies your profile; `askai update` upgrades the tools it installed. Before running a script from the internet you can read it first: [get.sh](get.sh), [get.ps1](get.ps1), and [SECURITY.md](SECURITY.md) for what the installer changes.

The full step-by-step guide (prerequisites per OS, every option, every file AskAI creates, checks and troubleshooting) is [docs/INSTALL.md](docs/INSTALL.md).
