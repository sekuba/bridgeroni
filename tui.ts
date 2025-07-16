#!/usr/bin/env node

/**
 * CCTP Bridge Monitor - Terminal UI
 * 
 * Real-time monitoring dashboard for CCTP v1 and v2 bridge transactions
 * across all supported chains. Refactored for maintainability and extensibility.
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
 * - ANSI terminal rendering with modular components
 * - 1-second refresh rate
 * - Deterministic v2 matching via messageBody decoding
 */

import { stdout } from 'process';

import { 
  COLORS, 
  TUI_CONFIG, 
  TRANSFER_AMOUNT_BINS,
  CHAIN_ID_TO_DOMAIN,
  DOMAIN_TO_CHAIN_NAME
} from './src/constants';

import { 
  formatUSDCAmount,
  formatVolume,
  formatAddress,
  formatTxHashWithUrl,
  formatDuration,
  formatTimestamp,
  extractRecipientAddress,
  getChainNameFromDomain,
  getChainNameFromChainId,
  getChainColorByName,
  convertUSDCToNumber
} from './src/utils/formatters';

import { fetchAllData } from './src/utils/graphql';

// Constants for calculations
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const RECENT_TRANSFER_THRESHOLD_SECONDS = 120; // 2 minutes
const RAW_ACTIVITY_DISPLAY_COUNT = 6;

interface RawEvent {
  type: 'deposit' | 'received';
  version: 'v1' | 'v2';
  sourceDomain: number;
  destinationDomain: number;
  sourceChain: string;
  destinationChain: string;
  amount: bigint | null;
  hasAmount: boolean;
  nonce: string | null;
  timestamp: string;
  txHash: string;
  direction: 'from' | 'to';
}

interface Metrics {
  totalEvents: number;
  v1: VersionMetrics;
  v2: VersionMetrics;
  matchedCount: number;
  avgLatency: number;
  binnedLatency: Record<string, BinnedLatency>;
  dailyVolume: VolumeMetrics;
  latestBlocks: Record<string, number>;
}

interface VersionMetrics {
  totalDeposits: number;
  totalReceived: number;
  matchedCount: number;
  avgLatency: number;
  binnedLatency: Record<string, BinnedLatency>;
  dailyVolume: VolumeMetrics;
}

interface BinnedLatency {
  avg: number;
  count: number;
  label: string;
}

interface VolumeMetrics {
  total: number;
  chains: Record<string, number>;
  count: number;
}

interface Transfer {
  matched?: boolean;
  version: 'v1' | 'v2';
  amount: string;
  latencySeconds: string;
  depositTimestamp: string;
  sourceDomain: string;
  destinationDomain: string;
  depositor: string;
  mintRecipient: string;
  sourceTxHash: string;
  destinationTxHash: string;
  lastUpdated?: string;
}

class CCTPMonitor {
  private data: {
    metrics: Metrics;
    rawEvents: RawEvent[];
    matchedTransfers: Transfer[];
    recentDeposits: any[];
    recentDepositsV2: any[];
    recentReceived: any[];
    recentReceivedV2: any[];
  };
  private lastUpdate: number = 0;

  constructor() {
    this.data = {
      metrics: {} as Metrics,
      rawEvents: [],
      matchedTransfers: [],
      recentDeposits: [],
      recentDepositsV2: [],
      recentReceived: [],
      recentReceivedV2: []
    };
  }

