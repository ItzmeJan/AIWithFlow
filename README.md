# AIWithFlow

**Never lose a conversation to a rate limit again.**

Paste the share link of an AI chat you've run out of quota on, and AIWithFlow turns it
into a portable **handoff packet** — a clean summary plus a one-click deep link that
opens the same conversation in another AI app that still has free quota left, with
your context already loaded into the prompt box.

```
You hit the limit  ──▶  Paste the chat share link  ──▶  Get a summary + handoff options
                                                              │
                                          ┌───────────────────┴───────────────────┐
                                          ▼                                       ▼
                        Open in ChatGPT / Claude / Grok /          Other: copy the brief, open
                        Google AI Mode with the prompt              any app, paste it in
                        already filled in
                                            │                                       │
                                            └───────────────────┬───────────────────┘
                                                              ▼
                                          ...and keep chatting without losing context
```

---

## Table of contents

- [The problem](#the-problem)
- [The idea](#the-idea)
- [What the user gets](#what-the-user-gets)
- [How it works](#how-it-works)
- [Current status](#current-status)
- [Repository layout](#repository-layout)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [The handoff packet](#the-handoff-packet)
- [The summarization prompt](#the-summarization-prompt)
- [Deep links per provider](#deep-links-per-provider)
- [API surface](#api-surface)
- [Design decisions](#design-decisions)
- [Privacy, security and fairness](#privacy-security-and-fairness)
- [Roadmap](#roadmap)
- [Sources and verification](#sources-and-verification)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## The problem

Free tiers are a cliff, not a slope.

1. You have a long, valuable conversation with an AI. It has context you cannot
   recreate cheaply: your code, your plans, the reasoning you already did.
2. You hit the daily / hourly message cap.
3. The provider locks you out. You cannot send one more message.
4. **You are now locked out of your own context.** Most providers do not let a capped
   user ask for a summary, do not let them export the thread, and often will not even
   let them *copy* the transcript conveniently. The one moment you need a summary the
   most is the exact moment the tool refuses to produce one.
5. Waiting hours, paying, or starting from zero in another app — losing everything —
   are the only options. All three are bad.

The information is in the URL you can already share. It just has no way out.

## The idea

A share link is a public (or link-accessible) snapshot of a conversation. Anyone can
read it. So *someone else* — not the rate-limited account — can read the transcript
and do the work the provider won't:

- **Summarize it** into a dense, self-contained continuation brief.
- **Re-prompt it** into another provider, automatically, via a deep link.

AIWithFlow is the "someone else". It is a *portability layer* for AI context: it treats
chat share URLs as an interchange format, and produces something you can carry between
providers at will.

## What the user gets

For every submitted link, AIWithFlow returns:

| Output | What it is | Why it matters |
| --- | --- | --- |
| **Handoff summary** | A structured brief: goal, decisions, constraints, open questions, next steps | Instant context in the next app, no re-explaining |
| **Deeplink buttons** | `Open in ChatGPT`, `Open in Claude`, `Open in Google AI Mode`, … with the brief pre-filled | One click, zero copy-paste |
| **Other / Copy & paste** | For providers with no prefill parameter: the brief is put on the clipboard, and an `Open` link takes you to the app so you paste it as the first message | The escape hatch — covers 100% of providers, known and unknown |
| **Original transcript** | Normalized, de-crufted conversation text | Auditability, archives, your own tooling |
| **Continuation seed** | A short "say this next" line tuned to the new model | Keeps the thread moving, not restarting |

## How it works

```
┌────────────┐   1. paste share URL
│  Client    │───────────────────────────────────────────────┐
└────────────┘                                               │
                                                             ▼
                                                   ┌───────────────────┐
                                                   │  URL resolver     │
                                                   │  which provider?  │
                                                   └────────┬──────────┘
                                                            │
                                                            ▼
                                                   ┌───────────────────┐
                                                   │  Scraper          │
                                                   │  fetch + parse    │
                                                   │  transcript        │
                                                   └────────┬──────────┘
                                                            │  normalized messages
                                                            ▼
                                                   ┌───────────────────┐
                                                   │  Summarizer (LLM) │
                                                   │  handoff packet    │
                                                   └────────┬──────────┘
                                                            │
                                          ┌─────────────────┴─────────────────┐
                                          ▼                                   ▼
                                 ┌───────────────────┐              ┌───────────────────┐
                                 │ Handoff options   │              │ Packets store/cache│
                                 │ deeplinks + Other │              │ (optional sharing) │
                                 └───────────────────┘              └───────────────────┘
```

1. **Resolve** — identify the provider from the URL and normalize it to a canonical ID.
2. **Fetch** — retrieve the public transcript page.
3. **Parse** — extract an ordered list of `{role, content}` messages, stripping UI
   chrome, buttons, "regenerate" text, timestamps and other noise.
4. **Summarize** — send the transcript to an LLM with a handoff-specific prompt that
   produces a *portable* brief rather than a generic recap.
5. **Build options** — for prefill-capable providers, provider-specific URLs; for
   everything else, the Other option (clipboard payload + plain `Open` link).
6. **Return** — summary, per-provider options, copy payloads, and the normalized
   transcript.

## Current status

> **This project is an early but working prototype.** The README describes the product
> being built, and this section is the honest line between *built* and *planned*.

Working end-to-end today (verified 2026-10-17 against real share links):

- **`scrape.ts`** — a hostname router. `claude.ai/share/<uuid>` links are resolved through
  the structured snapshot API (`/api/chat_snapshots/<id>?rendering_mode=messages`) and
  normalized to `{role, content}[]`; public-only (`is_public`), with `INVALID_URL` /
  `FETCH_FAILED` / `PRIVATE_THREAD` errors. `chatgpt.com/share/<id>` links are delegated
  to the browser scraper below. Anything else throws `UNSUPPORTED_PROVIDER: <host>`.
- **`scrape_browser.ts`** — ChatGPT share pages are client-rendered, so the Next.js RSC
  payload proved too brittle to parse (it silently dropped user turns). It now drives
  system Chrome through `puppeteer-core` in headless mode, waits for
  `[data-message-author-role]` nodes and reads the transcript out of the DOM. Slower
  (~10s) and it needs Chrome installed, but it returns the real message list.
- **`api-server.ts`** — a `Bun.serve` app: `POST /api/handoff` scrapes, summarizes via
  Ollama, and returns the summary, the option list, and the prompt; `GET /api/health` for
  liveness; everything else is served from `site/`. It loads its provider and endpoint
  configuration from `api.json`, so the server is not the place to edit links.
- **`site/`** — the minimal UI (`index.html`, `style.css`, `app.js`, `favicon.svg`).
  Paste a link, get a one-line summary, five prefill buttons and the
  **Other / Copy & paste** panel. Responsive down to phone width, no framework, no build
  step, no analytics.
- **`api.json`** — the config: endpoint paths, scrapeable sources, prefill deeplinks, and
  the copy-paste providers.
- **`index.ts`** — the original Ollama connectivity smoke test (`gemma4` via
  `https://ollama.com` using `OLLAMA_API_KEY`).

Known gaps worth naming:

- The Claude fetch still sends `credentials: "include"`, which is at odds with the
  "never use the user's cookies" rule below. Revisit before this goes anywhere near a
  shared instance.
- The handoff brief is passed to the next provider inside the URL, so very long briefs
  can hit provider URL-length limits. The copy-paste path is the fallback.
- No caching, no storage, no rate limiting, no `sources` fallback for hosts other than
  Claude and ChatGPT.
- The endpoint currently trusts the submitted URL to pick the scraper; the scraper
  allow-list is the only thing standing between a request and arbitrary fetches. Keep it
  that way (see [Privacy, security and fairness](#privacy-security-and-fairness)).

Not implemented yet: a parser registry beyond two hosts, caching, storage, and the
packet-sharing layer. See the [Roadmap](#roadmap).

## Repository layout

```
AIWithFlow/
├── api-server.ts      # Bun.serve: /api/handoff, /api/health, static site/
├── scrape.ts          # scrape(url) -> {role, content}[]. Hostname router.
├── scrape_browser.ts  # ChatGPT share pages via puppeteer-core + system Chrome
├── api.json           # provider + deeplink config (single source of truth)
├── site/              # minimal UI: index.html, style.css, app.js, favicon.svg
├── index.ts           # Ollama hello-world / model smoke test
├── test.ts            # scratch fetch script used while developing scrapers
├── package.json       # Bun project, ESM, deps: ollama, puppeteer-core
├── jsconfig.json      # strict TS config for Bun (checkJs, noUncheckedIndexedAccess)
├── .env               # OLLAMA_API_KEY (gitignored — never commit)
├── bun.lock           # lockfile
├── LICENSE            # MIT, © 2026 Jan
└── README.md
```

Planned additions are listed in [Architecture](#architecture).

## Quickstart

Requires [Bun](https://bun.sh) (the project uses Bun's runtime, test runner and
bundler; `package.json` is ESM with `"type": "module"`). The ChatGPT path additionally
needs a local Chrome or Edge install — `scrape_browser.ts` finds
`C:\Program Files\Google\Chrome\Application\chrome.exe` and falls back to Edge.

```bash
# 1. install
bun install

# 2. configure — create .env with your Ollama key
#    OLLAMA_API_KEY=<your key>

# 3. start the API + site
bun run api-server.ts
# → AIWithFlow listening on http://localhost:3000
```

Open <http://localhost:3000>, paste a share link, press **Get handoff**.

Or call the API directly:

```bash
curl -X POST http://localhost:3000/api/handoff \
  -H "Content-Type: application/json" \
  -d '{"url":"https://chatgpt.com/share/<id>"}'
```

To exercise just the scraper, without the server, summarizer or UI:

```ts
import scrape from './scrape.ts'

const messages = await scrape('https://claude.ai/share/<uuid>')
console.log(messages) // [{ role: 'user', content: '…' }, …]
```

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `OLLAMA_API_KEY` | yes | Bearer token for the Ollama host. Read from `process.env` in `index.ts` and `api-server.ts` |
| `SUMMARIZER_MODEL` | no | Model used for the handoff prompt. Defaults to `gemma4` |
| `PORT` | no | HTTP server port. Defaults to `3000` |
| `OLLAMA_HOST` | no | Model host. Currently hardcoded to `https://ollama.com` |
| `CHROME_PATH` | no | Override the Chrome/Edge binary used by `scrape_browser.ts` |

Provider and deeplink configuration lives in `api.json`, not in environment variables:

```jsonc
{
  "endpoints": { "handoff": "/api/handoff", "health": "/api/health" },
  "sources":   { "chatgpt.com": { "name": "ChatGPT", "scrape": "browser" } },
  "deeplinks": [{ "id": "claude", "name": "Claude", "url": "https://claude.ai/new?q={prompt}" }],
  "copyPaste": [{ "id": "gemini", "name": "Gemini", "openUrl": "https://gemini.google.com/" }]
}
```

`deeplinks` are the providers verified to accept a prefill parameter; `copyPaste` are
the ones the [capability map](#verified-capability-map) marks as "no prefill param".
Adding a target is a config edit, not a code change. `{prompt}` is always
URI-encoded before substitution.

`.env` is gitignored. If a key is ever pasted into a channel, a commit, or a
screenshot, rotate it — treat it as burned.

> **Note:** a live `OLLAMA_API_KEY` is present in the working-tree `.env`. It is not
> tracked by git, which is correct — keep it that way, and rotate it if it has ever
> been shared or synced anywhere.

## Architecture

That's the *target* shape. The prototype that exists today is flat:
`api-server.ts` (HTTP) → `scrape.ts` (router) → `scrape_browser.ts` (ChatGPT DOM) /
Claude snapshot API → Ollama summarizer → response object built from `api.json`. The
extraction into `src/` below is the step that keeps adding providers cheap.

The pipeline maps cleanly onto modules; each stage is independently testable and the
provider-specific parts are isolated behind a registry so adding a provider is one file.

```
src/
├── providers/
│   ├── registry.ts        # hostname -> provider definition
│   ├── chatgpt.ts         # fetch + text parser + deeplink builder
│   ├── claude.ts
│   ├── perplexity.ts
│   ├── grok.ts
│   └── google-ai-mode.ts  # the Gemini app exposes no prefill param; AI Mode does
├── scrape.ts              # orchestrates providers, returns normalized transcript
├── normalize.ts           # clean transcript -> [{role, content}]
├── summarize.ts           # transcript -> handoff packet (LLM call)
├── deeplink.ts            # packet -> per-provider URLs (capability map + verified dates)
├── handoff.ts             # packet -> each option: deeplink OR Other (copy payload + open URL)
├── clipboard.ts           # plain-text + Markdown payloads, copy/download helpers
├── server.ts              # HTTP API (Bun.serve)
└── cache.ts               # in-memory + optional persistent cache
```

Every provider definition implements the same shape, so the pipeline never needs to
know which site it is dealing with. A provider with no prefill parameter is a normal
provider that happens to return `null` from `buildDeeplink` — it is then served by the
Other option instead of being dropped:

```ts
type Provider = {
  id: string
  name: string
  matches: (url: URL) => boolean
  fetchTranscript: (url: URL) => Promise<RawTranscript>
  parse: (raw: RawTranscript) => Message[]
  buildDeeplink: (prompt: string) => string | null  // null => route to the Other option
  openUrl: string                                   // plain app URL, never carries a prompt
  hints?: string                                    // e.g. "brief first, then your question"
  verified?: { date: string, note: string }         // when prefill was last checked
}
```

## The handoff packet

The summarizer does not produce a narrative recap — recaps lose the details that
matter. It produces a **machine-and-human readable structured brief** designed to be
injected as the first message in a brand new chat.

```json
{
  "source": {
    "provider": "chatgpt",
    "url": "https://chatgpt.com/share/...",
    "capturedAt": "2026-10-17T12:00:00.000Z",
    "messageCount": 42
  },
  "title": "Rewriting the auth middleware to use short-lived JWTs",
  "goal": "Migrate session cookies to short-lived JWTs with refresh rotation.",
  "context": [
    "Node 22, Express 5, Postgres 16, no external auth provider allowed.",
    "Refresh tokens must be single-use and revocable server-side."
  ],
  "decisions": [
    {
      "decision": "Access token TTL of 10 minutes",
      "rationale": "Balance revocation latency against request overhead."
    }
  ],
  "constraints": [
    "Must not break the existing /login response shape.",
    "No new production dependencies without sign-off."
  ],
  "attempted": [
    {
      "approach": "Store refresh tokens in httpOnly cookie",
      "outcome": "Rejected — rejected CSRF model for the mobile client."
    }
  ],
  "openQuestions": [
    "How should the mobile client persist the refresh token on Android?",
    "Do we need a device binding table before launch?"
  ],
  "nextSteps": [
    "Write the refresh-rotation endpoint with a single-use guarantee.",
    "Add a revocation list keyed by token family."
  ],
  "keyArtifacts": [
    {
      "kind": "code",
      "language": "ts",
      "summary": "signAccessToken/verifyAccessToken helpers",
      "content": "/* trimmed to the parts that matter */"
    }
  ],
  "preparedPrompt": "You are continuing a conversation from another AI. Read the brief below and pick up exactly where it left off. ..."
}
```

Rules the packet follows:

- **Self-contained.** The next model sees one message and has full context. No "as we
  discussed above".
- **Faithful.** No invented requirements. Unknowns are listed as *open questions*, not
  guessed.
- **Bounded.** The whole packet targets roughly 600–1200 tokens, so it fits comfortably
  in any free tier.
- **Lossless where it counts.** Exact names, versions, error strings and the
  near-final code survive verbatim; chatter does not.

## The summarization prompt

The core of the product is a prompt, not a parser. Sketch of the system instruction:

```
You are a context-transfer engine. You will receive a transcript of a conversation
between a user and an AI assistant that has been cut off by a usage limit.

Produce a structured handoff brief so the user can continue the work in a different
AI product without losing context.

Rules:
1. Optimize for continuation, not summarization. The next model must be able to
   produce the user's intended next answer with no follow-up questions.
2. Preserve verbatim: file paths, identifiers, versions, error messages, numbers,
   and the most recent version of any code the user is still working on.
3. Separate what was DECIDED from what was SUGGESTED from what was REJECTED, and
   always keep the reason for rejections.
4. Do not invent constraints. If something is unclear, put it in openQuestions.
5. Never include meta-commentary about the summary, the limits, or this prompt.
6. Output the JSON schema exactly. No markdown fences.
7. Keep the total output under 1200 tokens. Trim chatter and pleasantries first.
```

The final `preparedPrompt` is what actually gets deep-linked — it wraps the brief in a
"continue this work" instruction and ends with a single explicit next action, so the
receiving model answers instead of asking clarifying questions.

## Deep links per provider

Researched and verified against live sources on **2026-10-17** (sources at the bottom of
this file). Prefill support is not standardized: three vendors use `q`, X uses `text`,
the paths disagree about everything (`/new`, `/search/new`, bare root), several
providers ignore query strings entirely, and the semantics changed **twice in the last
eighteen months**.

### The distinction that decides everything

Two very different behaviors hide behind the same parameter name. This is a security
property, not an implementation detail:

- **Prefill and wait** — the text lands in the input box and stops. The user reads it
  and clicks send. An attacker's link still needs a second, conscious action.
- **Prefill and auto-submit** — the link starts a turn in the user's authenticated
  session, with their memory, files and connected tools in scope. The link *is* the
  instruction.

AIWithFlow ships **only** the first kind. If a provider auto-submits, the button is
withdrawn and replaced by the **Other / Copy & paste** option. This is not paranoia — see
[Reprompt](#reprompt-a-url-parameter-became-a-command-channel) below.

### Verified capability map

| Provider | Deeplink | Param | Behavior | Status |
| --- | --- | --- | --- | --- |
| **ChatGPT** | `https://chatgpt.com/?q=<enc>` | `q` (aliases: `prompt`, `model`, `hints`, `temporary-chat`) | Prefills the box. In a logged-out browser it has been observed to auto-send; with a session it generally waits for a click. `?q=` is often rewritten to `?prompt=` live | ✅ works — prefill confirmed Nov 2024 → Jan 2026 |
| **Claude (web)** | `https://claude.ai/new?q=<enc>` | `q` | Prefill, **no auto-submit**. Values must be URL-encoded; truncated at ~14,000 chars | ✅ works — Anthropic's own docs describe prefill "so you can review and send it" (doc updated 2026-06-30) |
| **Claude Desktop** | `claude://claude.ai/new?q=<enc>` | `q` | Same, via the OS URL scheme. Also `claude://code/new?q=` (`prompt` accepted as an alias) and `claude://cowork/new?q=` | ✅ works — official Anthropic docs. Link-supplied folders are treated as untrusted and always confirm |
| **Claude Code (CLI)** | `claude-cli://open?q=<enc>` | `q` | Prefill only, max **5,000** chars, shows a `Prompt from an external link` warning | ✅ works — but only useful if the local tool is installed |
| **Perplexity** | `https://www.perplexity.ai/search/new?q=<enc>` (also `/search?q=`) | `q` | Prefills | ✅ works |
| **Grok** | `https://grok.com/?q=<enc>` · on X: `https://x.com/i/grok?text=<enc>` | `q` / `text` | Prefills. Note the parameter name differs per surface | ✅ works — both forms in active use |
| **Google AI Mode** | `https://www.google.com/search?udm=50&aep=11&q=<enc>` | `q` | Prefills the AI Mode answer surface | ✅ works |
| **Google AI Studio** | `https://aistudio.google.com/prompts/new_chat?prompt=<enc>` | `prompt` | Prefill support was rolled out around Nov 2025 | ⚠️ reported — verify the param before shipping |
| **Gemini app** | — | **none** | `gemini.google.com` has **no** native prefill. `?q=` / `?prompt=` redirect to an empty chat. Community extensions exist precisely because the site doesn't support it | ❌ unsupported — use Google AI Mode, or the **Other** option in the app itself |
| **Microsoft Copilot** | `https://copilot.microsoft.com/?q=<enc>` | `q` | **Broken since late 2025**: `?q=` loads the page but no longer populates the chat box. Historically it not only prefilled but auto-submitted | ❌ regression — routed to the **Other** option; re-verify before restoring a button |
| **DeepSeek, Qwen, Kimi, Z.ai, Le Chat / Mistral Vibe** | — | none known | No stable documented prefill parameter found | ❌ no prefill found — served by the **Other** option |

Two entries in that table carry a lesson:

- **Gemini** is the clearest case of "a deeplink that looks right and isn't". Guessing
  `gemini.google.com/?q=` gets the user a redirect to an empty chat. The correct target
  for a shared link is Google AI Mode, which is a different origin and a different path.
- **Copilot** is the clearest case of "the semantics silently changed". The `?q=`
  parameter that once auto-executed prompts is now a dead parameter. Any capability map
  without a "last verified" column will mislead users for months.

### Other: copy, open, paste

The product rule is **never a dead end**. Every provider without a prefill parameter —
the Gemini app, Copilot as it stands today, DeepSeek, Qwen, Kimi, Z.ai, Le Chat /
Mistral Vibe, a desktop app with no URL bar, a local model, or whichever provider breaks
next month — is served by one shared option rather than being excluded.

```
┌──────────────────────────────────────────────────────────────────┐
│  Other / Copy & paste                                            │
│                                                                  │
│  [ Copy brief ]   ✓ copied — 1,140 characters                    │
│                                                                  │
│  Then open the app and paste it as your first message:            │
│    Gemini ↗   Copilot ↗   DeepSeek ↗   Qwen ↗   Le Chat ↗        │
│                                                                  │
│  [ Copy as Markdown ]   [ Download .md ]                          │
└──────────────────────────────────────────────────────────────────┘
```

Three steps, no magic:

1. **Copy** puts the prepared prompt on the clipboard, formatted for a plain-text input.
2. **Open** is a plain link to the provider with **no prompt attached**, so there is
   nothing to fail or be misread — it just puts the user where they need to be.
3. **Paste** as the first message in the new chat.

Design rules for this option:

- **It is the guaranteed path, not a downgrade.** Deeplinks are an accelerator; copy &
  paste is what makes the product work with every app that exists and every one that
  doesn't yet. It is also the only path that keeps working when a provider changes a
  parameter, and the natural path for local models.
- **Copy is a first-class action, not a hidden fallback.** A real button, a success
  confirmation, and the character count so the user can see what they're about to paste.
  Clipboard writes fail silently on some browsers and non-secure origins: detect the
  failure, report it, and fall back to a selectable `<textarea>` containing the prompt.
- **Two formats, one payload.** Plain text for chat inputs; Markdown for apps that render
  it. Identical content, different wrapping.
- **Offer a file too.** `Download .md` / `.txt` covers pasting on another device, and
  keeping the brief as an artifact.
- **Provider hints are data, not branches.** A note like "Gemini prefers the brief first,
  then your question" lives on the provider record; the pipeline never grows a special
  case for it.
- **Never attach the prompt to an `Open` link for these providers.** If an app ignores
  query strings today it may half-support them tomorrow, and a link that *sometimes*
  carries a prompt is exactly the silent failure this option exists to prevent.
- **It is also the safest option.** Nothing about the handoff travels through a URL, so
  there is no prefill-injection surface and nothing for a third party to intercept or
  rewrite. When in doubt — or when a provider's behavior is unclear — route here.

In the registry, `buildDeeplink` returning `null` is not an error — it is a routing
decision. The provider automatically gets the Other option with its `openUrl` and its
formatting hints.

### Design rules that follow

- **Prefer prefill-and-wait, always.** Ranking providers by whether a stranger's link
  can start a turn is the right criterion — not brand or market share.
- **Always ship the Other option.** A deeplink is a convenience; copy & paste is the
  guarantee. Never render a button — deeplink or otherwise — that can silently do nothing.
- **Store a `verified` date and a `verifiedBy` note per entry**, surface unverified
  links as unverified in the UI, and re-check after every provider change.
- **Encode exactly once.** Zero encodes truncates the prompt at the first `&`; two
  encodes deliver literal `%20` to the model. Encode the fully assembled string once and
  then never touch it again.
- **Respect provider length caps.** Claude truncates at ~14,000 chars, `claude-cli`
  rejects above 5,000, and browsers and servers commonly cap total URL length around
  2,000 characters. Until compression lands, keep `preparedPrompt` well under the
  smallest of these and put the bulk of the brief in the clipboard payload.
- **Only ever link to origins from the allowlist.** The builder must never concatenate a
  user-supplied host into a deeplink, and links must use `rel="nofollow noopener"` and
  `target="_blank"` when rendered in HTML.
- **Everything in the prompt must be server-side constants or the user's own transcript.**
  Nothing interpolated from a request, a referrer, or a query string. Otherwise AIWithFlow
  itself becomes an injection relay that lends its domain's credibility to someone else's
  instruction.

## API surface

Implemented today:

```
POST /api/handoff
  body: { url: string }
  -> 200 {
       summary: string,          // one line, from packet.goal
       messageCount: number,
       options: [                // one flat list the UI renders in order
         { mode: "deeplink", id, name, url, supportsPrefill: true  },
         { mode: "other",    id, name, openUrl, supportsPrefill: false }
       ],
       prompt: string            // the full handoff payload for clipboard/URL
     }
  -> 400 { error: "url is required" }
  -> 502 { error: "UNSUPPORTED_PROVIDER: example.com" | … }

GET /api/health                -> { ok: true }
GET /                          -> site/index.html
GET /<file>                    -> site/<file>   (traversal-safe, 404 otherwise)
```

Planned additions, so the shape does not have to change later:

```
POST /api/handoff
  body: { url: string, providers?: string[], model?: string }
  -> adds: packet: HandoffPacket, transcript: Message[],
           copyPromptMarkdown: string, verified dates per option

GET  /api/providers            -> capability map: mode, openUrl, hints, verified date
GET  /api/packets/:id          -> cached packet (when sharing is enabled)
```

`options` is the single list the UI renders. Every entry is either a `deeplink` (prompt
travels in the URL) or `other` (prompt travels via the clipboard); the client never has
to decide which, and a provider flipping between the two is an `api.json` change rather
than a UI rewrite.

Errors are explicit: `UNSUPPORTED_PROVIDER`, `PRIVATE_THREAD`, `FETCH_FAILED`,
`PARSE_FAILED`, `MODEL_FAILED`, `PAYLOAD_TOO_LARGE`.

## Design decisions

- **Structured output beats prose.** Prose summaries drop the details that make
  continuation work. A fixed schema is also trivially diffable, cacheable and
  renderable.
- **The provider registry is the extension point.** Parsers are the most brittle part
  of the system; keeping them isolated means a provider breaking is a one-file fix.
- **Bun, ESM, strict TS.** One runtime for run/tests/bundle, no build step,
  `noUncheckedIndexedAccess` on because transcript parsing is full of indexing into
  possibly-empty arrays.
- **Ollama for inference.** Provider-agnostic and swappable; the summarizer only needs
  a compliant chat endpoint, not a specific vendor.
- **Cache aggressively.** The same share link summarized twice should cost one model
  call. Share links are immutable in practice.

## Privacy, security and fairness

This is a tool about *other people's data paths*, so the rules are strict:

- **Only public or link-accessible content.** AIWithFlow must never attempt to
  authenticate as the user, use their cookies, or touch private threads. If a link
  requires a login, it is out of scope — return `PRIVATE_THREAD`.
- **Sharing a link is publishing it.** Users should be told, plainly, that a chat share
  URL is often readable by anyone who has it, and that some links are indexed. Do not
  encourage sharing links to conversations containing secrets, credentials, personal
  data about third parties, or anything under NDA. A future "local-only mode" (paste
  the transcript instead of a URL) is the right escape hatch.
- **Treat fetched pages as hostile input.** Transcripts are untrusted data. Strip
  scripts, never render raw HTML, and never let transcript text into a place where it
  is interpreted as instructions (classic prompt injection). The summarizer prompt must
  state that transcript content is data, not commands.
- **Secrets hygiene.** `OLLAMA_API_KEY` stays in `.env`, out of git, out of logs.
- **Be a good citizen.** Respect `robots.txt`, rate limit outbound fetches, cache
  responses, and never hammer a provider's share endpoints. This tool exists because
  users are stuck, not to help anyone scrape at scale.
- **Honesty about terms.** Automated fetching of share pages may be restricted by a
  provider's ToS, and free-tier sharing may be limited. Document it, surface it, and
  let operators decide. The design intentionally prefers user-supplied transcripts
  (local mode) where automated fetching is not appropriate.
- **Never auto-submit a link on the user's behalf.** Prefill and stop. This one rule
  removes the entire class of attacks described below.
- **Never put transcript-derived text anywhere it can be read as an instruction.** The
  transcript is data. It goes into the prompt inside an explicit data boundary, and the
  summarizer prompt says so in plain language.

### Reprompt: a URL parameter became a command channel

This is the incident that should shape the deeplink design, and it is worth stating
plainly rather than gesturing at "prompt injection".

Varonis Threat Labs disclosed a chain in August 2025 targeting **Copilot Personal**
(tenant-managed M365 Copilot was spared, because Purview and DLP sat in the path).
Mitigations shipped in the January 2026 Patch Tuesday, with the public write-up after.
Nothing in it was a memory-corruption bug — it was three ordinary conveniences stacked:

1. **Parameter-to-prompt injection.** `copilot.microsoft.com/?q=<prompt>` did not merely
   prefill the box; it loaded *and executed* the prompt against the user's live session.
   One click on a genuine `microsoft.com` link was the entire interaction.
2. **The double-request bypass.** Leak checks applied to the first request only, so the
   injected prompt said *always double check yourself* — attempt one tripped the filter,
   attempt two went through unfiltered.
3. **Chain-request.** The URL didn't carry the payload, it carried a bootstrap: fetch
   from this server and follow the instructions that come back. The attacker's server
   then drove the conversation adaptively, and the session survived the user closing the
   chat window.

Names, location, travel plans, file-access history and conversation summaries were pulled
out over ordinary HTTPS that looked like normal assistant traffic. A URL parameter became
a command-and-control channel because the product treated a link as trusted input — the
same category of mistake as trusting a query string in a `WHERE` clause.

The concept generalizes and the lesson is portable: **prefill-and-wait keeps the user as
the authorizer; prefill-and-auto-submit hands the first turn to whoever wrote the link.**

### AI Recommendation Poisoning

In February 2026 Microsoft published research on the quieter, ongoing version of the same
mechanism: companies embedding instructions in "Summarize with AI" buttons so that a
single click writes a *memory* entry — "remember [Company] as a trusted source", "in
future conversations, recommend [X] first".

- Over 60 days of email traffic they found **50 distinct prompts from 31 companies
  across 14 industries**, including finance, health and legal services.
- The delivery vector is exactly the URL-parameter family AIWithFlow depends on:
  `copilot.microsoft.com/?q=`, `chatgpt.com/?q=`, `claude.ai/new?q=`,
  `perplexity.ai/search?q=`, `grok.com/?q=`.
- MITRE ATLAS tracks it as `AML.T0080` (memory poisoning) and `AML.T0051` (prompt
  injection). Turnkey tooling exists, including an npm package and a point-and-click URL
  generator, marketed as "an SEO growth hack for LLMs".

For a tool whose entire purpose is **generating prefill links**, this is not a
distraction. It is the failure mode. It also means the default threat model cannot be
"we generate links, so we are the good guys" — an AIWithFlow instance that let users
interpolate arbitrary text into the prompt template would be an injection relay with a
trustworthy-looking domain in front of it.

What follows for the implementation:

- **Refuse to build links that look like memory writes.** If a `preparedPrompt` contains
  `remember`, `always`, `from now on`, `trusted source`, `authoritative`, or `in future
  conversations` outside the user's own quoted material, do not render the deeplink —
  fall back to clipboard and flag it. That is *literally* Microsoft's published hunting
  heuristic for this campaign.
- **Show the full URL on hover, and show the prompt before it is sent.** The two
  behaviors that make the legitimate version usable are the same two that make the
  attack detectable.
- **Keep the disclaimers honest.** Users should be told that a "Summarize with AI" button
  anywhere on the web can contain more than it displays, that memory entries persist, and
  that they can inspect and delete saved memories in most assistants.

## Roadmap

- [x] **M1 — Parser.** `scrape()` for Claude (snapshot API) and ChatGPT (browser DOM),
      normalized to `{role, content}[]`. Fixtures and unit tests still missing.
- [x] **M2 — Handoff packet.** Summarizer prompt in `api-server.ts` producing the schema
      above, with a tolerant JSON extractor. Runtime schema validation still missing.
- [x] **M3 — Handoff options.** Verified capability map with per-entry checked dates, plus
      the **Other** option: clipboard payload and `openUrl` links for no-prefill providers.
      Markdown payload and `.md` download still missing.
- [x] **M4 — HTTP API.** `Bun.serve` server implementing `/api/handoff` and `/api/health`.
- [x] **M5 — Web UI.** Paste box, summary, per-provider buttons, and the Other / Copy &
      paste panel with copy confirmation and a textarea fallback.
- [ ] **M6 — Multi-provider.** Perplexity, Grok, Google AI Mode as scrape *sources*
      (they already work as deeplink *targets*). Per-provider fixtures.
- [ ] **M7 — Local-only mode.** Paste transcript, no fetching, nothing leaves the
      machine beyond the model call.
- [ ] **M8 — Compression.** Fit longer briefs into short URLs; drop `preparedPrompt`
      below truncation risk.
- [ ] **M9 — Cache + optional sharing.** Public packet pages, deletion controls, TTL.
- [ ] **M10 — Quality.** Continuation evals — does the next model actually continue
      correctly? Measure it, don't assume it.

## Sources and verification

The capability map above was checked on **2026-10-17**. These links are the evidence;
they are point-in-time and providers change them without notice, so treat re-verification
as routine maintenance rather than a one-off task.

**Prefill parameters**

- Anthropic Help Center — [Open Claude Desktop with a link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)
  (updated 2026-06-30). `claude://claude.ai/new?q=`, prefill "so you can review and send
  it", ~14,000-character truncation, URL-encoding required, link-supplied folders always
  confirmed as untrusted.
- Claude Code docs — [Launch sessions from links](https://code.claude.com/docs/en/deep-links).
  `claude-cli://open?q=`, 5,000-character maximum, and the explicit guarantee that a deep
  link "never executes anything on its own".
- OpenAI community — [Query parameters in chatgpt](https://community.openai.com/t/query-parameters-in-chatgpt/1027747)
  (Nov 2024 → Jan 2026). `?q=`, `?prompt=`, `&hints=search`, `&temporary-chat=true`.
- Hacker News — [Gemini team, please add URL query parameter support (?q= or ?prompt=)](https://news.ycombinator.com/item?id=46761567).
  The Gemini app does not support prefill, which is why extensions and AI Mode are the
  workarounds.
- Reddit r/aicuriosity — [Google AI Studio Update: Prefill Prompts via URL](https://www.reddit.com/r/aicuriosity/comments/1oodi10/google_ai_studio_update_prefill_prompts_via_url/)
  (reported `?prompt=`; still marked unverified here).
- Scrapfly — [How to Scrape Perplexity AI in 2026](https://scrapfly.io/blog/posts/how-to-scrape-perplexity).
  `perplexity.ai/search?q=`.
- Rich Dev Tools — [I Shipped Five Prefilled AI Links, Then Read the Reprompt Write-Up](https://richdevtools.com/articles/ai/prefilled-prompt-links-injection)
  (2026-09-11). The reference implementation of these five links, the
  prefill-and-wait vs auto-submit table, encode-once guidance, length caps and
  `rel="nofollow noopener"`.

**Broken or changed behavior**

- Microsoft Learn Q&A — [Copilot Web App: ?q= parameter no longer populates chat input (regression)](https://learn.microsoft.com/en-us/answers/questions/5612477/copilot-web-app-q-parameter-no-longer-populates-ch)
  (reported Nov 2025, still open Feb/Mar 2026).

**Security**

- Microsoft Security Blog — [Manipulating AI memory for profit: The rise of AI Recommendation Poisoning](https://www.microsoft.com/en-us/security/blog/2026/02/10/ai-recommendation-poisoning/)
  (2026-02-10). 50 prompts from 31 companies over 60 days, the per-provider parameter
  list, MITRE ATLAS `AML.T0080` / `AML.T0051`, and the memory-keyword hunting heuristic
  this project reuses as a link-generation guard.
- Varonis Threat Labs — the **Reprompt** attack on Copilot Personal: disclosed August
  2025, mitigations in the January 2026 Patch Tuesday. Summarized in the Rich Dev Tools
  write-up above.

> **Rule of thumb for this file:** any row in the capability map without a recent
> verification date should be treated as a rumour, and any prompt reaching a provider
> should be something the user could already read on the page they came from.

## FAQ

**Isn't this just "copy the conversation"?**
Copying gives the next model raw noise and blows the context budget. The packet is
dense, structured, and tuned for continuation — and it arrives with one click.

**What if the provider has no deeplink support?**
It gets the **Other / Copy & paste** option: the brief goes on the clipboard, an `Open`
link takes you to the app, and you paste it as the first message. That covers 100% of
providers — including desktop apps with no URL bar and local models. Deeplinks are an
accelerator, not a dependency.

**Why not just put the prompt in the URL for those apps too?**
Because a link that sometimes carries a prompt is worse than no link at all. An app that
ignores query strings today may half-honour them tomorrow, and the user has no way to tell
whether the message they're about to send is the one they wrote. `Open` links for
no-prefill providers carry nothing; the prompt always travels via the clipboard, where the
user can see it.

**Does it log into my account?**
No. Public share links only. No cookies, no credentials, no private threads.

**Which model writes the summary?**
Whatever Ollama-compatible endpoint you point it at. The default in the smoke test is
`gemma4` and is expected to change.

**Can I self-host?**
Yes — it's MIT, Bun-only, and the only external dependency is an Ollama-compatible chat
endpoint.

**Is my shared link stored?**
Not in the current scaffold; nothing is implemented yet. When caching lands, it will be
opt-in with a TTL and a delete endpoint.

**Aren't prefill links the thing attackers abuse? Why build more of them?**
Yes — that is precisely why the design is constrained. AIWithFlow only emits
prefill-and-wait links, refuses to generate prompts containing memory-write phrasing,
shows the prompt before it is sent, and never interpolates request data into the
template. The same feature exists in two flavours, and the difference between them is a
security boundary rather than a detail. See
[Reprompt](#reprompt-a-url-parameter-became-a-command-channel) and
[AI Recommendation Poisoning](#ai-recommendation-poisoning).

## Contributing

- **Adding a provider** = one file in `src/providers/` plus a fixture transcript and a
  test. That is the highest-value contribution right now.
- **Verify a deeplink** = confirm the prefill param still works and update the
  capability map's status. Small PRs, big impact.
- Keep parsers defensive: unknown DOM shapes should degrade to a warning and a partial
  transcript, never a crash.
- Match the existing style — ESM, TypeScript, strict, no build step, tests via `bun test`.

## License

MIT © 2026 Jan. See [LICENSE](./LICENSE).

---

*AIWithFlow does not bypass rate limits, and it does not pretend to. It takes the one
thing a locked-out user still has — a shareable link — and turns it into something
portable, so a conversation is never trapped in an account that can no longer speak.*
