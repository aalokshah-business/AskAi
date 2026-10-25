# Releasing AskAI

AskAI follows semantic versioning from 1.0.0: a fix raises the patch number (1.0.1), a new feature the minor number (1.1.0), a change that breaks existing setups the major number (2.0.0). Everyone who runs the one-line installer or `askai upgrade` gets the latest `main`, so keep `main` releasable and let CI pass before merging.

1. Bump the version in `package.json`, in `askai.js` (`const VERSION`) and in the version test (`test/v3.test.js`).
2. Add the changes to `docs/CHANGELOG.md`, newest first.
3. Regenerate and check: `node scripts/gen-docs.js`, `python scripts/build-cheat-pdf.py`, `python scripts/build-commands-card.py`, `node scripts/gen-docs.js --check`, `node --test test/*.test.js`, `bash scripts/preview-matrix.sh --quiet`. PDF/image generation needs PyMuPDF and Pillow (`python -m pip install pymupdf pillow`) on the release machine; users only need the committed files. `build-commands-card.py` writes the setup poster (`docs/AskAI-setup-A3.png`/`.pdf`) and the working poster (`docs/AskAI-working-A3.png`/`.pdf`) from the command list in `scripts/build-commands-a3.py`.
4. Refresh the checksums: `node scripts/sums.js`.
5. Commit, tag and push: `git commit -am "askai X.Y.Z"`, `git tag vX.Y.Z`, `git push && git push --tags`.
6. On GitHub, create a release from the tag (Releases, Draft a new release) and paste the changelog entry. Tags record what each version contained; installs always take the latest `main`.

## First-time repository setup

With the GitHub CLI installed and signed in as the owner (`gh auth login`), one command applies every setting; `--dry-run` shows the commands first:

```bash
node scripts/setup-github.js --dry-run
node scripts/setup-github.js
```

It makes the repository public with `main` as the default branch, adds the description and topics, turns issues on and the wiki and projects off, turns Actions on with a read-only token, turns on private vulnerability reporting, adds the `protect-main` ruleset (`.github/rulesets/protect-main.json`: no force pushes, `main` cannot be deleted, every pull request goes to the code owner; the owner can still push directly), creates the release for the current version, and checks that nobody else has push access.

Without the CLI, the same in the browser: Settings, General (visibility public, default branch `main`); Settings, Actions, General (allow all actions; workflow permissions: read repository contents; require approval for all external contributors); Settings, Code security (private vulnerability reporting); Settings, Rules, Rulesets (New ruleset, Import a ruleset, choose `.github/rulesets/protect-main.json`); Releases (Draft a new release, tag `vX.Y.Z`). Keep Settings, Collaborators empty: then only you can push.
