/*
 Bridge indexer route match report

 Fetches all data from Hasura and prints:
 - CrosschainMessage match rate per protocol per route
 - AppPayload match rate per payload type (bus, taxi, across) per route
 - Latency stats per protocol per route (AppPayloads only)

 Sorting: all lists sorted by decreasing match percentage.

 Config via env:
 - HASURA_URL (default http://localhost:8080/v1/graphql)
 - HASURA_ADMIN_SECRET (optional)
*/

import { mapEidToChainInfo } from "../analyze/const";

type CrosschainMessage = {
  id: string
  transport: string
  matched: boolean
  latency?: string | number | null
  routeSrcSlug?: string | null
  routeDstSlug?: string | null
  routeSrcEid?: string | number | null
  routeDstEid?: string | number | null
}

type AppPayload = {
  id: string
  app: string
  transportingProtocol?: string | null
  matched: boolean
  crosschainMessage?: {
    id: string
    transport: string
    latency?: string | number | null
    routeSrcSlug?: string | null
    routeDstSlug?: string | null
    routeSrcEid?: string | number | null
    routeDstEid?: string | number | null
  } | null
}

type GQLResp<T> = { data?: T; errors?: { message: string }[] }

const HASURA_URL = process.env.HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '2000', 10)

async function gql<T>(query: string, variables?: any): Promise<T> {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(HASURA_ADMIN_SECRET ? { 'x-hasura-admin-secret': HASURA_ADMIN_SECRET } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status} ${res.statusText}`)
  const json = (await res.json()) as GQLResp<T>
  if (json.errors && json.errors.length) throw new Error(json.errors.map(e=>e.message).join('; '))
  return json.data as T
}

async function fetchAllCrosschainMessages(): Promise<CrosschainMessage[]> {
  const q = `
    query ($limit: Int!, $offset: Int!) {
      CrosschainMessage(limit: $limit, offset: $offset) {
        id transport matched latency
        routeSrcSlug routeDstSlug
        routeSrcEid routeDstEid
      }
    }
  `
  const out: CrosschainMessage[] = []
  for (let offset = 0;; offset += PAGE_SIZE) {
    const page = await gql<{ CrosschainMessage: CrosschainMessage[] }>(q, { limit: PAGE_SIZE, offset })
    const arr = page.CrosschainMessage || []
    out.push(...arr)
    if (arr.length < PAGE_SIZE) break
  }
  return out
}

async function fetchAllAppPayloads(): Promise<AppPayload[]> {
  const q = `
    query ($limit: Int!, $offset: Int!) {
      AppPayload(limit: $limit, offset: $offset) {
        id app transportingProtocol matched
        crosschainMessage { id transport latency routeSrcSlug routeDstSlug routeSrcEid routeDstEid }
      }
    }
  `
  const out: AppPayload[] = []
  for (let offset = 0;; offset += PAGE_SIZE) {
    const page = await gql<{ AppPayload: AppPayload[] }>(q, { limit: PAGE_SIZE, offset })
    const arr = page.AppPayload || []
    out.push(...arr)
    if (arr.length < PAGE_SIZE) break
  }
  return out
}

function slugOrFromEid(slug?: string | null, eid?: string | number | null): string | undefined {
  if (slug && slug.trim().length) return slug
  if (eid === undefined || eid === null) return undefined
  const n = typeof eid === 'string' ? Number(eid) : typeof eid === 'bigint' ? Number(eid) : eid
  const info = mapEidToChainInfo(n)
  return info?.slug
}

function routeKey(src?: string | null, dst?: string | null, srcEid?: string | number | null, dstEid?: string | number | null): string {
  const s = slugOrFromEid(src, srcEid) || 'unknown'
  const d = slugOrFromEid(dst, dstEid) || 'unknown'
  return `${s}->${d}`
}

function pct(matched: number, total: number): number { return total ? matched / total : 0 }

function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a,b)=>a-b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const h = idx - lo
  return sorted[lo] * (1 - h) + sorted[hi] * h
}

function stats(values: number[]) {
  const n = values.length
  if (!n) return { count: 0 }
  const sum = values.reduce((a,b)=>a+b, 0)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = sum / n
  const p50 = percentile(values, 0.5)
  const p90 = percentile(values, 0.9)
  const p99 = percentile(values, 0.99)
  return { count: n, min, max, avg, p50, p90, p99 }
}

function fmt(n: number | undefined): string { return n === undefined ? '-' : n.toFixed(2) }

function payloadCategory(app: string): 'bus' | 'taxi' | 'across' | 'other' {
  if (app === 'StargateV2-bus-passenger') return 'bus'
  if (app === 'StargateV2-taxi') return 'taxi'
  if (app === 'Across') return 'across'
  return 'other'
}

async function main() {
  console.log(`Using Hasura: ${HASURA_URL}`)

  const [envelopes, payloads] = await Promise.all([
    fetchAllCrosschainMessages(),
    fetchAllAppPayloads(),
  ])

  // 1) CrosschainMessage per route and per protocol match
  console.log('\n== CrosschainMessage: Match Rate per Protocol per Route (sorted by % matched) ==')
  type CKey = string
  const cmGroups = new Map<CKey, CrosschainMessage[]>()
  for (const e of envelopes) {
    const rk = routeKey(e.routeSrcSlug, e.routeDstSlug, e.routeSrcEid, e.routeDstEid)
    const key = `${e.transport}:${rk}`
    const arr = cmGroups.get(key) || []
    arr.push(e); cmGroups.set(key, arr)
  }
  const cmSorted = [...cmGroups.entries()].map(([key, arr])=>{
    const matched = arr.filter(x=>x.matched).length
    const rate = pct(matched, arr.length)
    return { key, total: arr.length, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const r of cmSorted) {
    console.log(`- ${r.key}: total=${r.total}, matched=${r.matched} (${(r.rate*100).toFixed(2)}%)`)
  }

  // 2) AppPayload per payload (bus vs taxi vs across) and per route match
  console.log('\n== AppPayload: Match Rate per Payload Type per Route (sorted by % matched) ==')
  type PKey = string // e.g., 'bus:ethereum->arbitrum'
  const payloadGroups = new Map<PKey, AppPayload[]>()
  for (const p of payloads) {
    const cat = payloadCategory(p.app)
    if (cat === 'other') continue
    const r = p.crosschainMessage
    const rk = routeKey(r?.routeSrcSlug, r?.routeDstSlug, r?.routeSrcEid, r?.routeDstEid)
    const key = `${cat}:${rk}`
    const arr = payloadGroups.get(key) || []
    arr.push(p); payloadGroups.set(key, arr)
  }
  const plSorted = [...payloadGroups.entries()].map(([key, arr])=>{
    const matched = arr.filter(x=>x.matched).length
    const rate = pct(matched, arr.length)
    return { key, total: arr.length, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const r of plSorted) {
    console.log(`- ${r.key}: total=${r.total}, matched=${r.matched} (${(r.rate*100).toFixed(2)}%)`)
  }

  // 3) Latency per protocol per route (AppPayloads only)
  console.log('\n== AppPayload: Latency per Protocol per Route (sorted by % matched; latencies in seconds) ==')
  type LKey = string // e.g., 'layerzero:ethereum->arbitrum'
  const latGroups = new Map<LKey, { total: number; matched: number; lats: number[] }>()
  for (const p of payloads) {
    const r = p.crosschainMessage
    if (!r) continue
    const proto = r.transport
    const rk = routeKey(r.routeSrcSlug, r.routeDstSlug, r.routeSrcEid, r.routeDstEid)
    const key = `${proto}:${rk}`
    const entry = latGroups.get(key) || { total: 0, matched: 0, lats: [] }
    entry.total += 1
    if (p.matched && r.latency !== undefined && r.latency !== null) {
      entry.matched += 1
      const n = typeof r.latency === 'string' ? Number(r.latency) : (r.latency as number)
      if (!Number.isNaN(n)) entry.lats.push(n)
    }
    latGroups.set(key, entry)
  }
  const latSorted = [...latGroups.entries()].map(([key, v])=>{
    const rate = pct(v.matched, v.total)
    const st = stats(v.lats)
    return { key, total: v.total, matched: v.matched, rate, st }
  }).sort((a,b)=> b.rate - a.rate)
  for (const r of latSorted) {
    console.log(`- ${r.key}: total=${r.total}, matched=${r.matched} (${(r.rate*100).toFixed(2)}%) lat[min=${fmt(r.st.min)} avg=${fmt(r.st.avg)} p50=${fmt(r.st.p50)} p90=${fmt(r.st.p90)} p99=${fmt(r.st.p99)} max=${fmt(r.st.max)}]`)
  }

  console.log('\nDone.')
}

main().catch((e)=>{ console.error('routeMatchReport error:', e); process.exit(1) })

