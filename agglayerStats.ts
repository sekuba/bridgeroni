/**
 * Agglayer Bridge Statistics Script
 * 
 * Analyzes all indexed Agglayer bridge data to provide comprehensive statistics
 * about raw events, matching rates, and network distribution.
 */

const GRAPHQL_URL = 'http://localhost:8080/v1/graphql';

interface AgglayerStats {
  rawEvents: {
    totalBridge: number;
    totalClaim: number;
    byNetwork: Record<string, number>;
    byLeafType: Record<string, number>;
  };
  transfers: {
    total: number;
    matched: number;
    unmatched: number;
    matchRate: number;
    depositCountMatchRate: number;
    byEventType: Record<string, number>;
    byNetwork: {
      source: Record<string, number>;
      destination: Record<string, number>;
    };
  };
  performance: {
    avgLatencySeconds: number;
    fastestTransfer: number;
    slowestTransfer: number;
  };
}

async function executeGraphQLQuery(query: string): Promise<any> {
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      throw new Error('GraphQL query failed');
    }

    return result.data;
  } catch (error) {
    console.error('Failed to execute GraphQL query:', error);
    throw error;
  }
}

function getNetworkName(chainId: string): string {
  switch (chainId) {
    case '1': return 'ethereum';
    case '1101': return 'polygonzkevm';
    default: return `chain${chainId}`;
  }
}

function getLeafTypeName(leafType: string): string {
  switch (leafType) {
    case '0': return 'asset';
    case '1': return 'message';
    default: return `type${leafType}`;
  }
}

