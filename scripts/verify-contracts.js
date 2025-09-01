const { ethers, run } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🔍 Starting contract verification process...\n");

    const network = await ethers.provider.getNetwork();
    const networkName = network.name === 'unknown' ? 'localhost' : network.name;
    
    console.log("📋 Network:", networkName);
    console.log("🆔 Chain ID:", network.chainId);

    // Load deployment info
    const deploymentPath = path.join(__dirname, '../deployments', `${networkName}.json`);
    
    if (!fs.existsSync(deploymentPath)) {
        console.error(`❌ Deployment file not found: ${deploymentPath}`);
        console.log("💡 Please run deployment first: npm run deploy:sepolia");
        process.exit(1);
    }

    const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const contracts = deploymentInfo.contracts;

    console.log("📦 Found deployed contracts:");
    console.log("============================");
    Object.entries(contracts).forEach(([name, address]) => {
        console.log(`${name.padEnd(20)} ${address}`);
    });

    // Skip verification for localhost
    if (network.chainId === 31337n) {
        console.log("\n⏭️  Skipping verification on localhost network");
        console.log("✅ Local contracts are ready for testing");
        return;
    }

    // Verify contracts on public networks
    console.log("\n🔍 Starting Etherscan verification...");
    
    const verificationTasks = [
        {
            name: "FHECrypto",
            address: contracts.fheCrypto,
            constructorArguments: []
        },
        {
            name: "VaultManager", 
            address: contracts.vaultManager,
            constructorArguments: []
        },
        {
            name: "TestToken",
            address: contracts.testToken,
            constructorArguments: [
                "ZeroDrop Test Token",
                "ZTEST", 
                18,
                ethers.parseEther("1000000").toString()
            ]
        },
        {
            name: "SecretFundraiser",
            address: contracts.secretFundraiser,
            constructorArguments: [
                deploymentInfo.deployment.deployer, // Fee collector
                contracts.vaultManager,
                contracts.fheCrypto
            ]
        },
        {
            name: "ConfidentialTrading",
            address: contracts.confidentialTrading,
            constructorArguments: [
                deploymentInfo.deployment.deployer, // Fee collector
                contracts.fheCrypto
            ]
        }
    ];

    const verificationResults = [];

    for (let i = 0; i < verificationTasks.length; i++) {
        const task = verificationTasks[i];
        console.log(`\n🔍 [${i + 1}/${verificationTasks.length}] Verifying ${task.name}...`);
        console.log(`📍 Address: ${task.address}`);

        try {
            await run("verify:verify", {
                address: task.address,
                constructorArguments: task.constructorArguments,
                contract: `contracts/${task.name}.sol:${task.name}`
            });
            
            console.log(`✅ ${task.name} verified successfully`);
            verificationResults.push({
                contract: task.name,
                address: task.address,
                status: "verified",
                error: null
            });

        } catch (error) {
            const errorMessage = error.message;
            
            if (errorMessage.includes("Already Verified")) {
                console.log(`✅ ${task.name} already verified`);
                verificationResults.push({
                    contract: task.name,
                    address: task.address,
                    status: "already_verified",
                    error: null
                });
            } else {
                console.error(`❌ Failed to verify ${task.name}:`, errorMessage);
                verificationResults.push({
                    contract: task.name,
                    address: task.address,
                    status: "failed",
                    error: errorMessage
                });
            }
        }

        // Add delay between verifications to avoid rate limiting
        if (i < verificationTasks.length - 1) {
            console.log("⏱️  Waiting 10 seconds before next verification...");
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    // Verification summary
    console.log("\n📊 VERIFICATION SUMMARY:");
    console.log("========================");
    
    const verified = verificationResults.filter(r => r.status === "verified").length;
    const alreadyVerified = verificationResults.filter(r => r.status === "already_verified").length;
    const failed = verificationResults.filter(r => r.status === "failed").length;

    console.log(`✅ Successfully verified: ${verified}`);
    console.log(`ℹ️  Already verified: ${alreadyVerified}`);
    console.log(`❌ Failed to verify: ${failed}`);

    verificationResults.forEach(result => {
        const status = {
            verified: "✅ VERIFIED",
            already_verified: "ℹ️  ALREADY VERIFIED", 
            failed: "❌ FAILED"
        }[result.status];
        
        console.log(`${result.contract.padEnd(20)} ${status}`);
        
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
    });

    // Update deployment info with verification results
    deploymentInfo.verification = {
        timestamp: new Date().toISOString(),
        results: verificationResults,
        summary: {
            verified,
            alreadyVerified,
            failed,
            total: verificationTasks.length
        }
    };

    // Save updated deployment info
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`\n💾 Verification results saved to: ${deploymentPath}`);

    // Display verified contract links
    if (deploymentInfo.network.explorerBase && (verified > 0 || alreadyVerified > 0)) {
        console.log("\n🔗 VERIFIED CONTRACT LINKS:");
        console.log("===========================");
        
        verificationResults
            .filter(r => r.status === "verified" || r.status === "already_verified")
            .forEach(result => {
                const link = `${deploymentInfo.network.explorerBase}/address/${result.address}#code`;
                console.log(`${result.contract.padEnd(20)} ${link}`);
            });
    }

    // Final instructions
    console.log("\n🎯 POST-VERIFICATION STEPS:");
    console.log("===========================");
    console.log("1. Visit the contract links above to view verified source code");
    console.log("2. Test contract interactions through Etherscan");
    console.log("3. Start the frontend: npm run frontend");
    console.log("4. Test the full application at http://localhost:3012");

    if (failed > 0) {
        console.log("\n⚠️  Some contracts failed verification. You can:");
        console.log("- Retry verification later: npm run verify");
        console.log("- Check if Etherscan API key is configured correctly");
        console.log("- Verify manually through Etherscan UI");
    }

    console.log("\n✨ Contract verification process completed!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Verification failed:", error);
        process.exit(1);
    });