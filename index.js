import { Ollama } from 'ollama'

const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
})

const response = await ollama.chat({
  model: 'gemma4',
  messages: [{role: 'user', content: 'Hello!'}],
})

console.log(response.message.content)