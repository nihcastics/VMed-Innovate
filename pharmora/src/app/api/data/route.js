export async function GET(request) {
  return new Response(
    JSON.stringify({ users: ['Alice', 'Bob', 'Charlie'] }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
