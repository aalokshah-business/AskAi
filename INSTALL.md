# Installing AskAI

AskAI installs straight from GitHub: nothing to download first. Run **one command per project**. Fresh installs keep source, application, and data under `~/.askai`; existing `~/.claude/askai` installs keep working. The default `lean` profile configures hosts found on this machine, then writes the project's knowledge pack. Use `askai install --add ID` for a specific extra tool.

**Windows Git clone route.** Install Git and Node.js LTS first. Clone your project to a local folder, set `$projectPath` to that folder, then fetch AskAI and run the local installer:

```powershell
$askaiSource = Join-Path $HOME '.askai\src'
$projectPath = 'C:\code\myapp'  # change to your existing project folder
New-Item -ItemType Directory -Force -Path (Split-Path $askaiSource) | Out-Null
git clone https://github.com/aalokshah-business/AskAi.git $askaiSource
powershell -NoProfile -ExecutionPolicy Bypass -File "$askaiSource\install.ps1" -DryRun -Target all -Workflow coding -Project $projectPath
powershell -NoProfile -ExecutionPolicy Bypass -File "$askaiSource\install.ps1" -Target all -Workflow coding -Project $projectPath -Yes
```

Open a new PowerShell window, set `$projectPath` again, and run `askai setup --project $projectPath`. `coding` requests extra code navigation tools; the default is `lean`. See [the detailed installation guide](docs/INSTALL.md).

**Linux Git clone route (Cursor).** Install Git, Node.js 24 LTS and [Cursor for Linux](https://cursor.com/download). Sign in to Cursor, clone your project, and set `project_path` to its local folder:

```bash
project_path="$HOME/code/myapp" # change to your existing project folder
ls -ld "$project_path" # stop and correct the path if this fails
askai_source="$HOME/.askai/src"
mkdir -p "$(dirname "$askai_source")"
git clone https://github.com/aalokshah-business/AskAi.git "$askai_source"
bash "$askai_source/install.sh" --dry-run --target cursor --profile coding --project "$project_path"
bash "$askai_source/install.sh" --target cursor --profile coding --project "$project_path" --yes
"$HOME/.askai/bin/askai" setup --project "$project_path"
```

Restart Cursor, open the project and use `/askai-cli` in its chat. For all four hosts on Linux or Windows, use `--target all` and follow the [host checklist](docs/INSTALL.md#linux-and-windows-host-checklist). On Linux, `askai cli` opens AskAI's terminal interface.

Windows (PowerShell):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.ps1))) -Target all -Project C:\code\myapp -Yes
```

macOS, Linux or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.sh | bash -s -- --target all --project ~/code/myapp --yes
```

Then run `askai setup --project NAME` for a short host, finding, and file check. Restart each tool. `/askai-cli` (Codex: `$askai-cli`) reviews the project pack; `/askai-plugins` finishes one-time plugin setup. Add `-DryRun` / `--dry-run` to preview installation settings; the one-line bootstrap still downloads AskAI first.

**Or ask your agent to do it.** Paste this into Claude Code, Codex, Antigravity or Cursor, opened in the project:

```text
Set up AskAI for this repository. From the repository root, run the one command for this OS and wait for it to finish (it asks no questions):
- macOS, Linux or WSL: curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.sh | bash -s -- --target all --project . --yes
- Windows: powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/aalokshah-business/AskAi/v1.3.0/get.ps1))) -Target all -Project . -Yes"
Then run: askai setup .   (if askai is not found yet, use its full path: ~/.askai/bin/askai, or askai.cmd on Windows)
Reply with what was installed, anything that failed, the plugin-ready report, and my to-do list. Change no other files. Remind me to restart this session, then run /askai-plugins once.
```

**Other ways to get it.** Clone it (`git clone https://github.com/aalokshah-business/AskAi ~/tools/AskAI`) or download the ZIP from GitHub (Code, Download ZIP), then run the installer in that folder with the same options: `bash ~/tools/AskAI/install.sh --target all --project ~/code/myapp --yes`, or on Windows `powershell -ExecutionPolicy Bypass -File C:\tools\AskAI\install.ps1 -Target all -Project C:\code\myapp -Yes`. With Node.js and git installed, `npx github:aalokshah-business/AskAi install --target all --project . --yes` works too.

**Keeping it current.** `askai update` fetches the latest AskAI from GitHub and re-applies your profile; `askai tools update` upgrades installed tools. `askai upgrade --agents` opens Claude Code, Cursor and Codex in sequence for source-backed reviews; this spends model tokens and needs all three CLIs on PATH. Before running a script from the internet you can read it first: [get.sh](get.sh), [get.ps1](get.ps1), and [SECURITY.md](SECURITY.md) for what the installer changes.

The full step-by-step guide (prerequisites per OS, every option, every file AskAI creates, checks and troubleshooting) is [docs/INSTALL.md](docs/INSTALL.md).
