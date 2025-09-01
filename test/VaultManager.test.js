const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("VaultManager", function () {
    
    async function deployVaultManagerFixture() {
        const [owner, user1, user2, authorizedContract] = await ethers.getSigners();

        // Deploy VaultManager
        const VaultManager = await ethers.getContractFactory("VaultManager");
        const vaultManager = await VaultManager.deploy();

        // Deploy test token
        const TestToken = await ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(
            "Test Token",
            "TEST",
            18,
            ethers.parseEther("1000000")
        );

        // Mint tokens to users
        await testToken.mint(user1.address, ethers.parseEther("10000"));
        await testToken.mint(user2.address, ethers.parseEther("10000"));

        // Approve vault manager
        await testToken.connect(user1).approve(
            await vaultManager.getAddress(),
            ethers.parseEther("10000")
        );
        await testToken.connect(user2).approve(
            await vaultManager.getAddress(),
            ethers.parseEther("10000")
        );

        return {
            vaultManager,
            testToken,
            owner,
            user1,
            user2,
            authorizedContract
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct owner", async function () {
            const { vaultManager, owner } = await loadFixture(deployVaultManagerFixture);

            expect(await vaultManager.owner()).to.equal(owner.address);
            expect(await vaultManager.totalVaults()).to.equal(0);
        });
    });

    describe("Authorization Management", function () {
        it("Should allow owner to add authorized contracts", async function () {
            const { vaultManager, owner, authorizedContract } = await loadFixture(deployVaultManagerFixture);

            await expect(
                vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address)
            ).to.emit(vaultManager, "AuthorizedContractAdded")
            .withArgs(authorizedContract.address);

            expect(await vaultManager.authorizedContracts(authorizedContract.address)).to.be.true;
        });

        it("Should allow owner to remove authorized contracts", async function () {
            const { vaultManager, owner, authorizedContract } = await loadFixture(deployVaultManagerFixture);

            // First add the contract
            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            // Then remove it
            await expect(
                vaultManager.connect(owner).removeAuthorizedContract(authorizedContract.address)
            ).to.emit(vaultManager, "AuthorizedContractRemoved")
            .withArgs(authorizedContract.address);

            expect(await vaultManager.authorizedContracts(authorizedContract.address)).to.be.false;
        });

        it("Should not allow non-owner to manage authorizations", async function () {
            const { vaultManager, user1, authorizedContract } = await loadFixture(deployVaultManagerFixture);

            await expect(
                vaultManager.connect(user1).addAuthorizedContract(authorizedContract.address)
            ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
        });

        it("Should not allow adding zero address as authorized contract", async function () {
            const { vaultManager, owner } = await loadFixture(deployVaultManagerFixture);

            await expect(
                vaultManager.connect(owner).addAuthorizedContract(ethers.ZeroAddress)
            ).to.be.revertedWith("VaultManager: Invalid contract");
        });
    });

    describe("Token Deposits", function () {
        async function setupAuthorizedFixture() {
            const fixture = await deployVaultManagerFixture();
            const { vaultManager, owner, authorizedContract } = fixture;

            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            return fixture;
        }

        it("Should allow authorized contracts to deposit tokens", async function () {
            const { vaultManager, testToken, user1, authorizedContract } = await loadFixture(setupAuthorizedFixture);

            const depositAmount = ethers.parseEther("1000");
            const campaignId = 1;

            await expect(
                vaultManager.connect(authorizedContract).depositTokens(
                    await testToken.getAddress(),
                    user1.address,
                    depositAmount,
                    campaignId
                )
            ).to.emit(vaultManager, "TokensDeposited")
            .withArgs(campaignId, await testToken.getAddress(), user1.address, depositAmount);

            // Check vault was created
            const vault = await vaultManager.getVault(campaignId);
            expect(vault.depositor).to.equal(user1.address);
            expect(vault.tokenAddress).to.equal(await testToken.getAddress());
            expect(vault.totalDeposited).to.equal(depositAmount);
            expect(vault.remainingBalance).to.equal(depositAmount);

            // Check token was transferred
            expect(await testToken.balanceOf(await vaultManager.getAddress())).to.equal(depositAmount);
        });

        it("Should not allow unauthorized contracts to deposit", async function () {
            const { vaultManager, testToken, user1, user2 } = await loadFixture(deployVaultManagerFixture);

            await expect(
                vaultManager.connect(user2).depositTokens(
                    await testToken.getAddress(),
                    user1.address,
                    ethers.parseEther("1000"),
                    1
                )
            ).to.be.revertedWith("VaultManager: Not authorized");
        });

        it("Should not allow duplicate vault creation", async function () {
            const { vaultManager, testToken, user1, authorizedContract } = await loadFixture(setupAuthorizedFixture);

            const depositAmount = ethers.parseEther("1000");
            const campaignId = 1;

            // First deposit should succeed
            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                depositAmount,
                campaignId
            );

            // Second deposit with same campaign ID should fail
            await expect(
                vaultManager.connect(authorizedContract).depositTokens(
                    await testToken.getAddress(),
                    user1.address,
                    depositAmount,
                    campaignId
                )
            ).to.be.revertedWith("VaultManager: Vault already exists");
        });

        it("Should track depositor vaults", async function () {
            const { vaultManager, testToken, user1, authorizedContract } = await loadFixture(setupAuthorizedFixture);

            // Create two vaults for same depositor
            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("1000"),
                1
            );

            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("2000"),
                2
            );

            const depositorVaults = await vaultManager.getDepositorVaults(user1.address);
            expect(depositorVaults.length).to.equal(2);
            expect(depositorVaults[0]).to.equal(1);
            expect(depositorVaults[1]).to.equal(2);
        });
    });

    describe("Token Releases", function () {
        async function setupVaultFixture() {
            const fixture = await deployVaultManagerFixture();
            const { vaultManager, testToken, user1, owner, authorizedContract } = fixture;

            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            // Create a vault
            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("1000"),
                1
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should allow authorized contracts to release tokens", async function () {
            const { vaultManager, testToken, user2, authorizedContract, campaignId } = 
                await loadFixture(setupVaultFixture);

            const releaseAmount = ethers.parseEther("500");

            await expect(
                vaultManager.connect(authorizedContract).releaseTokens(
                    await testToken.getAddress(),
                    user2.address,
                    releaseAmount,
                    campaignId
                )
            ).to.emit(vaultManager, "TokensReleased")
            .withArgs(campaignId, user2.address, releaseAmount);

            // Check vault state updated
            const vault = await vaultManager.getVault(campaignId);
            expect(vault.totalReleased).to.equal(releaseAmount);
            expect(vault.remainingBalance).to.equal(ethers.parseEther("500"));

            // Check token was transferred
            expect(await testToken.balanceOf(user2.address)).to.equal(releaseAmount);
        });

        it("Should not allow releasing more than available balance", async function () {
            const { vaultManager, testToken, user2, authorizedContract, campaignId } = 
                await loadFixture(setupVaultFixture);

            await expect(
                vaultManager.connect(authorizedContract).releaseTokens(
                    await testToken.getAddress(),
                    user2.address,
                    ethers.parseEther("2000"), // More than deposited
                    campaignId
                )
            ).to.be.revertedWith("VaultManager: Insufficient balance");
        });

        it("Should validate token address matches vault", async function () {
            const { vaultManager, user2, authorizedContract, campaignId } = 
                await loadFixture(setupVaultFixture);

            // Deploy different token
            const TestToken2 = await ethers.getContractFactory("TestToken");
            const testToken2 = await TestToken2.deploy("Test2", "TEST2", 18, ethers.parseEther("1000"));

            await expect(
                vaultManager.connect(authorizedContract).releaseTokens(
                    await testToken2.getAddress(),
                    user2.address,
                    ethers.parseEther("100"),
                    campaignId
                )
            ).to.be.revertedWith("VaultManager: Token mismatch");
        });
    });

    describe("Token Returns", function () {
        async function setupVaultFixture() {
            const fixture = await deployVaultManagerFixture();
            const { vaultManager, testToken, user1, owner, authorizedContract } = fixture;

            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("1000"),
                1
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should allow returning tokens to depositor", async function () {
            const { vaultManager, testToken, user1, authorizedContract, campaignId } = 
                await loadFixture(setupVaultFixture);

            const returnAmount = ethers.parseEther("300");
            const balanceBefore = await testToken.balanceOf(user1.address);

            await expect(
                vaultManager.connect(authorizedContract).returnTokens(
                    await testToken.getAddress(),
                    user1.address,
                    returnAmount,
                    campaignId
                )
            ).to.emit(vaultManager, "TokensReturned")
            .withArgs(campaignId, user1.address, returnAmount);

            const balanceAfter = await testToken.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(returnAmount);

            // Check vault state
            const vault = await vaultManager.getVault(campaignId);
            expect(vault.remainingBalance).to.equal(ethers.parseEther("700"));
        });

        it("Should not allow returning to wrong depositor", async function () {
            const { vaultManager, testToken, user2, authorizedContract, campaignId } = 
                await loadFixture(setupVaultFixture);

            await expect(
                vaultManager.connect(authorizedContract).returnTokens(
                    await testToken.getAddress(),
                    user2.address, // Wrong depositor
                    ethers.parseEther("100"),
                    campaignId
                )
            ).to.be.revertedWith("VaultManager: Depositor mismatch");
        });

        it("Should not allow returns from locked vaults", async function () {
            const { vaultManager, testToken, user1, authorizedContract, campaignId } = 
                await loadFixture(setupVaultFixture);

            // Lock the vault
            await vaultManager.connect(authorizedContract).lockVault(campaignId);

            await expect(
                vaultManager.connect(authorizedContract).returnTokens(
                    await testToken.getAddress(),
                    user1.address,
                    ethers.parseEther("100"),
                    campaignId
                )
            ).to.be.revertedWith("VaultManager: Vault is locked");
        });
    });

    describe("Vault Locking", function () {
        async function setupVaultFixture() {
            const fixture = await deployVaultManagerFixture();
            const { vaultManager, testToken, user1, owner, authorizedContract } = fixture;

            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("1000"),
                1
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should allow authorized contracts to lock vaults", async function () {
            const { vaultManager, authorizedContract, campaignId } = await loadFixture(setupVaultFixture);

            await expect(
                vaultManager.connect(authorizedContract).lockVault(campaignId)
            ).to.emit(vaultManager, "VaultLocked")
            .withArgs(campaignId, await time.latest() + 1);

            const vault = await vaultManager.getVault(campaignId);
            expect(vault.isLocked).to.be.true;
        });

        it("Should allow unlocking after lock duration", async function () {
            const { vaultManager, authorizedContract, campaignId } = await loadFixture(setupVaultFixture);

            // Lock the vault
            await vaultManager.connect(authorizedContract).lockVault(campaignId);

            // Fast forward past lock duration (30 days)
            await time.increase(31 * 24 * 60 * 60);

            await expect(
                vaultManager.connect(authorizedContract).unlockVault(campaignId)
            ).to.emit(vaultManager, "VaultUnlocked")
            .withArgs(campaignId, await time.latest() + 1);

            const vault = await vaultManager.getVault(campaignId);
            expect(vault.isLocked).to.be.false;
        });

        it("Should not allow unlocking before duration expires", async function () {
            const { vaultManager, authorizedContract, campaignId } = await loadFixture(setupVaultFixture);

            await vaultManager.connect(authorizedContract).lockVault(campaignId);

            await expect(
                vaultManager.connect(authorizedContract).unlockVault(campaignId)
            ).to.be.revertedWith("VaultManager: Lock period not expired");
        });
    });

    describe("Emergency Functions", function () {
        async function setupVaultFixture() {
            const fixture = await deployVaultManagerFixture();
            const { vaultManager, testToken, user1, owner, authorizedContract } = fixture;

            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("1000"),
                1
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should allow owner to emergency token recovery", async function () {
            const { vaultManager, testToken, owner, user2 } = await loadFixture(setupVaultFixture);

            const recoveryAmount = ethers.parseEther("100");

            await expect(
                vaultManager.connect(owner).emergencyTokenRecovery(
                    await testToken.getAddress(),
                    user2.address,
                    recoveryAmount
                )
            ).to.not.be.reverted;

            expect(await testToken.balanceOf(user2.address)).to.equal(recoveryAmount);
        });

        it("Should allow owner to emergency unlock vault", async function () {
            const { vaultManager, owner, authorizedContract, campaignId } = await loadFixture(setupVaultFixture);

            // Lock vault first
            await vaultManager.connect(authorizedContract).lockVault(campaignId);

            // Emergency unlock without waiting for duration
            await expect(
                vaultManager.connect(owner).emergencyUnlockVault(campaignId)
            ).to.emit(vaultManager, "VaultUnlocked")
            .withArgs(campaignId, await time.latest() + 1);

            const vault = await vaultManager.getVault(campaignId);
            expect(vault.isLocked).to.be.false;
        });

        it("Should not allow non-owner to use emergency functions", async function () {
            const { vaultManager, testToken, user1, user2, campaignId } = await loadFixture(setupVaultFixture);

            await expect(
                vaultManager.connect(user1).emergencyTokenRecovery(
                    await testToken.getAddress(),
                    user2.address,
                    ethers.parseEther("100")
                )
            ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");

            await expect(
                vaultManager.connect(user1).emergencyUnlockVault(campaignId)
            ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("Vault Information", function () {
        async function setupVaultFixture() {
            const fixture = await deployVaultManagerFixture();
            const { vaultManager, testToken, user1, owner, authorizedContract } = fixture;

            await vaultManager.connect(owner).addAuthorizedContract(authorizedContract.address);

            await vaultManager.connect(authorizedContract).depositTokens(
                await testToken.getAddress(),
                user1.address,
                ethers.parseEther("1000"),
                1
            );

            return { ...fixture, campaignId: 1 };
        }

        it("Should return vault balance", async function () {
            const { vaultManager, campaignId } = await loadFixture(setupVaultFixture);

            const balance = await vaultManager.getVaultBalance(campaignId);
            expect(balance).to.equal(ethers.parseEther("1000"));
        });

        it("Should return vault details", async function () {
            const { vaultManager, testToken, user1, campaignId } = await loadFixture(setupVaultFixture);

            const vault = await vaultManager.getVault(campaignId);
            
            expect(vault.campaignId).to.equal(campaignId);
            expect(vault.tokenAddress).to.equal(await testToken.getAddress());
            expect(vault.depositor).to.equal(user1.address);
            expect(vault.totalDeposited).to.equal(ethers.parseEther("1000"));
            expect(vault.totalReleased).to.equal(0);
            expect(vault.remainingBalance).to.equal(ethers.parseEther("1000"));
            expect(vault.isLocked).to.be.false;
        });

        it("Should revert for non-existent vaults", async function () {
            const { vaultManager } = await loadFixture(deployVaultManagerFixture);

            await expect(
                vaultManager.getVault(999)
            ).to.be.revertedWith("VaultManager: Vault not found");
        });
    });
});