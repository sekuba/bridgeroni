#!/usr/bin/env node

/**
 * Agglayer Bridge Statistics Script
 * 
 * Provides comprehensive statistics and analysis for Agglayer bridge events.
 * Features:
 * - Statistics: Total events, matching rates, latency analysis
 * - Search: Transaction hash lookup with full metadata
 * - List: Latest transactions by chain and direction
 */

import { GraphQLClient, gql } from 'graphql-request';
import { 
  AGGLAYER_NETWORK_TO_CHAIN_NAME,
  getChainNameFromAgglayerNetwork,
  COLORS,
  TUI_CONFIG
} from './src/constants';

const GRAPHQL_URL = process.env.GRAPHQL_URL || TUI_CONFIG.GRAPHQL_URL;
const client = new GraphQLClient(GRAPHQL_URL);

interface AgglayerTransfer {
  id: string;
  assetOriginNetwork: string;
  assetDestinationNetwork: string;
  assetOriginAddress: string;
  destinationAddress: string;
  amount: string;
  leafType: string;
  metadata: string;
  depositCount: string;
  sourceTxHash: string;
  bridgeBlock: string;
  bridgeTimestamp: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: string;
  globalIndex: string;
  mainnetFlag: boolean;
  rollupIndex: string;
  localRootIndex: string;
  destinationTxHash: string;
  claimBlock: string;
  claimTimestamp: string;
  matched: boolean;
  latencySeconds: string;
  depositCountMatches: boolean;
  hasAmount: boolean;
  sourceChainId: string;
  destinationChainId: string;
  eventType: string;
  lastUpdated: string;
}

interface BridgeEvent {
  id: string;
  leafType: string;
  originNetwork: string;
  originAddress: string;
  destinationNetwork: string;
  destinationAddress: string;
  amount: string;
  metadata: string;
  depositCount: string;
  chainId: string;
  blockNumber: string;
  blockTimestamp: string;
  txHash: string;
}

interface ClaimEvent {
  id: string;
  globalIndex: string;
  originNetwork: string;
  originAddress: string;
  destinationAddress: string;
  amount: string;
  chainId: string;
  blockNumber: string;
  blockTimestamp: string;
  txHash: string;
}

