import { decodeAbiParameters, parseAbiParameters } from 'viem';

export interface DecodedAssetData {
  originalCaller: string;
  remoteReceiver: string;
  parsedOriginToken: string;
  amount: bigint;
  erc20Metadata: string;
}

export function decodeBridgeMintData(bridgeMintData: string): DecodedAssetData | null {
  try {
    const [originalCaller, remoteReceiver, parsedOriginToken, amount, erc20Metadata] = decodeAbiParameters(
      parseAbiParameters('address, address, address, uint256, bytes'),
      bridgeMintData as `0x${string}`
    );

    return {
      originalCaller: originalCaller as string,
      remoteReceiver: remoteReceiver as string,
      parsedOriginToken: parsedOriginToken as string,
      amount: amount as bigint,
      erc20Metadata: erc20Metadata as string,
    };
  } catch (error) {
    console.error('Failed to decode bridge mint data:', error);
    return null;
  }
}