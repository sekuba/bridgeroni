/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  L1AssetRouter,
  L1AssetRouter_BridgehubDepositBaseTokenInitiated,
  L1AssetRouter_BridgehubDepositFinalized,
  L1AssetRouter_BridgehubDepositInitiated,
  L1AssetRouter_ClaimedFailedDepositAssetRouter,
  L1AssetRouter_DepositFinalizedAssetRouter,
  L1AssetRouter_LegacyDepositInitiated,
} from "generated";

L1AssetRouter.BridgehubDepositBaseTokenInitiated.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubDepositBaseTokenInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    from: event.params.from,
    assetId: event.params.assetId,
    amount: event.params.amount,
  };

  context.L1AssetRouter_BridgehubDepositBaseTokenInitiated.set(entity);
});

L1AssetRouter.BridgehubDepositFinalized.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubDepositFinalized = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    txDataHash: event.params.txDataHash,
    l2DepositTxHash: event.params.l2DepositTxHash,
  };

  context.L1AssetRouter_BridgehubDepositFinalized.set(entity);
});

L1AssetRouter.BridgehubDepositInitiated.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubDepositInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    txDataHash: event.params.txDataHash,
    from: event.params.from,
    assetId: event.params.assetId,
    bridgeMintCalldata: event.params.bridgeMintCalldata,
  };

  context.L1AssetRouter_BridgehubDepositInitiated.set(entity);
});

L1AssetRouter.ClaimedFailedDepositAssetRouter.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_ClaimedFailedDepositAssetRouter = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    assetId: event.params.assetId,
    assetData: event.params.assetData,
  };

  context.L1AssetRouter_ClaimedFailedDepositAssetRouter.set(entity);
});

L1AssetRouter.DepositFinalizedAssetRouter.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_DepositFinalizedAssetRouter = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    assetId: event.params.assetId,
    assetData: event.params.assetData,
  };

  context.L1AssetRouter_DepositFinalizedAssetRouter.set(entity);
});

L1AssetRouter.LegacyDepositInitiated.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_LegacyDepositInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    l2DepositTxHash: event.params.l2DepositTxHash,
    from: event.params.from,
    to: event.params.to,
    l1Token: event.params.l1Token,
    amount: event.params.amount,
  };

  context.L1AssetRouter_LegacyDepositInitiated.set(entity);
});
