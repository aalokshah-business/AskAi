# Installing AskAI

AskAI installs straight from GitHub: nothing to download first. Run **one command per project**. It fetches AskAI into `~/.claude/askai/src` (so `askai upgrade` can refresh it later), installs or refreshes it for Claude Code, Codex, Antigravity and Cursor with every optimiser (the `max` profile), writes the project's knowledge pack, and ends with the list of things only you can do. Running it again for another project is safe: whatever is already set up is skipped.

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Workflow max -Project C:\code\myapp -Yes
```

macOS, Linux or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --profile max --project ~/code/myapp --yes
```

Then work through `askai todo <repo>` (sign-ins, restarts, app settings, project details) and check everything with `askai infra <repo>`. Add `-DryRun` / `--dry-run` for a preview, or leave out the `max` profile for the evidence-based default.

**Or ask your agent to do it.** Paste this into Claude Code, Codex, Antigravity or Cursor, opened in the project:

```text
Set up AskAI for this repository. From the repository root, run the one command for this OS and wait for it to finish (it asks no questions):
- macOS, Linux or WSL: curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --target all --profile max --project . --yes
- Windows: powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.ps1))) -Target all -Workflow max -Project . -Yes"
Then run: askai todo .   (if askai is not found yet, use its full path: ~/.claude/askai/bin/askai, or askai.cmd on Windows)
Reply with what was installed, anything that failed, and my to-do list. Change no other files. Remind me to restart this session afterwards.
```

**Other ways to get it.** Clone it (`git clone https://github.com/aalokshah-business/AskAi ~/tools/AskAI`) or download the ZIP from GitHub (Code, Download ZIP), then run the installer in that folder with the same options: `bash ~/tools/AskAI/install.sh --target all --profile max --project ~/code/myapp --yes`, or on Windows `powershell -ExecutionPolicy Bypass -File C:\tools\AskAI\install.ps1 -Target all -Workflow max -Project C:\code\myapp -Yes`. With Node.js and git installed, `npx github:aalokshah-business/AskAi install --target all --profile max --project . --yes` works too.

**Keeping it current.** `askai upgrade` fetches the latest AskAI from GitHub and re-applies your profile; `askai update` upgrades the tools it installed. Before running a script from the internet you can read it first: [get.sh](get.sh), [get.ps1](get.ps1), and [SECURITY.md](SECURITY.md) for what the installer changes.

The full step-by-step guide (prerequisites per OS, every option, every file AskAI creates, checks and troubleshooting) is [docs/INSTALL.md](docs/INSTALL.md).
