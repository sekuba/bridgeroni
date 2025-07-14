#!/usr/bin/env node

/**
 * CCTP Bridge Monitor - Terminal UI
 * 
 * Real-time monitoring dashboard for CCTP v1 and v2 bridge transactions
 * across all supported chains. Built with Node.js built-ins for simplicity.
 * 
 * Features:
 * - Comprehensive v1/v2 metrics with separate volume tracking
 * - Binned latency analysis by transaction amount
 * - Real-time raw event feed
 * - Matched bridge transfer display with accurate latency
 * - Support for all CCTP chains including Linea and World Chain
 * 
 * Architecture:
 * - GraphQL queries to Hasura/Envio indexer
 * - ANSI terminal rendering
 * - 1-second refresh rate
 * - Deterministic v2 matching via messageBody decoding
 */

const { stdout } = process;
const { performance } = require('perf_hooks');

// Terminal color codes
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// CCTP domain to chain name mapping
const DOMAINS = {
  0: 'ETHEREUM',
  1: 'AVALANCHE', 
  2: 'OP',
  3: 'ARBITRUM',
  4: 'NOBLE',
  5: 'SOLANA',
  6: 'BASE',
  7: 'POLYGON',
  8: 'SUI',
  9: 'APTOS',
  10: 'UNICHAIN',
  11: 'LINEA',
  12: 'CODEX',
  13: 'SONIC',
  14: 'WORLDCHAIN',
};

// Configuration
const CONFIG = {
  GRAPHQL_URL: 'http://localhost:8080/v1/graphql',
  REFRESH_INTERVAL: 1000, // 1 second
  TRANSFER_AMOUNT_BINS: {
    micro: { min: 0, max: 10, label: '0-10' },
    small: { min: 10.01, max: 100, label: '>10-100' },
    medium: { min: 100.01, max: 10000, label: '>100-10k' },
    large: { min: 10000.01, max: 100000, label: '>10k-100k' },
    xlarge: { min: 100000.01, max: 1000000, label: '>100k-1M' },
    whale: { min: 1000000.01, max: Infinity, label: '>1M' }
  }
};

class CCTPMonitor {
  constructor() {
    this.data = {
      metrics: {},
      rawEvents: [],
      matchedTransfers: []
    };
    this.lastUpdate = 0;
  }

  // Map chain ID to CCTP domain
  getChainIdToDomain(chainId) {
    const mapping = {
      1: 0,        // Ethereum
      10: 2,       // OP Mainnet  
      42161: 3,    // Arbitrum
      8453: 6,     // Base
      130: 10,    // Unichain
      // Additional chains can be added here
      43114: 1,    // Avalanche (not in config yet)
      137: 7,      // Polygon (not in config yet)
      59144: 11,   // Linea (not in config yet)
      480: 14      // World Chain (not in config yet)
    };
    return mapping[chainId] !== undefined ? mapping[chainId] : null;
  }

