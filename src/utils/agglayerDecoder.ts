/**
 * Agglayer Bridge Decoder
 * 
 * Handles decoding and parsing of Agglayer bridge events, metadata, and global indices.
 * Provides utilities for matching bridge events with claim events.
 */

import { AGGLAYER_CONSTANTS } from '../constants';

export interface DecodedTokenMetadata {
  name: string;
  symbol: string;
  decimals: bigint;
}

export interface DecodedGlobalIndex {
  mainnetFlag: boolean;
  rollupIndex: bigint;
  localRootIndex: bigint;
}

/**
 * Decode a dynamic string from ABI encoded data
 */
function decodeAbiString(data: string, offset: number): string | null {
  try {
    // Each hex character represents 4 bits, so multiply by 2 to get byte offset
    const byteOffset = offset * 2;
    
    if (data.length < byteOffset + 64) return null;
    
    // First 32 bytes at offset contain the string length
    const lengthHex = data.slice(byteOffset, byteOffset + 64);
    const length = parseInt(lengthHex, 16);
    
    if (length === 0) return "";
    if (length > AGGLAYER_CONSTANTS.METADATA_ENCODING.MAX_STRING_LENGTH) {
      return null; // Sanity check for unreasonable lengths
    }
    
    // String data starts after the length field
    const stringDataStart = byteOffset + 64;
    const stringDataEnd = stringDataStart + (length * 2); // length * 2 for hex encoding
    
    if (data.length < stringDataEnd) return null;
    
    const stringHex = data.slice(stringDataStart, stringDataEnd);
    
    // Convert hex to string
    let result = '';
    for (let i = 0; i < stringHex.length; i += 2) {
      const byte = parseInt(stringHex.slice(i, i + 2), 16);
      if (byte === 0) break; // Stop at null terminator
      result += String.fromCharCode(byte);
    }
    
    return result || null;
  } catch (error) {
    return null;
  }
}

/**
 * Handle bytes32 string format (left-aligned, null-terminated)
 * Used for legacy token implementations
 */
function decodeBytes32String(hex: string): string | null {
  try {
    if (hex.length !== 64) return null;
    
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (byte === 0) break; // Stop at first null byte
      if (byte < 32 || byte > 126) break; // Stop at non-printable characters
      result += String.fromCharCode(byte);
    }
    
    return result || null;
  } catch (error) {
    return null;
  }
}

/**
 * Full metadata decoder that handles the smart contract format
 * metadata is abi.encode(string name, string symbol, uint8 decimals)
 * 
 * ABI encoding format:
 * - First 32 bytes: offset to name string (usually 0x60)
 * - Second 32 bytes: offset to symbol string (dynamic, depends on name length)
 * - Third 32 bytes: decimals value (uint8, right-padded)
 * - Then the actual string data with lengths and content
 */
export function decodeTokenMetadata(metadata: string): DecodedTokenMetadata | null {
  try {
    // Remove 0x prefix if present
    const cleanMetadata = metadata.startsWith('0x') ? metadata.slice(2) : metadata;
    
    // Need at least 96 bytes (3 * 32) for the header
    if (cleanMetadata.length < AGGLAYER_CONSTANTS.METADATA_ENCODING.MIN_LENGTH) {
      return null;
    }
    
    // Parse the header (3 x 32 bytes)
    const nameOffsetHex = cleanMetadata.slice(0, 64);
    const symbolOffsetHex = cleanMetadata.slice(64, 128);
    const decimalsHex = cleanMetadata.slice(128, 192);
    
    // Extract decimals (should be a small uint8)
    const decimals = BigInt('0x' + decimalsHex);
    if (decimals > AGGLAYER_CONSTANTS.METADATA_ENCODING.DECIMALS_MAX) {
      console.warn(`Invalid decimals value: ${decimals}`);
      return null;
    }
    
    // Parse offsets
    const nameOffset = parseInt(nameOffsetHex, 16);
    const symbolOffset = parseInt(symbolOffsetHex, 16);
    
    // Decode strings using their offsets
    const name = decodeAbiString(cleanMetadata, nameOffset) || "Unknown";
    const symbol = decodeAbiString(cleanMetadata, symbolOffset) || "UNK";
    
    // Handle fallback cases mentioned in the smart contract
    const finalName = name === "NOT_VALID_ENCODING" ? "Unknown" : (name || "NO_NAME");
    const finalSymbol = symbol === "NOT_VALID_ENCODING" ? "UNK" : (symbol || "NO_SYMBOL");
    
    return {
      name: finalName,
      symbol: finalSymbol,
      decimals
    };
  } catch (error) {
    console.error('Failed to decode token metadata:', error);
    
    // Fallback: Try to extract just decimals for partial functionality
    try {
      const cleanMetadata = metadata.startsWith('0x') ? metadata.slice(2) : metadata;
      if (cleanMetadata.length >= AGGLAYER_CONSTANTS.METADATA_ENCODING.MIN_LENGTH) {
        const decimalsHex = cleanMetadata.slice(128, 192);
        const decimals = BigInt('0x' + decimalsHex);
        if (decimals <= AGGLAYER_CONSTANTS.METADATA_ENCODING.DECIMALS_MAX) {
          return {
            name: "Decode Error",
            symbol: "ERR",
            decimals
          };
        }
      }
    } catch {}
    
    return null;
  }
}