const QUERIES = {
  TRANSFERS: gql`
    query GetAgglayerTransfers($limit: Int!, $offset: Int!) {
      AgglayerTransfer(limit: $limit, offset: $offset, order_by: {lastUpdated: desc}) {
        id
        assetOriginNetwork
        assetDestinationNetwork
        assetOriginAddress
        destinationAddress
        amount
        leafType
        metadata
        depositCount
        sourceTxHash
        bridgeBlock
        bridgeTimestamp
        tokenName
        tokenSymbol
        tokenDecimals
        globalIndex
        mainnetFlag
        rollupIndex
        localRootIndex
        destinationTxHash
        claimBlock
        claimTimestamp
        matched
        latencySeconds
        depositCountMatches
        hasAmount
        sourceChainId
        destinationChainId
        eventType
        lastUpdated
      }
    }
  `,
  
  BRIDGE_EVENTS: gql`
    query GetBridgeEvents($limit: Int!, $offset: Int!) {
      PolygonZkEVMBridgeV2_BridgeEvent(limit: $limit, offset: $offset, order_by: {blockTimestamp: desc}) {
        id
        leafType
        originNetwork
        originAddress
        destinationNetwork
        destinationAddress
        amount
        metadata
        depositCount
        chainId
        blockNumber
        blockTimestamp
        txHash
      }
    }
  `,
  
  CLAIM_EVENTS: gql`
    query GetClaimEvents($limit: Int!, $offset: Int!) {
      PolygonZkEVMBridgeV2_ClaimEvent(limit: $limit, offset: $offset, order_by: {blockTimestamp: desc}) {
        id
        globalIndex
        originNetwork
        originAddress
        destinationAddress
        amount
        chainId
        blockNumber
        blockTimestamp
        txHash
      }
    }
  `,
  
  SEARCH_BY_TX: gql`
    query SearchByTransaction($txHash: String!) {
      AgglayerTransfer(where: {_or: [{sourceTxHash: {_eq: $txHash}}, {destinationTxHash: {_eq: $txHash}}]}) {
        id
        assetOriginNetwork
        assetDestinationNetwork
        assetOriginAddress
        destinationAddress
        amount
        leafType
        metadata
        depositCount
        sourceTxHash
        bridgeBlock
        bridgeTimestamp
        tokenName
        tokenSymbol
        tokenDecimals
        globalIndex
        mainnetFlag
        rollupIndex
        localRootIndex
        destinationTxHash
        claimBlock
        claimTimestamp
        matched
        latencySeconds
        depositCountMatches
        hasAmount
        sourceChainId
        destinationChainId
        eventType
        lastUpdated
      }
      
      PolygonZkEVMBridgeV2_BridgeEvent(where: {txHash: {_eq: $txHash}}) {
        id
        leafType
        originNetwork
        originAddress
        destinationNetwork
        destinationAddress
        amount
        metadata
        depositCount
        chainId
        blockNumber
        blockTimestamp
        txHash
      }
      
      PolygonZkEVMBridgeV2_ClaimEvent(where: {txHash: {_eq: $txHash}}) {
        id
        globalIndex
        originNetwork
        originAddress
        destinationAddress
        amount
        chainId
        blockNumber
        blockTimestamp
        txHash
      }
    }
  `,
  
  TRANSFERS_BY_CHAIN: gql`
    query GetTransfersByChain($limit: Int!) {
      AgglayerTransfer(
        order_by: {lastUpdated: desc}
        limit: $limit
      ) {
        id
        assetOriginNetwork
        assetDestinationNetwork
        assetOriginAddress
        destinationAddress
        amount
        leafType
        tokenName
        tokenSymbol
        tokenDecimals
        sourceTxHash
        bridgeTimestamp
        destinationTxHash
        claimTimestamp
        matched
        latencySeconds
        sourceChainId
        destinationChainId
        eventType
        lastUpdated
      }
    }
  `,
  
  ALL_TRANSFERS: gql`
    query GetAllTransfers {
      AgglayerTransfer {
        id
        assetOriginNetwork
        assetDestinationNetwork
        leafType
        matched
        latencySeconds
        sourceChainId
        destinationChainId
        eventType
      }
    }
  `,
  
  ALL_BRIDGE_EVENTS: gql`
    query GetAllBridgeEvents {
      PolygonZkEVMBridgeV2_BridgeEvent {
        id
        leafType
        originNetwork
        chainId
      }
    }
  `,
  
  ALL_CLAIM_EVENTS: gql`
    query GetAllClaimEvents {
      PolygonZkEVMBridgeV2_ClaimEvent {
        id
        originNetwork
        chainId
      }
    }
  `,
  
  LATENCY_DATA: gql`
    query GetLatencyData {
      AgglayerTransfer(
        where: {_and: [{matched: {_eq: true}}, {latencySeconds: {_is_null: false}}]}
        order_by: {latencySeconds: asc}
      ) {
        latencySeconds
      }
    }
  `,
  
  UNMATCHED_BRIDGES: gql`
    query GetUnmatchedBridges {
      AgglayerTransfer(where: {_and: [{matched: {_eq: false}}, {eventType: {_eq: "bridge"}}]}) {
        assetDestinationNetwork
        assetOriginNetwork
        amount
        tokenSymbol
        bridgeTimestamp
      }
    }
  `,
  
  UNMATCHED_CLAIMS: gql`
    query GetUnmatchedClaims {
      AgglayerTransfer(where: {_and: [{matched: {_eq: false}}, {eventType: {_eq: "claim"}}]}) {
        rollupIndex
        assetOriginNetwork
        amount
        tokenSymbol
        claimTimestamp
      }
    }
  `,
  
  MATCHED_TRANSFERS: gql`
    query GetMatchedTransfers {
      AgglayerTransfer(where: {matched: {_eq: true}}) {
        assetDestinationNetwork
        assetOriginNetwork
        amount
        tokenSymbol
        tokenDecimals
        bridgeTimestamp
        claimTimestamp
        latencySeconds
      }
    }
  `,
  
  RECENT_ACTIVITY: gql`
    query GetRecentActivity {
      AgglayerTransfer(
        order_by: {lastUpdated: desc}
        limit: 1000
      ) {
        eventType
        matched
        lastUpdated
        bridgeTimestamp
        claimTimestamp
      }
    }
  `
};

