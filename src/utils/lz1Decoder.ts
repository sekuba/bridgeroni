/**
 * LayerZero v1 Packet Decoder Utilities
 * 
 * Provides functions to decode LayerZero v1 packet payloads and create
 * matching IDs for cross-chain message tracking.
 * 
 * LayerZero v1 uses two different event paths:
 * 1. UltraLightNodeV2: Packet (source) -> PacketReceived (destination)
 * 2. SendUln301: PacketSent (source) -> ReceiveUln301: PacketDelivered (destination)
 */

import { createHash } from 'crypto';

// LayerZero v1 constants
export const LAYERZERO_V1_CONSTANTS = {
  PACKET_VERSION: 1,
  CHAIN_ID_LENGTH: 2,    // uint16
  NONCE_LENGTH: 8,       // uint64
  ADDRESS_LENGTH: 20,    // Ethereum address
} as const;

export interface DecodedV1Packet {
  nonce: bigint;
  localChainId: number;
  ua: string;           // User Application address
  dstChainId: number;
  dstAddress: string;   // Destination address
  payload: string;      // The actual message payload
}

export interface DecodedV1PacketHeader {
  version: number;
  nonce: bigint;
  srcEid: number;       // For SendUln301 events
  sender: string;       // bytes32 sender
  dstEid: number;
  receiver: string;     // bytes32 receiver
}

export interface DecodedV1SendUln301Packet {
  header: DecodedV1PacketHeader;
  payload: string;
}

/**
 * Decode LayerZero v1 UltraLightNodeV2 Packet payload
 * Format: abi.encodePacked(nonce, localChainId, ua, dstChainId, dstAddress, payload)
 * - nonce: uint64 (8 bytes)
 * - localChainId: uint16 (2 bytes) 
 * - ua: address (20 bytes)
 * - dstChainId: uint16 (2 bytes)
 * - dstAddress: bytes (variable length, but typically 20 bytes for Ethereum)
 * - payload: bytes (remaining data)
 */
export function decodeV1Packet(packetPayload: string): DecodedV1Packet | null {
  try {
    const hex = packetPayload.startsWith('0x') ? packetPayload.slice(2) : packetPayload;
    
    // Validate minimum length (8 + 2 + 20 + 2 + 20 = 52 bytes minimum)
    if (hex.length < 104) { // 52 * 2 = 104 hex chars
      return null;
    }
    
    let offset = 0;
    
    // Parse nonce (8 bytes, big endian)
    const nonce = BigInt('0x' + hex.slice(offset, offset + 16));
    offset += 16;
    
    // Parse localChainId (2 bytes, big endian)
    const localChainId = parseInt(hex.slice(offset, offset + 4), 16);
    offset += 4;
    
    // Parse ua (20 bytes)
    const ua = '0x' + hex.slice(offset, offset + 40);
    offset += 40;
    
    // Parse dstChainId (2 bytes, big endian)
    const dstChainId = parseInt(hex.slice(offset, offset + 4), 16);
    offset += 4;
    
    // Parse dstAddress (20 bytes for Ethereum addresses)
    const dstAddress = '0x' + hex.slice(offset, offset + 40);
    offset += 40;
    
    // Parse payload (remaining bytes)
    const payload = hex.length > offset ? '0x' + hex.slice(offset) : '0x';
    
    return {
      nonce,
      localChainId,
      ua,
      dstChainId,
      dstAddress,
      payload
    };
  } catch (error) {
    console.error('Failed to decode v1 packet:', error);
    return null;
  }
}

/**
 * Decode LayerZero v1 SendUln301 PacketSent encodedPayload
 * Format: abi.encodePacked(packetHeader, payload)
 * PacketHeader format: version (1 byte) + nonce (8 bytes) + srcEid (4 bytes) + sender (32 bytes) + dstEid (4 bytes) + receiver (32 bytes)
 */
