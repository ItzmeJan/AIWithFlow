const res = await fetch('http://localhost:3000/api/handoff', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://chatgpt.com/share/6ad32396-5fd4-83ee-9edd-52731f2ea432' }),
})
const data = await res.json()
console.log('status:', res.status)
console.log(JSON.stringify(data, null, 2))
