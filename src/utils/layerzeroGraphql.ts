/**
 * LayerZero GraphQL Query Utilities
 * 
 * Provides GraphQL query definitions and helper functions for the LayerZero TUI.
 */

import { TUI_CONFIG } from '../constants';

/**
 * LayerZero GraphQL query definitions
 */
export const LAYERZERO_QUERIES = {
  // Get recent sent packet events
  recentPacketsSent: `{
    EndpointV2_PacketSent(
      limit: ${TUI_CONFIG.MAX_RECENT_EVENTS}, 
      order_by: [{blockTimestamp: desc}, {txHash: asc}]
    ) {
      id encodedPayload options sendLibrary
      chainId blockNumber blockTimestamp txHash
    }
  }`,
  
  // Get recent delivered packet events
  recentPacketsDelivered: `{
    EndpointV2_PacketDelivered(
      limit: ${TUI_CONFIG.MAX_RECENT_EVENTS}, 
      order_by: [{blockTimestamp: desc}, {txHash: asc}]
    ) {
      id originSrcEid originSender originNonce receiver
      chainId blockNumber blockTimestamp txHash
    }
  }`,
  
  // Get all matched packets for display
  matchedPackets: `{
    LayerZeroPacket(
      where: {matched: {_eq: true}}, 
      order_by: [{lastUpdated: desc}, {deliveredTimestamp: desc}, {sender: asc}, {receiver: asc}, {id: asc}]
    ) {
      id srcEid dstEid nonce sender receiver
      encodedPayload options sendLibrary payload
      sourceTxHash destinationTxHash
      sentTimestamp deliveredTimestamp latencySeconds
      sourceChainId destinationChainId
      lastUpdated
    }
  }`,
  
  // Get all packets for metrics calculation
  allPackets: `{
    LayerZeroPacket(order_by: {sentTimestamp: desc}) {
      matched latencySeconds srcEid dstEid
      sentBlock deliveredBlock sentTimestamp
      hasPayload
    }
  }`,
  
  // Get raw event counts
  allPacketsSent: `{
    EndpointV2_PacketSent { id }
  }`,
  
  allPacketsDelivered: `{
    EndpointV2_PacketDelivered { id }
  }`,

  // Get latest block number for each chain from sent packets
  latestBlocksPacketsSent: `{
    EndpointV2_PacketSent(
      order_by: [{chainId: asc}, {blockNumber: desc}]
      distinct_on: chainId
    ) {
      chainId blockNumber
    }
  }`,

  // Get latest block number for each chain from delivered packets
  latestBlocksPacketsDelivered: `{
    EndpointV2_PacketDelivered(
      order_by: [{chainId: asc}, {blockNumber: desc}]
      distinct_on: chainId
    ) {
      chainId blockNumber
    }
  }`
};

/**
 * Make GraphQL requests using built-in fetch
 */
export async function executeLayerZeroGraphQLQuery(query: string): Promise<any> {
  try {
    const response = await fetch(TUI_CONFIG.GRAPHQL_URL, {
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
    console.error(`LayerZero GraphQL Error: ${error.message}`);
    return null;
  }
}

/**
 * Execute all LayerZero queries in parallel
 */
export async function fetchAllLayerZeroData(): Promise<any[] | null> {
  const results = await Promise.all([
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.recentPacketsSent),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.recentPacketsDelivered),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.matchedPackets),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.allPackets),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.allPacketsSent),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.allPacketsDelivered),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.latestBlocksPacketsSent),
    executeLayerZeroGraphQLQuery(LAYERZERO_QUERIES.latestBlocksPacketsDelivered)
  ]);

  if (results.some(r => !r)) return null;
  return results;
}