  // Make GraphQL requests using built-in fetch (Node 18+)
  async graphql(query) {
    try {
      const response = await fetch(CONFIG.GRAPHQL_URL, {
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
      console.error(`GraphQL Error: ${error.message}`);
      return null;
    }
  }

  // Fetch all required data
  async fetchData() {
    const queries = {
      // Get recent deposit events directly from raw events with enhanced metadata (v1)
      recentDeposits: `{
        TokenMessenger_DepositForBurn(
          limit: 15, 
          order_by: {blockTimestamp: desc}
        ) {
          id nonce amount depositor destinationDomain
          chainId blockTimestamp txHash
        }
      }`,
      
      // Get recent deposit events from v2 contracts
      recentDepositsV2: `{
        TokenMessenger_DepositForBurnV2(
          limit: 15, 
          order_by: {blockTimestamp: desc}
        ) {
          id amount depositor destinationDomain
          chainId blockTimestamp txHash
        }
      }`,
      
      // Get recent received events directly from raw events with enhanced metadata (v1)
      recentReceived: `{
        MessageTransmitter_MessageReceived(
          limit: 15, 
          order_by: {blockTimestamp: desc}
        ) {
          id nonce sourceDomain caller
          chainId blockTimestamp txHash
        }
      }`,
      
      // Get recent received events from v2 contracts
      recentReceivedV2: `{
        MessageTransmitter_MessageReceivedV2(
          limit: 15, 
          order_by: {blockTimestamp: desc}
        ) {
          id nonce sourceDomain caller finalityThresholdExecuted
          chainId blockTimestamp txHash
        }
      }`,
      
      // Get all matched transfers for display
      matchedTransfers: `{
        CCTPTransfer(
          where: {matched: {_eq: true}}, 
          order_by: {messageReceivedTimestamp: desc}
        ) {
          id sourceDomain destinationDomain nonce amount 
          depositor mintRecipient sourceTxHash destinationTxHash
          depositTimestamp messageReceivedTimestamp latencySeconds
          version maxFee minFinalityThreshold hookData finalityThresholdExecuted
        }
      }`,
      
      // Get all transfers for metrics calculation
      allTransfers: `{
        CCTPTransfer(order_by: {depositTimestamp: desc}) {
          matched latencySeconds sourceDomain destinationDomain
          depositBlock messageReceivedBlock version amount depositTimestamp
        }
      }`,
      
      // Get raw event counts (we'll count them ourselves)
      allDeposits: `{
        TokenMessenger_DepositForBurn { id }
      }`,
      
      allDepositsV2: `{
        TokenMessenger_DepositForBurnV2 { id }
      }`,
      
      allReceived: `{
        MessageTransmitter_MessageReceived { id }
      }`,
      
      allReceivedV2: `{
        MessageTransmitter_MessageReceivedV2 { id }
      }`
    };

    const results = await Promise.all([
      this.graphql(queries.recentDeposits),
      this.graphql(queries.recentDepositsV2),
      this.graphql(queries.recentReceived),
      this.graphql(queries.recentReceivedV2),
      this.graphql(queries.matchedTransfers),
      this.graphql(queries.allTransfers),
      this.graphql(queries.allDeposits),
      this.graphql(queries.allDepositsV2),
      this.graphql(queries.allReceived),
      this.graphql(queries.allReceivedV2)
    ]);

    if (results.some(r => !r)) return false;

    const [recentDepositsData, recentDepositsV2Data, recentReceivedData, recentReceivedV2Data, matchedData, allTransfersData, depositsData, depositsV2Data, receivedData, receivedV2Data] = results;

    // Process data - combine v1 and v2 events
    this.data.recentDeposits = recentDepositsData.TokenMessenger_DepositForBurn;
    this.data.recentDepositsV2 = recentDepositsV2Data.TokenMessenger_DepositForBurnV2;
    this.data.recentReceived = recentReceivedData.MessageTransmitter_MessageReceived;
    this.data.recentReceivedV2 = recentReceivedV2Data.MessageTransmitter_MessageReceivedV2;
    this.data.matchedTransfers = matchedData.CCTPTransfer;
    
    // Create combined raw events feed from recent deposits and receives (both v1 and v2)
    this.data.rawEvents = this.createRawEventsFeed(
      this.data.recentDeposits, 
      this.data.recentDepositsV2,
      this.data.recentReceived,
      this.data.recentReceivedV2
    );
    
    // Calculate metrics separately for v1 and v2
    const allTransfers = allTransfersData.CCTPTransfer;
    const matchedTransfers = allTransfers.filter(t => t.matched);
    const v1Transfers = matchedTransfers.filter(t => t.version === 'v1');
    const v2Transfers = matchedTransfers.filter(t => t.version === 'v2');
    
    this.data.metrics = {
      totalEvents: depositsData.TokenMessenger_DepositForBurn.length + depositsV2Data.TokenMessenger_DepositForBurnV2.length + receivedData.MessageTransmitter_MessageReceived.length + receivedV2Data.MessageTransmitter_MessageReceivedV2.length,
      
      // V1 metrics
      v1: {
        totalDeposits: depositsData.TokenMessenger_DepositForBurn.length,
        totalReceived: receivedData.MessageTransmitter_MessageReceived.length,
        matchedCount: v1Transfers.length,
        avgLatency: this.calculateAverageLatency(v1Transfers),
        binnedLatency: this.calculateBinnedLatency(v1Transfers),
        dailyVolume: this.calculateDailyVolume(v1Transfers)
      },
      
      // V2 metrics
      v2: {
        totalDeposits: depositsV2Data.TokenMessenger_DepositForBurnV2.length,
        totalReceived: receivedV2Data.MessageTransmitter_MessageReceivedV2.length,
        matchedCount: v2Transfers.length,
        avgLatency: this.calculateAverageLatency(v2Transfers),
        binnedLatency: this.calculateBinnedLatency(v2Transfers),
        dailyVolume: this.calculateDailyVolume(v2Transfers)
      },
      
      // Combined metrics
      matchedCount: this.data.matchedTransfers.length,
      avgLatency: this.calculateAverageLatency(this.data.matchedTransfers),
      binnedLatency: this.calculateBinnedLatency(this.data.matchedTransfers),
      dailyVolume: this.calculateDailyVolume(this.data.matchedTransfers),
      latestBlocks: {
        ethereum: this.getLatestBlock(allTransfers, 0),
        optimism: this.getLatestBlock(allTransfers, 2), 
        arbitrum: this.getLatestBlock(allTransfers, 3),
        base: this.getLatestBlock(allTransfers, 6),
        unichain: this.getLatestBlock(allTransfers, 10),
        linea: this.getLatestBlock(allTransfers, 11),
        worldchain: this.getLatestBlock(allTransfers, 14)
      }
    };

    this.lastUpdate = Date.now();
    return true;
  }

  calculateAverageLatency(matchedTransfers) {
    const latencies = matchedTransfers
      .map(t => parseInt(t.latencySeconds))
      .filter(l => l > 0);
    
    if (latencies.length === 0) return 0;
    
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    return Math.round(avg);
  }

  // Calculate daily volume for matched transactions (24h rolling period)
  calculateDailyVolume(matchedTransfers) {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twentyFourHoursAgoTimestamp = Math.floor(twentyFourHoursAgo.getTime() / 1000);

    // Filter transfers from last 24 hours
    const recentTransfers = matchedTransfers.filter(transfer => {
      const transferTimestamp = parseInt(transfer.depositTimestamp);
      return transferTimestamp >= twentyFourHoursAgoTimestamp;
    });

    // Calculate cumulative volume
    const totalVolume = recentTransfers.reduce((sum, transfer) => {
      if (!transfer.amount) return sum;
      return sum + (parseInt(transfer.amount) / 1e6); // Convert to USDC
    }, 0);

    // Calculate per-chain volume
    const chainVolume = {};
    recentTransfers.forEach(transfer => {
      if (!transfer.amount) return;
      const sourceDomain = parseInt(transfer.sourceDomain);
      const chainName = DOMAINS[sourceDomain] || `Chain${sourceDomain}`;
      
      if (!chainVolume[chainName]) {
        chainVolume[chainName] = 0;
      }
      chainVolume[chainName] += parseInt(transfer.amount) / 1e6; // Convert to USDC
    });

    return {
      total: totalVolume,
      chains: chainVolume,
      count: recentTransfers.length
    };
  }

  // Calculate latency metrics binned by transfer amount (USDC)
  calculateBinnedLatency(matchedTransfers) {
    // Initialize bins with latencies array
    const bins = {};
    Object.keys(CONFIG.TRANSFER_AMOUNT_BINS).forEach(key => {
      bins[key] = { ...CONFIG.TRANSFER_AMOUNT_BINS[key], latencies: [] };
    });

    // Categorize transfers by amount
    matchedTransfers.forEach(transfer => {
      if (!transfer.amount || !transfer.latencySeconds) return;
      
      const amountUSDC = parseInt(transfer.amount) / 1e6; // Convert to USDC
      const latencySeconds = parseInt(transfer.latencySeconds);
      
      if (latencySeconds <= 0) return;

      if (amountUSDC >= bins.micro.min && amountUSDC <= bins.micro.max) {
        bins.micro.latencies.push(latencySeconds);
      } else if (amountUSDC >= bins.small.min && amountUSDC <= bins.small.max) {
        bins.small.latencies.push(latencySeconds);
      } else if (amountUSDC >= bins.medium.min && amountUSDC <= bins.medium.max) {
        bins.medium.latencies.push(latencySeconds);
      } else if (amountUSDC >= bins.large.min && amountUSDC <= bins.large.max) {
        bins.large.latencies.push(latencySeconds);
      } else if (amountUSDC >= bins.xlarge.min && amountUSDC <= bins.xlarge.max) {
        bins.xlarge.latencies.push(latencySeconds);
      } else if (amountUSDC >= bins.whale.min) {
        bins.whale.latencies.push(latencySeconds);
      }
    });

    // Calculate average for each bin
    const result = {};
    Object.keys(bins).forEach(binKey => {
      const bin = bins[binKey];
      if (bin.latencies.length > 0) {
        const avg = bin.latencies.reduce((a, b) => a + b, 0) / bin.latencies.length;
        result[binKey] = {
          avg: Math.round(avg),
          count: bin.latencies.length,
          label: bin.label
        };
      } else {
        result[binKey] = {
          avg: 0,
          count: 0,
          label: bin.label
        };
      }
    });

    return result;
  }

  getLatestBlock(transfers, domain) {
    const filtered = transfers.filter(t => 
      parseInt(t.sourceDomain) === domain || parseInt(t.destinationDomain) === domain
    );
    
    let maxBlock = 0;
    filtered.forEach(t => {
      if (parseInt(t.sourceDomain) === domain && t.depositBlock) {
        maxBlock = Math.max(maxBlock, parseInt(t.depositBlock));
      }
      if (parseInt(t.destinationDomain) === domain && t.messageReceivedBlock) {
        maxBlock = Math.max(maxBlock, parseInt(t.messageReceivedBlock));
      }
    });
    
    return maxBlock;
  }

  // Format amount in USDC (6 decimals)
  formatAmount(amount, hasAmount = true) {
    if (!amount || !hasAmount) return '?';
    const num = parseInt(amount) / 1e6;
    return num >= 1000 ? `$${(num/1000).toFixed(1)}k` : `$${num.toFixed(2)}`;
  }

  // Format volume amount (already in USDC)
  formatVolume(amount) {
    if (!amount || amount === 0) return '$0';
    if (amount >= 1000000) return `$${(amount/1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${(amount/1000).toFixed(1)}K`;
    return `$${amount.toFixed(0)}`;
  }

  // Format address for display
  formatAddress(addr) {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
  }

  // Format transaction hash with explorer URL
  formatTxHash(hash, domain) {
    if (!hash || hash.length < 10) return hash;
    
    const explorerUrls = {
      0: 'https://etherscan.io/tx/',            // Ethereum
      2: 'https://optimistic.etherscan.io/tx/', // OP Mainnet
      3: 'https://arbiscan.io/tx/',             // Arbitrum
      6: 'https://basescan.org/tx/',            // Base
      10: 'https://uniscan.xyz/tx/',             // Unichain
      11: 'https://lineascan.build/tx/',        // Linea
      14: 'https://worldscan.org/tx/'           // World Chain
    };
    
    const baseUrl = explorerUrls[domain] || `https://etherscan.io/tx/`; // fallback to etherscan
    return `${baseUrl}${hash}`;
  }

  // Format transaction hash for display (short version)
  formatTxHashShort(hash) {
    if (!hash || hash.length < 10) return hash;
    return `${hash.slice(0, 6)}..${hash.slice(-4)}`;
  }

  // Format duration in human readable form
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '?';
    
    if (seconds < 60) {
      return `${seconds}s`;
    }
    
    const mins = Math.floor(seconds / 60);
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      return `${hours}h`;
    }
    return `${mins}m`;
  }

