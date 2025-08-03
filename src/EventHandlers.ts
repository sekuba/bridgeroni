/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import {
  L1AssetRouter,
  L1AssetRouter_AssetDeploymentTrackerRegistered,
  L1AssetRouter_AssetDeploymentTrackerSet,
  L1AssetRouter_AssetHandlerRegistered,
  L1AssetRouter_BridgehubDepositBaseTokenInitiated,
  L1AssetRouter_BridgehubDepositFinalized,
  L1AssetRouter_BridgehubDepositInitiated,
  L1AssetRouter_BridgehubMintData,
  L1AssetRouter_BridgehubWithdrawalInitiated,
  L1AssetRouter_ClaimedFailedDepositAssetRouter,
  L1AssetRouter_DepositFinalizedAssetRouter,
  L1AssetRouter_LegacyDepositInitiated,
  L1AssetRouter_Paused,
  L1AssetRouter_Unpaused,
  L2AssetRouter,
  L2AssetRouter_AssetDeploymentTrackerRegistered,
  L2AssetRouter_AssetHandlerRegistered,
  L2AssetRouter_BridgehubDepositBaseTokenInitiated,
  L2AssetRouter_BridgehubDepositInitiated,
  L2AssetRouter_BridgehubWithdrawalInitiated,
  L2AssetRouter_DepositFinalizedAssetRouter,
  L2AssetRouter_Paused,
  L2AssetRouter_Unpaused,
  L2AssetRouter_WithdrawalInitiatedAssetRouter,
} from "generated";

L1AssetRouter.AssetDeploymentTrackerRegistered.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_AssetDeploymentTrackerRegistered = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    assetId: event.params.assetId,
    additionalData: event.params.additionalData,
    assetDeploymentTracker: event.params.assetDeploymentTracker,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_AssetDeploymentTrackerRegistered.set(entity);
});

L1AssetRouter.AssetDeploymentTrackerSet.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_AssetDeploymentTrackerSet = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    assetId: event.params.assetId,
    assetDeploymentTracker: event.params.assetDeploymentTracker,
    additionalData: event.params.additionalData,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_AssetDeploymentTrackerSet.set(entity);
});

L1AssetRouter.AssetHandlerRegistered.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_AssetHandlerRegistered = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    assetId: event.params.assetId,
    _assetHandlerAddress: event.params._assetHandlerAddress,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_AssetHandlerRegistered.set(entity);
});

L1AssetRouter.BridgehubDepositBaseTokenInitiated.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubDepositBaseTokenInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    from: event.params.from,
    assetId: event.params.assetId,
    amount: event.params.amount,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_BridgehubDepositBaseTokenInitiated.set(entity);
});

L1AssetRouter.BridgehubDepositFinalized.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubDepositFinalized = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    txDataHash: event.params.txDataHash,
    l2DepositTxHash: event.params.l2DepositTxHash,
    txHash: event.transaction.hash,
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
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_BridgehubDepositInitiated.set(entity);
});

L1AssetRouter.BridgehubMintData.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubMintData = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    bridgeMintData: event.params.bridgeMintData,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_BridgehubMintData.set(entity);
});

L1AssetRouter.BridgehubWithdrawalInitiated.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_BridgehubWithdrawalInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    sender: event.params.sender,
    assetId: event.params.assetId,
    assetDataHash: event.params.assetDataHash,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_BridgehubWithdrawalInitiated.set(entity);
});

L1AssetRouter.ClaimedFailedDepositAssetRouter.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_ClaimedFailedDepositAssetRouter = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    assetId: event.params.assetId,
    assetData: event.params.assetData,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_ClaimedFailedDepositAssetRouter.set(entity);
});

L1AssetRouter.DepositFinalizedAssetRouter.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_DepositFinalizedAssetRouter = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    assetId: event.params.assetId,
    assetData: event.params.assetData,
    txHash: event.transaction.hash,
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
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_LegacyDepositInitiated.set(entity);
});

L1AssetRouter.Paused.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_Paused = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    account: event.params.account,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_Paused.set(entity);
});

L1AssetRouter.Unpaused.handler(async ({ event, context }) => {
  const entity: L1AssetRouter_Unpaused = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    account: event.params.account,
    txHash: event.transaction.hash,
  };

  context.L1AssetRouter_Unpaused.set(entity);
});

L2AssetRouter.AssetDeploymentTrackerRegistered.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_AssetDeploymentTrackerRegistered = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    assetId: event.params.assetId,
    additionalData: event.params.additionalData,
    assetDeploymentTracker: event.params.assetDeploymentTracker,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_AssetDeploymentTrackerRegistered.set(entity);
});

L2AssetRouter.AssetHandlerRegistered.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_AssetHandlerRegistered = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    assetId: event.params.assetId,
    _assetHandlerAddress: event.params._assetHandlerAddress,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_AssetHandlerRegistered.set(entity);
});

L2AssetRouter.BridgehubDepositBaseTokenInitiated.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_BridgehubDepositBaseTokenInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    from: event.params.from,
    assetId: event.params.assetId,
    amount: event.params.amount,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_BridgehubDepositBaseTokenInitiated.set(entity);
});

L2AssetRouter.BridgehubDepositInitiated.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_BridgehubDepositInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    txDataHash: event.params.txDataHash,
    from: event.params.from,
    assetId: event.params.assetId,
    bridgeMintCalldata: event.params.bridgeMintCalldata,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_BridgehubDepositInitiated.set(entity);
});

L2AssetRouter.BridgehubWithdrawalInitiated.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_BridgehubWithdrawalInitiated = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    sender: event.params.sender,
    assetId: event.params.assetId,
    assetDataHash: event.params.assetDataHash,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_BridgehubWithdrawalInitiated.set(entity);
});

L2AssetRouter.DepositFinalizedAssetRouter.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_DepositFinalizedAssetRouter = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    assetId: event.params.assetId,
    assetData: event.params.assetData,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_DepositFinalizedAssetRouter.set(entity);
});

L2AssetRouter.Paused.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_Paused = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    account: event.params.account,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_Paused.set(entity);
});

L2AssetRouter.Unpaused.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_Unpaused = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    account: event.params.account,
    txHash: event.transaction.hash, 
  };

  context.L2AssetRouter_Unpaused.set(entity);
});

L2AssetRouter.WithdrawalInitiatedAssetRouter.handler(async ({ event, context }) => {
  const entity: L2AssetRouter_WithdrawalInitiatedAssetRouter = {
    id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
    chainId: event.params.chainId,
    l2Sender: event.params.l2Sender,
    assetId: event.params.assetId,
    assetData: event.params.assetData,
    txHash: event.transaction.hash,
  };

  context.L2AssetRouter_WithdrawalInitiatedAssetRouter.set(entity);
});
