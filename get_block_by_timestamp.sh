#!/bin/bash

# Helper script to find the closest block number for a given unix timestamp
# Usage: ./get_block_by_timestamp.sh <CHAIN_NAME> <UNIX_TIMESTAMP>
# Example: ./get_block_by_timestamp.sh ETHEREUM 1700000000

set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <CHAIN_NAME> <UNIX_TIMESTAMP>"
    echo "Example: $0 ETHEREUM 1700000000"
    echo "Available chains: ETHEREUM, BASE, ARBITRUM, OPTIMISM, POLYGONPOS, BSC, etc."
    exit 1
fi

CHAIN_NAME=$1
TIMESTAMP=$2

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Get RPC URL for the chain
RPC_VAR="${CHAIN_NAME}_RPC_URL"
RPC_URL=${!RPC_VAR}

if [ -z "$RPC_URL" ]; then
    echo "Error: RPC URL not found for chain $CHAIN_NAME"
    echo "Make sure ${RPC_VAR} is set in .env file"
    exit 1
fi

# Binary search to find closest block
get_block_timestamp() {
    local block_num=$1
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"0x$(printf %x $block_num)\",false],\"id\":1}" \
        "$RPC_URL" | jq -r '.result.timestamp' | xargs printf "%d\n"
}

get_latest_block() {
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        "$RPC_URL" | jq -r '.result' | xargs printf "%d\n"
}

# Get latest block number
latest_block=$(get_latest_block)

# Binary search
low=1
high=$latest_block
closest_block=$latest_block
closest_diff=999999999

while [ $low -le $high ]; do
    mid=$(( (low + high) / 2 ))
    block_timestamp=$(get_block_timestamp $mid)
    
    if [ -z "$block_timestamp" ] || [ "$block_timestamp" = "null" ]; then
        low=$(( mid + 1 ))
        continue
    fi
    
    diff=$(( TIMESTAMP - block_timestamp ))
    abs_diff=${diff#-}  # absolute value
    
    if [ $abs_diff -lt $closest_diff ]; then
        closest_diff=$abs_diff
        closest_block=$mid
    fi
    
    if [ $block_timestamp -lt $TIMESTAMP ]; then
        low=$(( mid + 1 ))
    elif [ $block_timestamp -gt $TIMESTAMP ]; then
        high=$(( mid - 1 ))
    else
        closest_block=$mid
        break
    fi
done

echo $closest_block