  // Extract recipient address from mintRecipient (32-byte hex to address)
  extractRecipient(mintRecipient) {
    if (!mintRecipient || mintRecipient.length !== 66) return '';
    // Take last 20 bytes (40 hex chars) and add 0x prefix
    return '0x' + mintRecipient.slice(-40);
  }

  // Create raw events feed from recent deposits and received events
  createRawEventsFeed(deposits, depositsV2, received, receivedV2) {
    const events = [];
    
    // Process deposit events
    deposits.forEach(deposit => {
      // Map chain ID to domain for source
      const chainId = parseInt(deposit.chainId);
      const sourceDomain = this.getChainIdToDomain(chainId);
      
      events.push({
        type: 'deposit',
        version: 'v1',
        sourceDomain,
        destinationDomain: parseInt(deposit.destinationDomain),
        sourceChain: sourceDomain !== null ? DOMAINS[sourceDomain] : `Chain${chainId}`,
        destinationChain: DOMAINS[deposit.destinationDomain] || deposit.destinationDomain,
        amount: deposit.amount,
        hasAmount: true, // deposits always have amount
        nonce: deposit.nonce,
        timestamp: deposit.blockTimestamp,
        txHash: deposit.txHash,
        direction: 'from'
      });
    });
    
    // Process v2 deposit events
    depositsV2.forEach(deposit => {
      // Map chain ID to domain for source
      const chainId = parseInt(deposit.chainId);
      const sourceDomain = this.getChainIdToDomain(chainId);
      
      events.push({
        type: 'deposit',
        version: 'v2',
        sourceDomain,
        destinationDomain: parseInt(deposit.destinationDomain),
        sourceChain: sourceDomain !== null ? DOMAINS[sourceDomain] : `Chain${chainId}`,
        destinationChain: DOMAINS[deposit.destinationDomain] || deposit.destinationDomain,
        amount: deposit.amount,
        hasAmount: true, // deposits always have amount
        nonce: null, // v2 doesn't have nonce in deposit events
        timestamp: deposit.blockTimestamp,
        txHash: deposit.txHash,
        direction: 'from'
      });
    });
    
    // Process v1 message received events  
    received.forEach(msg => {
      // Map chain ID to domain for destination
      const chainId = parseInt(msg.chainId);
      const destinationDomain = this.getChainIdToDomain(chainId);
      
      events.push({
        type: 'received',
        version: 'v1',
        sourceDomain: parseInt(msg.sourceDomain),
        destinationDomain,
        sourceChain: DOMAINS[msg.sourceDomain] || msg.sourceDomain,
        destinationChain: destinationDomain !== null ? DOMAINS[destinationDomain] : `Chain${chainId}`,
        amount: null, // received events don't have amount
        hasAmount: false,
        nonce: msg.nonce,
        timestamp: msg.blockTimestamp,
        txHash: msg.txHash,
        direction: 'to'
      });
    });
    
    // Process v2 message received events  
    receivedV2.forEach(msg => {
      // Map chain ID to domain for destination
      const chainId = parseInt(msg.chainId);
      const destinationDomain = this.getChainIdToDomain(chainId);
      
      events.push({
        type: 'received',
        version: 'v2',
        sourceDomain: parseInt(msg.sourceDomain),
        destinationDomain,
        sourceChain: DOMAINS[msg.sourceDomain] || msg.sourceDomain,
        destinationChain: destinationDomain !== null ? DOMAINS[destinationDomain] : `Chain${chainId}`,
        amount: null, // received events don't have amount
        hasAmount: false,
        nonce: msg.nonce, // v2 uses bytes32 nonce
        timestamp: msg.blockTimestamp,
        txHash: msg.txHash,
        direction: 'to'
      });
    });
    
    // Sort by timestamp (most recent first), then by type, then by nonce for stable ordering
    return events.sort((a, b) => {
      const timestampDiff = parseInt(b.timestamp) - parseInt(a.timestamp);
      if (timestampDiff !== 0) return timestampDiff;
      
      // If timestamps are equal, sort by type (deposits before received)
      const typeDiff = a.type.localeCompare(b.type);
      if (typeDiff !== 0) return typeDiff;
      
      // If type is also equal, sort by nonce for consistent ordering (handle null nonces)
      const nonceA = a.nonce ? parseInt(a.nonce) || 0 : 0;
      const nonceB = b.nonce ? parseInt(b.nonce) || 0 : 0;
      return nonceA - nonceB;
    }).slice(0, 12); // Show top 12 most recent events
  }

