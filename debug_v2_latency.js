#!/usr/bin/env node

/**
 * Debug script to investigate V2 latency discrepancy
 */

const GRAPHQL_URL = 'http://localhost:8080/v1/graphql';

// Query for V2 transactions with high latency
const HIGH_LATENCY_V2_QUERY = `{
  CCTPTransfer(
    where: {
      version: {_eq: "v2"},
      matched: {_eq: true},
      latencySeconds: {_gt: "300"}
    },
    order_by: {latencySeconds: desc},
    limit: 20
  ) {
    id
    sourceDomain
    destinationDomain
    amount
    latencySeconds
    depositTimestamp
    messageReceivedTimestamp
    sourceTxHash
    destinationTxHash
    version
  }
}`;

// Query for V2 latency distribution
const V2_LATENCY_DISTRIBUTION_QUERY = `{
  CCTPTransfer(
    where: {
      version: {_eq: "v2"},
      matched: {_eq: true}
    },
    order_by: {latencySeconds: desc}
  ) {
    latencySeconds
    amount
  }
}`;

// Query for recent V2 transactions shown in TUI
const RECENT_V2_MATCHED_QUERY = `{
  CCTPTransfer(
    where: {
      version: {_eq: "v2"},
      matched: {_eq: true}
    },
    order_by: [{lastUpdated: desc}, {messageReceivedTimestamp: desc}],
    limit: 20
  ) {
    id
    sourceDomain
    destinationDomain
    amount
    latencySeconds
    depositTimestamp
    messageReceivedTimestamp
    sourceTxHash
    destinationTxHash
    lastUpdated
  }
}`;

async function executeQuery(query, description) {
  console.log(`\n🔍 ${description}:`);
  console.log('─'.repeat(80));
  
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    if (result.errors) {
      throw new Error(result.errors[0].message);
    }
    
    return result.data;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return null;
  }
}

function formatDuration(seconds) {
  const sec = Number(seconds);
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h`;
  }
  return `${mins}m`;
}

function formatAmount(amount) {
  if (!amount) return '?';
  const num = Number(amount) / Math.pow(10, 6);
  return num >= 1000 ? `$${(num/1000).toFixed(1)}k` : `$${num.toFixed(2)}`;
}

function getDomainName(domain) {
  const names = {
    0: 'ethereum', 2: 'op', 3: 'arbitrum', 6: 'base', 
    10: 'unichain', 11: 'linea', 14: 'worldchain'
  };
  return names[domain] || `Domain${domain}`;
}

async function main() {
  console.log('🌱 V2 Latency Investigation');
  console.log('═'.repeat(80));
  
  // 1. Check high latency V2 transactions
  const highLatencyData = await executeQuery(HIGH_LATENCY_V2_QUERY, 'High Latency V2 Transactions (>5min)');
  if (highLatencyData?.CCTPTransfer) {
    highLatencyData.CCTPTransfer.forEach(tx => {
      console.log(`${getDomainName(tx.sourceDomain)}→${getDomainName(tx.destinationDomain)}: ${formatAmount(tx.amount)} ~${formatDuration(tx.latencySeconds)}`);
      console.log(`  src: ${tx.sourceTxHash}`);
      console.log(`  dst: ${tx.destinationTxHash}`);
    });
  }
  
  // 2. Check recent V2 transactions (what TUI shows)
  const recentData = await executeQuery(RECENT_V2_MATCHED_QUERY, 'Recent V2 Matched Transactions (TUI View)');
  if (recentData?.CCTPTransfer) {
    recentData.CCTPTransfer.forEach(tx => {
      console.log(`${getDomainName(tx.sourceDomain)}→${getDomainName(tx.destinationDomain)}: ${formatAmount(tx.amount)} ~${formatDuration(tx.latencySeconds)}`);
    });
  }
  
  // 3. Calculate latency distribution for V2
  const distributionData = await executeQuery(V2_LATENCY_DISTRIBUTION_QUERY, 'V2 Latency Distribution Analysis');
  if (distributionData?.CCTPTransfer) {
    const latencies = distributionData.CCTPTransfer
      .map(tx => Number(tx.latencySeconds))
      .filter(l => l > 0 && !isNaN(l))
      .sort((a, b) => a - b);
    
    if (latencies.length > 0) {
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const median = latencies[Math.floor(latencies.length / 2)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      
      console.log(`Total V2 matched transfers: ${latencies.length}`);
      console.log(`Average latency: ${formatDuration(Math.round(avg))}`);
      console.log(`Median latency: ${formatDuration(median)}`);
      console.log(`95th percentile: ${formatDuration(p95)}`);
      console.log(`Max latency: ${formatDuration(Math.max(...latencies))}`);
      
      // Show distribution
      const buckets = {
        '<1m': latencies.filter(l => l < 60).length,
        '1-5m': latencies.filter(l => l >= 60 && l < 300).length,
        '5-15m': latencies.filter(l => l >= 300 && l < 900).length,
        '15-60m': latencies.filter(l => l >= 900 && l < 3600).length,
        '>1h': latencies.filter(l => l >= 3600).length
      };
      
      console.log('\nLatency Distribution:');
      Object.entries(buckets).forEach(([range, count]) => {
        const pct = ((count / latencies.length) * 100).toFixed(1);
        console.log(`  ${range}: ${count} (${pct}%)`);
      });
    }
  }
}

main().catch(console.error);