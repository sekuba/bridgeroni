/**
 * Agglayer Bridge Formatter
 * 
 * Formatting utilities for displaying Agglayer bridge data in a user-friendly way.
 * Handles amount formatting, network names, addresses, and timing calculations.
 */

import {
  getChainNameFromAgglayerNetwork,
  getAgglayerNetworkFromChainId,
  AGGLAYER_NETWORK_TO_CHAIN_NAME,
} from '../constants';

/**
 * Format token amount with proper decimal places and symbol
 */
export function formatTokenAmount(
  amount: bigint,
  decimals: bigint,
  symbol?: string
): string {
  try {
    const divisor = 10n ** decimals;
    const wholePart = amount / divisor;
    const fractionalPart = amount % divisor;
    
    if (fractionalPart === 0n) {
      return `${wholePart.toString()}${symbol ? ` ${symbol}` : ''}`;
    }
    
    // Format fractional part with appropriate precision
    const fractionalStr = fractionalPart.toString().padStart(Number(decimals), '0');
    // Remove trailing zeros
    const trimmedFractional = fractionalStr.replace(/0+$/, '');
    
    if (trimmedFractional === '') {
      return `${wholePart.toString()}${symbol ? ` ${symbol}` : ''}`;
    }
    
    return `${wholePart.toString()}.${trimmedFractional}${symbol ? ` ${symbol}` : ''}`;
  } catch (error) {
    return `${amount.toString()}${symbol ? ` ${symbol}` : ''} (raw)`;
  }
}

/**
 * Format token amount in a compact way for display in limited space
 */
export function formatTokenAmountCompact(
  amount: bigint,
  decimals: bigint,
  symbol?: string
): string {
  try {
    const divisor = 10n ** decimals;
    const wholePart = amount / divisor;
    
    // For very large amounts, use scientific notation or abbreviated forms
    if (wholePart >= 1000000n) {
      const millions = Number(wholePart) / 1000000;
      return `${millions.toFixed(2)}M${symbol ? ` ${symbol}` : ''}`;
    } else if (wholePart >= 1000n) {
      const thousands = Number(wholePart) / 1000;
      return `${thousands.toFixed(2)}K${symbol ? ` ${symbol}` : ''}`;
    }
    
    // For smaller amounts, show up to 4 decimal places
    const fullAmount = Number(amount) / Number(divisor);
    const formatted = fullAmount.toFixed(4).replace(/\.?0+$/, '');
    
    return `${formatted}${symbol ? ` ${symbol}` : ''}`;
  } catch (error) {
    return formatTokenAmount(amount, decimals, symbol);
  }
}

/**
 * Format Agglayer network ID to human-readable network name
 */
export function formatNetworkName(networkId: bigint): string {
  const name = getChainNameFromAgglayerNetwork(Number(networkId));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Format address for display (shortened with ellipsis)
 */
export function formatAddress(address: string, length: number = 8): string {
  if (address.length <= length + 2) return address; // +2 for 0x prefix
  
  const start = address.slice(0, length / 2 + 2); // +2 for 0x
  const end = address.slice(-length / 2);
  return `${start}...${end}`;
}

/**
 * Format transaction hash for display
 */
export function formatTxHash(hash: string, length: number = 12): string {
  return formatAddress(hash, length);
}

/**
 * Format latency in human-readable format
 */
export function formatLatency(latencySeconds: bigint): string {
  const seconds = Number(latencySeconds);
  
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    const days = Math.floor(seconds / 86400);
    const remainingHours = Math.floor((seconds % 86400) / 3600);
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
}

/**
 * Format timestamp to readable date/time
 */
export function formatTimestamp(timestamp: bigint): string {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString();
}

/**
 * Format timestamp to relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(timestamp: bigint): string {
  const now = Date.now();
  const eventTime = Number(timestamp) * 1000;
  const diffMs = now - eventTime;
  const diffSeconds = Math.floor(diffMs / 1000);
  
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  } else if (diffSeconds < 3600) {
    const minutes = Math.floor(diffSeconds / 60);
    return `${minutes}m ago`;
  } else if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diffSeconds / 86400);
    return `${days}d ago`;
  }
}

/**
 * Format global index components for display
 */
export function formatGlobalIndex(
  mainnetFlag: boolean,
  rollupIndex: bigint,
  localRootIndex: bigint
): string {
  const flag = mainnetFlag ? "mainnet" : "rollup";
  return `${flag}:${rollupIndex}:${localRootIndex}`;
}

/**
 * Format deposit count (nonce) for display
 */
export function formatDepositCount(depositCount: bigint): string {
  const count = Number(depositCount);
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Get status color for terminal display
 */
export function getStatusColor(matched: boolean, depositCountMatches: boolean): string {
  if (matched && depositCountMatches) return '\x1b[32m'; // Green
  if (matched && !depositCountMatches) return '\x1b[33m'; // Yellow (matched but suspicious)
  return '\x1b[90m'; // Gray (unmatched)
}

/**
 * Format transfer status for display
 */
export function formatTransferStatus(
  matched: boolean,
  depositCountMatches: boolean,
  eventType: string
): string {
  if (matched && depositCountMatches) return 'MATCHED';
  if (matched && !depositCountMatches) return 'MATCHED*'; // Asterisk for suspicious
  return eventType.toUpperCase();
}

/**
 * Format the complete transfer summary for display
 */
export function formatTransferSummary(transfer: {
  assetOriginNetwork: bigint;
  assetDestinationNetwork?: bigint;
  amount: bigint;
  tokenSymbol?: string;
  tokenDecimals?: bigint;
  destinationAddress: string;
  matched: boolean;
  depositCountMatches: boolean;
  eventType: string;
  latencySeconds?: bigint;
}): string {
  const amount = formatTokenAmountCompact(
    transfer.amount,
    transfer.tokenDecimals || 18n,
    transfer.tokenSymbol || undefined
  );
  
  const fromNetwork = formatNetworkName(transfer.assetOriginNetwork);
  const toNetwork = transfer.assetDestinationNetwork 
    ? formatNetworkName(transfer.assetDestinationNetwork)
    : '?';
  
  const recipient = formatAddress(transfer.destinationAddress);
  const status = formatTransferStatus(
    transfer.matched,
    transfer.depositCountMatches,
    transfer.eventType
  );
  
  const latency = transfer.latencySeconds 
    ? ` (${formatLatency(transfer.latencySeconds)})`
    : '';
  
  return `${amount} ${fromNetwork}→${toNetwork} to ${recipient} [${status}]${latency}`;
}