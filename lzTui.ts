#!/usr/bin/env node

/**
 * LayerZero Bridge Monitor - Terminal UI
 * 
 * Real-time monitoring dashboard for LayerZero v2 packet transactions
 * across all supported chains. Built with the same architecture as CCTP TUI.
 * 
 * Features:
 * - Real-time packet monitoring with latency analysis
 * - Raw packet event feed (PacketSent/PacketDelivered)
 * - Matched packet display with cross-chain routing
 * - Support for all LayerZero v2 chains
 * - Interactive list/filter views by EID
 * - Transaction hash search functionality
 * 
 * Architecture:
 * - GraphQL queries to Hasura/Envio indexer
 * - ANSI terminal rendering with modular components
 * - 1-second refresh rate
 * - Packet header decoding for routing information
 */

import { stdout, stdin } from 'process';

import { 
  COLORS, 
  TUI_CONFIG,
  LAYERZERO_EID_TO_CHAIN_NAME,
  CHAIN_ID_TO_LAYERZERO_EID
} from './src/constants';

import { 
  formatDuration,
  formatTimestamp
} from './src/utils/formatters';

import {
  getChainNameFromEid,
  getChainNameFromChainId,
  formatEid,
  formatPayload,
  formatOptions,
  formatSendLibrary,
  formatNonce,
  formatBytes32Address,
  formatTxHashWithUrl,
  getChainColorByEid,
  formatPacketSize,
  formatPacketDirection,
  formatPacketStatus,
  formatPacketDetails,
  formatEidNavigationHints
} from './src/utils/layerzeroFormatters';

import { fetchAllLayerZeroData } from './src/utils/layerzeroGraphql';

import { decodePacket } from './src/utils/layerzeroDecoder';

// Constants for calculations
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const RECENT_PACKET_THRESHOLD_SECONDS = 120; // 2 minutes
const RAW_ACTIVITY_DISPLAY_COUNT = 6;

interface RawPacketEvent {
  type: 'sent' | 'delivered';
  srcEid: number;
  dstEid: number;
  sourceChain: string;
  destinationChain: string;
  payload: string | null;
  hasPayload: boolean;
  nonce: string | null;
  timestamp: string;
  txHash: string;
  direction: 'from' | 'to';
  sender?: string;
  receiver?: string;
  options?: string;
  sendLibrary?: string;
}

interface PacketMetrics {
  totalEvents: number;
  totalSent: number;
  totalDelivered: number;
  matchedCount: number;
  avgLatency: number;
  latestBlocks: Record<string, number>;
}

interface Packet {
  matched?: boolean;
  srcEid: string;
  dstEid: string;
  nonce: string;
  sender: string;
  receiver: string;
  payload: string;
  latencySeconds: string;
  sentTimestamp: string;
  sourceTxHash: string;
  destinationTxHash: string;
  lastUpdated?: string;
  hasPayload: boolean;
  encodedPayload?: string;
  options?: string;
  sendLibrary?: string;
}

interface UIState {
  mode: 'dashboard' | 'list' | 'search';
  listFilter: {
    type: 'from' | 'to';
    eid: string;
  };
  searchQuery: string;
  selectedIndex: number;
  maxDisplayItems: number;
}

