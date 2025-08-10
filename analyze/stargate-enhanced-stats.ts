import { mapEidToChainInfo, mapChainIdToChainInfo, ChainInfo } from './const.js';

const HASURA_URL = 'http://localhost:8080/v1/graphql';
const ZERO_GUID = '0x0000000000000000000000000000000000000000000000000000000000000000';

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface EventCount {
  [key: string]: number;
}

interface StargateOFTSent {
  guid: string;
  chainId: string;
  dstEid: string;
  amountSentLD: string;
  amountReceivedLD: string;
  fromAddress: string;
  txHash: string;
}

interface StargateOFTReceived {
  guid: string;
  chainId: string;
  srcEid: string;
  amountReceivedLD: string;
  toAddress: string;
  txHash: string;
}

interface AppPayload {
  id: string;
  appName: string;
  matched: boolean;
  amountOutbound?: string;
  amountInbound?: string;
  sender?: string;
  recipient?: string;
  transportingMsgId: string;
  idMatching: string;
  crosschainMessage?: {
    latency?: string;
    matched: boolean;
  };
}

interface BusDriven {
  guid: string;
  dstEid: string;
  startTicketId: string;
  numPassengers: string;
  chainId: string;
  txHash: string;
}

interface BusRode {
  dstEid: string;
  ticketId: string;
  fare: string;
  chainId: string;
}

interface CrosschainMessage {
  id: string;
  chainIdOutbound: string;
  chainIdInbound: string;
  fromOutbound?: string;
  toInbound?: string;
  matched: boolean;
  latency?: string;
}

async function runQuery<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const response = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: GraphQLResponse<T> = await response.json();
  
  if (result.errors) {
    console.error('GraphQL errors:', result.errors);
    throw new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
  }

  if (!result.data) {
    console.error('GraphQL query failed. Response:', result);
    throw new Error("No 'data' in GraphQL response. Check if the table exists or query is valid.");
  }

  return result.data;
}

