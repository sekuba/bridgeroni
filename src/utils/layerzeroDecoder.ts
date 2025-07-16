/**
 * LayerZero v2 Packet Decoder Utilities
 * 
 * Provides functions to decode LayerZero v2 packet headers and create
 * matching IDs for cross-chain message tracking.
 */

import { createHash } from 'crypto';

// LayerZero v2 constants
export const LAYERZERO_CONSTANTS = {
  PACKET_VERSION: 1,
  PACKET_HEADER_LENGTH: 81, // 1 + 8 + 4 + 32 + 4 + 32 = 81 bytes
  EID_LENGTH: 4,
  NONCE_LENGTH: 8,
  SENDER_LENGTH: 32,
  RECEIVER_LENGTH: 32,
} as const;

export interface DecodedPacketHeader {
  version: number;
  nonce: bigint;
  srcEid: number;
  sender: string;
  dstEid: number;
  receiver: string;
}

export interface DecodedPacket {
  header: DecodedPacketHeader;
  payload: string;
}

export interface LayerZeroOrigin {
  srcEid: number;
  sender: string;
  nonce: bigint;
}

/**
 * Decode LayerZero v2 packet header from encodedPayload
 * Format: version (1 byte) + nonce (8 bytes) + srcEid (4 bytes) + sender (32 bytes) + dstEid (4 bytes) + receiver (32 bytes)
 */
export function decodePacketHeader(encodedPayload: string): DecodedPacketHeader | null {
  try {
    const hex = encodedPayload.startsWith('0x') ? encodedPayload.slice(2) : encodedPayload;
    
    // Validate minimum length for header
    if (hex.length < LAYERZERO_CONSTANTS.PACKET_HEADER_LENGTH * 2) {
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
    
    return {
      version,
      nonce,
      srcEid,
      sender,
      dstEid,
      receiver
    };
  } catch (error) {
    console.error('Failed to decode packet header:', error);
    return null;
  }
}

/**
 * Decode full LayerZero v2 packet (header + payload)
 */
export function decodePacket(encodedPayload: string): DecodedPacket | null {
  try {
    const header = decodePacketHeader(encodedPayload);
    if (!header) return null;
    
    const hex = encodedPayload.startsWith('0x') ? encodedPayload.slice(2) : encodedPayload;
    
    // Extract payload (everything after header)
    const headerLength = LAYERZERO_CONSTANTS.PACKET_HEADER_LENGTH * 2;
    const payload = hex.length > headerLength ? '0x' + hex.slice(headerLength) : '0x';
    
    return {
      header,
      payload
    };
  } catch (error) {
    console.error('Failed to decode packet:', error);
    return null;
  }
}

/**
 * Create a unique packet ID for matching sent and delivered packets
 * Uses srcEid + sender + nonce combination for deterministic matching
 */
export function createPacketId(srcEid: number, sender: string, nonce: bigint): string {
  const components = [
    srcEid.toString(16).padStart(8, '0'),
    sender.slice(2).padStart(64, '0'),
    nonce.toString(16).padStart(16, '0')
  ];
  
  const concatenated = components.join('');
  const hash = createHash('sha256').update(concatenated, 'hex').digest('hex');
  
  return '0x' + hash.slice(0, 32); // Use first 32 chars for shorter ID
}

/**
 * Create packet ID from Origin struct
 */
export function createPacketIdFromOrigin(origin: LayerZeroOrigin): string {
  return createPacketId(origin.srcEid, origin.sender, origin.nonce);
}

/**
 * Normalize sender/receiver address to bytes32 format
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
 * Validate LayerZero EID
 */
export function isValidEid(eid: number): boolean {
  return eid > 0 && eid <= 65535; // EIDs are 16-bit unsigned integers
}

/**
 * Encode packet header for testing/validation
 */
export function encodePacketHeader(packet: DecodedPacketHeader): string {
  const version = packet.version.toString(16).padStart(2, '0');
  const nonce = packet.nonce.toString(16).padStart(16, '0');
  const srcEid = packet.srcEid.toString(16).padStart(8, '0');
  const sender = packet.sender.slice(2).padStart(64, '0');
  const dstEid = packet.dstEid.toString(16).padStart(8, '0');
  const receiver = packet.receiver.slice(2).padStart(64, '0');
  
  return '0x' + version + nonce + srcEid + sender + dstEid + receiver;
}