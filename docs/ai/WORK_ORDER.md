<!-- askai:work-order; replaced while the goal line is empty. A written goal is kept. -->
# Current work order

1. **Current goal:** Implement the live-audit improvements from top to bottom: runtime update/identity, tool repair, honest MCP evidence, refreshed guidance, valid quota comparisons, bounded graph queries and fast terminal diagnostics; test, document, commit and push.
2. **Relevant files / area:** `askai.js`, `lib/surface.js`, `lib/help.js`, installers, `docs/CHEAT_SHEET.md`, `scripts/gen-docs.js`, and focused tests. Search `docs/ai/SOURCE_INDEX.md` for additional paths.
3. **Specs:** Keep one AskAI CLI entry point per host, make terminal commands cheap, preserve existing user files, and document every public command.
4. **Out of scope:** Changing user credentials or claiming unverified token savings.
5. **Acceptance criteria:**
   - [ ] Every public command appears in the generated command sheet.
   - [ ] Windows, Linux, and project setup tests pass; generated docs match source.
   - [ ] Commit and push reviewed changes.
6. **Checks to run:** `npm test`, `npm run test:commands` (no build script)
7. **Tier and agent:** build (`builder`)
8. **Open blockers:** Native-client attachment has not been checked by the user. No matched baseline trial has run; do not claim measured net savings.
