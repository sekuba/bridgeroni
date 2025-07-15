/**
 * CCTP v2 Message Decoder Utilities
 * 
 * Provides functions to decode CCTP v2 message bodies and compute
 * deterministic nonces for cross-chain message matching.
 */

import { createHash } from 'crypto';
import { CCTP_CONSTANTS } from '../constants';

export interface DecodedV2Message {
  version: number;
  burnToken: string;
  mintRecipient: string;
  amount: bigint;
  messageSender: string;
  maxFee: bigint;
  feeExecuted: bigint;
  expirationBlock: bigint;
  hookData: string;
}

/**
 * Decode CCTP v2 message body according to the format:
 * version (4 bytes) + burnToken (32 bytes) + mintRecipient (32 bytes) + 
 * amount (32 bytes) + messageSender (32 bytes) + maxFee (32 bytes) + 
 * feeExecuted (32 bytes) + expirationBlock (32 bytes) + hookData (dynamic)
 */
export function decodeV2MessageBody(messageBody: string): DecodedV2Message | null {
  try {
    const hex = messageBody.startsWith('0x') ? messageBody.slice(2) : messageBody;
    
    // Validate minimum length
    if (hex.length < CCTP_CONSTANTS.V2_MESSAGE_BODY_MIN_LENGTH) {
      return null;
    }
    
    let offset = 0;
    
    // Parse version (4 bytes)
    const version = parseInt(hex.slice(offset, offset + 8), 16);
    offset += 8;
    
    // Parse burnToken (32 bytes)
    const burnToken = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse mintRecipient (32 bytes)
    const mintRecipient = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse amount (32 bytes)
    const amount = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Parse messageSender (32 bytes)
    const messageSender = '0x' + hex.slice(offset, offset + 64);
    offset += 64;
    
    // Parse maxFee (32 bytes)
    const maxFee = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Parse feeExecuted (32 bytes)
    const feeExecuted = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Parse expirationBlock (32 bytes)
    const expirationBlock = BigInt('0x' + hex.slice(offset, offset + 64));
    offset += 64;
    
    // Remaining bytes are hookData
    const hookData = hex.length > offset ? '0x' + hex.slice(offset) : '0x';
    
    return {
      version,
      burnToken,
      mintRecipient,
      amount,
      messageSender,
      maxFee,
      feeExecuted,
      expirationBlock,
      hookData
    };
  } catch (error) {
    console.error('Failed to decode message body:', error);
    return null;
  }
}

/**
 * Compute deterministic nonce for CCTP v2 using source and destination event data
 * Uses SHA-256 hash of key message components for consistent matching
 */
export function computeV2DeterministicNonce(
  sourceDomain: bigint,
  destinationDomain: bigint,
  burnToken: string,
  mintRecipient: string,
  amount: bigint,
  messageSender: string,
  maxFee: bigint,
  hookData: string
): string {
  try {
    // Normalize all inputs to consistent format
    const components = [
      sourceDomain.toString(16).padStart(8, '0'),
      destinationDomain.toString(16).padStart(8, '0'),
      burnToken.slice(2).padStart(CCTP_CONSTANTS.DETERMINISTIC_NONCE_PADDING, '0'),
      mintRecipient.slice(2).padStart(CCTP_CONSTANTS.DETERMINISTIC_NONCE_PADDING, '0'),
      amount.toString(16).padStart(CCTP_CONSTANTS.DETERMINISTIC_NONCE_PADDING, '0'),
      messageSender.slice(2).padStart(CCTP_CONSTANTS.DETERMINISTIC_NONCE_PADDING, '0'),
      maxFee.toString(16).padStart(CCTP_CONSTANTS.DETERMINISTIC_NONCE_PADDING, '0'),
      hookData.startsWith('0x') ? hookData.slice(2) : hookData
    ];
    
    const concatenated = components.join('');
    const hash = createHash('sha256').update(concatenated, 'hex').digest('hex');
    
    return '0x' + hash;
  } catch (error) {
    console.error('Failed to compute deterministic nonce:', error);
    // Fallback to timestamp-based nonce if computation fails
    return '0x' + Date.now().toString(16).padStart(CCTP_CONSTANTS.DETERMINISTIC_NONCE_PADDING, '0');
  }
}

/**
 * Extract recipient address from mintRecipient (32-byte hex to address)
 */
export function extractRecipientAddress(mintRecipient: string): string {
  if (!mintRecipient || mintRecipient.length !== 66) {
    return '';
  }
  // Take last 20 bytes (40 hex chars) and add 0x prefix
  return '0x' + mintRecipient.slice(-40);
}