  /**
   * Fetch and process all data
   */
  async fetchData(): Promise<boolean> {
    try {
      const results = await fetchAllData();
      if (!results) return false;

      const [
        recentDepositsData,
        recentDepositsV2Data,
        recentReceivedData,
        recentReceivedV2Data,
        matchedData,
        allTransfersData,
        depositsData,
        depositsV2Data,
        receivedData,
        receivedV2Data,
        latestBlocksDepositsV1Data,
        latestBlocksDepositsV2Data,
        latestBlocksReceivedV1Data,
        latestBlocksReceivedV2Data
      ] = results;

      // Process data with validation
      this.data.recentDeposits = recentDepositsData?.TokenMessenger_DepositForBurn || [];
      this.data.recentDepositsV2 = recentDepositsV2Data?.TokenMessenger_DepositForBurnV2 || [];
      this.data.recentReceived = recentReceivedData?.MessageTransmitter_MessageReceived || [];
      this.data.recentReceivedV2 = recentReceivedV2Data?.MessageTransmitter_MessageReceivedV2 || [];
      this.data.matchedTransfers = matchedData?.CCTPTransfer || [];
      
      // Create raw events feed
      this.data.rawEvents = this.createRawEventsFeed(
        this.data.recentDeposits,
        this.data.recentDepositsV2,
        this.data.recentReceived,
        this.data.recentReceivedV2
      );
      
      // Calculate metrics
      this.calculateMetrics(
        allTransfersData?.CCTPTransfer || [],
        depositsData?.TokenMessenger_DepositForBurn || [],
        depositsV2Data?.TokenMessenger_DepositForBurnV2 || [],
        receivedData?.MessageTransmitter_MessageReceived || [],
        receivedV2Data?.MessageTransmitter_MessageReceivedV2 || [],
        latestBlocksDepositsV1Data?.TokenMessenger_DepositForBurn || [],
        latestBlocksDepositsV2Data?.TokenMessenger_DepositForBurnV2 || [],
        latestBlocksReceivedV1Data?.MessageTransmitter_MessageReceived || [],
        latestBlocksReceivedV2Data?.MessageTransmitter_MessageReceivedV2 || []
      );

      this.lastUpdate = Date.now();
      return true;
    } catch (error) {
      console.error('Error fetching data:', error);
      return false;
    }
  }

  /**
   * Calculate all metrics
   */
  private calculateMetrics(
    allTransfers: Transfer[],
    deposits: any[],
    depositsV2: any[],
    received: any[],
    receivedV2: any[],
    latestBlocksDepositsV1: any[],
    latestBlocksDepositsV2: any[],
    latestBlocksReceivedV1: any[],
    latestBlocksReceivedV2: any[]
  ): void {
    const matchedTransfers = allTransfers.filter(t => t.matched);
    const v1Transfers = matchedTransfers.filter(t => t.version === 'v1');
    const v2Transfers = matchedTransfers.filter(t => t.version === 'v2');
    
    this.data.metrics = {
      totalEvents: deposits.length + depositsV2.length + received.length + receivedV2.length,
      
      v1: {
        totalDeposits: deposits.length,
        totalReceived: received.length,
        matchedCount: v1Transfers.length,
        avgLatency: this.calculateAverageLatency(v1Transfers),
        binnedLatency: this.calculateBinnedLatency(v1Transfers),
        dailyVolume: this.calculateDailyVolume(v1Transfers)
      },
      
      v2: {
        totalDeposits: depositsV2.length,
        totalReceived: receivedV2.length,
        matchedCount: v2Transfers.length,
        avgLatency: this.calculateAverageLatency(v2Transfers),
        binnedLatency: this.calculateBinnedLatency(v2Transfers),
        dailyVolume: this.calculateDailyVolume(v2Transfers)
      },
      
      matchedCount: this.data.matchedTransfers.length,
      avgLatency: this.calculateAverageLatency(this.data.matchedTransfers),
      binnedLatency: this.calculateBinnedLatency(this.data.matchedTransfers),
      dailyVolume: this.calculateDailyVolume(this.data.matchedTransfers),
      latestBlocks: this.calculateLatestBlocks(
        latestBlocksDepositsV1,
        latestBlocksDepositsV2,
        latestBlocksReceivedV1,
        latestBlocksReceivedV2
      )
    };
  }

  /**
   * Calculate average latency for transfers
   */
  private calculateAverageLatency(transfers: Transfer[]): number {
    const latencies = transfers
      .map(t => Number(t.latencySeconds))
      .filter(l => l > 0);
    
    if (latencies.length === 0) return 0;
    
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    return Math.round(avg);
  }

