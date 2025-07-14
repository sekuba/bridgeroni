#!/usr/bin/env node

/**
 * CCTP Bridge Monitor - Solarpunk TUI
 * 
 * A suckless terminal interface for monitoring CCTP bridge transactions
 * between Ethereum and Base. Uses only Node.js built-ins for maximum
 * maintainability and cypherpunk minimalism.
 * 
 * Architecture:
 * - GraphQL queries fetch data from Hasura API
 * - Terminal rendering using ANSI escape codes
 * - Real-time updates every 5 seconds
 * - Three main sections: Metrics, Raw Activity, Matched Bridges
 */

const { stdout } = process;
const { performance } = require('perf_hooks');

// ANSI colors for solarpunk aesthetic (greens, cyans, earth tones)
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

// Domain mappings for all CCTP-supported chains
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

// GraphQL endpoint
const GRAPHQL_URL = 'http://localhost:8080/v1/graphql';

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
      console.error(`GraphQL Error: ${error.message}`);
      return null;
    }
  }

  // Fetch all required data
  async fetchData() {
    const queries = {
      // Get recent deposit events directly from raw events with enhanced metadata
      recentDeposits: `{
        TokenMessenger_DepositForBurn(
          limit: 15, 
          order_by: {blockTimestamp: desc}
        ) {
          id nonce amount depositor destinationDomain
          chainId blockTimestamp txHash
        }
      }`,
      
      // Get recent received events directly from raw events with enhanced metadata
      recentReceived: `{
        MessageTransmitter_MessageReceived(
          limit: 15, 
          order_by: {blockTimestamp: desc}
        ) {
          id nonce sourceDomain caller
          chainId blockTimestamp txHash
        }
      }`,
      
      // Get all matched transfers for display
      matchedTransfers: `{
        CCTPTransfer(
          where: {matched: {_eq: true}}, 
          order_by: {depositTimestamp: desc}
        ) {
          id sourceDomain destinationDomain nonce amount 
          depositor mintRecipient sourceTxHash destinationTxHash
          depositTimestamp messageReceivedTimestamp latencySeconds
        }
      }`,
      
      // Get all transfers for metrics calculation
      allTransfers: `{
        CCTPTransfer(order_by: {depositTimestamp: desc}) {
          matched latencySeconds sourceDomain destinationDomain
          depositBlock messageReceivedBlock
        }
      }`,
      
      // Get raw event counts (we'll count them ourselves)
      allDeposits: `{
        TokenMessenger_DepositForBurn { id }
      }`,
      
      allReceived: `{
        MessageTransmitter_MessageReceived { id }
      }`
    };

    const results = await Promise.all([
      this.graphql(queries.recentDeposits),
      this.graphql(queries.recentReceived),
      this.graphql(queries.matchedTransfers),
      this.graphql(queries.allTransfers),
      this.graphql(queries.allDeposits),
      this.graphql(queries.allReceived)
    ]);

    if (results.some(r => !r)) return false;

    const [recentDepositsData, recentReceivedData, matchedData, allTransfersData, depositsData, receivedData] = results;

    // Process data
    this.data.recentDeposits = recentDepositsData.TokenMessenger_DepositForBurn;
    this.data.recentReceived = recentReceivedData.MessageTransmitter_MessageReceived;
    this.data.matchedTransfers = matchedData.CCTPTransfer;
    
    // Create combined raw events feed from recent deposits and receives
    this.data.rawEvents = this.createRawEventsFeed(
      this.data.recentDeposits, 
      this.data.recentReceived
    );
    
    // Calculate metrics
    const allTransfers = allTransfersData.CCTPTransfer;
    const matchedTransfers = allTransfers.filter(t => t.matched);
    
    this.data.metrics = {
      totalEvents: depositsData.TokenMessenger_DepositForBurn.length + receivedData.MessageTransmitter_MessageReceived.length,
      totalDeposits: depositsData.TokenMessenger_DepositForBurn.length,
      totalReceived: receivedData.MessageTransmitter_MessageReceived.length,
      matchedCount: this.data.matchedTransfers.length, // Total matched transfers from dedicated query
      avgLatency: this.calculateAverageLatency(this.data.matchedTransfers), // Use the matched transfers data
      binnedLatency: this.calculateBinnedLatency(this.data.matchedTransfers), // Amount-binned latency metrics
      dailyVolume: this.calculateDailyVolume(this.data.matchedTransfers), // Daily volume metrics
      latestBlocks: {
        ethereum: this.getLatestBlock(allTransfers, 0),
        optimism: this.getLatestBlock(allTransfers, 2), 
        arbitrum: this.getLatestBlock(allTransfers, 3),
        base: this.getLatestBlock(allTransfers, 6),
        unichain: this.getLatestBlock(allTransfers, 10)
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
      return sum + (parseInt(transfer.amount) / 1e6); // Convert to USDC
    }, 0);

    // Calculate per-chain volume
    const chainVolume = {};
    recentTransfers.forEach(transfer => {
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
    const bins = {
      micro: { min: 0, max: 10, latencies: [], label: '0-10' },
      small: { min: 11, max: 100, latencies: [], label: '11-100' },
      medium: { min: 101, max: 1000, latencies: [], label: '101-1k' },
      large1: { min: 1001, max: 10000, latencies: [], label: '1k-10k' },
      large2: { min: 10001, max: 100000, latencies: [], label: '10k-100k' },
      whale: { min: 100001, max: Infinity, latencies: [], label: '100k+' }
    };

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
      } else if (amountUSDC >= bins.large1.min && amountUSDC <= bins.large1.max) {
        bins.large1.latencies.push(latencySeconds);
      } else if (amountUSDC >= bins.large2.min && amountUSDC <= bins.large2.max) {
        bins.large2.latencies.push(latencySeconds);
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
      0: 'https://etherscan.io/tx/',           // Ethereum
      2: 'https://optimistic.etherscan.io/tx/', // OP Mainnet
      3: 'https://arbiscan.io/tx/',            // Arbitrum
      6: 'https://basescan.org/tx/',           // Base
      10: 'https://uniscan.xyz/tx/'                   // Unichain
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
  createRawEventsFeed(deposits, received) {
    const events = [];
    
    // Process deposit events
    deposits.forEach(deposit => {
      // Map chain ID to domain for source
      const chainId = parseInt(deposit.chainId);
      const sourceDomain = this.getChainIdToDomain(chainId);
      
      events.push({
        type: 'deposit',
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
    
    // Process message received events  
    received.forEach(msg => {
      // Map chain ID to domain for destination
      const chainId = parseInt(msg.chainId);
      const destinationDomain = this.getChainIdToDomain(chainId);
      
      events.push({
        type: 'received',
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
    
    // Sort by timestamp (most recent first), then by type, then by nonce for stable ordering
    return events.sort((a, b) => {
      const timestampDiff = parseInt(b.timestamp) - parseInt(a.timestamp);
      if (timestampDiff !== 0) return timestampDiff;
      
      // If timestamps are equal, sort by type (deposits before received)
      const typeDiff = a.type.localeCompare(b.type);
      if (typeDiff !== 0) return typeDiff;
      
      // If type is also equal, sort by nonce for consistent ordering
      return parseInt(a.nonce) - parseInt(b.nonce);
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

  // Render metrics section
  renderMetrics() {
    const { metrics } = this.data;
    const binned = metrics.binnedLatency;
    
    const content = [
      `${COLORS.green}Events:${COLORS.reset} ${metrics.totalEvents} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Global Avg:${COLORS.reset} ${this.formatDuration(metrics.avgLatency)}`,
      
      `${COLORS.yellow}Latest Blocks:${COLORS.reset} ETH ${metrics.latestBlocks.ethereum.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `OP ${metrics.latestBlocks.optimism.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ARB ${metrics.latestBlocks.arbitrum.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.blue}Base ${metrics.latestBlocks.base.toLocaleString()} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.magenta}Unichain ${metrics.latestBlocks.unichain.toLocaleString()}${COLORS.reset}`,

      `${COLORS.bright}${COLORS.blue}Daily Volume:${COLORS.reset} ${this.formatVolume(metrics.dailyVolume.total)} ${COLORS.gray}(${metrics.dailyVolume.count} transfers)${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${['ETHEREUM', 'BASE', 'ARBITRUM', 'UNICHAIN'].filter(chain => metrics.dailyVolume.chains[chain]).map(chain => 
        `${chain}: ${this.formatVolume(metrics.dailyVolume.chains[chain])}`
      ).join(` ${COLORS.gray}│${COLORS.reset} `)}`,

      `${COLORS.cyan}Latency by Amount:${COLORS.reset} ` +
      `${COLORS.dim}${binned.micro.label}:${COLORS.reset} ${binned.micro.count > 0 ? this.formatDuration(binned.micro.avg) : '?'} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.dim}${binned.small.label}:${COLORS.reset} ${binned.small.count > 0 ? this.formatDuration(binned.small.avg) : '?'} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.dim}${binned.medium.label}:${COLORS.reset} ${binned.medium.count > 0 ? this.formatDuration(binned.medium.avg) : '?'} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.dim}${binned.large1.label}:${COLORS.reset} ${binned.large1.count > 0 ? this.formatDuration(binned.large1.avg) : '?'} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.dim}${binned.large2.label}:${COLORS.reset} ${binned.large2.count > 0 ? this.formatDuration(binned.large2.avg) : '?'} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.bright}${COLORS.magenta}${binned.whale.label}:${COLORS.reset} ${binned.whale.count > 0 ? this.formatDuration(binned.whale.avg) : '?'}`,

      `${COLORS.gray}Samples (${binned.micro.label}│${binned.small.label}│${binned.medium.label}│${binned.large1.label}│${binned.large2.label}│${binned.whale.label}): ` +
      `${binned.micro.count} │ ${binned.small.count} │ ${binned.medium.count} │ ${binned.large1.count} │ ${binned.large2.count} │ ${binned.whale.count}${COLORS.reset}`
    ].join('\n');

    return this.drawBox(0, 8, 'METRICS', content);
  }

  // Render raw activity feed
  renderRawActivity() {
    const events = this.data.rawEvents.slice(0, 8);
    const content = events.map(event => {
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
          default: return COLORS.white;   // Other chains
        }
      };
      
      const sourceColor = getChainColor(event.sourceDomain);
      const destColor = getChainColor(event.destinationDomain);
      
      let line = '';
      if (event.type === 'deposit') {
        // Deposit: money leaving source chain
        line = `${sourceColor}${event.sourceChain}${COLORS.reset}→${destColor}${event.destinationChain}${COLORS.reset}: ${COLORS.bright}${amount}${COLORS.reset} ${COLORS.dim}${time}${COLORS.reset} ${COLORS.gray}${txUrl}${COLORS.reset}`;
      } else {
        // Received: money arriving at destination chain  
        line = `${sourceColor}${event.sourceChain}${COLORS.reset}→${destColor}${event.destinationChain}${COLORS.reset}: ${COLORS.bright}${amount}${COLORS.reset} ${COLORS.dim}${time}${COLORS.reset} ${COLORS.gray}${txUrl}${COLORS.reset}`;
      }
      
      return line;
    }).join('\n');

    return this.drawBox(0, 10, 'RAW ACTIVITY', content);
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
      const srcTxShort = this.formatTxHashShort(transfer.sourceTxHash);
      const dstTxShort = this.formatTxHashShort(transfer.destinationTxHash);
      const srcTxUrl = this.formatTxHash(transfer.sourceTxHash, parseInt(transfer.sourceDomain));
      const dstTxUrl = this.formatTxHash(transfer.destinationTxHash, parseInt(transfer.destinationDomain));

      // Main transfer line
      content += `${COLORS.cyan}${srcDomain}${COLORS.reset}→${COLORS.yellow}${dstDomain}${COLORS.reset}: `;
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
    stdout.write(`\n${COLORS.gray}Press Ctrl+C to exit • Refreshing every 1s${COLORS.reset}\n`);
  }

  // Start the monitor
  async start() {
    console.log(`${COLORS.green}🌱 Starting CCTP Bridge Monitor...${COLORS.reset}`);
    
    // Initial data fetch
    const success = await this.fetchData();
    if (!success) {
      console.error(`${COLORS.red}Failed to fetch initial data. Is the indexer running?${COLORS.reset}`);
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
      console.log(`${COLORS.green}🌱 Bridge monitoring stopped. Keep scaling Ethereum! ${COLORS.reset}`);
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