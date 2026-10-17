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
