# Comparing allowances fairly

Measure outcomes, not just tokens. Use `helpers/ai_session.py measure ... --apply` to record manually sourced usage. Compare the same difficulty bucket and acceptance criteria across tools. Suggested indicators:
- Completed accepted tasks per subscription month (primary).
- Median human+agent elapsed minutes per accepted task.
- Rework minutes and percentage of tasks passing on first verification.
- Total input/output/cache token counts where officially available.
- Context overhead and tool-output burden.
- Provider-reported allowance consumed per accepted task; separately label API spend vs subscription usage.

API-equivalent dollars are NOT the same as subscription cost; model prices are NOT automatically comparable with pooled vendor usage credits. Do not pretend local cost estimates equal billing invoices. Track plan, dates, model, effort, repo commit, complexity and whether multi-agent mode was used.
