/**
 * High-Performance LayerZero GraphQL Utilities
 * 
 * Optimized for minimal data transfer with incremental updates,
 * smart caching, and connection pooling.
 */

import { TUI_CONFIG } from '../constants';

// Performance configuration
const PERF_CONFIG = {
  MAX_RECENT_EVENTS: 50,
  MAX_MATCHED_PACKETS: 500, // Increased for better list view coverage
  INCREMENTAL_WINDOW_HOURS: 6, // Increased for more list view data
  CONNECTION_TIMEOUT: 5000,
  REQUEST_TIMEOUT: 3000,
  MAX_RETRIES: 2,
  BATCH_SIZE: 3
} as const;

interface QueryCache {
  data: any;
  timestamp: number;
  checksum: string;
}

class LayerZeroGraphQLOptimized {
  private cache = new Map<string, QueryCache>();
  private lastFetchTimestamp: number = 0;
  private controller: AbortController | null = null;
  private lastTotalCountsUpdate: number = 0;
  private cachedTotalCounts: any = null;

  /**
   * High-performance incremental data fetching
   */
  async fetchIncrementalData(): Promise<any[] | null> {
    const now = Date.now();
    const timeWindow = now - (PERF_CONFIG.INCREMENTAL_WINDOW_HOURS * 60 * 60 * 1000);
    
    // Cancel any ongoing requests
    if (this.controller) {
      this.controller.abort();
    }
    this.controller = new AbortController();

    try {
      // Execute optimized queries in batches
      const batch1 = this.executeBatch([
        this.buildIncrementalQuery('recentPacketsSent', timeWindow),
        this.buildIncrementalQuery('recentPacketsDelivered', timeWindow),
        this.buildIncrementalQuery('matchedPackets', timeWindow)
      ]);

      const batch2 = this.executeBatch([
        this.buildMetricsQuery(),
        this.buildLatestBlocksQuery()
      ]);

      // Run total counts query less frequently (every 30 seconds)
      const needsTotalCounts = !this.lastTotalCountsUpdate || (now - this.lastTotalCountsUpdate) > 30000;
      let totalCountsPromise = Promise.resolve(this.cachedTotalCounts);
      
      if (needsTotalCounts) {
        totalCountsPromise = this.executeOptimizedQuery(this.buildTotalCountsQuery())
          .then(result => {
            this.cachedTotalCounts = result;
            this.lastTotalCountsUpdate = now;
            return result;
          });
      }

      const [results1, results2, totalCounts] = await Promise.all([batch1, batch2, totalCountsPromise]);
      
      return [...results1, ...results2, totalCounts];
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request aborted for new fetch');
        return null;
      }
      console.error('Optimized fetch error:', error);
      return null;
    }
  }

  /**
   * Build incremental query with time-based filtering
   */
  private buildIncrementalQuery(queryType: string, timeWindow: number): string {
    const timestampFilter = `{blockTimestamp: {_gte: "${Math.floor(timeWindow / 1000)}"}}`;
    
    switch (queryType) {
      case 'recentPacketsSent':
        return `{
          EndpointV2_PacketSent(
            where: ${timestampFilter},
            limit: ${PERF_CONFIG.MAX_RECENT_EVENTS},
            order_by: [{blockTimestamp: desc}]
          ) {
            id encodedPayload chainId blockTimestamp txHash
          }
        }`;
      
      case 'recentPacketsDelivered':
        return `{
          EndpointV2_PacketDelivered(
            where: ${timestampFilter},
            limit: ${PERF_CONFIG.MAX_RECENT_EVENTS},
            order_by: [{blockTimestamp: desc}]
          ) {
            id originSrcEid originSender originNonce receiver
            chainId blockTimestamp txHash
          }
        }`;
      
      case 'matchedPackets':
        return `{
          LayerZeroPacket(
            where: {_and: [
              {matched: {_eq: true}},
              {lastUpdated: {_gte: "${Math.floor(timeWindow / 1000)}"}}
            ]},
            limit: ${PERF_CONFIG.MAX_MATCHED_PACKETS},
            order_by: [{lastUpdated: desc}]
          ) {
            id srcEid dstEid sender receiver
            sourceTxHash destinationTxHash
            sentTimestamp deliveredTimestamp latencySeconds
            sourceChainId destinationChainId lastUpdated
          }
        }`;
      
      default:
        return '{}';
    }
  }

  /**
   * Build optimized metrics query without aggregation
   */
  private buildMetricsQuery(): string {
    return `{
      matched_packets: LayerZeroPacket(
        where: {matched: {_eq: true}},
        limit: 1000
      ) {
        latencySeconds
      }
      sent_count: EndpointV2_PacketSent(limit: 1) {
        id
      }
      delivered_count: EndpointV2_PacketDelivered(limit: 1) {
        id
      }
    }`;
  }

  /**
   * Build latest blocks query with distinct optimization
   */
  private buildLatestBlocksQuery(): string {
    return `{
      sent_blocks: EndpointV2_PacketSent(
        order_by: [{chainId: asc}, {blockNumber: desc}]
        distinct_on: chainId
        limit: 10
      ) {
        chainId blockNumber
      }
      delivered_blocks: EndpointV2_PacketDelivered(
        order_by: [{chainId: asc}, {blockNumber: desc}]
        distinct_on: chainId
        limit: 10
      ) {
        chainId blockNumber
      }
    }`;
  }

  /**
   * Build total counts query for accurate metrics
   * Use the old approach but with better limits
   */
  private buildTotalCountsQuery(): string {
    return `{
      all_sent: EndpointV2_PacketSent {
        id
      }
      all_delivered: EndpointV2_PacketDelivered {
        id
      }
      all_matched: LayerZeroPacket(where: {matched: {_eq: true}}) {
        id
      }
    }`;
  }

  /**
   * Execute batch of queries with connection pooling
   */
  private async executeBatch(queries: string[]): Promise<any[]> {
    const promises = queries.map(query => 
      this.executeOptimizedQuery(query)
    );
    
    return Promise.all(promises);
  }

  /**
   * Execute single optimized query with caching and compression
   */
  private async executeOptimizedQuery(query: string): Promise<any> {
    const queryHash = this.hashQuery(query);
    const cached = this.cache.get(queryHash);
    
    // Return cached result if still valid (5 seconds for real-time updates)
    if (cached && Date.now() - cached.timestamp < 5000) {
      return cached.data;
    }

    try {
      const response = await fetch(TUI_CONFIG.GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        },
        body: JSON.stringify({ query }),
        signal: this.controller?.signal,
        // @ts-ignore - Node.js specific options
        timeout: PERF_CONFIG.REQUEST_TIMEOUT
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.errors) {
        throw new Error(result.errors[0].message);
      }

      // Cache the result
      this.cache.set(queryHash, {
        data: result.data,
        timestamp: Date.now(),
        checksum: queryHash
      });

      return result.data;
    } catch (error) {
      console.error(`Optimized query error: ${error.message}`);
      // Return cached data if available on error
      return cached?.data || null;
    }
  }

  /**
   * Simple hash function for query caching
   */
  private hashQuery(query: string): string {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  /**
   * Search for packets by transaction hash across entire database
   */
  async searchByTxHash(txHash: string): Promise<any[] | null> {
    const searchQuery = `{
      search_results: LayerZeroPacket(
        where: {
          _or: [
            {sourceTxHash: {_ilike: "%${txHash}%"}},
            {destinationTxHash: {_ilike: "%${txHash}%"}}
          ]
        },
        order_by: {lastUpdated: desc},
        limit: 100
      ) {
        id srcEid dstEid sender receiver
        sourceTxHash destinationTxHash
        sentTimestamp deliveredTimestamp latencySeconds
        sourceChainId destinationChainId lastUpdated
        matched hasPayload
      }
    }`;
    
    return this.executeOptimizedQuery(searchQuery);
  }

  /**
   * Get more packets for list view by EID
   */
  async getListViewPackets(eid: string, filterType: 'from' | 'to'): Promise<any[] | null> {
    const eidFilter = filterType === 'from' 
      ? `{srcEid: {_eq: "${eid}"}}`
      : `{dstEid: {_eq: "${eid}"}}`;
    
    const listQuery = `{
      list_packets: LayerZeroPacket(
        where: {
          _and: [
            {matched: {_eq: true}},
            ${eidFilter}
          ]
        },
        order_by: {lastUpdated: desc},
        limit: 50
      ) {
        id srcEid dstEid sender receiver
        sourceTxHash destinationTxHash
        sentTimestamp deliveredTimestamp latencySeconds
        sourceChainId destinationChainId lastUpdated
        matched hasPayload
      }
    }`;
    
    return this.executeOptimizedQuery(listQuery);
  }

  /**
   * Clear old cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, cache] of this.cache.entries()) {
      if (now - cache.timestamp > 60000) { // 1 minute
        this.cache.delete(key);
      }
    }
  }
}

// Export singleton instance
export const layerZeroGraphQL = new LayerZeroGraphQLOptimized();

// Backward compatibility wrapper
export async function fetchAllLayerZeroData(): Promise<any[] | null> {
  return layerZeroGraphQL.fetchIncrementalData();
}