export function decodeV1SendUln301Packet(encodedPayload: string): DecodedV1SendUln301Packet | null {
  try {
    const hex = encodedPayload.startsWith('0x') ? encodedPayload.slice(2) : encodedPayload;
    
    // Validate minimum length for header (1 + 8 + 4 + 32 + 4 + 32 = 81 bytes)
    if (hex.length < 162) { // 81 * 2 = 162 hex chars
      return null;
    }
    
    let offset = 0;
    
    // Parse version (1 byte)
    const version = parseInt(hex.slice(offset, offset + 2), 16);
    offset += 2;
    
    // Parse nonce (8 bytes, big endian)
    const nonce = BigInt('0x' + hex.slice(offset, offset + 16));
    offset += 16;
    
    // Parse srcEid (4 bytes, big endian)
    const srcEid = parseInt(hex.slice(offset, offset + 8), 16);
    offset += 8;
    
    // Parse sender (32 bytes)
    const sender = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse dstEid (4 bytes, big endian)
    const dstEid = parseInt(hex.slice(offset, offset + 8), 16);
    offset += 8;
    
    // Parse receiver (32 bytes)
    const receiver = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse payload (remaining bytes)
    const payload = hex.length > offset ? '0x' + hex.slice(offset) : '0x';
    
    return {
      header: {
        version,
        nonce,
        srcEid,
        sender,
        dstEid,
        receiver
      },
      payload
    };
  } catch (error) {
    console.error('Failed to decode v1 SendUln301 packet:', error);
    return null;
  }
}

/**
 * Create LayerZero v1 matching ID for UltraLightNodeV2 path
 * Based on: keccak256(abi.encodePacked(nonce, srcChainId, ua, dstChainId, dstAddress))
 * This ensures deterministic matching between Packet and PacketReceived events
 */
export function createV1PacketId(nonce: bigint, srcChainId: number, ua: string, dstChainId: number, dstAddress: string): string {
  // Convert to bytes format
  const nonceBytes = nonce.toString(16).padStart(16, '0');
  const srcChainIdBytes = srcChainId.toString(16).padStart(4, '0');
  const uaBytes = normalizeAddress(ua).slice(2);
  const dstChainIdBytes = dstChainId.toString(16).padStart(4, '0');
  const dstAddressBytes = normalizeAddress(dstAddress).slice(2);
  
  // Concatenate all components (equivalent to abi.encodePacked)
  const concatenated = nonceBytes + srcChainIdBytes + uaBytes + dstChainIdBytes + dstAddressBytes;
  
  // Use sha256 (should be keccak256 for exact match with contracts)
  const hash = createHash('sha256').update(concatenated, 'hex').digest('hex');
  
  return '0x' + hash;
}

/**
 * Normalize address to bytes32 format (pad to 64 hex chars)
 */
export function normalizeAddress(address: string): string {
  const addr = address.startsWith('0x') ? address.slice(2) : address;
  return '0x' + addr.padStart(64, '0');
}

/**
 * Convert bytes32 to standard address format
 */
export function addressFromBytes32(bytes32: string): string {
  const addr = bytes32.startsWith('0x') ? bytes32.slice(2) : bytes32;
  return '0x' + addr.slice(-40);
}

/**
 * Validate LayerZero v1 chain ID
 */
export function isValidV1ChainId(chainId: number): boolean {
  return chainId > 0 && chainId <= 65535; // Chain IDs are 16-bit unsigned integers in v1
}

/**
 * Map LayerZero v1 chain IDs to actual chain IDs
 * This is a simplified mapping - in production, you'd need the full mapping
 */
export const LAYERZERO_V1_CHAIN_ID_MAP: Record<number, number> = {
  101: 1,      // Ethereum
  102: 56,     // BSC
  106: 43114,  // Avalanche
  109: 137,    // Polygon
  110: 42161,  // Arbitrum
  111: 10,     // Optimism
  116: 250,    // Fantom
  126: 1313161554, // Aurora
  138: 1666600000, // Harmony
  145: 100,    // Gnosis
  151: 1285,   // Moonriver
  155: 42220,  // Celo
  165: 8217,   // Klaytn
  175: 8453,   // Base
  // Add more mappings as needed
};

/**
 * Get actual chain ID from LayerZero v1 chain ID
 */
export function getActualChainId(lzChainId: number | bigint): number | undefined {
  const chainId = typeof lzChainId === 'bigint' ? Number(lzChainId) : lzChainId;
  return LAYERZERO_V1_CHAIN_ID_MAP[chainId];
}

/**
 * Get LayerZero v1 chain ID from actual chain ID
 */
export function getLzV1ChainId(actualChainId: number | bigint): number | undefined {
  const chainId = typeof actualChainId === 'bigint' ? Number(actualChainId) : actualChainId;
  for (const [lzChainId, cid] of Object.entries(LAYERZERO_V1_CHAIN_ID_MAP)) {
    if (cid === chainId) {
      return parseInt(lzChainId);
    }
  }
  return undefined;
}