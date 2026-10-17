const form = document.getElementById('form')
const urlInput = document.getElementById('url')
const loading = document.getElementById('loading')
const results = document.getElementById('results')
const summary = document.getElementById('summary')
const links = document.getElementById('links')
const other = document.getElementById('other')
const otherBody = document.getElementById('other-body')
const error = document.getElementById('error')

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = urlInput.value.trim()
  if (!url) return

  loading.hidden = false
  results.hidden = true
  error.hidden = true

  try {
    const res = await fetch('/api/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    render(data)
  } catch (err) {
    error.textContent = err.message
    error.hidden = false
  } finally {
    loading.hidden = true
  }
})

function render(data) {
  summary.textContent = data.summary
  results.hidden = false
  renderLinks(data.options, data.prompt)
  renderOther(data.options, data.prompt)
}

function renderLinks(options, prompt) {
  links.innerHTML = ''
  const deeplinks = options.filter((o) => o.mode === 'deeplink')
  for (const o of deeplinks) {
    const a = document.createElement('a')
    a.className = 'link-btn'
    a.href = o.url
    a.target = '_blank'
    a.rel = 'noopener nofollow'
    a.textContent = `Open in ${o.name}`
    links.appendChild(a)
  }
  if (deeplinks.length === 0) links.innerHTML = '<p class="sub">No deeplinks available for this provider.</p>'
}

function renderOther(options, prompt) {
  otherBody.innerHTML = ''
  const others = options.filter((o) => o.mode === 'other')

  const ta = document.createElement('textarea')
  ta.value = prompt
  ta.readOnly = true
  otherBody.appendChild(ta)

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Copy brief'
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(prompt)
    btn.textContent = 'Copied!'
    setTimeout(() => (btn.textContent = 'Copy brief'), 1500)
  })
  otherBody.appendChild(btn)

  if (others.length > 0) {
    const label = document.createElement('p')
    label.className = 'sub'
    label.style.margin = '10px 0 6px'
    label.textContent = 'Then open the app and paste:'
    otherBody.appendChild(label)

    const openLinks = document.createElement('div')
    openLinks.className = 'open-links'
    for (const o of others) {
      const a = document.createElement('a')
      a.href = o.openUrl
      a.target = '_blank'
      a.rel = 'noopener nofollow'
      a.textContent = `${o.name} ↗`
      openLinks.appendChild(a)
    }
    otherBody.appendChild(openLinks)
  }
}
