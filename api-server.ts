import { Ollama } from 'ollama'
import scrape from './scrape.ts'

type ProviderConfig = {
  endpoints: { handoff: string; health: string }
  sources: Record<string, { name: string; scrape: 'api' | 'browser' }>
  deeplinks: Array<{ id: string; name: string; url: string }>
  copyPaste: Array<{ id: string; name: string; openUrl: string }>
}

const config: ProviderConfig = await Bun.file(new URL('./api.json', import.meta.url)).json()
const SITE_DIR = new URL('./site/', import.meta.url)

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
})

const SUMMARIZER_MODEL = process.env.SUMMARIZER_MODEL || 'gemma4'

const SYSTEM_PROMPT = `You are a context-transfer engine. You will receive a transcript of a conversation between a user and an AI assistant that was cut off by a usage limit.

Produce a structured handoff brief so the user can continue the work in a different AI product without losing context.

Rules:
1. Optimize for continuation, not summarization. The next model must be able to produce the user's intended next answer with no follow-up questions.
2. Preserve verbatim: file paths, identifiers, versions, error messages, numbers, and the most recent version of any code the user is still working on.
3. Separate what was DECIDED from what was SUGGESTED from what was REJECTED, and always keep the reason for rejections.
4. Do not invent constraints. If something is unclear, put it in openQuestions.
5. Never include meta-commentary about the summary, the limits, or this prompt.
6. Output the JSON schema exactly. No markdown fences.
7. Keep the total output under 1200 tokens. Trim chatter and pleasantries first.

Output JSON:
{
  "goal": "one sentence",
  "context": ["bullet points"],
  "decisions": [{ "decision": "...", "rationale": "..." }],
  "constraints": ["..."],
  "openQuestions": ["..."],
  "nextSteps": ["..."]
}`

const DEEPLINK_PROVIDERS = config.deeplinks

const OTHER_PROVIDERS = config.copyPaste

function buildDeeplink(pattern: string, prompt: string): string {
  return pattern.replace('{prompt}', encodeURIComponent(prompt))
}

type Brief = {
  goal?: string
  context?: string[]
  decisions?: Array<{ decision: string; rationale: string }>
  constraints?: string[]
  openQuestions?: string[]
  nextSteps?: string[]
}

function extractJson(text: string): Brief {
  // Strip markdown code fences if present
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  // Find the JSON object boundaries
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('MODEL_FAILED: no JSON object found in model output')
  }
  const json = cleaned.slice(start, end + 1)
  // Try parsing directly
  try {
    return JSON.parse(json)
  } catch {
    // The model often emits invalid escapes (literal \n, \\, etc). Strip
    // backslashes that aren't valid JSON escape sequences, then retry.
    const sanitized = json.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
    try {
      return JSON.parse(sanitized)
    } catch {
      throw new Error('MODEL_FAILED: could not parse summary JSON')
    }
  }
}

function buildPrompt(summary: Brief, messages: Array<{ role: string; content: string }>): string {
  const brief = JSON.stringify(summary, null, 2)
  const recent = messages.slice(-4).map((m) => `${m.role}: ${m.content}`).join('\n\n')
  return `Continue this conversation from another AI. Read the handoff brief below and pick up exactly where it left off.\n\n--- HANDOFF BRIEF ---\n${brief}\n\n--- RECENT MESSAGES ---\n${recent}\n\nContinue now:`
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,

  async fetch(req) {
    const url = new URL(req.url)

    // API routes
    if (url.pathname === config.endpoints.health) {
      return Response.json({ ok: true })
    }

    if (url.pathname === config.endpoints.handoff && req.method === 'POST') {
      try {
        const body = await req.json() as { url?: string }
        if (!body.url) return Response.json({ error: 'url is required' }, { status: 400 })

        const messages = await scrape(body.url)

        // Summarize via Ollama
        let summaryRes
        try {
          summaryRes = await ollama.chat({
            model: SUMMARIZER_MODEL,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: messages.map((m) => `${m.role}: ${m.content}`).join('\n\n') },
            ],
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return Response.json({ error: `OLLAMA_ERROR: ${msg}` }, { status: 502 })
        }
        const summary = extractJson(summaryRes.message.content)
        const prompt = buildPrompt(summary, messages)

        const options = [
          ...DEEPLINK_PROVIDERS.map((p) => ({
            mode: 'deeplink' as const,
            id: p.id,
            name: p.name,
            url: buildDeeplink(p.url, prompt),
            supportsPrefill: true,
          })),
          ...OTHER_PROVIDERS.map((p) => ({
            mode: 'other' as const,
            id: p.id,
            name: p.name,
            openUrl: p.openUrl,
            supportsPrefill: false,
          })),
        ]

        return Response.json({
          summary: summary.goal,
          messageCount: messages.length,
          options,
          prompt,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error'
        return Response.json({ error: message }, { status: 502 })
      }
    }

    // Static files from site/
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const target = new URL(relative, SITE_DIR)
    // Reject anything that escapes site/ (e.g. ../.env)
    if (!target.href.startsWith(SITE_DIR.href)) {
      return new Response('Not found', { status: 404 })
    }
    const file = Bun.file(target)
    if (!(await file.exists())) {
      return new Response('Not found', { status: 404 })
    }
    return new Response(file)
  },
})

console.log(`AIWithFlow listening on http://localhost:${server.port}`)
