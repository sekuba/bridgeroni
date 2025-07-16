/**
 * TUI Formatting Utilities
 * 
 * Provides consistent formatting functions for displaying data in the terminal UI.
 */

import { 
  DOMAIN_TO_CHAIN_NAME, 
  CHAIN_ID_TO_DOMAIN,
  EXPLORER_URLS,
  CCTP_CONSTANTS,
  COLORS
} from '../constants';

/**
 * Format USDC amount for display
 */
export function formatUSDCAmount(amount: bigint | string | null | undefined, hasAmount = true): string {
  if (!amount || !hasAmount) return '?';
  const num = Number(amount) / Math.pow(10, CCTP_CONSTANTS.USDC_DECIMALS);
  return num >= 1000 ? `$${(num/1000).toFixed(1)}k` : `$${num.toFixed(2)}`;
}

/**
 * Format volume amount (already in USDC)
 */
export function formatVolume(amount: number): string {
  if (!amount || amount === 0) return '$0';
  if (amount >= 1000000) return `$${(amount/1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount/1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

/**
 * Format address for display
 */
export function formatAddress(addr: string | null | undefined): string {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

/**
 * Format transaction hash with explorer URL
 */
export function formatTxHashWithUrl(hash: string | null | undefined, domain: number): string {
  if (!hash || hash.length < 10) return hash || '';
  const baseUrl = EXPLORER_URLS[domain] || 'https://etherscan.io/tx/';
  return `${baseUrl}${hash}`;
}

/**
 * Format duration in human readable form
 */
export function formatDuration(seconds: number | bigint | null | undefined): string {
  if (!seconds || Number(seconds) <= 0) return '?';
  
  const sec = Number(seconds);
  if (sec < 60) return `${sec}s`;
  
  const mins = Math.floor(sec / 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h`;
  }
  return `${mins}m`;
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: bigint | string | null | undefined): string {
  if (!timestamp) return '?';
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Extract recipient address from mintRecipient (32-byte hex to address)
 */
export function extractRecipientAddress(mintRecipient: string | null | undefined): string {
  if (!mintRecipient || mintRecipient.length !== 66) return '';
  // Take last 20 bytes (40 hex chars) and add 0x prefix
  return '0x' + mintRecipient.slice(-40);
}

/**
 * Get chain name from domain
 */
export function getChainNameFromDomain(domain: number): string {
  return DOMAIN_TO_CHAIN_NAME[domain] || `Domain${domain}`;
}

/**
 * Get chain name from chain ID
 */
export function getChainNameFromChainId(chainId: number): string {
  const domain = CHAIN_ID_TO_DOMAIN[chainId];
  return domain !== undefined ? getChainNameFromDomain(domain) : `Chain${chainId}`;
}

/**
 * Get chain color for display by chain name
 */
export function getChainColorByName(chainName: string): string {
  switch(chainName.toLowerCase()) {
    case 'ethereum': return COLORS.purple;
    case 'op': return COLORS.red;
    case 'arbitrum': return COLORS.cyan;
    case 'base': return COLORS.blue;
    case 'unichain': return COLORS.lightRed;
    case 'linea': return COLORS.dim;
    case 'worldchain': return COLORS.yellow;
    default: return COLORS.white;
  }
}

/**
 * Convert USDC amount to number for calculations
 */
export function convertUSDCToNumber(amount: bigint | string | null | undefined): number {
  if (!amount) return 0;
  return Number(amount) / Math.pow(10, CCTP_CONSTANTS.USDC_DECIMALS);
}