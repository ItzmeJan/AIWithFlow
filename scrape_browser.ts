import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

function findBrowserPath(): string {
    const found = CHROME_CANDIDATES.find((p) => p && existsSync(p))
    if (!found) {
        throw new Error('BROWSER_NOT_FOUND: set CHROME_PATH to a Chrome or Edge executable')
    }
    return found
}

export type BrowserMessage = {
    role: 'user' | 'assistant'
    content: string
}

/**
 * Scrape a ChatGPT share page using a real browser.
 *
 * The share page is React Router SSR + client hydration. The rendered DOM has
 * a stable structure that is far easier to read than the RSC reference format:
 * each message is a <div> with data-message-author-role="user"|"assistant",
 * and the text is in nested elements. We wait for hydration, then walk the DOM.
 */
export default async function scrapeChatgptWithBrowser(url: string): Promise<BrowserMessage[]> {
    const browser = await puppeteer.launch({
        executablePath: findBrowserPath(),
        headless: 'new',
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    })

    try {
        const page = await browser.newPage()
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        )
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 })

        // Wait for the conversation to hydrate — the first user message.
        await page.waitForSelector('[data-message-author-role]', { timeout: 15_000 })

        // Give React a beat to finish rendering any lazy content.
        await new Promise((r) => setTimeout(r, 500))

        const messages = await page.evaluate(() => {
            const nodes = Array.from(
                document.querySelectorAll('[data-message-author-role]'),
            )
            return nodes.map((node) => {
                const role = node.getAttribute('data-message-author-role') ?? ''
                // The text content is the deepest readable element; strip the UI chrome.
                const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
                return { role, content: text }
            })
        })

        return messages
            .map((m) => ({
                role: m.role === 'user' || m.role === 'assistant' ? m.role : 'assistant',
                content: m.content,
            }))
            .filter((m) => m.content.length > 0)
    } finally {
        await browser.close()
    }
}
