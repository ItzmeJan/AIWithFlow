export type Message = {
    role: 'user' | 'assistant'
    content: string
}

type ClaudeContentBlock = {
    type: string
    text?: string
    citations?: unknown[]
}

type ClaudeMessage = {
    uuid: string
    text: string
    content: ClaudeContentBlock[]
    sender: 'human' | 'assistant'
    index: number
    created_at: string
    updated_at: string
    truncated: boolean
    stop_reason: string | null
}

type ClaudeSnapshot = {
    uuid: string
    conversation_uuid: string
    snapshot_name: string
    created_by: string
    creator: { uuid: string; full_name: string }
    project_uuid: string | null
    chat_messages: ClaudeMessage[]
    up_to_date: boolean
    is_public: boolean
    viewer_can_access_files: boolean
    working_documents: unknown[]
}

import scrapeChatgptWithBrowser, { type BrowserMessage } from './scrape_browser.ts'

export default async function scrape(url: string): Promise<Message[]> {
    if (!url) {
        throw new Error('URL is required for scraping')
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new Error('Invalid URL format')
    }

    const { hostname } = new URL(url)
    if (hostname === 'claude.ai' || hostname.endsWith('.claude.ai')) {
        return claude(url)
    }
    if (hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com')) {
        const messages: BrowserMessage[] = await scrapeChatgptWithBrowser(url)
        return messages.map((m) => ({ role: m.role, content: m.content }))
    }

    throw new Error(`UNSUPPORTED_PROVIDER: ${hostname}`)
}

async function claude(url: string): Promise<Message[]> {
    if (!url) {
        throw new Error('URL is required for scraping')
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new Error('Invalid URL format')
    }

    // Share links look like claude.ai/share/<snapshot-uuid>
    const id = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (!id) {
        throw new Error('INVALID_URL: no snapshot id found in share link')
    }

    const req = await fetch(`https://claude.ai/api/chat_snapshots/${id}?rendering_mode=messages&render_all_tools=true`, {
        "credentials": "include",
        "headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-GPC": "1",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Priority": "u=0, i"
        },
        "method": "GET",
        "mode": "cors"
    })
    if (!req.ok) {
        throw new Error(`FETCH_FAILED: ${req.status}`)
    }

    const res = (await req.json()) as ClaudeSnapshot
    if (!res.is_public) {
        throw new Error('PRIVATE_THREAD: snapshot is not publicly accessible')
    }

    return res.chat_messages
        .filter((m) => m.content.length > 0)
        .map((m) => ({
            role: m.sender === 'human' ? 'user' : 'assistant',
            content: m.content.map((b) => b.text ?? '').join('\n'),
        }))
}

// --- ChatGPT share pages -------------------------------------------------
//
// The share page is React Router SSR. The full conversation arrives as a streamed
// RSC payload inside a <script>:
//
//   window.__reactRouterContext.streamController.enqueue("<json string>");
//
// That JSON is a flat array using a reference scheme:
//   - a non-negative integer is an index into the array
//   - object keys look like "_139"; the real key is arr[139]
//   - a literal (string/number/bool/null) is a final value
//
// The conversation order is in loaderData["routes/share.$shareId.($action)"]
// .linear_conversation, an array of { id, message, parent, children } entries.

const RSC_MARKER = 'window.__reactRouterContext.streamController.enqueue("'

function extractRscPayload(html: string): unknown[] {
    const start = html.indexOf(RSC_MARKER)
    if (start < 0) {
        throw new Error('PARSE_FAILED: RSC payload not found in page')
    }
    const bodyStart = start + RSC_MARKER.length
    const end = html.indexOf('");', bodyStart)
    if (end < 0) {
        throw new Error('PARSE_FAILED: RSC payload not terminated')
    }
    const raw = html.slice(bodyStart, end)
    try {
        const text = JSON.parse(`"${raw}"`) as string
        return JSON.parse(text) as unknown[]
    } catch {
        throw new Error('PARSE_FAILED: could not decode RSC payload')
    }
}

function findRscString(arr: unknown[], s: string): number {
    for (let k = 0; k < arr.length; k++) {
        if (arr[k] === s) return k
    }
    return -1
}

// Resolve an RSC reference to a plain value. `path` tracks the current ancestor
// chain so self-referential slots (e.g. a Statsig gate stored as ["P", 730]
// where arr[730] is that same array) terminate instead of recursing forever.
// Each array element gets its own copy of the path so siblings are independent.
function resolveRsc(arr: unknown[], v: unknown, path = new Set<number>()): unknown {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < arr.length) {
        if (path.has(v)) return undefined
        const t = arr[v]
        if (t !== null && typeof t === 'object') {
            path.add(v)
            const r = resolveRsc(arr, t, new Set(path))
            path.delete(v)
            return r
        }
        return t
    }
    if (Array.isArray(v)) return v.map((x) => resolveRsc(arr, x, new Set(path)))
    if (v !== null && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v)) {
            const m = /^_(\d+)$/.exec(k)
            const key = m ? String(resolveRsc(arr, arr[Number(m[1])])) : k
            out[key] = resolveRsc(arr, val, path)
        }
        return out
    }
    return v
}

async function chatgpt(url: string): Promise<Message[]> {
    if (!url) {
        throw new Error('URL is required for scraping')
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new Error('Invalid URL format')
    }

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } })
    if (!res.ok) {
        throw new Error(`FETCH_FAILED: ${res.status}`)
    }
    const html = await res.text()

    const arr = extractRscPayload(html)
    const lcIdx = findRscString(arr, 'linear_conversation')
    if (lcIdx < 0) {
        throw new Error('PARSE_FAILED: linear_conversation not found')
    }

    const linearConv = resolveRsc(arr, arr[lcIdx + 1]) as Array<{ message?: RscMessage }>

    return linearConv
        .map((entry) => entry?.message)
        .filter((msg): msg is RscMessage => !!msg && !!msg.author && !!msg.content)
        .map((msg) => {
            const role = msg.author.role
            return {
                role: role === 'human' ? 'user' : role === 'assistant' ? 'assistant' : 'system',
                content: (msg.content.parts ?? []).join(''),
            }
        })
        .filter((m) => m.role !== 'system' && m.content.length > 0)
}

type RscMessage = {
    id: string
    author: { role: string }
    content: { type?: string; parts?: string[] }
}
