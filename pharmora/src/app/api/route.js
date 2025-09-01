// Handle GET requests (e.g., fetch('/api'))
export async function GET(request) {
  return new Response(
    JSON.stringify({
      message: 'Hello from Next.js API 🚀',
      time: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

// Handle POST requests (e.g., fetch('/api', { method: 'POST', body: JSON.stringify(...) }))
export async function POST(request) {
  const body = await request.json() // parse JSON body

  return new Response(
    JSON.stringify({
      received: body,
      message: 'POST request success ✅',
      time: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