class LayerZeroMonitor {
  private data: {
    metrics: PacketMetrics;
    rawEvents: RawPacketEvent[];
    matchedPackets: Packet[];
    recentPacketsSent: any[];
    recentPacketsDelivered: any[];
  };
  private lastUpdate: number = 0;
  private uiState: UIState;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.data = {
      metrics: {} as PacketMetrics,
      rawEvents: [],
      matchedPackets: [],
      recentPacketsSent: [],
      recentPacketsDelivered: []
    };
    this.uiState = {
      mode: 'dashboard',
      listFilter: {
        type: 'from',
        eid: '30101' // Default to Ethereum EID
      },
      searchQuery: '',
      selectedIndex: 0,
      maxDisplayItems: 15
    };
  }

  /**
   * Fetch and process all LayerZero data
   */
  async fetchData(): Promise<boolean> {
    try {
      const results = await fetchAllLayerZeroData();
      if (!results) return false;

      const [
        recentPacketsSentData,
        recentPacketsDeliveredData,
        matchedPacketsData,
        allPacketsData,
        allPacketsSentData,
        allPacketsDeliveredData,
        latestBlocksPacketsSentData,
        latestBlocksPacketsDeliveredData
      ] = results;

      // Process data with validation
      this.data.recentPacketsSent = recentPacketsSentData?.EndpointV2_PacketSent || [];
      this.data.recentPacketsDelivered = recentPacketsDeliveredData?.EndpointV2_PacketDelivered || [];
      this.data.matchedPackets = matchedPacketsData?.LayerZeroPacket || [];
      
      // Create raw events feed
      this.data.rawEvents = this.createRawEventsFeed(
        this.data.recentPacketsSent,
        this.data.recentPacketsDelivered
      );
      
      // Calculate metrics
      this.calculateMetrics(
        allPacketsData?.LayerZeroPacket || [],
        allPacketsSentData?.EndpointV2_PacketSent || [],
        allPacketsDeliveredData?.EndpointV2_PacketDelivered || [],
        latestBlocksPacketsSentData?.EndpointV2_PacketSent || [],
        latestBlocksPacketsDeliveredData?.EndpointV2_PacketDelivered || []
      );

      this.lastUpdate = Date.now();
      return true;
    } catch (error) {
      console.error('Error fetching LayerZero data:', error);
      return false;
    }
  }

  /**
   * Calculate all LayerZero metrics
   */
  private calculateMetrics(
    allPackets: Packet[],
    sentPackets: any[],
    deliveredPackets: any[],
    latestBlocksPacketsSent: any[],
    latestBlocksPacketsDelivered: any[]
  ): void {
    const matchedPackets = allPackets.filter(p => p.matched);
    
    this.data.metrics = {
      totalEvents: sentPackets.length + deliveredPackets.length,
      totalSent: sentPackets.length,
      totalDelivered: deliveredPackets.length,
      matchedCount: matchedPackets.length,
      avgLatency: this.calculateAverageLatency(matchedPackets),
      latestBlocks: this.calculateLatestBlocks(
        latestBlocksPacketsSent,
        latestBlocksPacketsDelivered
      )
    };
  }

  /**
   * Calculate average latency for packets
   */
  private calculateAverageLatency(packets: Packet[]): number {
    const latencies = packets
      .map(p => Number(p.latencySeconds))
      .filter(l => l > 0 && !isNaN(l));
    
    if (latencies.length === 0) return 0;
    
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    return Math.round(avg);
  }

  /**
   * Calculate latest blocks for each chain
   */
  private calculateLatestBlocks(
    latestBlocksPacketsSent: any[],
    latestBlocksPacketsDelivered: any[]
  ): Record<string, number> {
    const latestBlocks: Record<string, number> = {};
    
    // Initialize with known chains
    Object.entries(LAYERZERO_EID_TO_CHAIN_NAME).forEach(([, chainName]) => {
      latestBlocks[chainName] = 0;
    });

    // Process latest blocks from database queries
    [
      ...latestBlocksPacketsSent,
      ...latestBlocksPacketsDelivered
    ].forEach(event => {
      const chainId = Number(event.chainId);
      const chainName = getChainNameFromChainId(chainId);
      const blockNumber = Number(event.blockNumber);
      
      if (blockNumber > 0 && chainName) {
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
    sentPackets: any[],
    deliveredPackets: any[]
  ): RawPacketEvent[] {
    const events: RawPacketEvent[] = [];
    
    // Process sent packets
    sentPackets.forEach(packet => {
      events.push(this.createSentEvent(packet));
    });
    
    // Process delivered packets
    deliveredPackets.forEach(packet => {
      events.push(this.createDeliveredEvent(packet));
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
   * Create a sent event from raw data
   */
  private createSentEvent(packet: any): RawPacketEvent {
    const chainId = Number(packet.chainId);
    const srcEid = CHAIN_ID_TO_LAYERZERO_EID[chainId];
    
    // Decode packet to get routing info
    const decodedPacket = decodePacket(packet.encodedPayload);
    const dstEid = decodedPacket?.header.dstEid || 0;
    
    return {
      type: 'sent',
      srcEid: srcEid || 0,
      dstEid,
      sourceChain: getChainNameFromChainId(chainId),
      destinationChain: getChainNameFromEid(dstEid),
      payload: decodedPacket?.payload || null,
      hasPayload: !!(decodedPacket?.payload && decodedPacket.payload !== '0x'),
      nonce: decodedPacket?.header.nonce.toString() || null,
      timestamp: packet.blockTimestamp,
      txHash: packet.txHash,
      direction: 'from',
      sender: decodedPacket?.header.sender,
      receiver: decodedPacket?.header.receiver,
      options: packet.options,
      sendLibrary: packet.sendLibrary
    };
  }

  /**
   * Create a delivered event from raw data
   */
  private createDeliveredEvent(packet: any): RawPacketEvent {
    const chainId = Number(packet.chainId);
    const dstEid = CHAIN_ID_TO_LAYERZERO_EID[chainId];
    const srcEid = Number(packet.originSrcEid);
    
    return {
      type: 'delivered',
      srcEid,
      dstEid: dstEid || 0,
      sourceChain: getChainNameFromEid(srcEid),
      destinationChain: getChainNameFromChainId(chainId),
      payload: null,
      hasPayload: false,
      nonce: packet.originNonce?.toString() || null,
      timestamp: packet.blockTimestamp,
      txHash: packet.txHash,
      direction: 'to',
      sender: packet.originSender,
      receiver: packet.receiver
    };
  }

  /**
   * Keyboard input handling
   */
  private setupKeyboardInput(): void {
    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
    }
    stdin.on('data', (key: string) => {
      const keyCode = key.charCodeAt(0);

      // Handle Ctrl+C to exit
      if (keyCode === 3) {
        this.clearScreen();
        console.log(`${COLORS.green}🌱 LayerZero monitoring stopped${COLORS.reset}`);
        process.exit(0);
      }

      // Handle different keys based on current mode
      if (this.uiState.mode === 'dashboard') {
        this.handleDashboardKeys(key);
      } else if (this.uiState.mode === 'list') {
        this.handleListKeys(key);
      } else if (this.uiState.mode === 'search') {
        this.handleSearchKeys(key);
      }

      this.render();
    });
  }

  private handleDashboardKeys(key: string): void {
    switch (key) {
      case 'l':
        this.uiState.mode = 'list';
        break;
      case 's':
        this.uiState.mode = 'search';
        this.uiState.searchQuery = '';
        break;
    }
  }

  private handleListKeys(key: string): void {
    const filteredPackets = this.getFilteredPackets();
    const maxItems = Math.min(filteredPackets.length, this.uiState.maxDisplayItems);
    
    switch (key) {
      case 'q':
      case '\u001b': // ESC
        this.uiState.mode = 'dashboard';
        break;
      case 'f':
        this.uiState.listFilter.type = 'from';
        this.uiState.selectedIndex = 0;
        break;
      case 't':
        this.uiState.listFilter.type = 'to';
        this.uiState.selectedIndex = 0;
        break;
      case 'j':
      case '\u001b[B': // Down arrow
        this.uiState.selectedIndex = Math.min(
          this.uiState.selectedIndex + 1,
          maxItems - 1
        );
        break;
      case 'k':
      case '\u001b[A': // Up arrow
        this.uiState.selectedIndex = Math.max(this.uiState.selectedIndex - 1, 0);
        break;
      case '1':
        this.uiState.listFilter.eid = '30101'; // Ethereum
        this.uiState.selectedIndex = 0;
        break;
      case '2':
        this.uiState.listFilter.eid = '30184'; // Base
        this.uiState.selectedIndex = 0;
        break;
      case '3':
        this.uiState.listFilter.eid = '30110'; // Arbitrum
        this.uiState.selectedIndex = 0;
        break;
    }
  }

  private handleSearchKeys(key: string): void {
    const keyCode = key.charCodeAt(0);

    switch (key) {
      case 'q':
      case '\u001b': // ESC
        this.uiState.mode = 'dashboard';
        break;
      case '\r': // Enter
        // Search functionality will be implemented in the render method
        break;
      case '\u0008': // Backspace
      case '\u007f': // Delete
        this.uiState.searchQuery = this.uiState.searchQuery.slice(0, -1);
        break;
      default:
        // Add regular characters to search query
        if (keyCode >= 32 && keyCode <= 126) {
          this.uiState.searchQuery += key;
        }
        break;
    }
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
   * Filtering and search methods
   */
  private getFilteredPackets(): Packet[] {
    const { listFilter } = this.uiState;
    const targetEid = parseInt(listFilter.eid);
    
    return this.data.matchedPackets.filter(packet => {
      const srcEid = Number(packet.srcEid);
      const dstEid = Number(packet.dstEid);
      
      if (listFilter.type === 'from') {
        return srcEid === targetEid;
      } else {
        return dstEid === targetEid;
      }
    });
  }

  private searchPackets(query: string): Packet[] {
    if (!query.trim()) return [];
    
    const searchTerm = query.toLowerCase();
    
    return this.data.matchedPackets.filter(packet => {
      return packet.sourceTxHash.toLowerCase().includes(searchTerm) ||
             packet.destinationTxHash.toLowerCase().includes(searchTerm);
    });
  }

  /**
   * Render sections
   */
  private renderMetrics(): string {
    const { metrics } = this.data;
    
    const content = [
      `${COLORS.green}Total Events:${COLORS.reset} ${metrics.totalEvents} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Sent:${COLORS.reset} ${metrics.totalSent} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Delivered:${COLORS.reset} ${metrics.totalDelivered}`,
      
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Avg Latency:${COLORS.reset} ${formatDuration(metrics.avgLatency)}`,
      
      `${COLORS.yellow}Latest Blocks:${COLORS.reset} ${getChainColorByEid(30101)}ETH ${(metrics.latestBlocks.ethereum || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByEid(30184)}Base ${(metrics.latestBlocks.base || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByEid(30110)}ARB ${(metrics.latestBlocks.arbitrum || 0).toLocaleString()}${COLORS.reset}`
    ].join('\n');

    return this.drawBox(0, 6, 'LayerZero v2 METRICS', content);
  }

  private renderRawActivity(): string {
    const events = this.data.rawEvents.slice(0, RAW_ACTIVITY_DISPLAY_COUNT);
    let content = '';
    
    events.forEach(event => {
      const time = formatTimestamp(event.timestamp);
      const direction = formatPacketDirection(event.srcEid, event.dstEid);
      
      const eventLine = `${direction} ${COLORS.dim}${time}${COLORS.reset}`;
      const detailsLine = `  ${COLORS.gray}${event.type}: ${event.txHash}${COLORS.reset}`;
      
      content += eventLine + '\n' + detailsLine + '\n';
    });

    return this.drawBox(0, 14, 'RAW PACKET ACTIVITY', content);
  }

  private renderMatchedPackets(): string {
    const packets = this.data.matchedPackets.slice(0, TUI_CONFIG.MAX_MATCHED_TRANSFERS);
    let content = '';

    packets.forEach((packet) => {
      const details = formatPacketDetails(packet);
      const srcChainId = Number(packet.sourceChainId);
      const dstChainId = Number(packet.destinationChainId);
      const srcTxUrl = formatTxHashWithUrl(packet.sourceTxHash, srcChainId);
      const dstTxUrl = formatTxHashWithUrl(packet.destinationTxHash, dstChainId);
      
      // Highlight recently updated packets
      const lastUpdated = Number(packet.lastUpdated || 0);
      const twoMinutesAgo = Date.now() / MILLISECONDS_PER_SECOND - RECENT_PACKET_THRESHOLD_SECONDS;
      const isRecent = lastUpdated > twoMinutesAgo;
      const newIndicator = isRecent ? `${COLORS.green}●${COLORS.reset} ` : '';

      content += `${newIndicator}${details}\n`;
      content += `  ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}\n`;
      content += `  ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}\n`;
    });

    return this.drawBox(0, Math.min(22, packets.length * 3 + 2), 'MATCHED PACKETS', content);
  }

  private renderListView(): string {
    const { listFilter, selectedIndex } = this.uiState;
    const filteredPackets = this.getFilteredPackets();
    const displayPackets = filteredPackets.slice(0, this.uiState.maxDisplayItems);
    
    let content = '';
    
    // Header with current filter
    const eid = parseInt(listFilter.eid);
    const chainName = getChainNameFromEid(eid);
    const chainColor = getChainColorByEid(eid);
    content += `${COLORS.bright}Filter: ${listFilter.type.toUpperCase()} ${chainColor}${chainName}(${eid})${COLORS.reset}\n`;
    content += `${COLORS.gray}Total: ${filteredPackets.length} packets${COLORS.reset}\n\n`;
    
    // Packet list
    displayPackets.forEach((packet, index) => {
      const details = formatPacketDetails(packet);
      const srcChainId = Number(packet.sourceChainId);
      const dstChainId = Number(packet.destinationChainId);
      const srcTxUrl = formatTxHashWithUrl(packet.sourceTxHash, srcChainId);
      const dstTxUrl = formatTxHashWithUrl(packet.destinationTxHash, dstChainId);
      
      // Highlight selected item
      const isSelected = index === selectedIndex;
      const selectionIndicator = isSelected ? `${COLORS.bright}${COLORS.green}▶${COLORS.reset} ` : '  ';
      
      content += `${selectionIndicator}${details}\n`;
      
      if (isSelected) {
        content += `    ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}\n`;
        content += `    ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}\n`;
      }
    });
    
    // Instructions
    content += `\n${COLORS.dim}Keys: [f]rom/[t]o filter, [1-3] chains, [j/k] navigate, [q/ESC] back${COLORS.reset}`;
    
    return this.drawBox(0, Math.min(25, displayPackets.length * 2 + 8), 'PACKET LIST', content);
  }

  private renderSearchView(): string {
    const { searchQuery } = this.uiState;
    const searchResults = this.searchPackets(searchQuery);
    
    let content = '';
    
    // Search input
    content += `${COLORS.bright}Search: ${COLORS.reset}${searchQuery}${COLORS.bright}_${COLORS.reset}\n`;
    content += `${COLORS.gray}Enter transaction hash (source or destination)${COLORS.reset}\n\n`;
    
    // Search results
    if (searchQuery.trim()) {
      content += `${COLORS.bright}Results: ${searchResults.length} matches${COLORS.reset}\n\n`;
      
      const displayResults = searchResults.slice(0, this.uiState.maxDisplayItems);
      displayResults.forEach((packet) => {
        const details = formatPacketDetails(packet);
        const srcChainId = Number(packet.sourceChainId);
        const dstChainId = Number(packet.destinationChainId);
        const srcTxUrl = formatTxHashWithUrl(packet.sourceTxHash, srcChainId);
        const dstTxUrl = formatTxHashWithUrl(packet.destinationTxHash, dstChainId);
        
        content += `${details}\n`;
        content += `  ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}\n`;
        content += `  ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}\n`;
      });
    }
    
    // Instructions
    content += `\n${COLORS.dim}Type to search, [Enter] to search, [q/ESC] to return${COLORS.reset}`;
    
    return this.drawBox(0, Math.min(25, searchResults.length * 3 + 8), 'PACKET SEARCH', content);
  }

  /**
   * Main render function
   */
  render(): void {
    this.clearScreen();
    
    // Header
    stdout.write(`${COLORS.bright}${COLORS.green}🌐 LayerZero v2 Bridge Monitor${COLORS.reset}\n`);
    stdout.write(`${COLORS.gray}Last update: ${new Date(this.lastUpdate).toLocaleTimeString()}${COLORS.reset}\n\n`);
    
    // Render based on current mode
    switch (this.uiState.mode) {
      case 'dashboard':
        stdout.write(this.renderMetrics());
        stdout.write(this.renderRawActivity());
        stdout.write(this.renderMatchedPackets());
        stdout.write(`${COLORS.gray}Press [l] for list view, [s] for search, Ctrl+C to exit${COLORS.reset}`);
        break;
      
      case 'list':
        stdout.write(this.renderListView());
        break;
      
      case 'search':
        stdout.write(this.renderSearchView());
        break;
    }
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    console.log(`${COLORS.green}🌐 Starting LayerZero v2 Bridge Monitor...${COLORS.reset}`);
    
    // Initial data fetch
    const success = await this.fetchData();
    if (!success) {
      console.error(`${COLORS.red}Failed to fetch initial data. Is the indexer running at ${TUI_CONFIG.GRAPHQL_URL}?${COLORS.reset}`);
      process.exit(1);
    }

    // Set up keyboard input
    this.setupKeyboardInput();

    // Initial render
    this.render();

    // Set up refresh interval
    this.refreshInterval = setInterval(async () => {
      await this.fetchData();
      this.render();
    }, TUI_CONFIG.REFRESH_INTERVAL);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
      }
      this.clearScreen();
      console.log(`${COLORS.green}🌐 LayerZero monitoring stopped${COLORS.reset}`);
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
const monitor = new LayerZeroMonitor();
monitor.start().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});