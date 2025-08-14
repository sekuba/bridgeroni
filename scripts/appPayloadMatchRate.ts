/*
 Quick script to compute match percentage per AppPayload.app across the DB.

 Usage:
  - Set env HYPERINDEX_GRAPHQL to your GraphQL endpoint (e.g. http://localhost:8080/graphql)
  - Run with ts-node or compile with tsc:
      npx ts-node scripts/appPayloadMatchRate.ts
    or
      pnpm tsc -p tsconfig.json && node dist/scripts/appPayloadMatchRate.js
*/

type AppPayload = {
  id: string
  app: string
  matched: boolean
}

type GraphQLResponse<T> = {
  data?: T
  errors?: { message: string }[]
}

const ENDPOINT = process.env.HYPERINDEX_GRAPHQL || 'http://localhost:8080/v1/graphql'
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '1000', 10)

async function fetchWithRoot(rootField: string, offset: number): Promise<AppPayload[]> {
  const query = `
    query ($limit: Int!, $offset: Int!) {
      ${rootField}(limit: $limit, offset: $offset) {
        id
        app
        matched
      }
    }
  `
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { limit: PAGE_SIZE, offset } }),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP error ${res.status}`)
  const json = (await res.json()) as GraphQLResponse<Record<string, AppPayload[]>>
  if (json.errors && json.errors.length) {
    throw new Error(`GraphQL error: ${json.errors.map(e => e.message).join('; ')}`)
  }
  const key = Object.keys(json.data || {})[0]
  return key ? (json.data as any)[key] : []
}

async function resolveRootField(): Promise<string> {
  // Try common variants first
  const candidates = ['appPayloads', 'apppayloads', 'AppPayloads', 'app_payloads', 'appPayload']
  for (const c of candidates) {
    try {
      await fetchWithRoot(c, 0)
      return c
    } catch (_e) {/* ignore and try next */}
  }
  // Fallback to introspection
  const introspection = `query { __schema { queryType { fields { name } } } }`
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: introspection }),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP error ${res.status}`)
  const json = (await res.json()) as GraphQLResponse<{ __schema: { queryType: { fields: { name: string }[] } } }>
  const fields = json.data?.__schema?.queryType?.fields?.map(f => f.name) || []
  const match = fields.find(n => /app.?payloads?/i.test(n))
  if (!match) throw new Error(`Could not determine AppPayload root field. Available: ${fields.join(', ')}`)
  return match
}

async function fetchPage(rootField: string, offset: number): Promise<AppPayload[]> {
  return fetchWithRoot(rootField, offset)
}

async function main() {
  const counts = new Map<string, { total: number; matched: number }>()
  let offset = 0
  let totalFetched = 0
  const rootField = await resolveRootField()
  for (;;) {
    const page = await fetchPage(rootField, offset)
    if (page.length === 0) break
    for (const p of page) {
      const key = p.app || 'UNKNOWN'
      const entry = counts.get(key) || { total: 0, matched: 0 }
      entry.total += 1
      if (p.matched) entry.matched += 1
      counts.set(key, entry)
    }
    totalFetched += page.length
    offset += PAGE_SIZE
    if (page.length < PAGE_SIZE) break
  }

  if (counts.size === 0) {
    console.log('No AppPayloads found.')
    return
  }

  console.log(`Scanned ${totalFetched} AppPayloads`) 
  for (const [app, { total, matched }] of counts.entries()) {
    const pct = total > 0 ? ((matched / total) * 100).toFixed(2) : '0.00'
    console.log(`${app}: ${matched}/${total} matched (${pct}%)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
