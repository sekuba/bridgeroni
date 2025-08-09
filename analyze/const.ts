export interface ChainInfo {
    name: string;
    slug: string;
    chainId: number | null; // Use number for Chain IDs, null for chains without a standard numeric ID
    eid: number;
}

const LAYERZERO_CHAINS_V2: ChainInfo[] = [
    { name: 'Abstract Mainnet', slug: 'abstract', chainId: 2741, eid: 30324 },
    { name: 'Animechain Mainnet', slug: 'animechain', chainId: 69000, eid: 30372 },
    { name: 'Ape Mainnet', slug: 'ape', chainId: 33139, eid: 30312 },
    { name: 'Aptos', slug: 'aptos', chainId: null, eid: 30108 },
    { name: 'Arbitrum Mainnet', slug: 'arbitrum', chainId: 42161, eid: 30110 },
    { name: 'Arbitrum Nova Mainnet', slug: 'arbitrumnova', chainId: 42170, eid: 30175 },
    { name: 'Astar Mainnet', slug: 'astar', chainId: 592, eid: 30210 },
    { name: 'Astar zkEVM Mainnet', slug: 'astarzkevm', chainId: 3776, eid: 30257 },
    { name: 'Avalanche Mainnet', slug: 'avalanche', chainId: 43114, eid: 30106 },
    { name: 'BNB Smart Chain (BSC) Mainnet', slug: 'bsc', chainId: 56, eid: 30102 },
    { name: 'BOB Mainnet', slug: 'bob', chainId: 60808, eid: 30279 },
    { name: 'Bahamut Mainnet', slug: 'bahamut', chainId: 5165, eid: 30363 },
    { name: 'Base Mainnet', slug: 'base', chainId: 8453, eid: 30184 },
    { name: 'Beam Mainnet', slug: 'beam', chainId: 4337, eid: 30198 },
    { name: 'Berachain Mainnet', slug: 'berachain', chainId: 80094, eid: 30362 },
    { name: 'Bevm Mainnet', slug: 'bevm', chainId: 11501, eid: 30317 },
    { name: 'Bitlayer Mainnet', slug: 'bitlayer', chainId: 200901, eid: 30314 },
    { name: 'Blast Mainnet', slug: 'blast', chainId: 81457, eid: 30243 },
    { name: 'Botanix', slug: 'botanix', chainId: 3637, eid: 30376 },
    { name: 'Bouncebit Mainnet', slug: 'bouncebit', chainId: 6001, eid: 30293 },
    { name: 'Canto Mainnet', slug: 'canto', chainId: 7700, eid: 30159 },
    { name: 'Celo Mainnet', slug: 'celo', chainId: 42220, eid: 30125 },
    { name: 'Codex Mainnet', slug: 'codex', chainId: 81224, eid: 30323 },
    { name: 'Concrete', slug: 'concrete', chainId: 12739, eid: 30366 },
    { name: 'Conflux eSpace Mainnet', slug: 'conflux', chainId: 1030, eid: 30212 },
    { name: 'CoreDAO Mainnet', slug: 'coredao', chainId: 1116, eid: 30153 },
    { name: 'Corn Mainnet', slug: 'corn', chainId: 21000000, eid: 30331 },
    { name: 'Cronos EVM Mainnet', slug: 'cronos', chainId: 25, eid: 30359 },
    { name: 'Cronos zkEVM Mainnet', slug: 'cronoszkevm', chainId: 388, eid: 30360 },
    { name: 'Cyber Mainnet', slug: 'cyber', chainId: 7560, eid: 30283 },
    { name: 'DFK Chain', slug: 'dfk', chainId: 53935, eid: 30115 },
    { name: 'DM2 Verse Mainnet', slug: 'dm2verse', chainId: 68770, eid: 30315 },
    { name: 'DOS Chain Mainnet', slug: 'dos', chainId: 7979, eid: 30149 },
    { name: 'Degen Mainnet', slug: 'degen', chainId: 666666666, eid: 30267 },
    { name: 'Dexalot Subnet Mainnet', slug: 'dexalot', chainId: 432204, eid: 30118 },
    { name: 'EDU Chain Mainnet', slug: 'edu', chainId: 41923, eid: 30328 },
    { name: 'EVM on Flow Mainnet', slug: 'evmonflow', chainId: 747, eid: 30336 },
    { name: 'Ethereum Mainnet', slug: 'ethereum', chainId: 1, eid: 30101 },
    { name: 'Etherlink Mainnet', slug: 'etherlink', chainId: 42793, eid: 30292 },
    { name: 'Fantom Mainnet', slug: 'fantom', chainId: 250, eid: 30112 },
    { name: 'Flare Mainnet', slug: 'flare', chainId: 14, eid: 30295 },
    { name: 'Fraxtal Mainnet', slug: 'fraxtal', chainId: 252, eid: 30255 },
    { name: 'Fuse Mainnet', slug: 'fuse', chainId: 122, eid: 30138 },
    { name: 'Glue Mainnet', slug: 'glue', chainId: 1300, eid: 30342 },
    { name: 'Gnosis Mainnet', slug: 'gnosis', chainId: 100, eid: 30145 },
    { name: 'Goat Mainnet', slug: 'goat', chainId: 2345, eid: 30361 },
    { name: 'Gravity Mainnet', slug: 'gravity', chainId: 1625, eid: 30294 },
    { name: 'Gunz Mainnet', slug: 'gunz', chainId: 43419, eid: 30371 },
    { name: 'Harmony Mainnet', slug: 'harmony', chainId: 1666600000, eid: 30116 },
    { name: 'Hedera Mainnet', slug: 'hedera', chainId: 295, eid: 30316 },
    { name: 'Hemi Mainnet', slug: 'hemi', chainId: 43111, eid: 30329 },
    { name: 'Homeverse Mainnet', slug: 'homeverse', chainId: 19011, eid: 30265 },
    { name: 'Horizen EON Mainnet', slug: 'horizen', chainId: 7332, eid: 30215 },
    { name: 'Hubble Mainnet', slug: 'hubble', chainId: 1992, eid: 30182 },
    { name: 'HyperEVM Mainnet', slug: 'hyperevm', chainId: 999, eid: 30367 },
    { name: 'Initia Mainnet', slug: 'initia', chainId: null, eid: 30326 },
    { name: 'Ink Mainnet', slug: 'ink', chainId: 57073, eid: 30339 },
    { name: 'Iota Mainnet', slug: 'iota', chainId: 8822, eid: 30284 },
    { name: 'Japan Open Chain Mainnet', slug: 'japanopenchain', chainId: 81, eid: 30285 },
    { name: 'Kaia Mainnet (formerly Klaytn)', slug: 'kaia', chainId: 8217, eid: 30150 },
    { name: 'Katana', slug: 'katana', chainId: 747474, eid: 30375 },
    { name: 'Kava Mainnet', slug: 'kava', chainId: 2222, eid: 30177 },
    { name: 'Lens Mainnet', slug: 'lens', chainId: 232, eid: 30373 },
    { name: 'Lightlink Mainnet', slug: 'lightlink', chainId: 1890, eid: 30309 },
    { name: 'Linea Mainnet', slug: 'linea', chainId: 59144, eid: 30183 },
    { name: 'Lisk Mainnet', slug: 'lisk', chainId: 1135, eid: 30321 },
    { name: 'Loot Mainnet', slug: 'loot', chainId: 5151706, eid: 30197 },
    { name: 'Lyra Mainnet', slug: 'lyra', chainId: 957, eid: 30311 },
    { name: 'Manta Pacific Mainnet', slug: 'mantapacific', chainId: 169, eid: 30217 },
    { name: 'Mantle Mainnet', slug: 'mantle', chainId: 5000, eid: 30181 },
    { name: 'Merlin Mainnet', slug: 'merlin', chainId: 4200, eid: 30266 },
    { name: 'Meter Mainnet', slug: 'meter', chainId: 82, eid: 30176 },
    { name: 'Metis Mainnet', slug: 'metis', chainId: 1088, eid: 30151 },
    { name: 'Mode Mainnet', slug: 'mode', chainId: 34443, eid: 30260 },
    { name: 'Moonbeam Mainnet', slug: 'moonbeam', chainId: 1284, eid: 30126 },
    { name: 'Moonriver Mainnet', slug: 'moonriver', chainId: 1285, eid: 30167 },
    { name: 'Morph Mainnet', slug: 'morph', chainId: 2818, eid: 30322 },
    { name: 'Movement Mainnet', slug: 'movement', chainId: null, eid: 30325 },
    { name: 'Near Aurora Mainnet', slug: 'aurora', chainId: 1313161554, eid: 30211 },
    { name: 'Nibiru Mainnet', slug: 'nibiru', chainId: 6900, eid: 30369 },
    { name: 'OKX Mainnet', slug: 'okx', chainId: 66, eid: 30155 },
    { name: 'Optimism Mainnet', slug: 'optimism', chainId: 10, eid: 30111 },
    { name: 'Orderly Mainnet', slug: 'orderly', chainId: 291, eid: 30213 },
    { name: 'Otherworld Space Mainnet', slug: 'otherworldspace', chainId: 8227, eid: 30341 },
    { name: 'Peaq Mainnet', slug: 'peaq', chainId: 3338, eid: 30302 },
    { name: 'Plume Mainnet', slug: 'plume', chainId: 98866, eid: 30370 },
    { name: 'Polygon Mainnet', slug: 'polygon', chainId: 137, eid: 30109 },
    { name: 'Polygon zkEVM Mainnet', slug: 'polygonzkevm', chainId: 1101, eid: 30158 },
    { name: 'Rari Chain Mainnet', slug: 'rari', chainId: 1380012617, eid: 30235 },
    { name: 'Reya Mainnet', slug: 'reya', chainId: 1729, eid: 30313 },
    { name: 'Rootstock Mainnet', slug: 'rootstock', chainId: 30, eid: 30333 },
    { name: 'Sanko Mainnet', slug: 'sanko', chainId: 1996, eid: 30278 },
    { name: 'Scroll Mainnet', slug: 'scroll', chainId: 534352, eid: 30214 },
    { name: 'Sei Mainnet', slug: 'sei', chainId: 1329, eid: 30280 },
    { name: 'Shimmer Mainnet', slug: 'shimmer', chainId: 148, eid: 30230 },
    { name: 'Skale Mainnet', slug: 'skale', chainId: 2046399126, eid: 30273 },
    { name: 'Solana Mainnet', slug: 'solana', chainId: 101, eid: 30168 },
    { name: 'Soneium Mainnet', slug: 'soneium', chainId: 1868, eid: 30340 },
    { name: 'Sonic Mainnet', slug: 'sonic', chainId: 146, eid: 30332 },
    { name: 'Sophon Mainnet', slug: 'sophon', chainId: 50104, eid: 30334 },
    { name: 'Story Mainnet', slug: 'story', chainId: 1514, eid: 30364 },
    { name: 'Subtensor EVM Mainnet', slug: 'subtensor', chainId: 964, eid: 30374 },
    { name: 'Superposition Mainnet', slug: 'superposition', chainId: 55244, eid: 30327 },
    { name: 'Swell Mainnet', slug: 'swell', chainId: 1923, eid: 30335 },
    { name: 'TON Mainnet', slug: 'ton', chainId: null, eid: 30343 },
    { name: 'Tac', slug: 'tac', chainId: 239, eid: 30377 },
    { name: 'Taiko Mainnet', slug: 'taiko', chainId: 167000, eid: 30290 },
    { name: 'TelosEVM Mainnet', slug: 'telos', chainId: 40, eid: 30199 },
    { name: 'Tenet Mainnet', slug: 'tenet', chainId: 1559, eid: 30173 },
    { name: 'Tiltyard Mainnet', slug: 'tiltyard', chainId: 710420, eid: 30238 },
    { name: 'Tron Mainnet', slug: 'tron', chainId: 728126428, eid: 30420 },
    { name: 'Unichain Mainnet', slug: 'unichain', chainId: 130, eid: 30320 },
    { name: 'Vana Mainnet', slug: 'vana', chainId: 1480, eid: 30330 },
    { name: 'Viction Mainnet', slug: 'viction', chainId: 88, eid: 30196 },
    { name: 'Worldchain Mainnet', slug: 'worldchain', chainId: 480, eid: 30319 },
    { name: 'X Layer Mainnet', slug: 'xlayer', chainId: 196, eid: 30274 },
    { name: 'XChain Mainnet', slug: 'xchain', chainId: 94524, eid: 30291 },
    { name: 'XDC Mainnet', slug: 'xdc', chainId: 50, eid: 30365 },
    { name: 'XPLA Mainnet', slug: 'xpla', chainId: 37, eid: 30216 },
    { name: 'Xai Mainnet', slug: 'xai', chainId: 660279, eid: 30236 },
    { name: 'Zircuit Mainnet', slug: 'zircuit', chainId: 48900, eid: 30303 },
    { name: 'Zora Mainnet', slug: 'zora', chainId: 7777777, eid: 30195 },
    { name: 'inEVM Mainnet', slug: 'inevm', chainId: 2525, eid: 30234 },
    { name: 'opBNB Mainnet', slug: 'opbnb', chainId: 204, eid: 30202 },
    { name: 're.al Mainnet', slug: 'real', chainId: 111188, eid: 30237 },
    { name: 'zkLink Mainnet', slug: 'zklink', chainId: 810180, eid: 30301 },
    { name: 'zkSync Era Mainnet', slug: 'zksync', chainId: 324, eid: 30165 },
];