  // Format timestamp for display
  formatTimestamp(timestamp) {
    if (!timestamp) return '?';
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  }

  // Clear terminal and position cursor
  clearScreen() {
    stdout.write('\x1b[2J\x1b[H');
  }

  // Strip ANSI escape codes to get actual visible text length
  stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  // Calculate the actual width needed for content
  calculateContentWidth(content) {
    const lines = content.split('\n');
    let maxWidth = 0;
    
    lines.forEach(line => {
      const visibleLength = this.stripAnsi(line).length;
      maxWidth = Math.max(maxWidth, visibleLength);
    });
    
    // Add padding for borders and spacing (4 chars: "│ " + " │")
    return maxWidth + 4;
  }

  // Draw a box with title (auto-sizes to content if width not specified)
  drawBox(width, height, title, content) {
    // If width is not specified or is 0, calculate based on content
    if (!width || width === 0) {
      const contentWidth = this.calculateContentWidth(content);
      const titleWidth = title.length + 6; // "┌─ " + title + " " + padding
      width = Math.max(contentWidth, titleWidth);
    }
    
    let output = '';
    
    // Top border with title
    output += `${COLORS.cyan}┌─ ${COLORS.bright}${title}${COLORS.reset}${COLORS.cyan} `;
    output += '─'.repeat(Math.max(0, width - title.length - 4));
    output += '┐\n';
    
    // Content lines
    const lines = content.split('\n');
    for (let i = 0; i < height - 2; i++) {
      const line = lines[i] || '';
      const visibleLength = this.stripAnsi(line).length;
      const padding = ' '.repeat(Math.max(0, width - visibleLength - 2));
      output += `${COLORS.cyan}│${COLORS.reset} ${line}${padding}${COLORS.cyan}│\n`;
    }
    
    // Bottom border
    output += `${COLORS.cyan}└${'─'.repeat(width - 2)}┘${COLORS.reset}\n`;
    
    return output;
  }