function formatAmount(amount: string, decimals: string = '18', symbol: string = ''): string {
  try {
    const amountBig = BigInt(amount);
    const decimalsBig = BigInt(decimals || '18');
    const divisor = 10n ** decimalsBig;
    const whole = amountBig / divisor;
    const remainder = amountBig % divisor;
    
    if (remainder === 0n) {
      return `${whole}${symbol ? ' ' + symbol : ''}`;
    }
    
    const fractional = remainder.toString().padStart(Number(decimalsBig), '0');
    const trimmed = fractional.replace(/0+$/, '');
    return `${whole}.${trimmed}${symbol ? ' ' + symbol : ''}`;
  } catch {
    return amount + (symbol ? ' ' + symbol : '');
  }
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  } catch {
    return timestamp;
  }
}

function formatLatency(seconds: string): string {
  try {
    const secs = parseInt(seconds);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  } catch {
    return seconds + 's';
  }
}

function calculateStatistics(latencies: string[]): { mean: number; median: number; stdDev: number } {
  if (latencies.length === 0) return { mean: 0, median: 0, stdDev: 0 };
  
  const numbers = latencies.map(l => parseInt(l)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (numbers.length === 0) return { mean: 0, median: 0, stdDev: 0 };
  
  const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  const median = numbers.length % 2 === 0 
    ? (numbers[numbers.length / 2 - 1] + numbers[numbers.length / 2]) / 2
    : numbers[Math.floor(numbers.length / 2)];
  
  const variance = numbers.reduce((sum, n) => sum + Math.pow(n - mean, 2), 0) / numbers.length;
  const stdDev = Math.sqrt(variance);
  
  return { mean, median, stdDev };
}

async function showStatistics() {
  try {
    console.log(`${COLORS.bright}${COLORS.cyan}=== AGGLAYER BRIDGE STATISTICS ===${COLORS.reset}\n`);
    
    console.log(`${COLORS.gray}Fetching data...${COLORS.reset}`);
    
    // Fetch all data in parallel
    const [
      transfersData, 
      bridgeEventsData, 
      claimEventsData, 
      latencyData,
      unmatchedBridgesData,
      unmatchedClaimsData,
      matchedTransfersData,
      recentActivityData
    ] = await Promise.all([
      client.request(QUERIES.ALL_TRANSFERS),
      client.request(QUERIES.ALL_BRIDGE_EVENTS),
      client.request(QUERIES.ALL_CLAIM_EVENTS),
      client.request(QUERIES.LATENCY_DATA),
      client.request(QUERIES.UNMATCHED_BRIDGES),
      client.request(QUERIES.UNMATCHED_CLAIMS),
      client.request(QUERIES.MATCHED_TRANSFERS),
      client.request(QUERIES.RECENT_ACTIVITY)
    ]);
    
    const transfers = transfersData.AgglayerTransfer;
    const bridgeEvents = bridgeEventsData.PolygonZkEVMBridgeV2_BridgeEvent;
    const claimEvents = claimEventsData.PolygonZkEVMBridgeV2_ClaimEvent;
    
    // Calculate overall statistics
    const totalTransfers = transfers.length;
    const matchedTransfers = transfers.filter((t: any) => t.matched).length;
    const matchRate = totalTransfers > 0 ? (matchedTransfers / totalTransfers * 100).toFixed(1) : '0.0';
    
    console.log(`${COLORS.bright}📊 Overall Statistics${COLORS.reset}`);
    console.log(`Total Events Indexed: ${COLORS.green}${totalTransfers}${COLORS.reset}`);
    console.log(`├─ Bridge Events: ${COLORS.yellow}${bridgeEvents.length}${COLORS.reset}`);
    console.log(`├─ Claim Events: ${COLORS.blue}${claimEvents.length}${COLORS.reset}`);
    console.log(`├─ Matched Transfers: ${COLORS.green}${matchedTransfers}${COLORS.reset} (${COLORS.green}${matchRate}%${COLORS.reset})`);
    console.log(`└─ Unmatched Events: ${COLORS.red}${totalTransfers - matchedTransfers}${COLORS.reset}\n`);
    
    // Calculate transfer types
    const assetBridging = transfers.filter((t: any) => t.leafType === '0').length;
    const messageBridging = transfers.filter((t: any) => t.leafType === '1').length;
    
    console.log(`${COLORS.bright}🔄 Transfer Types${COLORS.reset}`);
    console.log(`Asset Bridging: ${COLORS.green}${assetBridging}${COLORS.reset} (${totalTransfers > 0 ? (assetBridging / totalTransfers * 100).toFixed(1) : '0'}%)`);
    console.log(`Message Bridging: ${COLORS.blue}${messageBridging}${COLORS.reset} (${totalTransfers > 0 ? (messageBridging / totalTransfers * 100).toFixed(1) : '0'}%)\n`);
    
    // Calculate chain statistics
    const chainStats = {
      ethereum: {
        total: transfers.filter((t: any) => t.sourceChainId === '1' || t.destinationChainId === '1').length,
        outbound: transfers.filter((t: any) => t.sourceChainId === '1').length,
        inbound: transfers.filter((t: any) => t.destinationChainId === '1').length
      },
      polygonzkevm: {
        total: transfers.filter((t: any) => t.sourceChainId === '1101' || t.destinationChainId === '1101').length,
        outbound: transfers.filter((t: any) => t.sourceChainId === '1101').length,
        inbound: transfers.filter((t: any) => t.destinationChainId === '1101').length
      },
      katana: {
        total: transfers.filter((t: any) => t.sourceChainId === '747474' || t.destinationChainId === '747474').length,
        outbound: transfers.filter((t: any) => t.sourceChainId === '747474').length,
        inbound: transfers.filter((t: any) => t.destinationChainId === '747474').length
      }
    };
    
    console.log(`${COLORS.bright}🌍 By Chain Statistics${COLORS.reset}`);
    const chains = [
      { name: 'Ethereum', ...chainStats.ethereum },
      { name: 'Polygon zkEVM', ...chainStats.polygonzkevm },
      { name: 'Katana', ...chainStats.katana },
    ];
    
    chains.forEach((chain, i) => {
      const isLast = i === chains.length - 1;
      console.log(`${isLast ? '└─' : '├─'} ${chain.name}: ${COLORS.cyan}${chain.total}${COLORS.reset} total`);
      console.log(`${isLast ? '  ' : '│ '} ├─ Outbound: ${COLORS.yellow}${chain.outbound}${COLORS.reset}`);
      console.log(`${isLast ? '  ' : '│ '} └─ Inbound: ${COLORS.green}${chain.inbound}${COLORS.reset}`);
    });
    
    console.log();
    
    // Calculate latency statistics
    const latencies = latencyData.AgglayerTransfer.map((t: any) => t.latencySeconds).filter((l: any) => l !== null);
    if (latencies.length > 0) {
      const stats = calculateStatistics(latencies);
      console.log(`${COLORS.bright}⏱️  Latency Statistics (${latencies.length} matched transfers)${COLORS.reset}`);
      console.log(`Mean: ${COLORS.cyan}${formatLatency(Math.round(stats.mean).toString())}${COLORS.reset}`);
      console.log(`Median: ${COLORS.green}${formatLatency(Math.round(stats.median).toString())}${COLORS.reset}`);
      console.log(`Std Dev: ${COLORS.yellow}${formatLatency(Math.round(stats.stdDev).toString())}${COLORS.reset}`);
      console.log(`Range: ${COLORS.gray}${formatLatency(latencies[0])} - ${formatLatency(latencies[latencies.length - 1])}${COLORS.reset}`);
    } else {
      console.log(`${COLORS.bright}⏱️  Latency Statistics${COLORS.reset}`);
      console.log(`${COLORS.gray}No matched transfers with latency data available${COLORS.reset}`);
    }
    
    console.log();
    
    // Unmatched bridges analysis
    const unmatchedBridges = unmatchedBridgesData.AgglayerTransfer;
    if (unmatchedBridges.length > 0) {
      const destinationCounts = unmatchedBridges.reduce((acc: any, bridge: any) => {
        const network = bridge.assetDestinationNetwork;
        const networkName = getChainNameFromAgglayerNetwork(parseInt(network));
        acc[networkName] = (acc[networkName] || 0) + 1;
        return acc;
      }, {});
      
      const sortedDestinations = Object.entries(destinationCounts)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 5);
      
      console.log(`${COLORS.bright}🔄 Unmatched Bridge Destinations (${unmatchedBridges.length} pending)${COLORS.reset}`);
      sortedDestinations.forEach(([network, count], i) => {
        const isLast = i === sortedDestinations.length - 1;
        console.log(`${isLast ? '└─' : '├─'} ${network}: ${COLORS.red}${count}${COLORS.reset} pending claims`);
      });
    } else {
      console.log(`${COLORS.bright}🔄 Unmatched Bridge Destinations${COLORS.reset}`);
      console.log(`${COLORS.green}All bridges have been claimed!${COLORS.reset}`);
    }
    
    console.log();
    
    // Unmatched claims analysis
    const unmatchedClaims = unmatchedClaimsData.AgglayerTransfer;
    if (unmatchedClaims.length > 0) {
      const rollupCounts = unmatchedClaims.reduce((acc: any, claim: any) => {
        const rollup = claim.rollupIndex || 'unknown';
        const originNetwork = claim.assetOriginNetwork;
        const key = `${getChainNameFromAgglayerNetwork(parseInt(rollup))}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      
      const sortedRollups = Object.entries(rollupCounts)
        .sort(([,a], [,b]) => (b as number) - (a as number))
        .slice(0, 5);
      
      console.log(`${COLORS.bright}🎯 Unmatched Claims by Origin (${unmatchedClaims.length} orphaned)${COLORS.reset}`);
      sortedRollups.forEach(([rollup, count], i) => {
        const isLast = i === sortedRollups.length - 1;
        console.log(`${isLast ? '└─' : '├─'} ${rollup}: ${COLORS.yellow}${count}${COLORS.reset} orphaned claims`);
      });
    } else {
      console.log(`${COLORS.bright}🎯 Unmatched Claims by Origin${COLORS.reset}`);
      console.log(`${COLORS.green}All claims have matching bridges!${COLORS.reset}`);
    }
    
    console.log();
    
    // Popular matched destinations
    const matchedTransfersForDestinations = matchedTransfersData.AgglayerTransfer;
    if (matchedTransfersForDestinations.length > 0) {
      const matchedDestinations = matchedTransfersForDestinations.reduce((acc: any, transfer: any) => {
        const network = transfer.assetDestinationNetwork;
        const networkName = getChainNameFromAgglayerNetwork(parseInt(network));
        acc[networkName] = (acc[networkName] || 0) + 1;
        return acc;
      }, {});
      
      const sortedMatched = Object.entries(matchedDestinations)
        .sort(([,a], [,b]) => (b as number) - (a as number));
      
      console.log(`${COLORS.bright}✅ Successfully Matched Destinations${COLORS.reset}`);
      sortedMatched.forEach(([network, count], i) => {
        const isLast = i === sortedMatched.length - 1;
        const percentage = ((count as number) / matchedTransfersForDestinations.length * 100).toFixed(1);
        console.log(`${isLast ? '└─' : '├─'} ${network}: ${COLORS.green}${count}${COLORS.reset} (${percentage}%)`);
      });
    }
    
    console.log();
    
    // Volume analysis
    const totalVolume = matchedTransfersForDestinations.reduce((sum: number, transfer: any) => {
      try {
        const amount = BigInt(transfer.amount || '0');
        const decimals = BigInt(transfer.tokenDecimals || '18');
        const divisor = 10n ** decimals;
        return sum + Number(amount / divisor);
      } catch {
        return sum;
      }
    }, 0);
    
    // Token analysis
    const tokenCounts = matchedTransfersForDestinations.reduce((acc: any, transfer: any) => {
      const symbol = transfer.tokenSymbol || 'Unknown';
      acc[symbol] = (acc[symbol] || 0) + 1;
      return acc;
    }, {});
    
    const topTokens = Object.entries(tokenCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 5);
    
    console.log(`${COLORS.bright}💰 Volume Analysis${COLORS.reset}`);
    console.log(`Total Matched Volume: ${COLORS.cyan}${totalVolume.toLocaleString()}${COLORS.reset} tokens`);
    console.log(`Top Tokens:`);
    topTokens.forEach(([symbol, count], i) => {
      const isLast = i === topTokens.length - 1;
      const percentage = ((count as number) / matchedTransfersForDestinations.length * 100).toFixed(1);
      console.log(`${isLast ? '└─' : '├─'} ${symbol}: ${COLORS.yellow}${count}${COLORS.reset} transfers (${percentage}%)`);
    });
    
    console.log();
    
    // Recent activity analysis
    const recentActivity = recentActivityData.AgglayerTransfer;
    const now = Math.floor(Date.now() / 1000);
    const last24h = recentActivity.filter((activity: any) => {
      const timestamp = parseInt(activity.lastUpdated || '0');
      return (now - timestamp) <= 86400; // 24 hours
    });
    
    const last24hMatched = last24h.filter((activity: any) => activity.matched).length;
    const last24hBridges = last24h.filter((activity: any) => activity.eventType === 'bridge').length;
    const last24hClaims = last24h.filter((activity: any) => activity.eventType === 'claim').length;
    
    console.log(`${COLORS.bright}📈 Recent Activity (Last 24h)${COLORS.reset}`);
    console.log(`Total Events: ${COLORS.cyan}${last24h.length}${COLORS.reset}`);
    console.log(`├─ New Bridges: ${COLORS.yellow}${last24hBridges}${COLORS.reset}`);
    console.log(`├─ New Claims: ${COLORS.blue}${last24hClaims}${COLORS.reset}`);
    console.log(`└─ New Matches: ${COLORS.green}${last24hMatched}${COLORS.reset}`);
    
    if (last24h.length > 0) {
      const matchingRate24h = (last24hMatched / last24h.length * 100).toFixed(1);
      console.log(`24h Matching Rate: ${COLORS.purple}${matchingRate24h}%${COLORS.reset}`);
    }
    
  } catch (error) {
    console.error(`${COLORS.red}Error fetching statistics:${COLORS.reset}`, error);
    process.exit(1);
  }
}

async function searchTransaction(txHash: string) {
  try {
    console.log(`${COLORS.bright}${COLORS.cyan}=== TRANSACTION SEARCH: ${txHash} ===${COLORS.reset}\n`);
    
    const data = await client.request(QUERIES.SEARCH_BY_TX, { txHash });
    
    if (data.AgglayerTransfer.length > 0) {
      const transfer = data.AgglayerTransfer[0];
      console.log(`${COLORS.bright}🎯 Matched Transfer Found${COLORS.reset}`);
      console.log(`ID: ${COLORS.gray}${transfer.id}${COLORS.reset}`);
      console.log(`Type: ${COLORS.cyan}${transfer.leafType === '0' ? 'Asset Bridging' : 'Message Bridging'}${COLORS.reset}`);
      console.log(`Status: ${transfer.matched ? `${COLORS.green}Matched${COLORS.reset}` : `${COLORS.yellow}Pending${COLORS.reset}`}`);
      console.log(`Event Type: ${COLORS.blue}${transfer.eventType}${COLORS.reset}\n`);
      
      console.log(`${COLORS.bright}💰 Transfer Details${COLORS.reset}`);
      console.log(`Amount: ${COLORS.green}${formatAmount(transfer.amount, transfer.tokenDecimals, transfer.tokenSymbol)}${COLORS.reset}`);
      console.log(`Token: ${COLORS.cyan}${transfer.tokenName || 'Unknown'}${COLORS.reset} (${transfer.tokenSymbol || 'UNK'})`);
      console.log(`From: ${COLORS.yellow}${getChainNameFromAgglayerNetwork(parseInt(transfer.assetOriginNetwork))}${COLORS.reset} → ${COLORS.green}${getChainNameFromAgglayerNetwork(parseInt(transfer.assetDestinationNetwork || '0'))}${COLORS.reset}\n`);
      
      console.log(`${COLORS.bright}🔗 Transaction Hashes${COLORS.reset}`);
      if (transfer.sourceTxHash) {
        console.log(`Bridge Tx: ${COLORS.cyan}${transfer.sourceTxHash}${COLORS.reset}`);
        console.log(`Bridge Time: ${COLORS.gray}${formatTimestamp(transfer.bridgeTimestamp)}${COLORS.reset}`);
      }
      if (transfer.destinationTxHash) {
        console.log(`Claim Tx: ${COLORS.blue}${transfer.destinationTxHash}${COLORS.reset}`);
        console.log(`Claim Time: ${COLORS.gray}${formatTimestamp(transfer.claimTimestamp)}${COLORS.reset}`);
      }
      
      if (transfer.matched && transfer.latencySeconds) {
        console.log(`\n${COLORS.bright}⏱️  Performance${COLORS.reset}`);
        console.log(`Latency: ${COLORS.green}${formatLatency(transfer.latencySeconds)}${COLORS.reset}`);
      }
    }
    
    if (data.PolygonZkEVMBridgeV2_BridgeEvent.length > 0) {
      const bridgeEvent = data.PolygonZkEVMBridgeV2_BridgeEvent[0];
      console.log(`${data.AgglayerTransfer.length > 0 ? '\n' : ''}${COLORS.bright}🌉 Raw Bridge Event${COLORS.reset}`);
      console.log(`Chain: ${COLORS.cyan}${getChainNameFromAgglayerNetwork(parseInt(bridgeEvent.chainId))}${COLORS.reset}`);
      console.log(`Block: ${COLORS.gray}#${bridgeEvent.blockNumber}${COLORS.reset}`);
      console.log(`Time: ${COLORS.gray}${formatTimestamp(bridgeEvent.blockTimestamp)}${COLORS.reset}`);
      console.log(`Deposit Count: ${COLORS.yellow}${bridgeEvent.depositCount}${COLORS.reset}`);
    }
    
    if (data.PolygonZkEVMBridgeV2_ClaimEvent.length > 0) {
      const claimEvent = data.PolygonZkEVMBridgeV2_ClaimEvent[0];
      console.log(`${(data.AgglayerTransfer.length > 0 || data.PolygonZkEVMBridgeV2_BridgeEvent.length > 0) ? '\n' : ''}${COLORS.bright}🎯 Raw Claim Event${COLORS.reset}`);
      console.log(`Chain: ${COLORS.cyan}${getChainNameFromAgglayerNetwork(parseInt(claimEvent.chainId))}${COLORS.reset}`);
      console.log(`Block: ${COLORS.gray}#${claimEvent.blockNumber}${COLORS.reset}`);
      console.log(`Time: ${COLORS.gray}${formatTimestamp(claimEvent.blockTimestamp)}${COLORS.reset}`);
      console.log(`Global Index: ${COLORS.blue}${claimEvent.globalIndex}${COLORS.reset}`);
    }
    
    if (data.AgglayerTransfer.length === 0 && data.PolygonZkEVMBridgeV2_BridgeEvent.length === 0 && data.PolygonZkEVMBridgeV2_ClaimEvent.length === 0) {
      console.log(`${COLORS.yellow}No Agglayer bridge events found for transaction hash: ${txHash}${COLORS.reset}`);
    }
    
  } catch (error) {
    console.error(`${COLORS.red}Error searching transaction:${COLORS.reset}`, error);
    process.exit(1);
  }
}

async function listTransactions(chainName: string, direction: string, limit: number = 50) {
  try {
    const chainMapping: Record<string, string> = {
      'ethereum': '1',
      'eth': '1',
      'polygonzkevm': '1101',
      'polygon': '1101',
      'zkEVM': '1101',
      'katana': '747474'
    };
    
    const chainId = chainMapping[chainName.toLowerCase()];
    if (!chainId) {
      console.log(`${COLORS.red}Unknown chain: ${chainName}${COLORS.reset}`);
      console.log(`${COLORS.yellow}Available chains: ethereum, polygonzkevm, katana${COLORS.reset}`);
      return;
    }
    
    const validDirections = ['bridge', 'claim', 'matched'];
    if (!validDirections.includes(direction.toLowerCase())) {
      console.log(`${COLORS.red}Invalid direction: ${direction}${COLORS.reset}`);
      console.log(`${COLORS.yellow}Available directions: bridge, claim, matched${COLORS.reset}`);
      return;
    }
    
    console.log(`${COLORS.bright}${COLORS.cyan}=== LATEST ${direction.toUpperCase()} TRANSACTIONS - ${chainName.toUpperCase()} ===${COLORS.reset}\n`);
    
    const data = await client.request(QUERIES.TRANSFERS_BY_CHAIN, { 
      limit 
    });
    
    // Filter transfers client-side since GraphQL filtering is having issues
    const allTransfers = data.AgglayerTransfer;
    const filteredTransfers = allTransfers.filter((transfer: any) => {
      const matchesChain = transfer.sourceChainId === chainId || transfer.destinationChainId === chainId;
      const matchesDirection = transfer.eventType === direction.toLowerCase();
      return matchesChain && matchesDirection;
    }).slice(0, limit);
    
    if (filteredTransfers.length === 0) {
      console.log(`${COLORS.yellow}No ${direction} transactions found for ${chainName}${COLORS.reset}`);
      return;
    }
    
    filteredTransfers.forEach((transfer: AgglayerTransfer, i: number) => {
      const isLast = i === filteredTransfers.length - 1;
      console.log(`${isLast ? '└─' : '├─'} ${COLORS.bright}${transfer.tokenSymbol || 'UNK'}${COLORS.reset} ${formatAmount(transfer.amount, transfer.tokenDecimals)}`);
      console.log(`${isLast ? '  ' : '│ '} ├─ ${COLORS.gray}ID: ${transfer.id.slice(0, 20)}...${COLORS.reset}`);
      console.log(`${isLast ? '  ' : '│ '} ├─ Status: ${transfer.matched ? `${COLORS.green}Matched${COLORS.reset}` : `${COLORS.yellow}Pending${COLORS.reset}`}`);
      
      if (transfer.sourceTxHash) {
        console.log(`${isLast ? '  ' : '│ '} ├─ Bridge: ${COLORS.cyan}${transfer.sourceTxHash}${COLORS.reset}`);
      }
      if (transfer.destinationTxHash) {
        console.log(`${isLast ? '  ' : '│ '} ├─ Claim: ${COLORS.blue}${transfer.destinationTxHash}${COLORS.reset}`);
      }
      if (transfer.latencySeconds) {
        console.log(`${isLast ? '  ' : '│ '} ├─ Latency: ${COLORS.green}${formatLatency(transfer.latencySeconds)}${COLORS.reset}`);
      }
      console.log(`${isLast ? '  ' : '│ '} └─ Updated: ${COLORS.gray}${formatTimestamp(transfer.lastUpdated)}${COLORS.reset}`);
      if (!isLast) console.log(`│`);
    });
    
  } catch (error) {
    console.error(`${COLORS.red}Error listing transactions:${COLORS.reset}`, error);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`${COLORS.bright}${COLORS.cyan}Agglayer Bridge Statistics Tool${COLORS.reset}\n`);
  console.log(`${COLORS.bright}Usage:${COLORS.reset}`);
  console.log(`  ${COLORS.green}stats${COLORS.reset}                              Show comprehensive statistics`);
  console.log(`  ${COLORS.green}search${COLORS.reset} <txHash>                   Search for transaction details`);
  console.log(`  ${COLORS.green}list${COLORS.reset} <chain> <direction> [limit]   List latest transactions`);
  console.log(`  ${COLORS.green}help${COLORS.reset}                               Show this help message\n`);
  
  console.log(`${COLORS.bright}Examples:${COLORS.reset}`);
  console.log(`  ${COLORS.gray}node agglayer-stats.ts stats${COLORS.reset}`);
  console.log(`  ${COLORS.gray}node agglayer-stats.ts search 0x123...${COLORS.reset}`);
  console.log(`  ${COLORS.gray}node agglayer-stats.ts list ethereum matched 20${COLORS.reset}`);
  console.log(`  ${COLORS.gray}node agglayer-stats.ts list katana bridge${COLORS.reset}\n`);
  
  console.log(`${COLORS.bright}Available Chains:${COLORS.reset}`);
  console.log(`  ethereum, polygonzkevm, katana\n`);
  
  console.log(`${COLORS.bright}Available Directions:${COLORS.reset}`);
  console.log(`  bridge, claim, matched\n`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }
  
  const command = args[0].toLowerCase();
  
  switch (command) {
    case 'stats':
    case 'statistics':
      await showStatistics();
      break;
      
    case 'search':
      if (args.length < 2) {
        console.log(`${COLORS.red}Error: Transaction hash required${COLORS.reset}`);
        console.log(`${COLORS.yellow}Usage: search <txHash>${COLORS.reset}`);
        process.exit(1);
      }
      await searchTransaction(args[1]);
      break;
      
    case 'list':
      if (args.length < 3) {
        console.log(`${COLORS.red}Error: Chain and direction required${COLORS.reset}`);
        console.log(`${COLORS.yellow}Usage: list <chain> <direction> [limit]${COLORS.reset}`);
        process.exit(1);
      }
      const limit = args[3] ? parseInt(args[3]) : 50;
      await listTransactions(args[1], args[2], limit);
      break;
      
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
      
    default:
      console.log(`${COLORS.red}Unknown command: ${command}${COLORS.reset}`);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${COLORS.red}Fatal error:${COLORS.reset}`, error);
    process.exit(1);
  });
}