/**
 * LayerZero TUI Formatting Utilities
 * 
 * Provides consistent formatting functions for displaying LayerZero data in the terminal UI.
 */

import { 
  LAYERZERO_EID_TO_CHAIN_NAME,
  CHAIN_ID_TO_LAYERZERO_EID,
  EXPLORER_URLS,
  COLORS
} from '../constants';

import { 
  formatAddress,
  formatDuration,
  formatTimestamp,
  getChainColorByName
} from './formatters';

/**
 * Get chain name from LayerZero EID
 */
export function getChainNameFromEid(eid: number): string {
  return LAYERZERO_EID_TO_CHAIN_NAME[eid] || `EID${eid}`;
}

/**
 * Get chain name from chain ID (via EID mapping)
 */
export function getChainNameFromChainId(chainId: number): string {
  const eid = CHAIN_ID_TO_LAYERZERO_EID[chainId];
  return eid ? getChainNameFromEid(eid) : `Chain${chainId}`;
}

/**
 * Format EID for display
 */
export function formatEid(eid: number): string {
  const chainName = getChainNameFromEid(eid);
  return `${chainName}(${eid})`;
}

/**
 * Format packet payload for display
 */
export function formatPayload(payload: string | null | undefined): string {
  if (!payload || payload === '0x') return '∅';
  if (payload.length <= 20) return payload;
  return `${payload.slice(0, 10)}...${payload.slice(-6)}`;
}

/**
 * Format packet options for display
 */
export function formatOptions(options: string | null | undefined): string {
  if (!options || options === '0x') return '∅';
  if (options.length <= 20) return options;
  return `${options.slice(0, 10)}...${options.slice(-6)}`;
}

/**
 * Format send library address for display
 */
export function formatSendLibrary(sendLibrary: string | null | undefined): string {
  if (!sendLibrary) return '?';
  return formatAddress(sendLibrary);
}

/**
 * Format nonce for display
 */
export function formatNonce(nonce: bigint | string | null | undefined): string {
  if (!nonce) return '?';
  const nonceStr = nonce.toString();
  if (nonceStr.length <= 12) return nonceStr;
  return `${nonceStr.slice(0, 6)}...${nonceStr.slice(-4)}`;
}

/**
 * Format bytes32 sender/receiver for display
 */
export function formatBytes32Address(bytes32: string | null | undefined): string {
  if (!bytes32) return '?';
  // Convert bytes32 to standard address format for display
  const address = '0x' + bytes32.slice(-40);
  return formatAddress(address);
}

/**
 * Format transaction hash with explorer URL for LayerZero supported chains
 */
export function formatTxHashWithUrl(hash: string | null | undefined, chainId: number): string {
  if (!hash || hash.length < 10) return hash || '';
  
  // Direct mapping for LayerZero supported chains
  const explorerUrls: Record<number, string> = {
    1: 'https://etherscan.io/tx/',       // Ethereum
    8453: 'https://basescan.org/tx/',    // Base
    42161: 'https://arbiscan.io/tx/',    // Arbitrum
    10: 'https://optimistic.etherscan.io/tx/', // OP mainnet
    56: 'https://bscscan.com/tx/',       // BSC
  };
  
  const baseUrl = explorerUrls[chainId] || 'https://etherscan.io/tx/';
  return `${baseUrl}${hash}`;
}

/**
 * Get chain color by EID
 */
export function getChainColorByEid(eid: number): string {
  const chainName = getChainNameFromEid(eid);
  return getChainColorByName(chainName);
}

/**
 * Format packet size (payload length) for display
 */
export function formatPacketSize(payload: string | null | undefined): string {
  if (!payload || payload === '0x') return '0b';
  
  // Calculate bytes (2 hex chars = 1 byte, subtract 2 for '0x')
  const bytes = Math.max(0, (payload.length - 2) / 2);
  
  if (bytes === 0) return '0b';
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

/**
 * Format packet direction for display
 */
export function formatPacketDirection(srcEid: number, dstEid: number): string {
  const srcChain = getChainNameFromEid(srcEid);
  const dstChain = getChainNameFromEid(dstEid);
  const srcColor = getChainColorByEid(srcEid);
  const dstColor = getChainColorByEid(dstEid);
  
  return `${srcColor}${srcChain}${COLORS.reset}→${dstColor}${dstChain}${COLORS.reset}`;
}

/**
 * Format packet status for display
 */
export function formatPacketStatus(matched: boolean, hasPayload: boolean): string {
  if (matched) {
    return `${COLORS.green}✓${COLORS.reset}`;
  }
  return `${COLORS.yellow}⏳${COLORS.reset}`;
}

/**
 * Format detailed packet info for list view
 */
export function formatPacketDetails(packet: any): string {
  const srcEid = Number(packet.srcEid);
  let dstEid = Number(packet.dstEid);
  
  // If dstEid is null, 0, or NaN, derive it from destinationChainId
  if (!dstEid || isNaN(dstEid)) {
    dstEid = CHAIN_ID_TO_LAYERZERO_EID[Number(packet.destinationChainId)] || 0;
  }
  
  const direction = formatPacketDirection(srcEid, dstEid);
  const sender = formatBytes32Address(packet.sender);
  const receiver = formatBytes32Address(packet.receiver);
  const latency = formatDuration(Number(packet.latencySeconds));
  
  // Check if packet is actually matched (has both source and destination tx hashes)
  const isMatched = !!(packet.sourceTxHash && packet.destinationTxHash);
  const status = formatPacketStatus(isMatched, packet.hasPayload);
  
  return `${status} ${direction}: ${COLORS.green}${sender}${COLORS.reset}→${COLORS.green}${receiver}${COLORS.reset} ${COLORS.magenta}~${latency}${COLORS.reset}`;
}

/**
 * Format EID list for navigation hints
 */
export function formatEidNavigationHints(): string {
  const hints: string[] = [];
  let index = 1;
  
  Object.entries(LAYERZERO_EID_TO_CHAIN_NAME).forEach(([eid, chainName]) => {
    const color = getChainColorByName(chainName);
    hints.push(`[${index}] ${color}${chainName}${COLORS.reset}`);
    index++;
  });
  
  return hints.join(' ');
}