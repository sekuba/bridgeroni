# CCTP Bridge Monitor TUI 🌱

A comprehensive terminal interface for monitoring CCTP (Cross-Chain Transfer Protocol) bridge transactions across all supported EVM chains. This tool provides real-time insights into both CCTP v1 and v2 bridge activity with advanced analytics and search capabilities.

## Features

### Core Functionality
- **Real-time monitoring** of bridge events with 1-second refresh
- **Multi-chain support** for all CCTP-enabled chains including Linea and World Chain
- **Dual protocol support** for both CCTP v1 and v2 with separate metrics
- **Advanced matching logic** with deterministic nonce computation for v2
- **Multiple view modes**: Dashboard, List, and Search interfaces
- **Binned latency analysis** by transaction amount ranges
- **Live block tracking** for all monitored chains

### Interactive Interface
- **Dashboard mode**: Overview metrics, raw activity feed, and matched transfers
- **List mode**: Filtered transaction lists with chain-specific navigation
- **Search mode**: Transaction hash lookup functionality
- **Keyboard navigation**: vim-like controls with arrow key support
- **Real-time updates**: Green indicators for recently matched transfers

### Analytics & Metrics
- **Comprehensive metrics** separated by CCTP v1/v2 versions
- **24-hour rolling volume** tracking with per-chain breakdown
- **Latency binning** by transfer amounts (micro to whale categories)
- **Match rate analysis** for bridge completion monitoring
- **Block synchronization** status across all chains

## Supported Chains

### CCTP v1 + v2 Chains
- **Ethereum** (Domain 0, Chain ID 1)
- **OP Mainnet** (Domain 2, Chain ID 10)
- **Arbitrum** (Domain 3, Chain ID 42161)
- **Base** (Domain 6, Chain ID 8453)
- **Unichain** (Domain 10, Chain ID 130)

### CCTP v2 Only Chains
- **Linea** (Domain 11, Chain ID 59144)
- **World Chain** (Domain 14, Chain ID 480)

## Usage

### Starting the TUI
```bash
# install dependencies
pnpm install

# Make sure the indexer is running first
pnpm dev

# Start the TUI (requires Node.js 18+)
pnpm tui

```

### Navigation Controls
- **Dashboard mode**: 
  - `[l]` - Switch to list view
  - `[s]` - Switch to search mode
  - `Ctrl+C` - Exit
- **List mode**:
  - `[f]` - Filter by "from" chain
  - `[t]` - Filter by "to" chain
  - `[1-7]` - Select specific chains
  - `[j/k]` or `↑/↓` - Navigate items
  - `[q/ESC]` - Return to dashboard
- **Search mode**:
  - Type transaction hash to search
  - `[Enter]` - Execute search
  - `[Backspace]` - Edit query
  - `[q/ESC]` - Return to dashboard

## Requirements

- **Node.js 18+** (for built-in fetch support)
- **Running Envio indexer** with GraphQL API at `http://localhost:8080/v1/graphql`
- **Docker** (for running the indexer backend)

## Architecture

### Backend Infrastructure
- **Envio Hyperindex**: High-performance blockchain indexer
- **GraphQL API**: Real-time data access with efficient querying
- **PostgreSQL**: Event storage and historical data
- **Multi-chain synchronization**: Parallel indexing across all chains

### CCTP Protocol Understanding

#### CCTP v1 (Legacy)
- **Nonce-based matching**: Direct nonce correlation between deposit and receive events
- **Simple event structure**: Standard TokenMessenger/MessageTransmitter contracts
- **Supported chains**: Ethereum, OP, Arbitrum, Base, Unichain

#### CCTP v2 (Current)
- **Message body decoding**: Complex messageBody parsing for transfer details
- **Deterministic nonce computation**: SHA-256 hash of message components
- **Enhanced features**: Finality thresholds, hook data, dynamic fees
- **Broader adoption**: All chains support v2, some are v2-only

### Data Flow Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Blockchain    │───▶│  Envio Indexer   │───▶│   GraphQL API   │
│     Events      │    │   (HyperSync)    │    │   (Hasura)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   TUI Display   │◀───│  Event Matching  │◀───│ Data Processing │
│   (Terminal)    │    │    & Analysis    │    │   & Metrics     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Core Components

#### 1. Event Handlers (`src/EventHandlers.ts`)
- **TokenMessenger v1/v2**: Processes deposit events
- **MessageTransmitter v1/v2**: Processes message receipt events
- **Matching logic**: Links deposits to receipts via nonce correlation
- **Data enrichment**: Adds metadata for TUI display

#### 2. Message Decoder (`src/utils/messageDecoder.ts`)
- **v2 message parsing**: Decodes complex messageBody structures
- **Deterministic nonce computation**: Ensures consistent v2 matching
- **Field extraction**: Parses amounts, recipients, fees, and hook data

#### 3. GraphQL Interface (`src/utils/graphql.ts`)
- **Parallel queries**: Fetches all data sources simultaneously
- **Real-time data**: Recent events, matched transfers, metrics
- **Efficient filtering**: Optimized queries for TUI performance

#### 4. TUI Engine (`tui.ts`)
- **CCTPMonitor class**: Main application controller
- **Render system**: ANSI-based terminal drawing
- **Input handling**: Keyboard navigation and mode switching
- **State management**: UI state and data synchronization

#### 5. Formatters (`src/utils/formatters.ts`)
- **Amount formatting**: USDC decimal handling and display
- **Time formatting**: Human-readable duration and timestamps
- **Address formatting**: Truncated address display
- **Chain coloring**: Visual chain identification