// Mapping functions

/**
 * Maps a LayerZero Endpoint ID (EID) to a ChainInfo object.
 * @param eid The Endpoint ID (e.g., 30101)
 * @returns The ChainInfo object, or undefined if not found.
 */
export function mapEidToChainInfo(eid: number): ChainInfo | undefined {
    return LAYERZERO_CHAINS_V2.find(chain => chain.eid === eid);
}

/**
 * Maps an EIP-155 Chain ID to a ChainInfo object.
 * @param chainId The EIP-155 Chain ID (e.g., 1 for Ethereum Mainnet)
 * @returns The ChainInfo object, or undefined if not found.
 */
export function mapChainIdToChainInfo(chainId: number): ChainInfo | undefined {
    return LAYERZERO_CHAINS_V2.find(chain => chain.chainId === chainId);
}

/**
 * Maps a chain slug to a ChainInfo object.
 * @param slug The chain slug (e.g., "ethereum", "bsc")
 * @returns The ChainInfo object, or undefined if not found.
 */
export function mapSlugToChainInfo(slug: string): ChainInfo | undefined {
    return LAYERZERO_CHAINS_V2.find(chain => chain.slug === slug.toLowerCase());
}

// Combined mapping function
type ChainIdentifier = {
    type: 'eid',
    value: number
} | {
    type: 'chainId',
    value: number
} | {
    type: 'slug',
    value: string
};

/**
 * A combined mapping function to look up a chain by EID, Chain ID, or slug.
 * @param identifier An object specifying the type and value of the identifier.
 * @returns The ChainInfo object, or undefined if not found.
 */
export function getChainInfoByIdentifier(identifier: ChainIdentifier): ChainInfo | undefined {
    switch (identifier.type) {
        case 'eid':
            return mapEidToChainInfo(identifier.value);
        case 'chainId':
            return mapChainIdToChainInfo(identifier.value);
        case 'slug':
            return mapSlugToChainInfo(identifier.value);
        default:
            // This should not happen if identifier is strictly typed
            return undefined;
    }
}