function safeParseInt(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Handle the "null" string case
    if (value === 'null' || value === 'undefined' || value === '') return null;
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function getChainDisplayName(chainId: number | string | null | undefined, eid?: number | string | null | undefined): string {
  const numericChainId = safeParseInt(chainId);
  const numericEid = safeParseInt(eid);
  
  // Handle null/invalid chain IDs
  if (numericChainId === null && numericEid === null) {
    return 'Unknown Chain';
  }
  
  // First try to get by chainId
  let chainInfo: ChainInfo | undefined;
  if (numericChainId !== null) {
    chainInfo = mapChainIdToChainInfo(numericChainId);
  }
  
  // If not found by chainId and we have EID, try by EID
  if (!chainInfo && numericEid !== null) {
    chainInfo = mapEidToChainInfo(numericEid);
  }
  
  if (chainInfo) {
    return `${chainInfo.name} (${chainInfo.chainId || 'EID:' + chainInfo.eid})`;
  }
  
  // Fallback to raw values
  if (numericChainId !== null) {
    return `Chain ${numericChainId}${numericEid ? ` / EID ${numericEid}` : ''}`;
  } else if (numericEid !== null) {
    return `EID ${numericEid}`;
  } else {
    return 'Unknown Chain';
  }
}

function calculateStats(values: number[]): { mean: number; median: number; min: number; max: number; stdDev?: number } {
  if (values.length === 0) return { mean: 0, median: 0, min: 0, max: 0 };
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const median = sorted.length % 2 === 0 
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  let stdDev: number | undefined;
  if (values.length > 1) {
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (values.length - 1);
    stdDev = Math.sqrt(variance);
  }
  
  return { mean, median, min, max, stdDev };
}

async function main(): Promise<void> {
  console.log('=== ENHANCED STARGATE V2 STATISTICS ===\n');

  // 1. Raw event counts for all Stargate and LayerZero events
  const eventTypes = [
    'StargatePool_OFTSent',
    'StargatePool_OFTReceived', 
    'TokenMessaging_BusRode',
    'TokenMessaging_BusDriven',
    'EndpointV2_PacketSent',
    'EndpointV2_PacketDelivered'
  ];

  console.log('Raw event counts:');
  const eventCounts: EventCount = {};
  
  for (const eventType of eventTypes) {
    const query = `query { ${eventType} { id } }`;
    try {
      const result = await runQuery(query);
      const count = result[eventType]?.length || 0;
      eventCounts[eventType] = count;
      console.log(`  ${eventType}: ${count}`);
    } catch (error) {
      console.log(`  ${eventType}: Error - ${error}`);
      eventCounts[eventType] = 0;
    }
  }

  // 2. Taxi vs Bus mode analysis - analyze OFTSent events by GUID pattern
  console.log('\n=== TAXI vs BUS MODE ANALYSIS ===');
  let oftSentEventsGlobal: StargateOFTSent[] = [];

  const oftSentQuery = `
    query {
      StargatePool_OFTSent {
        guid
        chainId
        dstEid
        amountSentLD
        amountReceivedLD
        fromAddress
        txHash
      }
    }
  `;

  try {
    const result = await runQuery<{ StargatePool_OFTSent: StargateOFTSent[] }>(oftSentQuery);
    const oftSentEvents = result.StargatePool_OFTSent;

    const taxiEvents = oftSentEvents.filter(e => e.guid !== ZERO_GUID);
    const busEvents = oftSentEvents.filter(e => e.guid === ZERO_GUID);

    console.log('OFTSent Events:');
    console.log(`  Taxi mode (non-zero GUID): ${taxiEvents.length}`);
    console.log(`  Bus mode (zero GUID): ${busEvents.length}`);
    console.log(`  Total: ${oftSentEvents.length}`);
    console.log(`  Taxi percentage: ${(taxiEvents.length / oftSentEvents.length * 100).toFixed(1)}%`);
    console.log(`  Bus percentage: ${(busEvents.length / oftSentEvents.length * 100).toFixed(1)}%`);

    // Volume analysis
    if (taxiEvents.length > 0) {
      const taxiVolumes = taxiEvents
        .map(e => safeParseInt(e.amountSentLD))
        .filter((v): v is number => v !== null);
      
      if (taxiVolumes.length > 0) {
        const taxiStats = calculateStats(taxiVolumes);
        console.log('\nTaxi Volume Stats:');
        console.log(`  Total volume: ${taxiVolumes.reduce((a, b) => a + b, 0)}`);
        console.log(`  Average: ${taxiStats.mean.toFixed(2)}`);
        console.log(`  Median: ${taxiStats.median.toFixed(2)}`);
      }
    }

    if (busEvents.length > 0) {
      const busVolumes = busEvents
        .map(e => safeParseInt(e.amountSentLD))
        .filter((v): v is number => v !== null);
      
      if (busVolumes.length > 0) {
        const busStats = calculateStats(busVolumes);
        console.log('\nBus Volume Stats:');
        console.log(`  Total volume: ${busVolumes.reduce((a, b) => a + b, 0)}`);
        console.log(`  Average: ${busStats.mean.toFixed(2)}`);
        console.log(`  Median: ${busStats.median.toFixed(2)}`);
      }
    }

    // Store for routing analysis
    oftSentEventsGlobal = oftSentEvents;
  } catch (error) {
    console.log(`Taxi vs Bus analysis error: ${error}`);
  }

  // 3. AppPayload analysis by mode
  console.log('\n=== APPPAYLOAD ANALYSIS ===');

  const appPayloadQuery = `
    query {
      AppPayload {
        id
        appName
        matched
        amountOutbound
        amountInbound
        sender
        recipient
        transportingMsgId
        idMatching
      }
    }
  `;

  try {
    const result = await runQuery<{ AppPayload: AppPayload[] }>(appPayloadQuery);
    const appPayloads = result.AppPayload;

    const taxiPayloads = appPayloads.filter(p => p.appName === 'StargateV2-taxi');
    const busPayloads = appPayloads.filter(p => p.appName === 'StargateV2-bus');
    const legacyPayloads = appPayloads.filter(p => p.appName === 'StargateV2');

    console.log('AppPayload counts:');
    console.log(`  Taxi mode: ${taxiPayloads.length}`);
    console.log(`  Bus mode: ${busPayloads.length}`);
    console.log(`  Legacy (pre-enhancement): ${legacyPayloads.length}`);
    console.log(`  Total Stargate: ${taxiPayloads.length + busPayloads.length + legacyPayloads.length}`);

    // Matching analysis
    const taxiMatched = taxiPayloads.filter(p => p.matched).length;
    const busMatched = busPayloads.filter(p => p.matched).length;
    const legacyMatched = legacyPayloads.filter(p => p.matched).length;

    console.log('\nMatching status:');
    console.log(`  Taxi matched: ${taxiMatched}/${taxiPayloads.length} (${(taxiMatched / Math.max(taxiPayloads.length, 1) * 100).toFixed(1)}%)`);
    console.log(`  Bus matched: ${busMatched}/${busPayloads.length} (${(busMatched / Math.max(busPayloads.length, 1) * 100).toFixed(1)}%)`);
    console.log(`  Legacy matched: ${legacyMatched}/${legacyPayloads.length} (${(legacyMatched / Math.max(legacyPayloads.length, 1) * 100).toFixed(1)}%)`);

    // Unmatched analysis
    const taxiUnmatched = taxiPayloads.length - taxiMatched;
    const busUnmatched = busPayloads.length - busMatched;
    const legacyUnmatched = legacyPayloads.length - legacyMatched;
    const totalUnmatched = taxiUnmatched + busUnmatched + legacyUnmatched;

    console.log('\nUnmatched events:');
    console.log(`  Taxi unmatched: ${taxiUnmatched}`);
    console.log(`  Bus unmatched: ${busUnmatched}`);
    console.log(`  Legacy unmatched: ${legacyUnmatched}`);
    console.log(`  Total unmatched: ${totalUnmatched}`);

  } catch (error) {
    console.log(`AppPayload analysis error: ${error}`);
  }

  // 4. Bus passenger and batch analysis
  console.log('\n=== BUS BATCH ANALYSIS ===');

  const busDrivenQuery = `
    query {
      TokenMessaging_BusDriven {
        guid
        dstEid
        startTicketId
        numPassengers
        chainId
        txHash
      }
    }
  `;

  try {
    const result = await runQuery<{ TokenMessaging_BusDriven: BusDriven[] }>(busDrivenQuery);
    const busDrivenEvents = result.TokenMessaging_BusDriven;

    console.log(`Bus batches (BusDriven events): ${busDrivenEvents.length}`);

    if (busDrivenEvents.length > 0) {
      const passengerCounts = busDrivenEvents
        .map(e => safeParseInt(e.numPassengers))
        .filter((v): v is number => v !== null);
      const totalPassengers = passengerCounts.reduce((a, b) => a + b, 0);
      const passengerStats = calculateStats(passengerCounts);

      console.log(`Total bus passengers: ${totalPassengers}`);
      console.log(`Average passengers per batch: ${passengerStats.mean.toFixed(2)}`);
      console.log(`Median passengers per batch: ${passengerStats.median.toFixed(2)}`);
      console.log(`Min passengers per batch: ${passengerStats.min}`);
      console.log(`Max passengers per batch: ${passengerStats.max}`);

      // Batch size distribution
      const batchSizes: Record<number, number> = {};
      for (const count of passengerCounts) {
        batchSizes[count] = (batchSizes[count] || 0) + 1;
      }

      console.log('\nBatch size distribution:');
      Object.entries(batchSizes)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .forEach(([size, freq]) => {
          console.log(`  ${size} passengers: ${freq} batches`);
        });

      // Store for later comparison  
      var totalBusPassengers = totalPassengers;
    } else {
      var totalBusPassengers = 0;
    }

    // BusRode events analysis
    const busRodeQuery = `
      query {
        TokenMessaging_BusRode {
          dstEid
          ticketId
          fare
          chainId
        }
      }
    `;

    const busRodeResult = await runQuery<{ TokenMessaging_BusRode: BusRode[] }>(busRodeQuery);
    const busRodeEvents = busRodeResult.TokenMessaging_BusRode;
    console.log(`\nBus rides (BusRode events): ${busRodeEvents.length}`);

    // Compare BusRode vs total bus passengers from BusDriven
    if (busDrivenEvents.length > 0 && totalBusPassengers !== undefined) {
      console.log(`BusRode to BusDriven passenger ratio: ${busRodeEvents.length}/${totalBusPassengers} = ${(busRodeEvents.length / Math.max(totalBusPassengers, 1)).toFixed(2)}`);
    }

  } catch (error) {
    console.log(`Bus batch analysis error: ${error}`);
  }

  // 5. CrosschainMessage analysis for LayerZero protocol
  console.log('\n=== CROSSCHAIN MESSAGE ANALYSIS ===');

  const crosschainQuery = `
    query {
      CrosschainMessage(where: {protocol: {_eq: "layerzero"}}) {
        id
        chainIdOutbound
        chainIdInbound
        fromOutbound
        toInbound
        matched
        latency
      }
    }
  `;

  try {
    const result = await runQuery<{ CrosschainMessage: CrosschainMessage[] }>(crosschainQuery);
    const layerzeroMsgs = result.CrosschainMessage;
    const matchedMsgs = layerzeroMsgs.filter(msg => msg.matched);

    console.log(`LayerZero CrosschainMessages: ${layerzeroMsgs.length}`);
    console.log(`Matched LayerZero CrosschainMessages: ${matchedMsgs.length}`);
    console.log(`Match rate: ${(matchedMsgs.length / Math.max(layerzeroMsgs.length, 1) * 100).toFixed(1)}%`);

    console.log(`\nCrosschainMessage breakdown:`);
    console.log(`  Total LayerZero messages: ${layerzeroMsgs.length}`);

    // Most unmatched destinations/sources analysis
    console.log('\n=== MOST UNMATCHED DESTINATIONS/SOURCES ===');
    
    const unmatchedMsgs = layerzeroMsgs.filter(msg => !msg.matched);
    const unmatchedByOutbound: Record<string, number> = {};
    const unmatchedByInbound: Record<string, number> = {};
    const unmatchedByRoute: Record<string, number> = {};

    for (const msg of unmatchedMsgs) {
      const outboundChain = getChainDisplayName(msg.chainIdOutbound);
      const inboundChain = getChainDisplayName(msg.chainIdInbound);
      const route = `${outboundChain} → ${inboundChain}`;
      
      unmatchedByOutbound[outboundChain] = (unmatchedByOutbound[outboundChain] || 0) + 1;
      unmatchedByInbound[inboundChain] = (unmatchedByInbound[inboundChain] || 0) + 1;
      unmatchedByRoute[route] = (unmatchedByRoute[route] || 0) + 1;
    }

    console.log('\nTop unmatched source chains:');
    Object.entries(unmatchedByOutbound)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([chain, count]) => {
        console.log(`  ${chain}: ${count} unmatched`);
      });

    console.log('\nTop unmatched destination chains:');
    Object.entries(unmatchedByInbound)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([chain, count]) => {
        console.log(`  ${chain}: ${count} unmatched`);
      });

    console.log('\nTop unmatched routes:');
    Object.entries(unmatchedByRoute)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([route, count]) => {
        console.log(`  ${route}: ${count} unmatched`);
      });

  } catch (error) {
    console.log(`CrosschainMessage analysis error: ${error}`);
  }

  // 6. Latency analysis - comparing taxi vs bus if possible
  console.log('\n=== LATENCY ANALYSIS ===');

  try {
    // Get AppPayloads with their crosschain message latencies
    const latencyQuery = `
      query {
        AppPayload {
          appName
          matched
          transportingMsgId
          crosschainMessage {
            latency
            matched
          }
        }
      }
    `;

    const result = await runQuery<{ AppPayload: AppPayload[] }>(latencyQuery);
    const appPayloadsWithLatency = result.AppPayload;

    const taxiLatencies: number[] = [];
    const busLatencies: number[] = [];

    for (const payload of appPayloadsWithLatency) {
      if (payload.matched && payload.crosschainMessage?.latency) {
        const latency = safeParseInt(payload.crosschainMessage.latency);
        if (latency !== null) {
          if (payload.appName === 'StargateV2-taxi') {
            taxiLatencies.push(latency);
          } else if (payload.appName === 'StargateV2-bus') {
            busLatencies.push(latency);
          }
        }
      }
    }

    console.log('Latency data available:');
    console.log(`  Taxi mode: ${taxiLatencies.length} samples`);
    console.log(`  Bus mode: ${busLatencies.length} samples`);

    if (taxiLatencies.length > 0) {
      const taxiStats = calculateStats(taxiLatencies);
      console.log('\nTaxi mode latency (seconds):');
      console.log(`  Average: ${taxiStats.mean.toFixed(2)}`);
      console.log(`  Median: ${taxiStats.median.toFixed(2)}`);
      console.log(`  Min: ${taxiStats.min}`);
      console.log(`  Max: ${taxiStats.max}`);
      if (taxiStats.stdDev !== undefined) {
        console.log(`  Std Dev: ${taxiStats.stdDev.toFixed(2)}`);
      }
    }

    if (busLatencies.length > 0) {
      const busStats = calculateStats(busLatencies);
      console.log('\nBus mode latency (seconds):');
      console.log(`  Average: ${busStats.mean.toFixed(2)}`);
      console.log(`  Median: ${busStats.median.toFixed(2)}`);
      console.log(`  Min: ${busStats.min}`);
      console.log(`  Max: ${busStats.max}`);
      if (busStats.stdDev !== undefined) {
        console.log(`  Std Dev: ${busStats.stdDev.toFixed(2)}`);
      }
    }

    if (taxiLatencies.length > 0 && busLatencies.length > 0) {
      const taxiStats = calculateStats(taxiLatencies);
      const busStats = calculateStats(busLatencies);
      
      console.log('\nLatency comparison:');
      console.log(`  Taxi average: ${taxiStats.mean.toFixed(2)}s`);
      console.log(`  Bus average: ${busStats.mean.toFixed(2)}s`);
      console.log(`  Difference: ${Math.abs(taxiStats.mean - busStats.mean).toFixed(2)}s`);
      console.log(`  Bus is ${busStats.mean < taxiStats.mean ? 'faster' : 'slower'} than taxi`);
    }

  } catch (error) {
    console.log(`Latency analysis error: ${error}`);
  }

  // 7. Raw OFT Events Route Analysis
  console.log('\n=== RAW STARGATE EVENT ANALYSIS ===');
  
  try {
    // Get all OFTReceived events to analyze inbound routes
    const oftReceivedQuery = `
      query {
        StargatePool_OFTReceived {
          guid
          chainId
          srcEid
          amountReceivedLD
          toAddress
          txHash
        }
      }
    `;
    
    const oftReceivedResult = await runQuery<{ StargatePool_OFTReceived: StargateOFTReceived[] }>(oftReceivedQuery);
    const oftReceivedEvents = oftReceivedResult.StargatePool_OFTReceived;
    
    // Combine outbound and inbound route analysis
    console.log('=== OUTBOUND ROUTES (OFTSent) ===');
    const outboundRoutes: Record<string, { count: number; volume: number; taxi: number; bus: number; chains: string[] }> = {};
    const outboundChains: Record<string, { count: number; volume: number; destinations: Set<string> }> = {};
    
    for (const event of oftSentEventsGlobal) {
      const srcChain = getChainDisplayName(event.chainId);
      const dstChain = getChainDisplayName(null, event.dstEid);
      const route = `${srcChain} → ${dstChain}`;
      
      // Route analysis
      if (!outboundRoutes[route]) {
        outboundRoutes[route] = { count: 0, volume: 0, taxi: 0, bus: 0, chains: [srcChain, dstChain] };
      }
      outboundRoutes[route].count += 1;
      
      const amount = safeParseInt(event.amountSentLD);
      if (amount !== null) {
        outboundRoutes[route].volume += amount;
      }
      
      if (event.guid === ZERO_GUID) {
        outboundRoutes[route].bus += 1;
      } else {
        outboundRoutes[route].taxi += 1;
      }
      
      // Source chain analysis
      if (!outboundChains[srcChain]) {
        outboundChains[srcChain] = { count: 0, volume: 0, destinations: new Set() };
      }
      outboundChains[srcChain].count += 1;
      outboundChains[srcChain].destinations.add(dstChain);
      if (amount !== null) {
        outboundChains[srcChain].volume += amount;
      }
    }
    
    console.log('Top outbound routes by transaction count:');
    Object.entries(outboundRoutes)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 15)
      .forEach(([route, stats], index) => {
        console.log(`  ${index + 1}. ${route}: ${stats.count} txs (taxi: ${stats.taxi}, bus: ${stats.bus}) | volume: ${stats.volume.toLocaleString()}`);
      });
    
    console.log('\nTop source chains by transaction count:');
    Object.entries(outboundChains)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 10)
      .forEach(([chain, stats], index) => {
        console.log(`  ${index + 1}. ${chain}: ${stats.count} txs to ${stats.destinations.size} destinations | volume: ${stats.volume.toLocaleString()}`);
      });
    
    console.log('\n=== INBOUND ROUTES (OFTReceived) ===');
    const inboundRoutes: Record<string, { count: number; volume: number; chains: string[] }> = {};
    const inboundChains: Record<string, { count: number; volume: number; sources: Set<string> }> = {};
    
    for (const event of oftReceivedEvents) {
      const srcChain = getChainDisplayName(null, event.srcEid);
      const dstChain = getChainDisplayName(event.chainId);
      const route = `${srcChain} → ${dstChain}`;
      
      // Route analysis
      if (!inboundRoutes[route]) {
        inboundRoutes[route] = { count: 0, volume: 0, chains: [srcChain, dstChain] };
      }
      inboundRoutes[route].count += 1;
      
      const amount = safeParseInt(event.amountReceivedLD);
      if (amount !== null) {
        inboundRoutes[route].volume += amount;
      }
      
      // Destination chain analysis
      if (!inboundChains[dstChain]) {
        inboundChains[dstChain] = { count: 0, volume: 0, sources: new Set() };
      }
      inboundChains[dstChain].count += 1;
      inboundChains[dstChain].sources.add(srcChain);
      if (amount !== null) {
        inboundChains[dstChain].volume += amount;
      }
    }
    
    console.log('Top inbound routes by transaction count:');
    Object.entries(inboundRoutes)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 15)
      .forEach(([route, stats], index) => {
        console.log(`  ${index + 1}. ${route}: ${stats.count} txs | volume: ${stats.volume.toLocaleString()}`);
      });
    
    console.log('\nTop destination chains by transaction count:');
    Object.entries(inboundChains)
      .sort(([,a], [,b]) => b.count - a.count)
      .slice(0, 10)
      .forEach(([chain, stats], index) => {
        console.log(`  ${index + 1}. ${chain}: ${stats.count} txs from ${stats.sources.size} sources | volume: ${stats.volume.toLocaleString()}`);
      });
    
    // Route consistency analysis
    console.log('\n=== ROUTE CONSISTENCY ANALYSIS ===');
    const routeConsistency: Record<string, { outbound: number; inbound: number; difference: number }> = {};
    
    // Compare outbound vs inbound for each route
    const allRoutes = new Set([...Object.keys(outboundRoutes), ...Object.keys(inboundRoutes)]);
    
    for (const route of allRoutes) {
      const outbound = outboundRoutes[route]?.count || 0;
      const inbound = inboundRoutes[route]?.count || 0;
      routeConsistency[route] = {
        outbound,
        inbound,
        difference: Math.abs(outbound - inbound)
      };
    }
    
    console.log('Routes with largest outbound/inbound discrepancies:');
    Object.entries(routeConsistency)
      .sort(([,a], [,b]) => b.difference - a.difference)
      .slice(0, 10)
      .forEach(([route, stats], index) => {
        const total = stats.outbound + stats.inbound;
        if (total > 50) { // Only show routes with significant traffic
          const discrepancyPercent = total > 0 ? (stats.difference / total * 100).toFixed(1) : '0.0';
          console.log(`  ${index + 1}. ${route}: ${stats.outbound} out, ${stats.inbound} in (${stats.difference} diff, ${discrepancyPercent}%)`);
        }
      });
    
  } catch (error) {
    console.log(`Raw Stargate event analysis error: ${error}`);
  }

  // 8. EID routing analysis with pretty names (existing analysis)
  console.log('\n=== ROUTING ANALYSIS (MATCHED ONLY) ===');

  try {
    if (oftSentEventsGlobal) {
      const eidCombos: Record<string, { count: number; volume: number; taxi: number; bus: number }> = {};

      for (const event of oftSentEventsGlobal) {
        const srcChain = getChainDisplayName(event.chainId);
        const dstChain = getChainDisplayName(null, event.dstEid); // Use EID for destination
        const key = `${srcChain} → ${dstChain}`;

        if (!eidCombos[key]) {
          eidCombos[key] = { count: 0, volume: 0, taxi: 0, bus: 0 };
        }

        eidCombos[key].count += 1;
        const amountSent = safeParseInt(event.amountSentLD);
        if (amountSent !== null) {
          eidCombos[key].volume += amountSent;
        }

        if (event.guid === ZERO_GUID) {
          eidCombos[key].bus += 1;
        } else {
          eidCombos[key].taxi += 1;
        }
      }

      console.log('Top routes by transaction count:');
      Object.entries(eidCombos)
        .sort(([,a], [,b]) => b.count - a.count)
        .slice(0, 10)
        .forEach(([combo, stats]) => {
          console.log(`  ${combo}: ${stats.count} txs (taxi: ${stats.taxi}, bus: ${stats.bus}) | volume: ${stats.volume}`);
        });
    }

  } catch (error) {
    console.log(`Routing analysis error: ${error}`);
  }

  console.log('\n=== SUMMARY ===');
  const totalEvents = Object.values(eventCounts).reduce((a, b) => a + b, 0);
  console.log(`Total events indexed: ${totalEvents}`);
  console.log(`Stargate events: ${(eventCounts['StargatePool_OFTSent'] || 0) + (eventCounts['StargatePool_OFTReceived'] || 0)}`);
  console.log(`Bus events: ${(eventCounts['TokenMessaging_BusRode'] || 0) + (eventCounts['TokenMessaging_BusDriven'] || 0)}`);
  console.log(`LayerZero events: ${(eventCounts['EndpointV2_PacketSent'] || 0) + (eventCounts['EndpointV2_PacketDelivered'] || 0)}`);
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}