async function getAgglayerStatistics(): Promise<AgglayerStats> {
  console.log('🔍 Fetching Agglayer statistics...');

  const query = `
    query {
      bridgeEvents: PolygonZkEVMBridgeV2_BridgeEvent {
        id
        leafType
        chainId
        originNetwork
        destinationNetwork
        amount
      }
      claimEvents: PolygonZkEVMBridgeV2_ClaimEvent {
        id
        chainId
        originNetwork
        amount
      }
      transfers: AgglayerTransfer {
        id
        matched
        depositCountMatches
        eventType
        leafType
        sourceChainId
        destinationChainId
        assetOriginNetwork
        assetDestinationNetwork
        amount
        latencySeconds
      }
    }
  `;

  const data = await executeGraphQLQuery(query);
  
  // Initialize statistics
  const stats: AgglayerStats = {
    rawEvents: {
      totalBridge: data.bridgeEvents.length,
      totalClaim: data.claimEvents.length,
      byNetwork: {},
      byLeafType: {}
    },
    transfers: {
      total: data.transfers.length,
      matched: data.transfers.filter((t: any) => t.matched).length,
      unmatched: data.transfers.filter((t: any) => !t.matched).length,
      matchRate: 0,
      depositCountMatchRate: 0,
      byEventType: {},
      byNetwork: {
        source: {},
        destination: {}
      }
    },
    performance: {
      avgLatencySeconds: 0,
      fastestTransfer: Infinity,
      slowestTransfer: 0
    }
  };

  // Calculate transfer rates
  if (stats.transfers.total > 0) {
    stats.transfers.matchRate = stats.transfers.matched / stats.transfers.total;
    
    if (stats.transfers.matched > 0) {
      const validMatches = data.transfers.filter((t: any) => t.matched && t.depositCountMatches).length;
      stats.transfers.depositCountMatchRate = validMatches / stats.transfers.matched;
    }
  }

  // Process bridge events by network and leaf type
  data.bridgeEvents.forEach((event: any) => {
    const network = getNetworkName(event.chainId);
    const leafType = getLeafTypeName(event.leafType);
    
    stats.rawEvents.byNetwork[network] = (stats.rawEvents.byNetwork[network] || 0) + 1;
    stats.rawEvents.byLeafType[leafType] = (stats.rawEvents.byLeafType[leafType] || 0) + 1;
  });

  // Process transfers by event type and network
  data.transfers.forEach((transfer: any) => {
    // Event type distribution
    stats.transfers.byEventType[transfer.eventType] = (stats.transfers.byEventType[transfer.eventType] || 0) + 1;
    
    // Source network distribution  
    if (transfer.sourceChainId) {
      const sourceNetwork = getNetworkName(transfer.sourceChainId.toString());
      stats.transfers.byNetwork.source[sourceNetwork] = (stats.transfers.byNetwork.source[sourceNetwork] || 0) + 1;
    }
    
    // Destination network distribution
    if (transfer.destinationChainId) {
      const destNetwork = getNetworkName(transfer.destinationChainId.toString());
      stats.transfers.byNetwork.destination[destNetwork] = (stats.transfers.byNetwork.destination[destNetwork] || 0) + 1;
    }
  });

  // Calculate performance metrics for matched transfers
  const matchedWithLatency = data.transfers.filter((t: any) => t.matched && t.latencySeconds !== null);
  if (matchedWithLatency.length > 0) {
    const latencies = matchedWithLatency.map((t: any) => parseInt(t.latencySeconds));
    stats.performance.avgLatencySeconds = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    stats.performance.fastestTransfer = Math.min(...latencies);
    stats.performance.slowestTransfer = Math.max(...latencies);
  } else {
    stats.performance.fastestTransfer = 0;
  }

  return stats;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function displayStatistics(stats: AgglayerStats) {
  console.log('\n🌉 === AGGLAYER BRIDGE STATISTICS ===\n');
  
  // Raw Events
  console.log('📊 RAW EVENTS:');
  console.log(`  Total Bridge Events: ${stats.rawEvents.totalBridge.toLocaleString()}`);
  console.log(`  Total Claim Events:  ${stats.rawEvents.totalClaim.toLocaleString()}`);
  console.log(`  Total Raw Events:    ${(stats.rawEvents.totalBridge + stats.rawEvents.totalClaim).toLocaleString()}`);
  
  console.log('\n  📍 By Network:');
  Object.entries(stats.rawEvents.byNetwork).forEach(([network, count]) => {
    console.log(`    ${network}: ${count.toLocaleString()}`);
  });
  
  console.log('\n  🏷️  By Type:');
  Object.entries(stats.rawEvents.byLeafType).forEach(([type, count]) => {
    console.log(`    ${type}: ${count.toLocaleString()}`);
  });

  // Transfers & Matching
  console.log('\n🔗 TRANSFER MATCHING:');
  console.log(`  Total Transfers:     ${stats.transfers.total.toLocaleString()}`);
  console.log(`  Matched Transfers:   ${stats.transfers.matched.toLocaleString()}`);
  console.log(`  Unmatched Transfers: ${stats.transfers.unmatched.toLocaleString()}`);
  console.log(`  Match Rate:          ${(stats.transfers.matchRate * 100).toFixed(2)}%`);
  console.log(`  Valid Match Rate:    ${(stats.transfers.depositCountMatchRate * 100).toFixed(2)}%`);
  
  console.log('\n  📈 By Status:');
  Object.entries(stats.transfers.byEventType).forEach(([type, count]) => {
    console.log(`    ${type}: ${count.toLocaleString()}`);
  });

  // Network Flow
  console.log('\n🌐 NETWORK FLOW:');
  console.log('  Source Networks:');
  Object.entries(stats.transfers.byNetwork.source).forEach(([network, count]) => {
    console.log(`    ${network}: ${count.toLocaleString()}`);
  });
  
  console.log('  Destination Networks:');
  Object.entries(stats.transfers.byNetwork.destination).forEach(([network, count]) => {
    console.log(`    ${network}: ${count.toLocaleString()}`);
  });

  // Performance
  if (stats.performance.avgLatencySeconds > 0) {
    console.log('\n⚡ PERFORMANCE (Matched Transfers):');
    console.log(`  Average Latency: ${formatDuration(Math.round(stats.performance.avgLatencySeconds))}`);
    console.log(`  Fastest Transfer: ${formatDuration(stats.performance.fastestTransfer)}`);
    console.log(`  Slowest Transfer: ${formatDuration(stats.performance.slowestTransfer)}`);
  }

  // Summary
  console.log('\n📋 SUMMARY:');
  const totalEvents = stats.rawEvents.totalBridge + stats.rawEvents.totalClaim;
  const matchEfficiency = stats.transfers.total > 0 ? (stats.transfers.matched / totalEvents * 100) : 0;
  
  console.log(`  • Indexed ${totalEvents.toLocaleString()} raw events across ${Object.keys(stats.rawEvents.byNetwork).length} networks`);
  console.log(`  • Created ${stats.transfers.total.toLocaleString()} transfer records`);
  console.log(`  • Achieved ${(stats.transfers.matchRate * 100).toFixed(1)}% matching success rate`);
  console.log(`  • ${(stats.transfers.depositCountMatchRate * 100).toFixed(1)}% of matches have verified deposit counts`);
  
  if (stats.rawEvents.byLeafType.asset) {
    console.log(`  • ${((stats.rawEvents.byLeafType.asset / stats.rawEvents.totalBridge) * 100).toFixed(1)}% asset bridging, ${((stats.rawEvents.byLeafType.message || 0) / stats.rawEvents.totalBridge * 100).toFixed(1)}% message bridging`);
  }
}

// Main execution
async function main() {
  try {
    const stats = await getAgglayerStatistics();
    displayStatistics(stats);
  } catch (error) {
    console.error('❌ Failed to generate statistics:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { getAgglayerStatistics, AgglayerStats };