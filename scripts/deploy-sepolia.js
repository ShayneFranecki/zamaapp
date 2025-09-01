const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🚀 Deploying ZeroDrop Protocol to Sepolia...\n");

    const [deployer] = await ethers.getSigners();
    console.log("📋 Deploying contracts with account:", deployer.address);
    
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("💰 Account balance:", ethers.formatEther(balance), "ETH\n");

    if (balance < ethers.parseEther("0.5")) {
        console.warn("⚠️  Warning: Account balance is low. Get more Sepolia ETH from faucet.");
    }

    // Deploy contracts in dependency order
    console.log("🔐 Deploying FHECrypto...");
    const FHECrypto = await ethers.getContractFactory("FHECrypto");
    const fheCrypto = await FHECrypto.deploy();
    await fheCrypto.waitForDeployment();
    const fheCryptoAddress = await fheCrypto.getAddress();
    console.log("✅ FHECrypto deployed to:", fheCryptoAddress);

    console.log("\n🏦 Deploying VaultManager...");
    const VaultManager = await ethers.getContractFactory("VaultManager");
    const vaultManager = await VaultManager.deploy();
    await vaultManager.waitForDeployment();
    const vaultManagerAddress = await vaultManager.getAddress();
    console.log("✅ VaultManager deployed to:", vaultManagerAddress);

    console.log("\n🪙 Deploying TestToken...");
    const TestToken = await ethers.getContractFactory("TestToken");
    const testToken = await TestToken.deploy(
        "ZeroDrop Test Token",
        "ZTEST",
        18,
        ethers.parseEther("1000000") // 1M tokens
    );
    await testToken.waitForDeployment();
    const testTokenAddress = await testToken.getAddress();
    console.log("✅ TestToken deployed to:", testTokenAddress);

    console.log("\n🕵️  Deploying SecretFundraiser...");
    const SecretFundraiser = await ethers.getContractFactory("SecretFundraiser");
    const secretFundraiser = await SecretFundraiser.deploy(
        deployer.address, // Fee collector
        vaultManagerAddress,
        fheCryptoAddress
    );
    await secretFundraiser.waitForDeployment();
    const secretFundraiserAddress = await secretFundraiser.getAddress();
    console.log("✅ SecretFundraiser deployed to:", secretFundraiserAddress);

    console.log("\n💱 Deploying ConfidentialTrading...");
    const ConfidentialTrading = await ethers.getContractFactory("ConfidentialTrading");
    const confidentialTrading = await ConfidentialTrading.deploy(
        deployer.address, // Fee collector
        fheCryptoAddress
    );
    await confidentialTrading.waitForDeployment();
    const confidentialTradingAddress = await confidentialTrading.getAddress();
    console.log("✅ ConfidentialTrading deployed to:", confidentialTradingAddress);

    // Post-deployment configuration
    console.log("\n⚙️  Configuring contracts...");

    console.log("🔗 Authorizing SecretFundraiser in VaultManager...");
    await vaultManager.addAuthorizedContract(secretFundraiserAddress);

    console.log("🔗 Authorizing operators in FHECrypto...");
    await fheCrypto.authorizeOperator(secretFundraiserAddress);
    await fheCrypto.authorizeOperator(confidentialTradingAddress);

    console.log("🔗 Adding TestToken to ConfidentialTrading...");
    await confidentialTrading.addSupportedToken(testTokenAddress, 18);

    console.log("🔗 Adding SecretFundraiser as TestToken minter...");
    await testToken.addMinter(secretFundraiserAddress);

    // Deployment summary
    console.log("\n🎉 Deployment completed successfully!");
    console.log("=====================================");
    console.log("📊 Contract Addresses:");
    console.log("=====================================");
    console.log(`FHECrypto:           ${fheCryptoAddress}`);
    console.log(`VaultManager:        ${vaultManagerAddress}`);
    console.log(`TestToken:           ${testTokenAddress}`);
    console.log(`SecretFundraiser:    ${secretFundraiserAddress}`);
    console.log(`ConfidentialTrading: ${confidentialTradingAddress}`);
    console.log("=====================================");

    // Create deployment links
    const explorerBase = "https://sepolia.etherscan.io";
    console.log("\n🔍 Etherscan Links:");
    console.log("====================");
    console.log(`FHECrypto:           ${explorerBase}/address/${fheCryptoAddress}`);
    console.log(`VaultManager:        ${explorerBase}/address/${vaultManagerAddress}`);
    console.log(`TestToken:           ${explorerBase}/address/${testTokenAddress}`);
    console.log(`SecretFundraiser:    ${explorerBase}/address/${secretFundraiserAddress}`);
    console.log(`ConfidentialTrading: ${explorerBase}/address/${confidentialTradingAddress}`);

    // Frontend configuration
    console.log("\n🌐 Frontend URLs:");
    console.log("==================");
    console.log("Main App:      http://localhost:3012/");
    console.log("Fundraiser:    http://localhost:3012/fundraiser.html");
    console.log("Trading:       http://localhost:3012/trading.html");

    // Save deployment info
    const deploymentInfo = {
        network: "sepolia",
        chainId: 11155111,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        contracts: {
            fheCrypto: fheCryptoAddress,
            vaultManager: vaultManagerAddress,
            testToken: testTokenAddress,
            secretFundraiser: secretFundraiserAddress,
            confidentialTrading: confidentialTradingAddress
        },
        explorerLinks: {
            fheCrypto: `${explorerBase}/address/${fheCryptoAddress}`,
            vaultManager: `${explorerBase}/address/${vaultManagerAddress}`,
            testToken: `${explorerBase}/address/${testTokenAddress}`,
            secretFundraiser: `${explorerBase}/address/${secretFundraiserAddress}`,
            confidentialTrading: `${explorerBase}/address/${confidentialTradingAddress}`
        }
    };

    // Write deployment info to file
    
    const deploymentDir = path.join(__dirname, '../deployments');
    if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
    }
    
    fs.writeFileSync(
        path.join(deploymentDir, 'sepolia.json'),
        JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("\n💾 Deployment info saved to deployments/sepolia.json");

    console.log("\n🎯 Next Steps:");
    console.log("===============");
    console.log("1. Verify contracts: npm run verify");
    console.log("2. Start frontend: npm run frontend");
    console.log("3. Test functionality on http://localhost:3012");
    console.log("4. Get Sepolia ETH from: https://sepoliafaucet.com/");
    console.log("5. Add TestToken to MetaMask:", testTokenAddress);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });