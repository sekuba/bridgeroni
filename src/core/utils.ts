import { isAddress, getAddress, keccak256, encodePacked, pad } from "viem";
import { mapChainIdToChainInfo, mapEidToChainInfo } from "../../analyze/const";

export function unpadNormalizeAddy(paddedAddress: string | null | undefined): string | undefined {
  if (!paddedAddress) return undefined;
  const with0x = paddedAddress.startsWith('0x') ? paddedAddress : '0x' + paddedAddress;
  const addr = '0x' + with0x.slice(-40);
  return isAddress(addr) ? getAddress(addr) : paddedAddress;
}

export function getEidForChain(chainId: number): number {
  const info = mapChainIdToChainInfo(chainId);
  if (!info) throw new Error(`Unknown chainId ${chainId} for EID mapping`);
  return info.eid;
}

export function calculateLayerZeroGUID(nonce: bigint, srcEid: number | bigint, sender: string, dstEid: number | bigint, receiver: string): string {
  const paddedSender = pad((sender as `0x${string}`));
  const paddedReceiver = pad((receiver as `0x${string}`));
  const src = typeof srcEid === 'bigint' ? Number(srcEid) : srcEid;
  const dst = typeof dstEid === 'bigint' ? Number(dstEid) : dstEid;
  return keccak256(encodePacked(
    ['uint64', 'uint32', 'bytes32', 'uint32', 'bytes32'],
    [nonce, src, paddedSender, dst, paddedReceiver]
  ));
}

export const ZERO_GUID = '0x0000000000000000000000000000000000000000000000000000000000000000';

export function getSlugForChainId(chainId: number | bigint | undefined): string | undefined {
  if (chainId === undefined) return undefined;
  const idn = typeof chainId === 'bigint' ? Number(chainId) : chainId;
  const info = mapChainIdToChainInfo(idn);
  return info?.slug;
}

export function getSlugForEid(eid: number | bigint | undefined): string | undefined {
  if (eid === undefined) return undefined;
  const idn = typeof eid === 'bigint' ? Number(eid) : eid;
  const info = mapEidToChainInfo(idn);
  return info?.slug;
}
