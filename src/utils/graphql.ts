/**
 * GraphQL Query Utilities
 * 
 * Provides GraphQL query definitions and helper functions for the TUI.
 */

import { TUI_CONFIG } from '../constants';

/**
 * GraphQL query definitions
 */
export const QUERIES = {
  // Get recent deposit events from v1 contracts
  recentDeposits: `{
    TokenMessenger_DepositForBurn(
      limit: ${TUI_CONFIG.MAX_RECENT_EVENTS}, 
      order_by: {blockTimestamp: desc}
    ) {
      id nonce amount depositor destinationDomain
      chainId blockTimestamp txHash
    }
  }`,
  
  // Get recent deposit events from v2 contracts
  recentDepositsV2: `{
    TokenMessenger_DepositForBurnV2(
      limit: ${TUI_CONFIG.MAX_RECENT_EVENTS}, 
      order_by: {blockTimestamp: desc}
    ) {
      id amount depositor destinationDomain
      chainId blockTimestamp txHash
    }
  }`,
  
  // Get recent received events from v1 contracts
  recentReceived: `{
    MessageTransmitter_MessageReceived(
      limit: ${TUI_CONFIG.MAX_RECENT_EVENTS}, 
      order_by: {blockTimestamp: desc}
    ) {
      id nonce sourceDomain caller
      chainId blockTimestamp txHash
    }
  }`,
  
  // Get recent received events from v2 contracts
  recentReceivedV2: `{
    MessageTransmitter_MessageReceivedV2(
      limit: ${TUI_CONFIG.MAX_RECENT_EVENTS}, 
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
      order_by: [{messageReceivedTimestamp: desc}, {amount: desc}, {id: asc}]
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
  
  // Get raw event counts
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

/**
 * Make GraphQL requests using built-in fetch
 */
export async function executeGraphQLQuery(query: string): Promise<any> {
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
    console.error(`GraphQL Error: ${error.message}`);
    return null;
  }
}

/**
 * Execute all queries in parallel
 */
export async function fetchAllData(): Promise<any[] | null> {
  const results = await Promise.all([
    executeGraphQLQuery(QUERIES.recentDeposits),
    executeGraphQLQuery(QUERIES.recentDepositsV2),
    executeGraphQLQuery(QUERIES.recentReceived),
    executeGraphQLQuery(QUERIES.recentReceivedV2),
    executeGraphQLQuery(QUERIES.matchedTransfers),
    executeGraphQLQuery(QUERIES.allTransfers),
    executeGraphQLQuery(QUERIES.allDeposits),
    executeGraphQLQuery(QUERIES.allDepositsV2),
    executeGraphQLQuery(QUERIES.allReceived),
    executeGraphQLQuery(QUERIES.allReceivedV2)
  ]);

  if (results.some(r => !r)) return null;
  return results;
}