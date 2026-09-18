# AI Model Practical Map

A single static page (`index.html`) that maps twelve frontier AI models by practical strengths and list price, and helps you pick one for a specific job.

Live site: served by GitHub Pages from the `main` branch root.

## What the page does

1. **Task chooser.** Describe a job in plain text (or click a preset). The page scores the description for eight task signals and returns three picks: the cheapest model that clears the capability bar, the most capable model regardless of price, and the best practical balance of capability and cost.
2. **Prompt builder.** Up to ten short questions turn the job into a structured prompt (Role, Task, Deliverable, Constraints, Approach, Verification, Output) tuned to the chosen model. It also tells you which ChatGPT or Claude subscription tier fits the job and when an upgrade would pay off.
3. **Recheck.** Ask an AI to search the web for price, capability and availability changes since the snapshot date, review the findings one by one, and apply the ones you trust. Applied changes are stored in your browser and replayed on top of the published snapshot every load. Reset returns to the published snapshot.

Everything runs in the browser. There is no server, no build step and no runtime dependency.

## Running locally

Open `index.html` directly, or serve the folder so relative behaviour matches GitHub Pages:

```bash
npm run serve
```

That runs `python -m http.server 8765 --bind 127.0.0.1`. Any static file server works; nothing in the page depends on the port.

## Tests

```bash
npm test
```

Requires Node 22 or newer and nothing else. `test/harness.mjs` extracts the inline `<script>` from `index.html`, evaluates it against a stub DOM and stub storage, and returns the functions. The suites cover:

| File | Covers |
|---|---|
| `test/smoke.test.mjs` | The script boots and renders the snapshot; all presets produce picks |
| `test/xss.test.mjs` | Recheck-sourced text renders escaped in cards, pricing table and results |
| `test/chooser.test.mjs` | Word-boundary keyword matching, shared stakes signal, golden preset picks, no-signal notice |
| `test/recheck.test.mjs` | JSON parsing (fenced, prose-wrapped, truncated, hostile), patch validation, apply/reset loop, `callClaude` with a mocked API |
| `test/apikey.test.mjs` | Key storage rules |

GitHub Actions runs the suite on every push and pull request (`.github/workflows/ci.yml`).

The **golden test** in `test/chooser.test.mjs` records the current cheap/premium/balanced pick for each preset. If you retune scores or weights, that test will fail until you update it, which is the point: pick changes should be deliberate.

## How the data flows

One array, `models`, drives everything. It starts as a deep copy of `publishedModels` (the snapshot in the script) and Recheck replays applied patches on top of it. The model cards, pricing table, chooser and prompt builder all read from `models`, so an applied change shows up everywhere at once.

Each model has nine 0 to 10 scores (`breadth`, `depth`, `agent`, `code`, `long`, `research`, `multi`, `discipline`, `value`), list prices per million tokens (`input`, `output`, or `null` when not published per token), a `costTier` from 1 to 5, and editorial text (`desc`, `best`, `tags`).

To update the snapshot by hand, edit the `models` array and bump `PUBLISHED_AS_OF`, then update the dates in the hero stamp and footer and the matching assertions in `test/smoke.test.mjs`.

## How the chooser scores a job

- `patterns` lists keywords per signal. `signal()` counts hits and scales them to 0 to 10 (each hit is worth 2.2). Keywords match only where they start a word; keywords of three letters or fewer must end the word too. This stops "rapidly" registering as "api" and "webhook" as "web".
- `stakesWords` marks high-stakes or ambiguous jobs. It raises the chooser's `depth` need and is the same list Step 2 uses for task complexity, so the two panels agree.
- `capability()` is a weighted average of a model's scores, weighted by how strongly the job needs each signal.
- **Cheapest that works**: lowest `costTier` among models above the capability threshold (7.8 when depth, agent or code need is 7 or more, otherwise 7.25).
- **Best regardless of price**: highest capability match. Because GPT-6 Astra holds the top score on nearly every axis, this slot will be Astra for most jobs. That is a property of the editorial scores, not a bug in the ranking.
- **Best practical overall**: `capability * 0.78 + value * 0.22`. The value scores of the cheap models (9 to 9.8) make this slot lean toward them. If you want the balanced slot to favour capability more, the lever is the `.78 / .22` blend in `recommend()`; the golden test will show you what moves.

When no signal is detected at all, the page says so above the results and labels the picks as general-purpose defaults.

## Recheck JSON contract

Option B pastes a reply from any chat model. The page accepts a bare JSON object, a fenced ```` ```json ```` block, or JSON surrounded by prose, in this shape:

```json
{
  "checked_through": "YYYY-MM-DD",
  "changes": [
    {
      "kind": "price | capability | functionality | new-model",
      "model": "<id from the snapshot, or null for new-model>",
      "new_id": "<slug, new-model only>",
      "vendor": "<new-model only>",
      "title": "short headline",
      "summary": "old and new values in a sentence or two",
      "effective": "YYYY-MM-DD",
      "source": "https://...",
      "confidence": "high | medium | low",
      "patch": null
    }
  ]
}
```

`patch` may contain only: `input`, `output` (number or null), `name`, `desc`, `best` (strings, trimmed to 400 characters), `tags` (up to six strings of 40 characters), the nine scores (clamped to 0 to 10) and `costTier` (1 to 5). Anything else is dropped. `id` and `color` can never be set by a patch. A `new-model` entry needs a unique `new_id`, a `name` and all nine scores or it is recorded as a note only. `source` must start with `http://` or `https://`.

Option A sends the same prompt to the Claude API from the browser with server-side web search, then parses the reply the same way.

## Security model

- **Escaping.** Every model string that reaches `innerHTML` (name, vendor, description, best-for, tags) passes through `esc()`. Recheck text is untrusted: it comes from an AI reply, and in Option A that reply was shaped by web pages the model read. A patch containing HTML renders as literal text. `test/xss.test.mjs` proves it with the payload from the September 2026 review.
- **Validation.** `cleanPatch()` whitelists fields and clamps ranges; `normalizeChange()` drops unknown models, malformed new-model entries and non-HTTP sources.
- **API key.** Sent only to `api.anthropic.com`. If you tick "remember", it is kept in `sessionStorage` for the current tab and cleared when the tab closes. It is never written to `localStorage`, and any key an earlier version left there is removed at boot.
- **Persistence.** Applied Recheck changes live in `localStorage` under `pm_recheck`; plan choices under `pm_plans`; the last Recheck model under `pm_rcmodel`. Reset clears `pm_recheck`.

## Known limits

- The chooser is a keyword heuristic. It reads the words you use, not the job behind them. Vague descriptions get general-purpose defaults.
- Prices and plan quotas go stale. The snapshot date is in the hero; Recheck exists to move it forward.
- Option A depends on the web-search tool type and beta header named in `callClaude()`. If Anthropic renames them the call will fail with a 400 that names the field. It has not been exercised against a live key in this repository.
- Recheck keeps at most 200 applied changes in `localStorage`; beyond that the oldest are dropped with a console warning. Reset clears it.

## Repository notes

- `index.html` is committed with LF line endings; Windows checkouts see CRLF through `core.autocrlf`. Editors should preserve whichever they find.
- `index.html.html` is a stray local copy and is ignored by `.gitignore`. Do not commit it.
- Some working trees carry a local task brief, `practical-map-prompt-generator.prompt.md`. It is not part of the repository; if you have one, keep it out of git with `.git/info/exclude`, which is per-clone and never pushed.
