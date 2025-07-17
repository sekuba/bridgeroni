#!/usr/bin/env python3

import json
import sys

def main():
    # Read the JSON file
    with open('/home/sekuba/w/bridgeroni/lz.json', 'r') as f:
        data = json.load(f)
    
    evm_mainnet_chains = []
    
    for chain_name, chain_data in data.items():
        # Check if it's an EVM chain
        chain_details = chain_data.get('chainDetails', {})
        if chain_details.get('chainType') != 'evm':
            continue
            
        # Check if it's NOT a testnet
        # Skip if chain name contains "testnet" or "stage" is not "mainnet"
        if 'testnet' in chain_name.lower():
            continue
            
        # Check deployments for stage
        deployments = chain_data.get('deployments', [])
        if not deployments:
            # If no deployments, check if it's a mainnet chain based on name
            if 'mainnet' not in chain_name.lower():
                continue
        else:
            # Check if any deployment has stage="mainnet"
            has_mainnet_deployment = any(dep.get('stage') == 'mainnet' for dep in deployments)
            if not has_mainnet_deployment:
                continue
        
        # Extract required data
        chain_info = {
            'chainname': chain_name,
            'nativeChainId': chain_details.get('nativeChainId'),
            'eid': None,
            'endpointV2': None,
            'endpoint': None
        }
        
        # Extract EID and endpoint addresses from deployments
        for deployment in deployments:
            if deployment.get('stage') == 'mainnet':
                # Get EID
                if 'eid' in deployment:
                    chain_info['eid'] = deployment['eid']
                
                # Get EndPointV2 address (version=2)
                if deployment.get('version') == 2:
                    endpoint_v2 = deployment.get('endpointV2', {})
                    if isinstance(endpoint_v2, dict) and 'address' in endpoint_v2:
                        chain_info['endpointV2'] = endpoint_v2['address']
                
                # Get endpoint (v1) address (version=1)
                if deployment.get('version') == 1:
                    endpoint_v1 = deployment.get('endpoint', {})
                    if isinstance(endpoint_v1, dict) and 'address' in endpoint_v1:
                        chain_info['endpoint'] = endpoint_v1['address']
        
        # If we found mainnet deployments, add to results
        if chain_info['eid'] is not None:
            evm_mainnet_chains.append(chain_info)
    
    # Write results to JSON file
    with open('/home/sekuba/w/bridgeroni/evm_mainnet_chains.json', 'w') as f:
        json.dump(evm_mainnet_chains, f, indent=2)
    
    print(f"Extracted {len(evm_mainnet_chains)} EVM mainnet chains")
    print("Results written to evm_mainnet_chains.json")

if __name__ == '__main__':
    main()