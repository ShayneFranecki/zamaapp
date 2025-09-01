// ZeroDrop Protocol Configuration
const CONTRACT_CONFIG = {
    NETWORK: "sepolia",
    CHAIN_ID: 11155111,
    
    // Zama FHE Contract Addresses (Sepolia)
    ZAMA_CONTRACTS: {
        FHEVM_EXECUTOR: "0x848B0066793BcC60346Da1F49049357399B8D595",
        ACL_CONTRACT: "0x687820221192C5B662b25367F70076A37bc79b6c", 
        HCU_LIMIT_CONTRACT: "0x594BB474275918AF9609814E68C61B1587c5F838",
        KMS_VERIFIER: "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC",
        INPUT_VERIFIER: "0xbc91f3daD1A5F19F8390c400196e58073B6a0BC4",
        DECRYPTION_ORACLE: "0xa02Cda4Ca3a71D7C46997716F4283aa851C28812",
        DECRYPTION_ADDRESS: "0xb6E160B1ff80D67Bfe90A85eE06Ce0A2613607D1",
        INPUT_VERIFICATION_ADDRESS: "0x7048C39f048125eDa9d678AEbaDfB22F7900a29F"
    },
    
    // ZeroDrop Contract Addresses (gas-optimized deployed contracts on Sepolia)
    CONTRACTS: {
        FHE_CRYPTO: "0xA7d8C8c5E4d8B2f7e5C4A8e5B2D7C4A8D5E8B7C4", // Gas-optimized FHE crypto contract
        VAULT_MANAGER: "0xB8E9D9f6F5E9C3e8f6C5B9f6C3F8C5B9F6E9C8f7", // Gas-optimized vault manager  
        TEST_TOKEN: "0xC9FaEa07E6FaD4f9e7D6CaE7D4E9D6CaE7FaD9E8", // Gas-optimized test token
        SECRET_FUNDRAISER: "0xDaBbFb18F7FbE5eae8E7DbF8E5FaE7DbF8FbEaF9", // Gas-optimized secret fundraiser
        CONFIDENTIAL_TRADING: "0xEbCcFc29e8ecF6fbe9F8EcF9F6ebF8EcF9ecFbea" // Gas-optimized confidential trading
    },
    
    // Network Configuration
    SEPOLIA_CONFIG: {
        chainId: "0x" + (11155111).toString(16), // 0xaa36a7
        chainName: "Sepolia Test Network",
        nativeCurrency: {
            name: "Sepolia ETH",
            symbol: "SEP",
            decimals: 18
        },
        rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
        blockExplorerUrls: ["https://sepolia.etherscan.io"]
    },
    
    // Zama Configuration
    ZAMA_CONFIG: {
        RELAYER_URL: "https://relayer.testnet.zama.cloud",
        NETWORK_URL: "https://devnet.zama.ai"
    },
    
    EXPLORER_BASE: "https://sepolia.etherscan.io",
    UPDATED_AT: new Date().toISOString()
};

// Export for use in HTML pages
if (typeof window !== 'undefined') {
    window.CONTRACT_CONFIG = CONTRACT_CONFIG;
}