  /**
   * Calculate daily volume (24h rolling)
   */
  private calculateDailyVolume(transfers: Transfer[]): VolumeMetrics {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - MILLISECONDS_PER_DAY);
    const cutoffTimestamp = Math.floor(twentyFourHoursAgo.getTime() / MILLISECONDS_PER_SECOND);

    const recentTransfers = transfers.filter(transfer => {
      const transferTimestamp = Number(transfer.depositTimestamp);
      return transferTimestamp >= cutoffTimestamp;
    });

    const totalVolume = recentTransfers.reduce((sum, transfer) => {
      return sum + convertUSDCToNumber(transfer.amount);
    }, 0);

    const chainVolume: Record<string, number> = {};
    recentTransfers.forEach(transfer => {
      if (!transfer.amount) return;
      const sourceDomain = Number(transfer.sourceDomain);
      const chainName = getChainNameFromDomain(sourceDomain);
      
      if (!chainVolume[chainName]) {
        chainVolume[chainName] = 0;
      }
      chainVolume[chainName] += convertUSDCToNumber(transfer.amount);
    });

    return {
      total: totalVolume,
      chains: chainVolume,
      count: recentTransfers.length
    };
  }

  /**
   * Calculate latency metrics binned by transfer amount
   */
  private calculateBinnedLatency(transfers: Transfer[]): Record<string, BinnedLatency> {
    const bins: Record<string, { latencies: number[]; label: string }> = {};
    
    Object.entries(TRANSFER_AMOUNT_BINS).forEach(([key, config]) => {
      bins[key] = { latencies: [], label: config.label };
    });

    transfers.forEach(transfer => {
      if (!transfer.amount || !transfer.latencySeconds) return;
      
      const amountUSDC = convertUSDCToNumber(transfer.amount);
      const latencySeconds = Number(transfer.latencySeconds);
      
      if (latencySeconds <= 0) return;

      // Categorize by amount bins
      Object.entries(TRANSFER_AMOUNT_BINS).forEach(([binKey, config]) => {
        if (amountUSDC >= config.min && amountUSDC <= config.max) {
          bins[binKey].latencies.push(latencySeconds);
        }
      });
    });

    // Calculate averages
    const result: Record<string, BinnedLatency> = {};
    Object.entries(bins).forEach(([binKey, bin]) => {
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

  /**
   * Calculate latest blocks for each chain from all events in the database
   */
  private calculateLatestBlocks(
    latestBlocksDepositsV1: any[],
    latestBlocksDepositsV2: any[],
    latestBlocksReceivedV1: any[],
    latestBlocksReceivedV2: any[]
  ): Record<string, number> {
    const latestBlocks: Record<string, number> = {};
    
    // Initialize with known chains
    Object.entries(DOMAIN_TO_CHAIN_NAME).forEach(([, chainName]) => {
      latestBlocks[chainName] = 0;
    });

    // Process latest blocks from database queries
    [
      ...latestBlocksDepositsV1,
      ...latestBlocksDepositsV2,
      ...latestBlocksReceivedV1,
      ...latestBlocksReceivedV2
    ].forEach(event => {
      const chainId = Number(event.chainId);
      const chainName = getChainNameFromChainId(chainId);
      const blockNumber = Number(event.blockNumber);
      
      if (blockNumber > 0 && chainName) {
        // Take the maximum block number for each chain
        latestBlocks[chainName] = Math.max(
          latestBlocks[chainName] || 0,
          blockNumber
        );
      }
    });

    return latestBlocks;
  }

  /**
   * Create raw events feed from recent events
   */
  private createRawEventsFeed(
    deposits: any[],
    depositsV2: any[],
    received: any[],
    receivedV2: any[]
  ): RawEvent[] {
    const events: RawEvent[] = [];
    
    // Process v1 deposits
    deposits.forEach(deposit => {
      events.push(this.createDepositEvent(deposit, 'v1'));
    });
    
    // Process v2 deposits
    depositsV2.forEach(deposit => {
      events.push(this.createDepositEvent(deposit, 'v2'));
    });
    
    // Process v1 received
    received.forEach(msg => {
      events.push(this.createReceivedEvent(msg, 'v1'));
    });
    
    // Process v2 received
    receivedV2.forEach(msg => {
      events.push(this.createReceivedEvent(msg, 'v2'));
    });
    
    // Sort and limit events
    return events
      .sort((a, b) => {
        const timestampDiff = Number(b.timestamp) - Number(a.timestamp);
        if (timestampDiff !== 0) return timestampDiff;
        
        const typeDiff = a.type.localeCompare(b.type);
        if (typeDiff !== 0) return typeDiff;
        
        return 0;
      })
      .slice(0, TUI_CONFIG.MAX_RAW_EVENTS);
  }

  /**
   * Create a deposit event from raw data
   */
  private createDepositEvent(deposit: any, version: 'v1' | 'v2'): RawEvent {
    const chainId = Number(deposit.chainId);
    const sourceDomain = CHAIN_ID_TO_DOMAIN[chainId];
    
    return {
      type: 'deposit',
      version,
      sourceDomain: sourceDomain !== undefined ? sourceDomain : chainId,
      destinationDomain: Number(deposit.destinationDomain),
      sourceChain: getChainNameFromChainId(chainId),
      destinationChain: getChainNameFromDomain(Number(deposit.destinationDomain)),
      amount: BigInt(deposit.amount),
      hasAmount: true,
      nonce: version === 'v1' ? deposit.nonce : null,
      timestamp: deposit.blockTimestamp,
      txHash: deposit.txHash,
      direction: 'from'
    };
  }

  /**
   * Create a received event from raw data
   */
  private createReceivedEvent(msg: any, version: 'v1' | 'v2'): RawEvent {
    const chainId = Number(msg.chainId);
    const destDomain = CHAIN_ID_TO_DOMAIN[chainId];
    
    return {
      type: 'received',
      version,
      sourceDomain: Number(msg.sourceDomain),
      destinationDomain: destDomain !== undefined ? destDomain : chainId,
      sourceChain: getChainNameFromDomain(Number(msg.sourceDomain)),
      destinationChain: getChainNameFromChainId(chainId),
      amount: null,
      hasAmount: false,
      nonce: msg.nonce,
      timestamp: msg.blockTimestamp,
      txHash: msg.txHash,
      direction: 'to'
    };
  }

  /**
   * Terminal utilities
   */
  private clearScreen(): void {
    stdout.write('\x1b[2J\x1b[H');
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  private calculateContentWidth(content: string): number {
    const lines = content.split('\n');
    let maxWidth = 0;
    
    lines.forEach(line => {
      const visibleLength = this.stripAnsi(line).length;
      maxWidth = Math.max(maxWidth, visibleLength);
    });
    
    return maxWidth + 4; // Add padding for borders
  }

  private drawBox(width: number, height: number, title: string, content: string): string {
    if (!width || width === 0) {
      const contentWidth = this.calculateContentWidth(content);
      const titleWidth = title.length + 6;
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

  /**
   * Render sections
   */
  private renderMetrics(): string {
    const { metrics } = this.data;
    
    const content = [
      `${COLORS.green}Total Events:${COLORS.reset} ${metrics.totalEvents} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Combined Avg:${COLORS.reset} ${formatDuration(metrics.avgLatency)}`,
      
      `${COLORS.bright}${COLORS.yellow}CCTPv1:${COLORS.reset} ` +
      `${COLORS.green}Events:${COLORS.reset} ${metrics.v1.totalDeposits + metrics.v1.totalReceived} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.v1.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Avg:${COLORS.reset} ${formatDuration(metrics.v1.avgLatency)}`,
      
      `${COLORS.bright}${COLORS.magenta}CCTPv2:${COLORS.reset} ` +
      `${COLORS.green}Events:${COLORS.reset} ${metrics.v2.totalDeposits + metrics.v2.totalReceived} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.v2.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Avg:${COLORS.reset} ${formatDuration(metrics.v2.avgLatency)}`,
      
      `${COLORS.yellow}Latest Blocks:${COLORS.reset} ${getChainColorByName('ethereum')}ETH ${(metrics.latestBlocks.ethereum || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByName('op')}OP ${(metrics.latestBlocks.op || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ${getChainColorByName('arbitrum')}ARB ${(metrics.latestBlocks.arbitrum || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByName('base')}Base ${(metrics.latestBlocks.base || 0).toLocaleString()}${COLORS.reset}`,

      `               ${getChainColorByName('unichain')}Unichain ${(metrics.latestBlocks.unichain || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByName('linea')}Linea ${(metrics.latestBlocks.linea || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByName('worldchain')}World Chain ${(metrics.latestBlocks.worldchain || 0).toLocaleString()}${COLORS.reset}`,

      `${COLORS.bright}${COLORS.blue}Daily Volume v1:${COLORS.reset} ${formatVolume(metrics.v1.dailyVolume.total)} ${COLORS.gray}(${metrics.v1.dailyVolume.count} transfers)${COLORS.reset}`,
      
      `${COLORS.bright}${COLORS.blue}             v2:${COLORS.reset} ${formatVolume(metrics.v2.dailyVolume.total)} ${COLORS.gray}(${metrics.v2.dailyVolume.count} transfers)${COLORS.reset}`,

      this.formatBinnedLatency(metrics.v1.binnedLatency, 'v1'),
      this.formatBinnedLatency(metrics.v2.binnedLatency, 'v2')

    ].filter(line => line !== '').join('\n');

    return this.drawBox(0, 11, 'METRICS (CCTPv1 & v2)', content);
  }

  private formatBinnedLatency(binnedData: Record<string, BinnedLatency>, version: string): string {
    const versionColor = version === 'v1' ? COLORS.yellow : COLORS.magenta;
    const bins = ['micro', 'small', 'medium', 'large', 'xlarge', 'whale'];
    
    const binnedItems = bins.map(binKey => {
      const bin = binnedData[binKey];
      if (!bin || bin.count === 0) return null;
      return `${bin.label}: ${formatDuration(bin.avg)} (${bin.count})`;
    }).filter(item => item !== null);
    
    if (binnedItems.length === 0) return '';
    
    return `${COLORS.bright}${versionColor}${version.toUpperCase()} Latency by Amount:${COLORS.reset} ${binnedItems.join(` ${COLORS.gray}│${COLORS.reset} `)}`;
  }

  private renderRawActivity(): string {
    const events = this.data.rawEvents.slice(0, RAW_ACTIVITY_DISPLAY_COUNT);
    let content = '';
    
    events.forEach(event => {
      const amount = formatUSDCAmount(event.amount, event.hasAmount);
      const time = formatTimestamp(event.timestamp);
      const txUrl = formatTxHashWithUrl(event.txHash, event.direction === 'from' ? event.sourceDomain : event.destinationDomain);
      
      const sourceColor = getChainColorByName(event.sourceChain);
      const destColor = getChainColorByName(event.destinationChain);
      
      const versionLabel = event.version === 'v2' ? `${COLORS.magenta}v2${COLORS.reset}` : `${COLORS.yellow}v1${COLORS.reset}`;
      
      const eventLine = `${versionLabel} ${sourceColor}${event.sourceChain}${COLORS.reset}→${destColor}${event.destinationChain}${COLORS.reset}: ${COLORS.bright}${amount}${COLORS.reset} ${COLORS.dim}${time}${COLORS.reset}`;
      const txLine = `  ${COLORS.gray}tx: ${txUrl}${COLORS.reset}`;
      
      content += eventLine + '\n' + txLine + '\n';
    });

    return this.drawBox(0, 14, 'RAW ACTIVITY', content);
  }

  private renderMatchedBridges(): string {
    const transfers = this.data.matchedTransfers.slice(0, TUI_CONFIG.MAX_MATCHED_TRANSFERS);
    let content = '';

    transfers.forEach((transfer) => {
      const srcDomain = getChainNameFromDomain(Number(transfer.sourceDomain));
      const dstDomain = getChainNameFromDomain(Number(transfer.destinationDomain));
      const amount = formatUSDCAmount(BigInt(transfer.amount));
      const depositor = formatAddress(transfer.depositor);
      const recipient = formatAddress(extractRecipientAddress(transfer.mintRecipient));
      const latency = formatDuration(Number(transfer.latencySeconds));
      const versionLabel = transfer.version === 'v2' ? `${COLORS.magenta}v2${COLORS.reset}` : `${COLORS.yellow}v1${COLORS.reset}`;
      const srcTxUrl = formatTxHashWithUrl(transfer.sourceTxHash, Number(transfer.sourceDomain));
      const dstTxUrl = formatTxHashWithUrl(transfer.destinationTxHash, Number(transfer.destinationDomain));
      
      // Highlight recently updated transfers (within last 2 minutes)
      const lastUpdated = Number(transfer.lastUpdated || 0);
      const twoMinutesAgo = Date.now() / MILLISECONDS_PER_SECOND - RECENT_TRANSFER_THRESHOLD_SECONDS;
      const isRecent = lastUpdated > twoMinutesAgo;
      const newIndicator = isRecent ? `${COLORS.green}●${COLORS.reset} ` : '';

      content += `${newIndicator}${versionLabel} ${getChainColorByName(srcDomain)}${srcDomain}${COLORS.reset}→${getChainColorByName(dstDomain)}${dstDomain}${COLORS.reset}: `;
      content += `${COLORS.bright}${amount}${COLORS.reset} `;
      content += `${COLORS.green}${depositor}${COLORS.reset}→${COLORS.green}${recipient}${COLORS.reset} `;
      content += `${COLORS.magenta}~${latency}${COLORS.reset}\n`;
      
      content += `  ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}\n`;
      content += `  ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}\n`;
    });

    return this.drawBox(0, Math.min(22, transfers.length * 3 + 2), 'MATCHED BRIDGES', content);
  }

  /**
   * Main render function
   */
  render(): void {
    this.clearScreen();
    
    // Header
    stdout.write(`${COLORS.bright}${COLORS.green}🌱 CCTP Bridge Monitor${COLORS.reset}\n`);
    stdout.write(`${COLORS.gray}Last update: ${new Date(this.lastUpdate).toLocaleTimeString()}${COLORS.reset}\n\n`);
    
    // Render sections
    stdout.write(this.renderMetrics());
    stdout.write(this.renderRawActivity());
    stdout.write(this.renderMatchedBridges());
    
    // Footer
    stdout.write(`${COLORS.gray}Press Ctrl+C to exit • Refreshing every ${TUI_CONFIG.REFRESH_INTERVAL/1000}s${COLORS.reset}`);
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    console.log(`${COLORS.green}🌱 Starting CCTP Bridge Monitor...${COLORS.reset}`);
    
    // Initial data fetch
    const success = await this.fetchData();
    if (!success) {
      console.error(`${COLORS.red}Failed to fetch initial data. Is the indexer running at ${TUI_CONFIG.GRAPHQL_URL}?${COLORS.reset}`);
      process.exit(1);
    }

    // Initial render
    this.render();

    // Set up refresh interval
    setInterval(async () => {
      await this.fetchData();
      this.render();
    }, TUI_CONFIG.REFRESH_INTERVAL);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.clearScreen();
      console.log(`${COLORS.green}🌱 Bridge monitoring stopped${COLORS.reset}`);
      process.exit(0);
    });
  }
}

// Check Node.js version and start
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