#### 6. Constants (`src/constants.ts`)
- **Domain mappings**: Chain ID to CCTP domain correlations
- **Network configuration**: Explorer URLs and chain metadata
- **Protocol constants**: USDC decimals, message lengths, etc.

### Matching Algorithm

#### v1 Matching (Nonce-based)
```typescript
// Direct nonce correlation
const transferId = createTransferId(sourceDomain, nonce);
const existingTransfer = await context.CCTPTransfer.get(transferId);
```

#### v2 Matching (Deterministic)
```typescript
// Compute deterministic nonce from message components
const deterministicNonce = computeV2DeterministicNonce(
  sourceDomain,
  destinationDomain,
  burnToken,
  mintRecipient,
  amount,
  messageSender,
  maxFee,
  hookData
);
const transferId = createTransferId(sourceDomain, deterministicNonce);
```

### Performance Optimizations

- **1-second refresh**: Real-time updates without overwhelming the system
- **Parallel queries**: All GraphQL requests executed simultaneously
- **Efficient rendering**: Minimal terminal redraws with ANSI positioning
- **Memory management**: Bounded event arrays and automatic cleanup
- **Indexed queries**: Optimized database queries with proper indexing

## Customization

### Visual Themes
```typescript
// Modify colors in src/constants.ts
export const COLORS = {
  ethereum: '\x1b[95m',  // Purple
  base: '\x1b[34m',      // Blue
  arbitrum: '\x1b[36m',  // Cyan
  // Add custom chain colors
};
```

### Refresh Intervals
```typescript
// Adjust in src/constants.ts
export const TUI_CONFIG = {
  REFRESH_INTERVAL: 1000,  // 1 second
  MAX_RAW_EVENTS: 12,      // Events in feed
  MAX_MATCHED_TRANSFERS: 6, // Matched transfers shown
};
```

### Amount Binning
```typescript
// Customize latency analysis bins
export const TRANSFER_AMOUNT_BINS = {
  micro: { min: 0, max: 10, label: '0-10' },
  small: { min: 10, max: 100, label: '>10-100' },
  // Add custom bins
};
```

## Development

### Adding New Chains
1. **Update constants**: Add chain ID and domain mappings
2. **Configure indexer**: Add network configuration to `config.yaml`
3. **Deploy contracts**: Ensure CCTP contracts are deployed
4. **Update formatters**: Add chain-specific colors and explorers

### Extending Analytics
- **Custom metrics**: Add new calculations to `calculateMetrics()`
- **Additional queries**: Extend GraphQL queries for new data
- **Enhanced visualizations**: Create new render methods for data

### Testing
```bash
# Run the indexer
pnpm dev

# Test TUI in development
node tui.ts
```

## Technical Details

### Message Body Structure (v2)
```
┌─────────────────┬──────────────────┐
│     Field       │      Size        │
├─────────────────┼──────────────────┤
│ Version         │ 4 bytes          │
│ Burn Token      │ 32 bytes         │
│ Mint Recipient  │ 32 bytes         │
│ Amount          │ 32 bytes         │
│ Message Sender  │ 32 bytes         │
│ Max Fee         │ 32 bytes         │
│ Fee Executed    │ 32 bytes         │
│ Expiration Block│ 32 bytes         │
│ Hook Data       │ Dynamic          │
└─────────────────┴──────────────────┘
```

### Database Schema
- **CCTPTransfer**: Matched transfer records with latency metrics
- **TokenMessenger_DepositForBurn**: Raw v1 deposit events
- **TokenMessenger_DepositForBurnV2**: Raw v2 deposit events
- **MessageTransmitter_MessageReceived**: Raw v1 receipt events
- **MessageTransmitter_MessageReceivedV2**: Raw v2 receipt events

### Error Handling
- **Graceful degradation**: Continues operation with partial data
- **Retry logic**: Built-in error recovery for network issues
- **Data validation**: Comprehensive input validation and sanitization

## Troubleshooting

### Common Issues
1. **No data displayed**: Ensure indexer is running and synced
2. **Slow performance**: Check database connection and query efficiency
3. **Missing events**: Verify contract addresses and start blocks
4. **Matching failures**: Check nonce computation and message decoding

### Debug Mode
```bash
# Enable debug logging
DEBUG=cctp:* node tui.ts
```

## Future Enhancements

### Planned Features
- **Historical analysis**: Time-series charts and trend analysis
- **Alert system**: Notifications for failed transfers or anomalies
- **Export functionality**: CSV/JSON export of transfer data
- **Multi-indexer support**: Federation across multiple indexer instances
- **RPC fallback**: Direct RPC queries when indexer is unavailable

### Protocol Extensions
- **Additional bridges**: Support for other cross-chain protocols
- **Unified metrics**: Cross-protocol bridge comparison
- **Advanced analytics**: MEV analysis, arbitrage detection
- **Custom hooks**: Plugin system for additional processing

## Philosophy

This tool embodies **solarpunk** principles:
- **Decentralized**: Monitors decentralized bridge infrastructure
- **Sustainable**: Minimal resource usage, efficient algorithms
- **Accessible**: Terminal-based, works on any system
- **Hackable**: Open source, modular, extensively documented
- **Aesthetic**: Clean interface celebrating technological harmony

(lmao @this)

The CCTP Bridge Monitor represents the intersection of robust engineering and sustainable design, providing essential infrastructure monitoring while maintaining environmental and social responsibility.

Keep scaling Ethereum! 🌱