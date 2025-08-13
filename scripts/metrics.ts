/*
  Metrics reporter for the indexer DB via Hasura GraphQL
  - Uses Node 18+ global fetch
  - Configure via env:
    HASURA_URL (default http://localhost:8080/v1/graphql)
    HASURA_ADMIN_SECRET (optional)
*/

type Envelope = {
  id: string
  transport: string
  routeSrcSlug?: string | null
  routeDstSlug?: string | null
  matched: boolean
  latency?: string | number | null
}

type Payload = {
  id: string
  app: string
  payloadType: string
  transportingProtocol?: string | null
  matched: boolean
  crosschainMessage?: {
    id: string
    transport: string
    routeSrcSlug?: string | null
    routeDstSlug?: string | null
  } | null
}

type BusIndex = { id: string, ticketStart: string, numPassengers: string, nextInboundOrdinal: string }
type InboundHead = { id: string, nextSeq: string, assignedSeq: string }

const HASURA_URL = process.env.HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET

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
  const json = await res.json()
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`)
  return json.data
}

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

async function main() {
  console.log(`Using Hasura: ${HASURA_URL}`)
  const q = `
    query AllData {
      CrosschainMessage { id transport routeSrcSlug routeDstSlug matched latency }
      AppPayload { id app payloadType transportingProtocol matched crosschainMessage { id transport routeSrcSlug routeDstSlug } }
      BusIndex { id ticketStart numPassengers nextInboundOrdinal }
      InboundBufferHead { id nextSeq assignedSeq }
    }
  `
  const data = await gql<{CrosschainMessage: Envelope[], AppPayload: Payload[], BusIndex: BusIndex[], InboundBufferHead: InboundHead[]}>(q)

  const envelopes = data.CrosschainMessage
  const payloads = data.AppPayload
  const busIndex = data.BusIndex
  const bufferHeads = data.InboundBufferHead

  // Envelope metrics
  const byTransport = new Map<string, Envelope[]>()
  for (const e of envelopes) {
    const arr = byTransport.get(e.transport) || []
    arr.push(e); byTransport.set(e.transport, arr)
  }

  console.log('\n== Envelope Metrics (sorted by % matched) ==')
  const transportSorted = [...byTransport.entries()].map(([transport, arr])=>{
    const matched = arr.filter(e=>e.matched).length
    const rate = arr.length ? matched/arr.length : 0
    return { transport, arr, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const t of transportSorted) {
    const latencies = t.arr.filter(e=>e.matched).map(e=> Number(e.latency ?? 0)).filter(n=>!Number.isNaN(n))
    const st = stats(latencies)
    console.log(`- ${t.transport}: total=${t.arr.length}, matched=${t.matched} (${(t.rate*100).toFixed(2)}%) latency[s]: min=${fmt(st.min)} avg=${fmt(st.avg)} p50=${fmt(st.p50)} p90=${fmt(st.p90)} p99=${fmt(st.p99)} max=${fmt(st.max)}`)
  }

  // Route metrics
  const byRoute = new Map<string, Envelope[]>()
  for (const e of envelopes) {
    const key = `${e.transport}:${e.routeSrcSlug||'unknown'}->${e.routeDstSlug||'unknown'}`
    const arr = byRoute.get(key) || []
    arr.push(e); byRoute.set(key, arr)
  }
  console.log('\n== Route Metrics (by transport and route, sorted by % matched) ==')
  const routeSorted = [...byRoute.entries()].map(([key, arr])=>{
    const matched = arr.filter(e=>e.matched).length
    const rate = arr.length? matched/arr.length : 0
    const st = stats(arr.filter(e=>e.matched).map(e=> Number(e.latency ?? 0)).filter(n=>!Number.isNaN(n)))
    return { key, arr, matched, rate, st }
  }).sort((a,b)=> b.rate - a.rate)
  for (const r of routeSorted) {
    console.log(`- ${r.key}: total=${r.arr.length}, matched=${r.matched} (${(r.rate*100).toFixed(2)}%) lat min=${fmt(r.st.min)} avg=${fmt(r.st.avg)} p50=${fmt(r.st.p50)} p90=${fmt(r.st.p90)} p99=${fmt(r.st.p99)} max=${fmt(r.st.max)}`)
  }

  // Payload metrics
  console.log('\n== Payload Metrics (by transportingProtocol/app/payloadType, sorted by % matched) ==')
  type Key = string
  const payloadGroups = new Map<Key, Payload[]>()
  for (const p of payloads) {
    const key = `${p.transportingProtocol||'unknown'}|${p.app}|${p.payloadType}`
    const arr = payloadGroups.get(key) || []
    arr.push(p); payloadGroups.set(key, arr)
  }
  const payloadSorted = [...payloadGroups.entries()].map(([key, arr])=>{
    const matched = arr.filter(p=>p.matched).length
    const rate = arr.length? matched/arr.length : 0
    const [proto, app, type] = key.split('|')
    return { proto, app, type, arr, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const p of payloadSorted) {
    console.log(`- ${p.proto}/${p.app}/${p.type}: total=${p.arr.length}, matched=${p.matched} (${(p.rate*100).toFixed(2)}%)`)
  }

  // Stargate taxi vs bus details
  const sg = payloads.filter(p=>p.app==='StargateV2' && p.transportingProtocol==='layerzero')
  const taxi = sg.filter(p=>p.payloadType==='transfer')
  const bus = sg.filter(p=>p.payloadType==='busPassenger')
  console.log('\n== Stargate Taxi vs Bus ==')
  const taxiMatched = taxi.filter(p=>p.matched).length
  const busMatched = bus.filter(p=>p.matched).length
  console.log(`- Taxi: total=${taxi.length}, matched=${taxiMatched} (${(taxiMatched/taxi.length*100||0).toFixed(2)}%)`)
  console.log(`- Bus: total=${bus.length}, matched=${busMatched} (${(busMatched/bus.length*100||0).toFixed(2)}%)`)

  // Taxi by route (sorted by matched %)
  console.log('\n== Stargate Taxi by Route (sorted by % matched) ==')
  const taxiByRoute = new Map<string, Payload[]>()
  for (const p of taxi) {
    const r = p.crosschainMessage
    const key = `${r?.routeSrcSlug||'unknown'}->${r?.routeDstSlug||'unknown'}`
    const arr = taxiByRoute.get(key) || []
    arr.push(p); taxiByRoute.set(key, arr)
  }
  const taxiSorted = [...taxiByRoute.entries()].map(([key, arr])=>{
    const matched = arr.filter(x=>x.matched).length
    const rate = arr.length? matched/arr.length : 0
    return { key, total: arr.length, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const r of taxiSorted) {
    console.log(`- ${r.key}: total=${r.total}, matched=${r.matched} (${(r.rate*100).toFixed(2)}%)`)
  }

  // Bus by source chain (parsed from id sg-bus:{srcChainId}:{ticketId})
  console.log('\n== Stargate Bus by Source Chain (linking coverage) ==')
  function parseBusSrc(id:string): string { const m = id.match(/^sg-bus:(\d+):/); return m? m[1] : 'unknown' }
  const busBySrc = new Map<string, Payload[]>()
  for (const p of bus) { const src = parseBusSrc(p.id); const arr = busBySrc.get(src) || []; arr.push(p); busBySrc.set(src, arr) }
  const busSrcSorted = [...busBySrc.entries()].map(([src, arr])=>{
    const linked = arr.filter(p=>!!p.transportingProtocol && !!p.transportingMessageId).length
    const rate = arr.length? linked/arr.length : 0
    const matched = arr.filter(p=>p.matched).length
    return { src, arr, linked, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const s of busSrcSorted) {
    console.log(`- srcChainId=${s.src}: total=${s.arr.length}, linked_to_guid=${s.linked} (${(s.rate*100).toFixed(2)}%) matched=${s.matched}`)
  }

  // Bus: per-route metrics using payload->envelope route
  const busByRoute = new Map<string, Payload[]>()
  for (const p of bus) {
    const r = p.crosschainMessage
    const key = `${r?.routeSrcSlug||'unknown'}->${r?.routeDstSlug||'unknown'}`
    const arr = busByRoute.get(key) || []
    arr.push(p); busByRoute.set(key, arr)
  }
  console.log('\n== Stargate Bus by Route (sorted by % matched) ==')
  const busSorted = [...busByRoute.entries()].map(([key, arr])=>{
    const matched = arr.filter(p=>p.matched).length
    const rate = arr.length? matched/arr.length : 0
    return { key, arr, matched, rate }
  }).sort((a,b)=> b.rate - a.rate)
  for (const r of busSorted) {
    console.log(`- ${r.key}: total=${r.arr.length}, matched=${r.matched} (${(r.rate*100).toFixed(2)}%)`)
  }

  // Bus backlog from buffer heads
  console.log('\n== Bus Buffer Backlog ==')
  for (const h of bufferHeads) {
    const index = busIndex.find(i=>i.id===h.id)
    const backlog = BigInt(h.nextSeq) - BigInt(h.assignedSeq)
    const remaining = index ? (BigInt(index.numPassengers) - BigInt(index.nextInboundOrdinal)) : BigInt(0)
    console.log(`- ${h.id}: backlog=${backlog.toString()} remaining_to_assign=${remaining.toString()}`)
  }

  // Orphan payloads
  const orphans = payloads.filter(p=>!p.crosschainMessage)
  console.log(`\n== Orphan Payloads ==\n- count=${orphans.length}`)
  if (orphans.length) {
    for (const p of orphans.slice(0, 20)) {
      console.log(`  * ${p.id} ${p.app}/${p.payloadType} ${p.transportingProtocol||''}`)
    }
  }

  console.log('\nDone.')
}

main().catch((e)=>{ console.error('Metrics error:', e); process.exit(1) })
