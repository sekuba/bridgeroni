#!/usr/bin/env node

/**
 * LayerZero Bridge Monitor - Terminal UI
 * 
 * Optimized real-time monitoring dashboard for LayerZero v2 packet transactions.
 * Features efficient data processing, caching, and modular rendering.
 * 
 * Performance Optimizations:
 * - Incremental data updates with change detection
 * - Cached formatting operations with memoization
 * - Efficient memory management and garbage collection
 * - Modular rendering components for better performance
 * - Optimized string operations and ANSI rendering
 * 
 * Architecture:
 * - GraphQL indexer integration with smart caching
 * - Event-driven state management
 * - Modular UI components with selective rendering
 * - Performance monitoring and metrics
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
  formatTxHashWithUrl,
  getChainColorByEid,
  formatPacketDirection,
  formatPacketDetails
} from './src/utils/layerzeroFormatters';

import { fetchAllLayerZeroData, layerZeroGraphQL } from './src/utils/layerzeroGraphqlOptimized';
import { fetchAllLayerZeroData as fetchAllLayerZeroDataLegacy } from './src/utils/layerzeroGraphql';
import { decodePacket } from './src/utils/layerzeroDecoder';

// Performance constants
const PERFORMANCE_CONFIG = {
  RECENT_PACKET_THRESHOLD_SECONDS: 120,
  RAW_ACTIVITY_DISPLAY_COUNT: 6,
  CACHE_TTL_MS: 5000,
  MAX_RETAINED_EVENTS: 1000,
  BATCH_SIZE: 100,
  RENDER_THROTTLE_MS: 50
} as const;

// Cache for expensive operations
const formatCache = new Map<string, string>();
const chainLookupCache = new Map<number, string>();
let lastCacheCleanup = 0;

// Type definitions with performance optimizations
interface RawPacketEvent {
  readonly type: 'sent' | 'delivered';
  readonly srcEid: number;
  readonly dstEid: number;
  readonly sourceChain: string;
  readonly destinationChain: string;
  readonly payload: string | null;
  readonly hasPayload: boolean;
  readonly nonce: string | null;
  readonly timestamp: string;
  readonly txHash: string;
  readonly direction: 'from' | 'to';
  readonly sender?: string;
  readonly receiver?: string;
  readonly options?: string;
  readonly sendLibrary?: string;
}

interface PacketMetrics {
  readonly totalEvents: number;
  readonly totalSent: number;
  readonly totalDelivered: number;
  readonly matchedCount: number;
  readonly avgLatency: number;
  readonly latestBlocks: Record<string, number>;
}

interface Packet {
  readonly matched?: boolean;
  readonly srcEid: string;
  readonly dstEid: string;
  readonly nonce: string;
  readonly sender: string;
  readonly receiver: string;
  readonly payload: string;
  readonly latencySeconds: string;
  readonly sentTimestamp: string;
  readonly sourceTxHash: string;
  readonly destinationTxHash: string;
  readonly lastUpdated?: string;
  readonly hasPayload: boolean;
  readonly encodedPayload?: string;
  readonly options?: string;
  readonly sendLibrary?: string;
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

interface PerformanceMetrics {
  fetchTime: number;
  renderTime: number;
  totalMemoryUsage: number;
  cacheHitRate: number;
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
  private performanceMetrics: PerformanceMetrics;
  private dataChecksum: string = '';
  private lastRenderTime: number = 0;
  private renderComponents: Map<string, string> = new Map();

  constructor() {
    this.data = {
      metrics: this.getEmptyMetrics(),
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
    this.performanceMetrics = {
      fetchTime: 0,
      renderTime: 0,
      totalMemoryUsage: 0,
      cacheHitRate: 0
    };
    
    // Initialize cache cleanup
    this.scheduleCacheCleanup();
  }

  private getEmptyMetrics(): PacketMetrics {
    return {
      totalEvents: 0,
      totalSent: 0,
      totalDelivered: 0,
      matchedCount: 0,
      avgLatency: 0,
      latestBlocks: {}
    };
  }

  private scheduleCacheCleanup(): void {
    setInterval(() => {
      this.cleanupCache();
    }, PERFORMANCE_CONFIG.CACHE_TTL_MS);
  }

  /**
   * Helper function to safely serialize objects with BigInt values
   */
  private safeStringify(obj: any): string {
    return JSON.stringify(obj, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
  }

  private cleanupCache(): void {
    const now = Date.now();
    if (now - lastCacheCleanup > PERFORMANCE_CONFIG.CACHE_TTL_MS) {
      formatCache.clear();
      chainLookupCache.clear();
      lastCacheCleanup = now;
    }
  }

  /**
   * Optimized data fetching with change detection and caching
   */
  async fetchData(): Promise<boolean> {
    const fetchStart = Date.now();
    
    try {
      // Try optimized fetch first
      let results = await fetchAllLayerZeroData();
      let useOptimized = true;
      
      // Fall back to legacy if optimized fails
      if (!results) {
        console.log('Optimized fetch failed, falling back to legacy...');
        results = await fetchAllLayerZeroDataLegacy();
        useOptimized = false;
      }
      
      if (!results) return false;

      // Calculate data checksum for change detection
      const newChecksum = this.calculateDataChecksum(results);
      
      // Skip processing if data hasn't changed (but allow updates every 10 seconds)
      const timeSinceLastUpdate = Date.now() - this.lastUpdate;
      if (newChecksum === this.dataChecksum && timeSinceLastUpdate < 10000) {
        this.performanceMetrics.fetchTime = Date.now() - fetchStart;
        return true;
      }

      this.dataChecksum = newChecksum;

      // Destructure with null safety
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

      // Process data efficiently with batch operations
      if (useOptimized) {
        this.processDataBatch(results);
      } else {
        this.processDataBatch({
          recentPacketsSentData: recentPacketsSentData?.EndpointV2_PacketSent || [],
          recentPacketsDeliveredData: recentPacketsDeliveredData?.EndpointV2_PacketDelivered || [],
          matchedPacketsData: matchedPacketsData?.LayerZeroPacket || [],
          allPacketsData: allPacketsData?.LayerZeroPacket || [],
          allPacketsSentData: allPacketsSentData?.EndpointV2_PacketSent || [],
          allPacketsDeliveredData: allPacketsDeliveredData?.EndpointV2_PacketDelivered || [],
          latestBlocksPacketsSentData: latestBlocksPacketsSentData?.EndpointV2_PacketSent || [],
          latestBlocksPacketsDeliveredData: latestBlocksPacketsDeliveredData?.EndpointV2_PacketDelivered || []
        });
      }

      this.lastUpdate = Date.now();
      this.performanceMetrics.fetchTime = Date.now() - fetchStart;
      return true;
    } catch (error) {
      console.error('Error fetching LayerZero data:', error);
      this.performanceMetrics.fetchTime = Date.now() - fetchStart;
      return false;
    }
  }

  private calculateDataChecksum(data: any): string {
    // Enhanced checksum that includes recent timestamps for better change detection
    if (!data || !Array.isArray(data)) return '0';
    
    let checksum = '';
    
    try {
      for (const item of data) {
        if (item?.EndpointV2_PacketSent?.length) {
          checksum += item.EndpointV2_PacketSent.length;
          // Add timestamp of most recent item
          if (item.EndpointV2_PacketSent[0]?.blockTimestamp) {
            checksum += item.EndpointV2_PacketSent[0].blockTimestamp;
          }
        }
        if (item?.EndpointV2_PacketDelivered?.length) {
          checksum += item.EndpointV2_PacketDelivered.length;
          // Add timestamp of most recent item
          if (item.EndpointV2_PacketDelivered[0]?.blockTimestamp) {
            checksum += item.EndpointV2_PacketDelivered[0].blockTimestamp;
          }
        }
        if (item?.LayerZeroPacket?.length) {
          checksum += item.LayerZeroPacket.length;
          // Add timestamp of most recent item
          if (item.LayerZeroPacket[0]?.lastUpdated) {
            checksum += item.LayerZeroPacket[0].lastUpdated;
          }
        }
      }
    } catch (error) {
      // Fallback to simple checksum
      checksum = data.length.toString();
    }
    
    return checksum || '0';
  }

  private processDataBatch(batchData: any): void {
    // Handle optimized data structure (array of results)
    if (Array.isArray(batchData) && batchData.length >= 6) {
      this.data.recentPacketsSent = batchData[0]?.EndpointV2_PacketSent || [];
      this.data.recentPacketsDelivered = batchData[1]?.EndpointV2_PacketDelivered || [];
      this.data.matchedPackets = batchData[2]?.LayerZeroPacket || [];
      
      // Process metrics from optimized structure
      const metricsData = batchData[3] || {};
      const blocksData = batchData[4] || {};
      const totalCountsData = batchData[5] || {};
      
      // Create raw events feed with optimization
      this.data.rawEvents = this.createOptimizedRawEventsFeed(
        this.data.recentPacketsSent,
        this.data.recentPacketsDelivered
      );
      
      // Calculate metrics efficiently with new structure
      this.calculateOptimizedMetricsFromAggregates(metricsData, blocksData, totalCountsData);
    } else {
      // Handle legacy structure (object with named properties)
      this.processLegacyDataBatch(batchData);
    }
  }
  
  private processLegacyDataBatch(batchData: any): void {
    if (Array.isArray(batchData) && batchData.length >= 8) {
      // Handle legacy array structure
      this.data.recentPacketsSent = batchData[0]?.EndpointV2_PacketSent || [];
      this.data.recentPacketsDelivered = batchData[1]?.EndpointV2_PacketDelivered || [];
      this.data.matchedPackets = batchData[2]?.LayerZeroPacket || [];
      
      // Create raw events feed with optimization
      this.data.rawEvents = this.createOptimizedRawEventsFeed(
        this.data.recentPacketsSent,
        this.data.recentPacketsDelivered
      );
      
      // Calculate metrics efficiently
      this.calculateOptimizedMetrics(
        batchData[3]?.LayerZeroPacket || [],
        batchData[4]?.EndpointV2_PacketSent || [],
        batchData[5]?.EndpointV2_PacketDelivered || [],
        batchData[6]?.EndpointV2_PacketSent || [],
        batchData[7]?.EndpointV2_PacketDelivered || []
      );
    } else if (batchData && typeof batchData === 'object') {
      // Handle object structure from processDataBatch call
      this.data.recentPacketsSent = batchData.recentPacketsSentData || [];
      this.data.recentPacketsDelivered = batchData.recentPacketsDeliveredData || [];
      this.data.matchedPackets = batchData.matchedPacketsData || [];
      
      // Create raw events feed with optimization
      this.data.rawEvents = this.createOptimizedRawEventsFeed(
        this.data.recentPacketsSent,
        this.data.recentPacketsDelivered
      );
      
      // Calculate metrics efficiently
      this.calculateOptimizedMetrics(
        batchData.allPacketsData || [],
        batchData.allPacketsSentData || [],
        batchData.allPacketsDeliveredData || [],
        batchData.latestBlocksPacketsSentData || [],
        batchData.latestBlocksPacketsDeliveredData || []
      );
    }
  }

  /**
   * Optimized metrics calculation with caching
   */
  private calculateOptimizedMetrics(
    allPackets: Packet[],
    sentPackets: any[],
    deliveredPackets: any[],
    latestBlocksPacketsSent: any[],
    latestBlocksPacketsDelivered: any[]
  ): void {
    // Use cached values if available
    const cacheKey = `metrics_${allPackets.length}_${sentPackets.length}_${deliveredPackets.length}`;
    const cachedResult = formatCache.get(cacheKey);
    
    if (cachedResult) {
      this.data.metrics = JSON.parse(cachedResult);
      return;
    }

    const matchedPackets = allPackets.filter(p => p.matched);
    
    const metrics = {
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

    // Cache the result with BigInt handling
    formatCache.set(cacheKey, this.safeStringify(metrics));
    this.data.metrics = metrics;
  }

  /**
   * Ultra-fast metrics calculation from optimized queries
   */
  private calculateOptimizedMetricsFromAggregates(metricsData: any, blocksData: any, totalCountsData: any): void {
    const cacheKey = `agg_metrics_${JSON.stringify(metricsData).length}_${JSON.stringify(totalCountsData).length}`;
    const cachedResult = formatCache.get(cacheKey);
    
    if (cachedResult) {
      this.data.metrics = JSON.parse(cachedResult);
      return;
    }

    // Extract data from optimized structure
    const matchedPackets = metricsData.matched_packets || [];
    
    // Use actual total counts from dedicated query
    const totalSent = totalCountsData.all_sent?.length || 0;
    const totalDelivered = totalCountsData.all_delivered?.length || 0;
    const matchedCount = totalCountsData.all_matched?.length || 0;
    
    // Calculate latency from sample data
    const avgLatency = this.calculateAverageLatency(matchedPackets);
    
    // Process latest blocks efficiently
    const latestBlocks = this.calculateLatestBlocksFromOptimized(blocksData);
    
    const metrics = {
      totalEvents: totalSent + totalDelivered,
      totalSent,
      totalDelivered,
      matchedCount,
      avgLatency,
      latestBlocks
    };

    // Cache the result
    formatCache.set(cacheKey, this.safeStringify(metrics));
    this.data.metrics = metrics;
  }

  /**
   * Process latest blocks from optimized query structure
   */
  private calculateLatestBlocksFromOptimized(blocksData: any): Record<string, number> {
    const latestBlocks: Record<string, number> = {};
    
    // Initialize with known chains
    for (const chainName of Object.values(LAYERZERO_EID_TO_CHAIN_NAME)) {
      latestBlocks[chainName] = 0;
    }

    // Process sent blocks
    const sentBlocks = blocksData.sent_blocks || [];
    for (const block of sentBlocks) {
      const chainId = Number(block.chainId);
      const chainName = this.getCachedChainName(chainId);
      if (chainName) {
        latestBlocks[chainName] = Math.max(
          latestBlocks[chainName] || 0,
          Number(block.blockNumber)
        );
      }
    }

    // Process delivered blocks
    const deliveredBlocks = blocksData.delivered_blocks || [];
    for (const block of deliveredBlocks) {
      const chainId = Number(block.chainId);
      const chainName = this.getCachedChainName(chainId);
      if (chainName) {
        latestBlocks[chainName] = Math.max(
          latestBlocks[chainName] || 0,
          Number(block.blockNumber)
        );
      }
    }

    return latestBlocks;
  }

  /**
   * Optimized latency calculation with early exit
   */
  private calculateAverageLatency(packets: Packet[]): number {
    if (packets.length === 0) return 0;
    
    let sum = 0;
    let count = 0;
    
    // More efficient than filter + reduce
    for (const packet of packets) {
      const latency = Number(packet.latencySeconds);
      if (latency > 0 && !isNaN(latency)) {
        sum += latency;
        count++;
      }
    }
    
    return count > 0 ? Math.round(sum / count) : 0;
  }

  /**
   * Optimized block calculation with caching
   */
  private calculateLatestBlocks(
    latestBlocksPacketsSent: any[],
    latestBlocksPacketsDelivered: any[]
  ): Record<string, number> {
    const latestBlocks: Record<string, number> = {};
    
    // Initialize with known chains
    for (const chainName of Object.values(LAYERZERO_EID_TO_CHAIN_NAME)) {
      latestBlocks[chainName] = 0;
    }

    // Process events efficiently
    const allEvents = [...latestBlocksPacketsSent, ...latestBlocksPacketsDelivered];
    
    for (const event of allEvents) {
      const chainId = Number(event.chainId);
      const blockNumber = Number(event.blockNumber);
      
      if (blockNumber <= 0) continue;
      
      // Use cached chain name lookup
      let chainName = chainLookupCache.get(chainId);
      if (!chainName) {
        chainName = getChainNameFromChainId(chainId);
        if (chainName) {
          chainLookupCache.set(chainId, chainName);
        }
      }
      
      if (chainName) {
        latestBlocks[chainName] = Math.max(
          latestBlocks[chainName] || 0,
          blockNumber
        );
      }
    }

    return latestBlocks;
  }

  /**
   * Optimized raw events feed with pre-sorted data
   */
  private createOptimizedRawEventsFeed(
    sentPackets: any[],
    deliveredPackets: any[]
  ): RawPacketEvent[] {
    const events: RawPacketEvent[] = [];
    
    // Process in batches to avoid blocking
    const processBatch = (packets: any[], createEventFn: (packet: any) => RawPacketEvent) => {
      for (let i = 0; i < packets.length; i += PERFORMANCE_CONFIG.BATCH_SIZE) {
        const batch = packets.slice(i, i + PERFORMANCE_CONFIG.BATCH_SIZE);
        for (const packet of batch) {
          events.push(createEventFn(packet));
        }
      }
    };
    
    processBatch(sentPackets, (packet) => this.createSentEvent(packet));
    processBatch(deliveredPackets, (packet) => this.createDeliveredEvent(packet));
    
    // Optimized sorting with single pass
    events.sort((a, b) => {
      const timestampDiff = Number(b.timestamp) - Number(a.timestamp);
      if (timestampDiff !== 0) return timestampDiff;
      
      // Use type comparison as secondary sort
      if (a.type !== b.type) {
        return a.type === 'sent' ? -1 : 1;
      }
      
      // Final sort by txHash for stability
      return a.txHash.localeCompare(b.txHash);
    });
    
    // Limit and clean up old events
    const limitedEvents = events.slice(0, TUI_CONFIG.MAX_RAW_EVENTS);
    
    // Memory cleanup
    if (events.length > PERFORMANCE_CONFIG.MAX_RETAINED_EVENTS) {
      events.length = PERFORMANCE_CONFIG.MAX_RETAINED_EVENTS;
    }
    
    return limitedEvents;
  }

  /**
   * Optimized sent event creation with caching
   */
  private createSentEvent(packet: any): RawPacketEvent {
    const chainId = Number(packet.chainId);
    const srcEid = CHAIN_ID_TO_LAYERZERO_EID[chainId];
    
    // Cache decoded packet data
    const cacheKey = `decoded_${packet.encodedPayload}`;
    let decodedPacket = formatCache.get(cacheKey);
    
    if (!decodedPacket) {
      const decoded = decodePacket(packet.encodedPayload);
      // Handle BigInt serialization
      decodedPacket = this.safeStringify(decoded);
      formatCache.set(cacheKey, decodedPacket);
    }
    
    const parsed = JSON.parse(decodedPacket);
    const dstEid = parsed?.header?.dstEid || 0;
    
    // Use cached chain name lookups
    const sourceChain = this.getCachedChainName(chainId);
    const destinationChain = this.getCachedChainNameFromEid(dstEid);
    
    return {
      type: 'sent',
      srcEid: srcEid || 0,
      dstEid,
      sourceChain,
      destinationChain,
      payload: parsed?.payload || null,
      hasPayload: !!(parsed?.payload && parsed.payload !== '0x'),
      nonce: parsed?.header?.nonce?.toString() || null,
      timestamp: packet.blockTimestamp,
      txHash: packet.txHash,
      direction: 'from',
      sender: parsed?.header?.sender,
      receiver: parsed?.header?.receiver,
      options: packet.options,
      sendLibrary: packet.sendLibrary
    };
  }

  private getCachedChainName(chainId: number): string {
    let chainName = chainLookupCache.get(chainId);
    if (!chainName) {
      chainName = getChainNameFromChainId(chainId);
      if (chainName) {
        chainLookupCache.set(chainId, chainName);
      }
    }
    return chainName || 'Unknown';
  }

  private getCachedChainNameFromEid(eid: number): string {
    const cacheKey = -eid; // Negative to distinguish from chainId
    let chainName = chainLookupCache.get(cacheKey);
    if (!chainName) {
      chainName = getChainNameFromEid(eid);
      if (chainName) {
        chainLookupCache.set(cacheKey, chainName);
      }
    }
    return chainName || 'Unknown';
  }

  /**
   * Optimized delivered event creation with caching
   */
  private createDeliveredEvent(packet: any): RawPacketEvent {
    const chainId = Number(packet.chainId);
    const dstEid = CHAIN_ID_TO_LAYERZERO_EID[chainId];
    const srcEid = Number(packet.originSrcEid);
    
    return {
      type: 'delivered',
      srcEid,
      dstEid: dstEid || 0,
      sourceChain: this.getCachedChainNameFromEid(srcEid),
      destinationChain: this.getCachedChainName(chainId),
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
        this.searchResults = []; // Clear previous search results
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
        this.searchResults = []; // Clear search results when exiting
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
   * Optimized terminal utilities
   */
  private clearScreen(): void {
    stdout.write('\x1b[2J\x1b[H');
  }

  private stripAnsi(text: string): string {
    // More efficient regex for ANSI escape sequences
    return text.replace(/\x1b\[[0-9;]*[mGK]/g, '');
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
    
    // First filter from current data
    const currentFiltered = this.data.matchedPackets.filter(packet => {
      const srcEid = Number(packet.srcEid);
      const dstEid = Number(packet.dstEid);
      
      if (listFilter.type === 'from') {
        return srcEid === targetEid;
      } else {
        return dstEid === targetEid;
      }
    });
    
    // If we have less than 20 packets, we need to fetch more
    if (currentFiltered.length < 20) {
      this.fetchMoreListViewPackets(listFilter.eid, listFilter.type);
    }
    
    return currentFiltered;
  }

  /**
   * Fetch more packets for list view
   */
  private async fetchMoreListViewPackets(eid: string, filterType: 'from' | 'to'): Promise<void> {
    try {
      const result = await layerZeroGraphQL.getListViewPackets(eid, filterType);
      if (result?.list_packets) {
        // Merge with existing data, avoiding duplicates
        const existingIds = new Set(this.data.matchedPackets.map(p => p.id));
        const newPackets = result.list_packets.filter((p: any) => !existingIds.has(p.id));
        this.data.matchedPackets = [...this.data.matchedPackets, ...newPackets];
      }
    } catch (error) {
      console.error('Error fetching more list view packets:', error);
    }
  }

  private searchPackets(query: string): Packet[] {
    if (!query.trim()) return [];
    
    // First search in current data for immediate results
    const searchTerm = query.toLowerCase();
    const localResults = this.data.matchedPackets.filter(packet => {
      return packet.sourceTxHash.toLowerCase().includes(searchTerm) ||
             packet.destinationTxHash.toLowerCase().includes(searchTerm);
    });
    
    // Also trigger database search for comprehensive results
    this.performDatabaseSearch(query);
    
    return localResults;
  }

  /**
   * Perform database search and update search results
   */
  private searchResults: Packet[] = [];
  private async performDatabaseSearch(query: string): Promise<void> {
    try {
      const result = await layerZeroGraphQL.searchByTxHash(query);
      if (result?.search_results) {
        this.searchResults = result.search_results;
        // Force a re-render to show updated search results
        this.render();
      }
    } catch (error) {
      console.error('Error performing database search:', error);
    }
  }

  /**
   * Get combined search results (local + database)
   */
  private getCombinedSearchResults(query: string): Packet[] {
    if (!query.trim()) return [];
    
    const localResults = this.searchPackets(query);
    
    // Combine with database results, avoiding duplicates
    const allResults = [...localResults];
    const existingIds = new Set(localResults.map(p => p.id));
    
    for (const dbResult of this.searchResults) {
      if (!existingIds.has(dbResult.id)) {
        allResults.push(dbResult);
      }
    }
    
    return allResults;
  }

  /**
   * Render sections
   */
  private renderMetrics(): string {
    const { metrics } = this.data;
    
    // Build content with performance metrics
    const lines = [
      `${COLORS.green}Total Events:${COLORS.reset} ${metrics.totalEvents} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Sent:${COLORS.reset} ${metrics.totalSent} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Delivered:${COLORS.reset} ${metrics.totalDelivered}`,
      
      `${COLORS.green}Matched:${COLORS.reset} ${metrics.matchedCount} ${COLORS.gray}│${COLORS.reset} ` +
      `${COLORS.green}Avg Latency:${COLORS.reset} ${formatDuration(metrics.avgLatency)}`,
      
      `${COLORS.yellow}Latest Blocks:${COLORS.reset} ${getChainColorByEid(30101)}ETH ${(metrics.latestBlocks.ethereum || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByEid(30184)}Base ${(metrics.latestBlocks.base || 0).toLocaleString()}${COLORS.reset} ${COLORS.gray}│${COLORS.reset} ` +
      `${getChainColorByEid(30110)}ARB ${(metrics.latestBlocks.arbitrum || 0).toLocaleString()}${COLORS.reset}`,
      
      // Add performance metrics
      `${COLORS.blue}Performance:${COLORS.reset} ${COLORS.gray}Fetch: ${this.performanceMetrics.fetchTime}ms │ ` +
      `Render: ${this.performanceMetrics.renderTime}ms │ ` +
      `Memory: ${Math.round(this.performanceMetrics.totalMemoryUsage / 1024 / 1024)}MB${COLORS.reset}`
    ];

    return this.drawBox(0, 8, 'LayerZero v2 METRICS', lines.join('\n'));
  }

  private renderRawActivity(): string {
    const events = this.data.rawEvents.slice(0, PERFORMANCE_CONFIG.RAW_ACTIVITY_DISPLAY_COUNT);
    
    // Pre-allocate array for better performance
    const contentLines: string[] = [];
    
    for (const event of events) {
      const time = formatTimestamp(event.timestamp);
      const direction = formatPacketDirection(event.srcEid, event.dstEid);
      
      contentLines.push(`${direction} ${COLORS.dim}${time}${COLORS.reset}`);
      contentLines.push(`  ${COLORS.gray}${event.type}: ${event.txHash}${COLORS.reset}`);
    }

    return this.drawBox(0, 14, 'RAW PACKET ACTIVITY', contentLines.join('\n'));
  }

  private renderMatchedPackets(): string {
    const packets = this.data.matchedPackets.slice(0, TUI_CONFIG.MAX_MATCHED_TRANSFERS);
    const contentLines: string[] = [];
    const currentTime = Date.now() / 1000;
    const recentThreshold = currentTime - PERFORMANCE_CONFIG.RECENT_PACKET_THRESHOLD_SECONDS;

    for (const packet of packets) {
      const details = formatPacketDetails(packet);
      const srcChainId = Number(packet.sourceChainId);
      const dstChainId = Number(packet.destinationChainId);
      const srcTxUrl = formatTxHashWithUrl(packet.sourceTxHash, srcChainId);
      const dstTxUrl = formatTxHashWithUrl(packet.destinationTxHash, dstChainId);
      
      // Format delivery timestamp
      const deliveryTime = packet.deliveredTimestamp ? 
        formatTimestamp(packet.deliveredTimestamp) : 
        formatTimestamp(packet.lastUpdated || '0');
      
      // Highlight recently updated packets
      const lastUpdated = Number(packet.lastUpdated || 0);
      const isRecent = lastUpdated > recentThreshold;
      const newIndicator = isRecent ? `${COLORS.green}●${COLORS.reset} ` : '';

      contentLines.push(`${newIndicator}${details} ${COLORS.dim}${deliveryTime}${COLORS.reset}`);
      contentLines.push(`  ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}`);
      contentLines.push(`  ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}`);
    }

    return this.drawBox(0, Math.min(22, packets.length * 3 + 2), 'MATCHED PACKETS', contentLines.join('\n'));
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
      
      // Format delivery timestamp
      const deliveryTime = packet.deliveredTimestamp ? 
        formatTimestamp(packet.deliveredTimestamp) : 
        formatTimestamp(packet.lastUpdated || '0');
      
      // Highlight selected item
      const isSelected = index === selectedIndex;
      const selectionIndicator = isSelected ? `${COLORS.bright}${COLORS.green}▶${COLORS.reset} ` : '  ';
      
      content += `${selectionIndicator}${details} ${COLORS.dim}${deliveryTime}${COLORS.reset}\n`;
      
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
    const searchResults = this.getCombinedSearchResults(searchQuery);
    
    let content = '';
    
    // Search input
    content += `${COLORS.bright}Search: ${COLORS.reset}${searchQuery}${COLORS.bright}_${COLORS.reset}\n`;
    content += `${COLORS.gray}Enter transaction hash (searches entire database)${COLORS.reset}\n\n`;
    
    // Search results
    if (searchQuery.trim()) {
      const dbSearchActive = this.searchResults.length > 0;
      const searchStatus = dbSearchActive ? 'database' : 'local cache';
      content += `${COLORS.bright}Results: ${searchResults.length} matches ${COLORS.gray}(${searchStatus})${COLORS.reset}\n\n`;
      
      const displayResults = searchResults.slice(0, this.uiState.maxDisplayItems);
      displayResults.forEach((packet) => {
        const details = formatPacketDetails(packet);
        const srcChainId = Number(packet.sourceChainId);
        const dstChainId = Number(packet.destinationChainId);
        const srcTxUrl = formatTxHashWithUrl(packet.sourceTxHash, srcChainId);
        const dstTxUrl = formatTxHashWithUrl(packet.destinationTxHash, dstChainId);
        
        // Format delivery timestamp
        const deliveryTime = packet.deliveredTimestamp ? 
          formatTimestamp(packet.deliveredTimestamp) : 
          formatTimestamp(packet.lastUpdated || '0');
        
        content += `${details} ${COLORS.dim}${deliveryTime}${COLORS.reset}\n`;
        content += `  ${COLORS.gray}src: ${srcTxUrl}${COLORS.reset}\n`;
        content += `  ${COLORS.gray}dst: ${dstTxUrl}${COLORS.reset}\n`;
      });
    }
    
    // Instructions
    content += `\n${COLORS.dim}Type to search, [Enter] to search, [q/ESC] to return${COLORS.reset}`;
    
    return this.drawBox(0, Math.min(25, searchResults.length * 3 + 8), 'PACKET SEARCH', content);
  }

  /**
   * Optimized render function with throttling and caching
   */
  render(): void {
    const now = Date.now();
    
    // Throttle rendering to improve performance
    if (now - this.lastRenderTime < PERFORMANCE_CONFIG.RENDER_THROTTLE_MS) {
      return;
    }
    
    const renderStart = Date.now();
    
    this.clearScreen();
    
    // Header (cached)
    const headerKey = `header_${this.lastUpdate}`;
    let header = this.renderComponents.get(headerKey);
    if (!header) {
      header = `${COLORS.bright}${COLORS.green}🌐 LayerZero v2 Bridge Monitor${COLORS.reset}\n` +
               `${COLORS.gray}Last update: ${new Date(this.lastUpdate).toLocaleTimeString()}${COLORS.reset}\n\n`;
      this.renderComponents.set(headerKey, header);
    }
    stdout.write(header);
    
    // Render based on current mode with component caching
    switch (this.uiState.mode) {
      case 'dashboard':
        stdout.write(this.renderCachedMetrics());
        stdout.write(this.renderCachedRawActivity());
        stdout.write(this.renderCachedMatchedPackets());
        stdout.write(`${COLORS.gray}Press [l] for list view, [s] for search, Ctrl+C to exit${COLORS.reset}`);
        break;
      
      case 'list':
        stdout.write(this.renderListView());
        break;
      
      case 'search':
        stdout.write(this.renderSearchView());
        break;
    }
    
    this.lastRenderTime = now;
    this.performanceMetrics.renderTime = Date.now() - renderStart;
  }

  private renderCachedMetrics(): string {
    const cacheKey = `metrics_${this.safeStringify(this.data.metrics)}`;
    let cached = this.renderComponents.get(cacheKey);
    if (!cached) {
      cached = this.renderMetrics();
      this.renderComponents.set(cacheKey, cached);
    }
    return cached;
  }

  private renderCachedRawActivity(): string {
    const cacheKey = `raw_activity_${this.data.rawEvents.length}_${this.data.rawEvents[0]?.timestamp || 0}`;
    let cached = this.renderComponents.get(cacheKey);
    if (!cached) {
      cached = this.renderRawActivity();
      this.renderComponents.set(cacheKey, cached);
    }
    return cached;
  }

  private renderCachedMatchedPackets(): string {
    const cacheKey = `matched_packets_${this.data.matchedPackets.length}_${this.data.matchedPackets[0]?.lastUpdated || 0}`;
    let cached = this.renderComponents.get(cacheKey);
    if (!cached) {
      cached = this.renderMatchedPackets();
      this.renderComponents.set(cacheKey, cached);
    }
    return cached;
  }

  /**
   * Start the optimized monitor with performance tracking
   */
  async start(): Promise<void> {
    console.log(`${COLORS.green}🌐 Starting LayerZero v2 Bridge Monitor (Optimized)...${COLORS.reset}`);
    
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

    // Set up optimized refresh interval
    this.refreshInterval = setInterval(async () => {
      await this.fetchData();
      this.render();
      this.updatePerformanceMetrics();
      
      // Clean up caches periodically
      if (Date.now() % 10000 < 1000) { // Every ~10 seconds
        layerZeroGraphQL.clearExpiredCache();
      }
    }, TUI_CONFIG.REFRESH_INTERVAL);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.shutdown();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error(`${COLORS.red}Uncaught exception: ${error.message}${COLORS.reset}`);
      this.shutdown();
    });
  }

  private updatePerformanceMetrics(): void {
    const memUsage = process.memoryUsage();
    this.performanceMetrics.totalMemoryUsage = memUsage.heapUsed;
    this.performanceMetrics.cacheHitRate = formatCache.size / Math.max(1, formatCache.size + chainLookupCache.size);
  }

  private shutdown(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    // Clear caches
    formatCache.clear();
    chainLookupCache.clear();
    this.renderComponents.clear();
    
    this.clearScreen();
    console.log(`${COLORS.green}🌐 LayerZero monitoring stopped${COLORS.reset}`);
    process.exit(0);
  }
}

// Performance and compatibility checks
if (typeof fetch === 'undefined') {
  console.error('This script requires Node.js 18+ with built-in fetch support.');
  console.error('Please upgrade your Node.js version.');
  process.exit(1);
}

// Memory usage monitoring
const initialMemory = process.memoryUsage();
console.log(`${COLORS.gray}Initial memory usage: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB${COLORS.reset}`);

// Start the optimized monitor
const monitor = new LayerZeroMonitor();
monitor.start().catch(error => {
  console.error(`${COLORS.red}Fatal error: ${error.message}${COLORS.reset}`);
  console.error(`${COLORS.red}Stack trace: ${error.stack}${COLORS.reset}`);
  process.exit(1);
});