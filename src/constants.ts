/**
 * CCTP Bridge Monitor - Constants and Configuration
 * 
 * Centralized configuration for domain mappings, network parameters,
 * and application settings. This file ensures consistency across
 * the indexer and TUI components.
 */

// CCTP domain mappings for supported chains
export const DOMAIN_BY_CHAIN_ID: Record<number, bigint> = {
  1: 0n,        // Ethereum
  43114: 1n,    // Avalanche
  10: 2n,       // OP Mainnet
  42161: 3n,    // Arbitrum
  1151111081099710: 4n,  // Noble
  // 5: Solana (not EVM)
  8453: 6n,     // Base
  137: 7n,      // Polygon
  // 8: Sui (not EVM)
  // 9: Aptos (not EVM)  
  130: 10n,     // Unichain
  59144: 11n,   // Linea
  // 12: Codex (placeholder)
  // 13: Sonic (placeholder)
  480: 14n,     // World Chain
};

// Chain ID to domain mapping (reverse lookup)
export const CHAIN_ID_TO_DOMAIN = Object.fromEntries(
  Object.entries(DOMAIN_BY_CHAIN_ID).map(([chainId, domain]) => [parseInt(chainId), Number(domain)])
);

// Domain to chain name mapping
export const DOMAIN_TO_CHAIN_NAME: Record<number, string> = {
  0: 'ethereum',
  1: 'avalanche', 
  2: 'op',
  3: 'arbitrum',
  4: 'noble',
  5: 'solana',
  6: 'base',
  7: 'polygon',
  8: 'sui',
  9: 'aptos',
  10: 'unichain',
  11: 'linea',
  12: 'codex',
  13: 'sonic',
  14: 'worldchain',
};

// Chain ID to chain name mapping
export const CHAIN_ID_TO_NAME: Record<number, string> = {
  1: 'ethereum',
  43114: 'avalanche',
  10: 'op',
  42161: 'arbitrum',
  1151111081099710: 'noble',
  8453: 'base',
  137: 'polygon',
  130: 'unichain',
  59144: 'linea',
  480: 'worldchain',
};

// Explorer URL mappings
export const EXPLORER_URLS: Record<number, string> = {
  0: 'https://etherscan.io/tx/',            // Ethereum
  1: 'https://snowtrace.io/tx/',            // Avalanche
  2: 'https://optimistic.etherscan.io/tx/', // OP Mainnet
  3: 'https://arbiscan.io/tx/',             // Arbitrum
  6: 'https://basescan.org/tx/',            // Base
  7: 'https://polygonscan.com/tx/',         // Polygon
  10: 'https://uniscan.xyz/tx/',            // Unichain
  11: 'https://lineascan.build/tx/',        // Linea
  14: 'https://worldscan.org/tx/',          // World Chain
};

// Transfer amount bins for latency analysis (in USDC)
export const TRANSFER_AMOUNT_BINS = {
  micro: { min: 0, max: 10, label: '0-10' },
  small: { min: 10.01, max: 100, label: '>10-100' },
  medium: { min: 100.01, max: 10000, label: '>100-10k' },
  large: { min: 10000.01, max: 100000, label: '>10k-100k' },
  xlarge: { min: 100000.01, max: 1000000, label: '>100k-1M' },
  whale: { min: 1000000.01, max: Infinity, label: '>1M' }
} as const;

// TUI Configuration
export const TUI_CONFIG = {
  GRAPHQL_URL: 'http://localhost:8080/v1/graphql',
  REFRESH_INTERVAL: 1000, // 1 second
  MAX_RAW_EVENTS: 12,
  MAX_MATCHED_TRANSFERS: 6,
  MAX_RECENT_EVENTS: 15,
} as const;

// Terminal colors
export const COLORS = {
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
  red: '\x1b[31m',
} as const;

// CCTP Protocol constants
export const CCTP_CONSTANTS = {
  USDC_DECIMALS: 6,
  V2_MESSAGE_BODY_MIN_LENGTH: 456, // 228 bytes = 456 hex chars
  DETERMINISTIC_NONCE_PADDING: 64,
} as const;

// Helper function to create consistent transfer IDs
export const createTransferId = (domain: bigint, nonce: bigint | string): string => 
  `${domain}_${nonce}`;

// Helper function to get domain from chain ID
export const getDomainFromChainId = (chainId: number): bigint | undefined => 
  DOMAIN_BY_CHAIN_ID[chainId];

// Helper function to get chain name from domain
export const getChainNameFromDomain = (domain: number): string => 
  DOMAIN_TO_CHAIN_NAME[domain] || `Domain${domain}`;

// Helper function to get chain name from chain ID
export const getChainNameFromChainId = (chainId: number): string => 
  CHAIN_ID_TO_NAME[chainId] || `Chain${chainId}`;

// Helper function to get explorer URL
export const getExplorerUrl = (domain: number): string => 
  EXPLORER_URLS[domain] || 'https://etherscan.io/tx/';

// Helper function to format USDC amount
export const formatUSDCAmount = (amount: bigint): number => 
  Number(amount) / Math.pow(10, CCTP_CONSTANTS.USDC_DECIMALS);

// Helper function to check if chain supports only v2
export const isV2OnlyChain = (chainId: number): boolean => 
  [59144, 480].includes(chainId); // Linea, World Chain

// Helper function to check if chain supports v1
export const supportsV1 = (chainId: number): boolean => 
  [1, 10, 42161, 8453, 130].includes(chainId); // Ethereum, OP, Arbitrum, Base, Unichain

// Helper function to check if chain supports v2
export const supportsV2 = (chainId: number): boolean => 
  Object.keys(DOMAIN_BY_CHAIN_ID).map(Number).includes(chainId);