const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Deploying Complete ZeroDrop Protocol...\n");

    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    
    console.log("📋 Deployment Details:");
    console.log("=======================");
    console.log("Deployer:", deployer.address);
    console.log("Network:", network.name);
    console.log("Chain ID:", network.chainId);
    
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH\n");

    // Deployment configuration
    const config = {
        feeCollector: process.env.FEE_COLLECTOR || deployer.address,
        initialTokenSupply: ethers.parseEther("1000000"), // 1M tokens
        serviceFeeRate: 200, // 2%
        tradingFeeRate: 30, // 0.3%
    };

    console.log("⚙️  Configuration:");
    console.log("===================");
    console.log("Fee Collector:", config.feeCollector);
    console.log("Initial Token Supply:", ethers.formatEther(config.initialTokenSupply));
    console.log("Service Fee Rate:", config.serviceFeeRate / 100, "%");
    console.log("Trading Fee Rate:", config.tradingFeeRate / 100, "%\n");

    const deployedContracts = {};
    const startTime = Date.now();

    try {
        // 1. Deploy FHECrypto utility contract
        console.log("🔐 [1/5] Deploying FHECrypto utility contract...");
        const FHECrypto = await ethers.getContractFactory("FHECrypto");
        const fheCrypto = await FHECrypto.deploy();
        await fheCrypto.waitForDeployment();
        deployedContracts.fheCrypto = await fheCrypto.getAddress();
        console.log("✅ FHECrypto deployed:", deployedContracts.fheCrypto);

        // 2. Deploy VaultManager
        console.log("\n🏦 [2/5] Deploying VaultManager...");
        const VaultManager = await ethers.getContractFactory("VaultManager");
        const vaultManager = await VaultManager.deploy();
        await vaultManager.waitForDeployment();
        deployedContracts.vaultManager = await vaultManager.getAddress();
        console.log("✅ VaultManager deployed:", deployedContracts.vaultManager);

        // 3. Deploy TestToken
        console.log("\n🪙 [3/5] Deploying TestToken...");
        const TestToken = await ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(
            "ZeroDrop Test Token",
            "ZTEST",
            18,
            config.initialTokenSupply
        );
        await testToken.waitForDeployment();
        deployedContracts.testToken = await testToken.getAddress();
        console.log("✅ TestToken deployed:", deployedContracts.testToken);

        // 4. Deploy SecretFundraiser
        console.log("\n🕵️  [4/5] Deploying SecretFundraiser main contract...");
        const SecretFundraiser = await ethers.getContractFactory("SecretFundraiser");
        const secretFundraiser = await SecretFundraiser.deploy(
            config.feeCollector,
            deployedContracts.vaultManager,
            deployedContracts.fheCrypto
        );
        await secretFundraiser.waitForDeployment();
        deployedContracts.secretFundraiser = await secretFundraiser.getAddress();
        console.log("✅ SecretFundraiser deployed:", deployedContracts.secretFundraiser);

        // 5. Deploy ConfidentialTrading
        console.log("\n💱 [5/5] Deploying ConfidentialTrading DEX...");
        const ConfidentialTrading = await ethers.getContractFactory("ConfidentialTrading");
        const confidentialTrading = await ConfidentialTrading.deploy(
            config.feeCollector,
            deployedContracts.fheCrypto
        );
        await confidentialTrading.waitForDeployment();
        deployedContracts.confidentialTrading = await confidentialTrading.getAddress();
        console.log("✅ ConfidentialTrading deployed:", deployedContracts.confidentialTrading);

        // Post-deployment configuration
        console.log("\n🔧 Configuring contract permissions and settings...");
        
        console.log("📝 Setting up VaultManager authorizations...");
        await vaultManager.addAuthorizedContract(deployedContracts.secretFundraiser);
        
        console.log("📝 Setting up FHECrypto operators...");
        await fheCrypto.authorizeOperator(deployedContracts.secretFundraiser);
        await fheCrypto.authorizeOperator(deployedContracts.confidentialTrading);
        
        console.log("📝 Configuring ConfidentialTrading supported tokens...");
        await confidentialTrading.addSupportedToken(deployedContracts.testToken, 18);
        
        console.log("📝 Adding SecretFundraiser as TestToken minter...");
        await testToken.addMinter(deployedContracts.secretFundraiser);

        // Additional test setup for demo
        console.log("\n🎭 Setting up demo data...");
        
        // Mint some test tokens for demo
        console.log("💰 Minting demo tokens...");
        await testToken.mint(deployer.address, ethers.parseEther("10000"));
        
        // Set up platform fees
        console.log("💸 Configuring platform fees...");
        if (config.serviceFeeRate !== 200) {
            await secretFundraiser.updateServiceFeeRate(config.serviceFeeRate);
        }
        if (config.tradingFeeRate !== 30) {
            await confidentialTrading.updateTradingFeeRate(config.tradingFeeRate);
        }

        const endTime = Date.now();
        const deploymentTime = (endTime - startTime) / 1000;

        // Deployment Success Summary
        console.log("\n🎉 DEPLOYMENT COMPLETED SUCCESSFULLY! 🎉");
        console.log("==========================================");
        console.log(`⏱️  Total deployment time: ${deploymentTime.toFixed(2)} seconds`);
        console.log("🌐 Network:", network.name, `(Chain ID: ${network.chainId})`);
        console.log("👤 Deployer:", deployer.address);
        console.log("💰 Gas used: ~", (await ethers.provider.getBalance(deployer.address) - balance).toString(), "wei");

        console.log("\n📋 DEPLOYED CONTRACTS:");
        console.log("=======================");
        Object.entries(deployedContracts).forEach(([name, address]) => {
            console.log(`${name.padEnd(20)} ${address}`);
        });

        // Network-specific explorer links
        let explorerBase;
        switch (network.chainId) {
            case 1n: explorerBase = "https://etherscan.io"; break;
            case 11155111n: explorerBase = "https://sepolia.etherscan.io"; break;
            case 31337n: explorerBase = null; break;
            default: explorerBase = null;
        }

        if (explorerBase) {
            console.log("\n🔍 ETHERSCAN LINKS:");
            console.log("====================");
            Object.entries(deployedContracts).forEach(([name, address]) => {
                console.log(`${name.padEnd(20)} ${explorerBase}/address/${address}`);
            });
        }

        // Frontend configuration
        console.log("\n🌐 FRONTEND ACCESS:");
        console.log("===================");
        console.log("Main Application:    http://localhost:3012/");
        console.log("Secret Fundraiser:   http://localhost:3012/fundraiser.html");
        console.log("Confidential Trading: http://localhost:3012/trading.html");

        // Save comprehensive deployment information
        const deploymentInfo = {
            network: {
                name: network.name,
                chainId: Number(network.chainId),
                explorerBase: explorerBase
            },
            deployment: {
                deployer: deployer.address,
                timestamp: new Date().toISOString(),
                deploymentTime: deploymentTime,
                gasUsed: (balance - await ethers.provider.getBalance(deployer.address)).toString()
            },
            configuration: config,
            contracts: deployedContracts,
            links: explorerBase ? Object.fromEntries(
                Object.entries(deployedContracts).map(([name, address]) => [
                    name, `${explorerBase}/address/${address}`
                ])
            ) : {},
            frontend: {
                baseUrl: "http://localhost:3012",
                pages: {
                    main: "http://localhost:3012/",
                    fundraiser: "http://localhost:3012/fundraiser.html",
                    trading: "http://localhost:3012/trading.html"
                }
            }
        };

        // Save deployment information
        const fs = require('fs');
        const path = require('path');
        
        const deploymentDir = path.join(__dirname, '../deployments');
        if (!fs.existsSync(deploymentDir)) {
            fs.mkdirSync(deploymentDir, { recursive: true });
        }
        
        const filename = network.name === 'unknown' ? 'localhost' : network.name;
        const filePath = path.join(deploymentDir, `${filename}.json`);
        
        fs.writeFileSync(filePath, JSON.stringify(deploymentInfo, null, 2));
        console.log(`\n💾 Deployment info saved to: deployments/${filename}.json`);

        // Update frontend config
        const frontendConfig = `// Auto-generated contract configuration
const CONTRACT_CONFIG = {
    NETWORK: "${network.name}",
    CHAIN_ID: ${network.chainId},
    CONTRACTS: {
        FHE_CRYPTO: "${deployedContracts.fheCrypto}",
        VAULT_MANAGER: "${deployedContracts.vaultManager}",
        TEST_TOKEN: "${deployedContracts.testToken}",
        SECRET_FUNDRAISER: "${deployedContracts.secretFundraiser}",
        CONFIDENTIAL_TRADING: "${deployedContracts.confidentialTrading}"
    },
    EXPLORER_BASE: "${explorerBase || ''}",
    UPDATED_AT: "${new Date().toISOString()}"
};

// Export for use in HTML pages
if (typeof window !== 'undefined') {
    window.CONTRACT_CONFIG = CONTRACT_CONFIG;
}
`;

        const frontendDir = path.join(__dirname, '../frontend/public');
        if (!fs.existsSync(frontendDir)) {
            fs.mkdirSync(frontendDir, { recursive: true });
        }
        
        fs.writeFileSync(
            path.join(frontendDir, 'config.js'),
            frontendConfig
        );
        console.log("🌐 Frontend config updated: frontend/public/config.js");

        console.log("\n🚀 NEXT STEPS:");
        console.log("===============");
        console.log("1. Verify contracts: npm run verify");
        console.log("2. Start frontend server: npm run frontend");
        console.log("3. Visit: http://localhost:3012");
        console.log("4. Connect MetaMask to Sepolia testnet");
        console.log("5. Add TestToken to wallet:", deployedContracts.testToken);
        
        if (network.chainId === 11155111n) {
            console.log("6. Get Sepolia ETH: https://sepoliafaucet.com/");
        }

        console.log("\n🎯 TESTING CHECKLIST:");
        console.log("======================");
        console.log("□ Connect wallet to application");
        console.log("□ Create a secret fundraising campaign");
        console.log("□ Make anonymous contributions");
        console.log("□ Test confidential trading orders");
        console.log("□ Verify encrypted data is hidden");
        console.log("□ Test token claiming after campaign success");

    } catch (error) {
        console.error("\n❌ DEPLOYMENT FAILED:");
        console.error("====================");
        console.error("Error:", error.message);
        console.error("\nStack trace:", error.stack);
        
        // Cleanup partially deployed contracts if needed
        console.log("\n🧹 Cleanup may be required for partially deployed contracts");
        
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n✨ ZeroDrop Protocol deployment completed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Deployment script error:", error);
        process.exit(1);
    });