/**
 * Extract components from globalIndex
 * Global index format: | 191 bits | 1 bit | 32 bits | 32 bits |
 *                      |    0     | flag  | rollup  | local   |
 */
export function decodeGlobalIndex(globalIndex: bigint): DecodedGlobalIndex {
  const { LOCAL_ROOT_INDEX_BITS, ROLLUP_INDEX_BITS } = AGGLAYER_CONSTANTS.GLOBAL_INDEX;
  
  // Extract the last 32 bits (localRootIndex)
  const localRootIndex = globalIndex & ((1n << BigInt(LOCAL_ROOT_INDEX_BITS)) - 1n);
  
  // Extract rollup index (bits 32-63)
  const rollupIndex = (globalIndex >> BigInt(LOCAL_ROOT_INDEX_BITS)) & ((1n << BigInt(ROLLUP_INDEX_BITS)) - 1n);
  
  // Extract mainnet flag (bit 64)
  const mainnetFlag = ((globalIndex >> BigInt(LOCAL_ROOT_INDEX_BITS + ROLLUP_INDEX_BITS)) & 1n) === 1n;
  
  return {
    mainnetFlag,
    rollupIndex,
    localRootIndex
  };
}

/**
 * Validate that a bridge event and claim event should be matched
 * Returns true if all matching criteria are satisfied
 */
export function validateEventMatch(
  bridgeEvent: {
    assetOriginNetwork: bigint;
    assetOriginAddress: string;
    destinationAddress: string;
    amount: bigint;
    depositCount: bigint;
  },
  claimEvent: {
    assetOriginNetwork: bigint;
    assetOriginAddress: string;
    destinationAddress: string;
    amount: bigint;
    localRootIndex: bigint;
  }
): boolean {
  return (
    bridgeEvent.assetOriginNetwork === claimEvent.assetOriginNetwork &&
    bridgeEvent.assetOriginAddress.toLowerCase() === claimEvent.assetOriginAddress.toLowerCase() &&
    bridgeEvent.destinationAddress.toLowerCase() === claimEvent.destinationAddress.toLowerCase() &&
    bridgeEvent.amount === claimEvent.amount &&
    bridgeEvent.depositCount === claimEvent.localRootIndex
  );
}

/**
 * Check if a leaf type represents asset bridging
 */
export function isAssetBridging(leafType: bigint): boolean {
  return leafType === AGGLAYER_CONSTANTS.LEAF_TYPE.ASSET;
}

/**
 * Check if a leaf type represents message bridging
 */
export function isMessageBridging(leafType: bigint): boolean {
  return leafType === AGGLAYER_CONSTANTS.LEAF_TYPE.MESSAGE;
}

/**
 * Get human-readable leaf type description
 */
export function getLeafTypeDescription(leafType: bigint): string {
  if (isAssetBridging(leafType)) return "Asset Bridging";
  if (isMessageBridging(leafType)) return "Message Bridging";
  return `Unknown (${leafType})`;
}