  // Format binned latency data for display
  formatBinnedLatency(binnedData, version) {
    const versionColor = version === 'v1' ? COLORS.yellow : COLORS.magenta;
    const bins = ['micro', 'small', 'medium', 'large', 'xlarge', 'whale'];
    
    const binnedItems = bins.map(binKey => {
      const bin = binnedData[binKey];
      if (!bin || bin.count === 0) return null;
      return `${bin.label}: ${this.formatDuration(bin.avg)} (${bin.count})`;
    }).filter(item => item !== null);
    
    if (binnedItems.length === 0) return '';
    
    return `${COLORS.bright}${versionColor}${version.toUpperCase()} Latency by Amount:${COLORS.reset} ${binnedItems.join(` ${COLORS.gray}│${COLORS.reset} `)}`;
  }

  // Render metrics section
  renderMetrics() {
    const { metrics } = this.data;
    const binnedV1 = metrics.v1.binnedLatency;
    const binnedV2 = metrics.v2.binnedLatency;
    
    const content = [
      `${COLORS.green}Total Events:${COLORS.reset} ${metrics.totalEvents} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Combined Avg:${COLORS.reset} ${this.formatDuration(metrics.avgLatency)}`,
      
      `${COLORS.bright}${COLORS.yellow}CCTPv1:${COLORS.reset} ` +
      `${COLORS.green}Events:${COLORS.reset} ${metrics.v1.totalDeposits + metrics.v1.totalReceived} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.v1.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Avg:${COLORS.reset} ${this.formatDuration(metrics.v1.avgLatency)}`,
      
      `${COLORS.bright}${COLORS.magenta}CCTPv2:${COLORS.reset} ` +
      `${COLORS.green}Events:${COLORS.reset} ${metrics.v2.totalDeposits + metrics.v2.totalReceived} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.v2.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Avg:${COLORS.reset} ${this.formatDuration(metrics.v2.avgLatency)}`,
      
      `${COLORS.yellow}Latest Blocks:${COLORS.reset} ETH ${metrics.latestBlocks.ethereum.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `OP ${metrics.latestBlocks.optimism.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ARB ${metrics.latestBlocks.arbitrum.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.blue}Base ${metrics.latestBlocks.base.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.magenta}Unichain ${metrics.latestBlocks.unichain.toLocaleString()}`,

      `${COLORS.yellow}More Blocks:${COLORS.reset} ${COLORS.cyan}Linea ${metrics.latestBlocks.linea.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}World Chain ${metrics.latestBlocks.worldchain.toLocaleString()}${COLORS.reset}`,

      `${COLORS.bright}${COLORS.blue}Daily Volume v1:${COLORS.reset} ${this.formatVolume(metrics.v1.dailyVolume.total)} ${COLORS.gray}(${metrics.v1.dailyVolume.count} transfers)${COLORS.reset}`,
      
      `${COLORS.bright}${COLORS.blue}Daily Volume v2:${COLORS.reset} ${this.formatVolume(metrics.v2.dailyVolume.total)} ${COLORS.gray}(${metrics.v2.dailyVolume.count} transfers)${COLORS.reset}`,

      this.formatBinnedLatency(binnedV1, 'v1'),
      this.formatBinnedLatency(binnedV2, 'v2')

    ].filter(line => line !== '').join('\n');

    return this.drawBox(0, 12, 'METRICS (CCTPv1 & v2)', content);
  }

  // Render raw activity feed
  renderRawActivity() {
    const events = this.data.rawEvents.slice(0, 6); // Reduced to fit tx links
    let content = '';
    
    events.forEach(event => {
      const amount = this.formatAmount(event.amount, event.hasAmount);
      const time = this.formatTimestamp(event.timestamp);
      const txUrl = this.formatTxHash(event.txHash, event.direction === 'from' ? event.sourceDomain : event.destinationDomain);
      
      // Color coding for chains
      const getChainColor = (domain) => {
        switch(domain) {
          case 0: return COLORS.yellow;   // Ethereum
          case 2: return COLORS.green;    // OP Mainnet
          case 3: return COLORS.cyan;     // Arbitrum  
          case 6: return COLORS.blue;     // Base
          case 10: return COLORS.magenta; // Unichain
          case 11: return COLORS.cyan;    // Linea
          case 14: return COLORS.green;   // World Chain
          default: return COLORS.white;   // Other chains
        }
      };
      
      const sourceColor = getChainColor(event.sourceDomain);
      const destColor = getChainColor(event.destinationDomain);
      
      const versionLabel = event.version === 'v2' ? `${COLORS.magenta}v2${COLORS.reset}` : `${COLORS.yellow}v1${COLORS.reset}`;
      
      // Main event line
      const eventLine = `${versionLabel} ${sourceColor}${event.sourceChain}${COLORS.reset}→${destColor}${event.destinationChain}${COLORS.reset}: ${COLORS.bright}${amount}${COLORS.reset} ${COLORS.dim}${time}${COLORS.reset}`;
      
      // Transaction link line
      const txLine = `  ${COLORS.gray}tx: ${txUrl}${COLORS.reset}`;
      
      content += eventLine + '\n' + txLine + '\n';
    });

    return this.drawBox(0, 14, 'RAW ACTIVITY', content);
  }

  // Render matched bridges section
  renderMatchedBridges() {
    const transfers = this.data.matchedTransfers.slice(0, 6); // Reduce to fit wider format
    let content = '';

    transfers.forEach(transfer => {
      const srcDomain = DOMAINS[transfer.sourceDomain] || transfer.sourceDomain;
      const dstDomain = DOMAINS[transfer.destinationDomain] || transfer.destinationDomain;
      const amount = this.formatAmount(transfer.amount);
      const depositor = this.formatAddress(transfer.depositor);
      const recipient = this.formatAddress(this.extractRecipient(transfer.mintRecipient));
      const latency = this.formatDuration(parseInt(transfer.latencySeconds));
      const versionLabel = transfer.version === 'v2' ? `${COLORS.magenta}v2${COLORS.reset}` : `${COLORS.yellow}v1${COLORS.reset}`;
      const srcTxShort = this.formatTxHashShort(transfer.sourceTxHash);
      const dstTxShort = this.formatTxHashShort(transfer.destinationTxHash);
      const srcTxUrl = this.formatTxHash(transfer.sourceTxHash, parseInt(transfer.sourceDomain));
      const dstTxUrl = this.formatTxHash(transfer.destinationTxHash, parseInt(transfer.destinationDomain));

      // Main transfer line
      content += `${versionLabel} ${COLORS.cyan}${srcDomain}${COLORS.reset}→${COLORS.yellow}${dstDomain}${COLORS.reset}: `;
      content += `${COLORS.bright}${amount}${COLORS.reset} `;
      content += `${COLORS.green}${depositor}${COLORS.reset}→${COLORS.green}${recipient}${COLORS.reset} `;
      content += `${COLORS.magenta}~${latency}${COLORS.reset}\n`;
      
      // Transaction URLs lines
      content += `  ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}\n`;
      content += `  ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}\n`;
    });

    return this.drawBox(0, Math.min(22, transfers.length * 3 + 2), 'MATCHED BRIDGES', content);
  }

  // Main render function
  render() {
    this.clearScreen();
    
    // Header
    stdout.write(`${COLORS.bright}${COLORS.green}🌱 CCTP Bridge Monitor${COLORS.reset}\n`);
    stdout.write(`${COLORS.gray}Last update: ${new Date(this.lastUpdate).toLocaleTimeString()}${COLORS.reset}\n\n`);
    
    // Render sections
    stdout.write(this.renderMetrics());
    stdout.write(this.renderRawActivity());
    stdout.write(this.renderMatchedBridges());
    
    // Footer
    stdout.write(`\n${COLORS.gray}Press Ctrl+C to exit • Refreshing every ${CONFIG.REFRESH_INTERVAL/1000}s${COLORS.reset}\n`);
  }

  // Start the monitor
  async start() {
    console.log(`${COLORS.green}🌱 Starting CCTP Bridge Monitor...${COLORS.reset}`);
    
    // Initial data fetch
    const success = await this.fetchData();
    if (!success) {
      console.error(`${COLORS.red}Failed to fetch initial data. Is the indexer running at ${CONFIG.GRAPHQL_URL}?${COLORS.reset}`);
      process.exit(1);
    }

    // Initial render
    this.render();

    // Set up refresh interval
    setInterval(async () => {
      await this.fetchData();
      this.render();
    }, 1000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.clearScreen();
      console.log(`${COLORS.green}🌱 Bridge monitoring stopped${COLORS.reset}`);
      process.exit(0);
    });
  }
}

// Check if Node.js has fetch (Node 18+)
if (typeof fetch === 'undefined') {
  console.error('This script requires Node.js 18+ with built-in fetch support.');
  console.error('Please upgrade your Node.js version.');
  process.exit(1);
}

// Start the monitor
const monitor = new CCTPMonitor();
monitor.start().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});