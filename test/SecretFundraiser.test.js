const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("SecretFundraiser", function () {
    
    async function deploySecretFundraiserFixture() {
        const [owner, feeCollector, creator, investor1, investor2] = await ethers.getSigners();

        // Deploy dependencies
        const FHECrypto = await ethers.getContractFactory("FHECrypto");
        const fheCrypto = await FHECrypto.deploy();
        
        const VaultManager = await ethers.getContractFactory("VaultManager");
        const vaultManager = await VaultManager.deploy();
        
        const TestToken = await ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(
            "Test Token",
            "TEST",
            18,
            ethers.parseEther("1000000")
        );

        // Deploy main contract
        const SecretFundraiser = await ethers.getContractFactory("SecretFundraiser");
        const secretFundraiser = await SecretFundraiser.deploy(
            feeCollector.address,
            await vaultManager.getAddress(),
            await fheCrypto.getAddress()
        );

        // Setup authorizations
        await vaultManager.addAuthorizedContract(await secretFundraiser.getAddress());
        await fheCrypto.authorizeOperator(await secretFundraiser.getAddress());
        await testToken.addMinter(await secretFundraiser.getAddress());

        // Mint tokens for creator
        await testToken.mint(creator.address, ethers.parseEther("10000"));
        await testToken.connect(creator).approve(
            await secretFundraiser.getAddress(),
            ethers.parseEther("10000")
        );

        return {
            secretFundraiser,
            vaultManager,
            fheCrypto,
            testToken,
            owner,
            feeCollector,
            creator,
            investor1,
            investor2
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct initial parameters", async function () {
            const { secretFundraiser, feeCollector, vaultManager, fheCrypto } = await loadFixture(deploySecretFundraiserFixture);

            expect(await secretFundraiser.feeCollector()).to.equal(feeCollector.address);
            expect(await secretFundraiser.nextCampaignId()).to.equal(1);
            expect(await secretFundraiser.serviceFeeRate()).to.equal(200); // 2%
        });

        it("Should revert if deployed with zero address", async function () {
            const FHECrypto = await ethers.getContractFactory("FHECrypto");
            const fheCrypto = await FHECrypto.deploy();
            
            const VaultManager = await ethers.getContractFactory("VaultManager");
            const vaultManager = await VaultManager.deploy();

            const SecretFundraiser = await ethers.getContractFactory("SecretFundraiser");
            
            await expect(
                SecretFundraiser.deploy(
                    ethers.ZeroAddress,
                    await vaultManager.getAddress(),
                    await fheCrypto.getAddress()
                )
            ).to.be.revertedWith("SecretFundraiser: Invalid fee collector");
        });
    });

    describe("Campaign Creation", function () {
        it("Should create a campaign successfully", async function () {
            const { secretFundraiser, testToken, creator } = await loadFixture(deploySecretFundraiserFixture);

            const tokenSupply = ethers.parseEther("1000");
            const fundingGoal = ethers.parseEther("10");
            const tokenPrice = ethers.parseEther("0.01");
            const duration = 30 * 24 * 60 * 60; // 30 days
            const minContribution = ethers.parseEther("0.1");
            const maxContribution = ethers.parseEther("5");
            const infoHash = "QmTest123";

            await expect(
                secretFundraiser.connect(creator).launchCampaign(
                    await testToken.getAddress(),
                    tokenSupply,
                    fundingGoal,
                    tokenPrice,
                    duration,
                    minContribution,
                    maxContribution,
                    infoHash
                )
            ).to.emit(secretFundraiser, "CampaignLaunched")
            .withArgs(1, creator.address, await testToken.getAddress(), fundingGoal, tokenPrice);

            const campaign = await secretFundraiser.getCampaign(1);
            expect(campaign.creator).to.equal(creator.address);
            expect(campaign.fundingGoal).to.equal(fundingGoal);
            expect(campaign.tokenPrice).to.equal(tokenPrice);
            expect(campaign.isLive).to.be.true;
        });

        it("Should revert with invalid parameters", async function () {
            const { secretFundraiser, testToken, creator } = await loadFixture(deploySecretFundraiserFixture);

            await expect(
                secretFundraiser.connect(creator).launchCampaign(
                    ethers.ZeroAddress, // Invalid token address
                    ethers.parseEther("1000"),
                    ethers.parseEther("10"),
                    ethers.parseEther("0.01"),
                    30 * 24 * 60 * 60,
                    ethers.parseEther("0.1"),
                    ethers.parseEther("5"),
                    "QmTest123"
                )
            ).to.be.revertedWith("SecretFundraiser: Invalid token");
        });

        it("Should increment campaign ID", async function () {
            const { secretFundraiser, testToken, creator } = await loadFixture(deploySecretFundraiserFixture);

            // Mint more tokens for multiple campaigns
            await testToken.mint(creator.address, ethers.parseEther("10000"));
            await testToken.connect(creator).approve(
                await secretFundraiser.getAddress(),
                ethers.parseEther("20000")
            );

            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("10"),
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest1"
            );

            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("10"),
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest2"
            );

            expect(await secretFundraiser.nextCampaignId()).to.equal(3);
        });
    });

    describe("Secret Contributions", function () {
        async function createCampaignFixture() {
            const fixture = await deploySecretFundraiserFixture();
            const { secretFundraiser, testToken, creator } = fixture;

            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("10"), // 10 ETH funding goal
                ethers.parseEther("0.01"), // 0.01 ETH per token
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest123"
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should accept valid secret contributions", async function () {
            const { secretFundraiser, investor1, campaignId } = await loadFixture(createCampaignFixture);

            const contributionAmount = ethers.parseEther("1");
            
            // Note: In real implementation, this would use actual FHE encryption
            // For testing, we simulate the encrypted input
            const mockEncryptedAmount = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const mockProof = "0x";

            await expect(
                secretFundraiser.connect(investor1).contributeSecretly(
                    campaignId,
                    mockEncryptedAmount,
                    mockProof,
                    { value: contributionAmount }
                )
            ).to.emit(secretFundraiser, "SecretContributionReceived")
            .withArgs(campaignId, investor1.address, await time.latest() + 1);

            expect(await secretFundraiser.hasContributed(campaignId, investor1.address)).to.be.true;
        });

        it("Should revert for inactive campaigns", async function () {
            const { secretFundraiser, testToken, creator, investor1 } = await loadFixture(deploySecretFundraiserFixture);

            await expect(
                secretFundraiser.connect(investor1).contributeSecretly(
                    999, // Non-existent campaign
                    "0x1234567890123456789012345678901234567890123456789012345678901234",
                    "0x",
                    { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWith("SecretFundraiser: Campaign not found");
        });

        it("Should enforce contribution limits", async function () {
            const { secretFundraiser, investor1, campaignId } = await loadFixture(createCampaignFixture);

            const tooSmall = ethers.parseEther("0.05"); // Below 0.1 ETH minimum
            const tooLarge = ethers.parseEther("6"); // Above 5 ETH maximum

            await expect(
                secretFundraiser.connect(investor1).contributeSecretly(
                    campaignId,
                    "0x1234567890123456789012345678901234567890123456789012345678901234",
                    "0x",
                    { value: tooSmall }
                )
            ).to.be.revertedWith("SecretFundraiser: Below minimum");

            await expect(
                secretFundraiser.connect(investor1).contributeSecretly(
                    campaignId,
                    "0x1234567890123456789012345678901234567890123456789012345678901234",
                    "0x",
                    { value: tooLarge }
                )
            ).to.be.revertedWith("SecretFundraiser: Above maximum");
        });
    });

    describe("Campaign Management", function () {
        async function createCampaignFixture() {
            const fixture = await deploySecretFundraiserFixture();
            const { secretFundraiser, testToken, creator } = fixture;

            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("10"),
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest123"
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should allow campaign creator to cancel", async function () {
            const { secretFundraiser, creator, campaignId } = await loadFixture(createCampaignFixture);

            await expect(
                secretFundraiser.connect(creator).cancelCampaign(campaignId)
            ).to.emit(secretFundraiser, "CampaignStateChanged")
            .withArgs(campaignId, 4); // Failed state

            const campaign = await secretFundraiser.getCampaign(campaignId);
            expect(campaign.isLive).to.be.false;
        });

        it("Should not allow non-creator to cancel", async function () {
            const { secretFundraiser, investor1, campaignId } = await loadFixture(createCampaignFixture);

            await expect(
                secretFundraiser.connect(investor1).cancelCampaign(campaignId)
            ).to.be.revertedWith("SecretFundraiser: Not campaign creator");
        });

        it("Should get live campaigns", async function () {
            const { secretFundraiser } = await loadFixture(createCampaignFixture);

            const liveCampaigns = await secretFundraiser.getLiveCampaigns();
            expect(liveCampaigns.length).to.equal(1);
            expect(liveCampaigns[0]).to.equal(1);
        });
    });

    describe("Fee Management", function () {
        it("Should allow owner to update service fee", async function () {
            const { secretFundraiser, owner } = await loadFixture(deploySecretFundraiserFixture);

            await expect(
                secretFundraiser.connect(owner).updateServiceFeeRate(300) // 3%
            ).to.not.be.reverted;

            expect(await secretFundraiser.serviceFeeRate()).to.equal(300);
        });

        it("Should not allow fee above maximum", async function () {
            const { secretFundraiser, owner } = await loadFixture(deploySecretFundraiserFixture);

            await expect(
                secretFundraiser.connect(owner).updateServiceFeeRate(600) // 6% (above 5% max)
            ).to.be.revertedWith("SecretFundraiser: Fee too high");
        });

        it("Should allow owner to update fee collector", async function () {
            const { secretFundraiser, owner, investor1 } = await loadFixture(deploySecretFundraiserFixture);

            await expect(
                secretFundraiser.connect(owner).updateFeeCollector(investor1.address)
            ).to.not.be.reverted;

            expect(await secretFundraiser.feeCollector()).to.equal(investor1.address);
        });
    });

    describe("Emergency Functions", function () {
        async function createCampaignFixture() {
            const fixture = await deploySecretFundraiserFixture();
            const { secretFundraiser, testToken, creator } = fixture;

            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("10"),
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest123"
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should allow owner to emergency terminate campaign", async function () {
            const { secretFundraiser, owner, campaignId } = await loadFixture(createCampaignFixture);

            await expect(
                secretFundraiser.connect(owner).emergencyTerminateCampaign(campaignId)
            ).to.emit(secretFundraiser, "ComputationStarted");
        });

        it("Should not allow non-owner to emergency terminate", async function () {
            const { secretFundraiser, investor1, campaignId } = await loadFixture(createCampaignFixture);

            await expect(
                secretFundraiser.connect(investor1).emergencyTerminateCampaign(campaignId)
            ).to.be.revertedWithCustomError(secretFundraiser, "OwnableUnauthorizedAccount");
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete campaign lifecycle", async function () {
            const { secretFundraiser, testToken, creator, investor1, investor2, feeCollector } = 
                await loadFixture(deploySecretFundraiserFixture);

            // 1. Create campaign
            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("2"), // Lower goal for easier testing
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest123"
            );

            // 2. Multiple investors contribute
            await secretFundraiser.connect(investor1).contributeSecretly(
                1,
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x",
                { value: ethers.parseEther("1") }
            );

            await secretFundraiser.connect(investor2).contributeSecretly(
                1,
                "0x1234567890123456789012345678901234567890123456789012345678901234", 
                "0x",
                { value: ethers.parseEther("1.5") }
            );

            // 3. Verify user participation tracking
            const user1Campaigns = await secretFundraiser.getUserCampaigns(investor1.address);
            const user2Campaigns = await secretFundraiser.getUserCampaigns(investor2.address);

            expect(user1Campaigns.length).to.equal(1);
            expect(user2Campaigns.length).to.equal(1);
            expect(user1Campaigns[0]).to.equal(1);
            expect(user2Campaigns[0]).to.equal(1);

            // 4. Check campaign state
            const campaign = await secretFundraiser.getCampaign(1);
            expect(campaign.currentState).to.equal(1); // Live state
            expect(campaign.isLive).to.be.true;
        });

        it("Should track multiple campaigns per user", async function () {
            const { secretFundraiser, testToken, creator, investor1 } = await loadFixture(deploySecretFundraiserFixture);

            // Mint more tokens for multiple campaigns
            await testToken.mint(creator.address, ethers.parseEther("10000"));
            await testToken.connect(creator).approve(
                await secretFundraiser.getAddress(),
                ethers.parseEther("20000")
            );

            // Create two campaigns
            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("2"),
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest1"
            );

            await secretFundraiser.connect(creator).launchCampaign(
                await testToken.getAddress(),
                ethers.parseEther("1000"),
                ethers.parseEther("3"),
                ethers.parseEther("0.01"),
                30 * 24 * 60 * 60,
                ethers.parseEther("0.1"),
                ethers.parseEther("5"),
                "QmTest2"
            );

            // Investor contributes to both
            await secretFundraiser.connect(investor1).contributeSecretly(
                1,
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x",
                { value: ethers.parseEther("1") }
            );

            await secretFundraiser.connect(investor1).contributeSecretly(
                2,
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x",
                { value: ethers.parseEther("1.5") }
            );

            const userCampaigns = await secretFundraiser.getUserCampaigns(investor1.address);
            expect(userCampaigns.length).to.equal(2);
            expect(userCampaigns).to.deep.equal([1n, 2n]);
        });
    });
});