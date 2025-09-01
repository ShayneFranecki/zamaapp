const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("TestToken", function () {
    
    async function deployTestTokenFixture() {
        const [owner, user1, user2, minter1] = await ethers.getSigners();

        const TestToken = await ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(
            "Test Token",
            "TEST",
            18,
            ethers.parseEther("1000000") // 1M tokens initial supply
        );

        return {
            testToken,
            owner,
            user1,
            user2,
            minter1
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct initial parameters", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            expect(await testToken.name()).to.equal("Test Token");
            expect(await testToken.symbol()).to.equal("TEST");
            expect(await testToken.decimals()).to.equal(18);
            expect(await testToken.totalSupply()).to.equal(ethers.parseEther("1000000"));
            expect(await testToken.owner()).to.equal(owner.address);
            expect(await testToken.balanceOf(owner.address)).to.equal(ethers.parseEther("1000000"));
        });

        it("Should deploy with zero initial supply", async function () {
            const TestToken = await ethers.getContractFactory("TestToken");
            const testToken = await TestToken.deploy("Zero Token", "ZERO", 18, 0);

            expect(await testToken.totalSupply()).to.equal(0);
        });

        it("Should not allow decimals above 18", async function () {
            const TestToken = await ethers.getContractFactory("TestToken");
            
            await expect(
                TestToken.deploy("Invalid Token", "INV", 19, 0)
            ).to.be.revertedWith("TestToken: Decimals too high");
        });

        it("Should not allow initial supply above maximum", async function () {
            const TestToken = await ethers.getContractFactory("TestToken");
            const maxSupply = ethers.parseEther("1000000000"); // 1B tokens
            const tooMuch = maxSupply + 1n;
            
            await expect(
                TestToken.deploy("Invalid Token", "INV", 18, tooMuch)
            ).to.be.revertedWith("TestToken: Initial supply too high");
        });
    });

    describe("Basic ERC20 Functions", function () {
        it("Should transfer tokens between accounts", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            const transferAmount = ethers.parseEther("1000");

            await expect(
                testToken.connect(owner).transfer(user1.address, transferAmount)
            ).to.emit(testToken, "Transfer")
            .withArgs(owner.address, user1.address, transferAmount);

            expect(await testToken.balanceOf(user1.address)).to.equal(transferAmount);
            expect(await testToken.balanceOf(owner.address)).to.equal(
                ethers.parseEther("999000") // 1M - 1K
            );
        });

        it("Should approve and transferFrom", async function () {
            const { testToken, owner, user1, user2 } = await loadFixture(deployTestTokenFixture);

            const approveAmount = ethers.parseEther("2000");
            const transferAmount = ethers.parseEther("1000");

            // Owner approves user1 to spend tokens
            await testToken.connect(owner).approve(user1.address, approveAmount);
            expect(await testToken.allowance(owner.address, user1.address)).to.equal(approveAmount);

            // User1 transfers tokens from owner to user2
            await expect(
                testToken.connect(user1).transferFrom(owner.address, user2.address, transferAmount)
            ).to.emit(testToken, "Transfer")
            .withArgs(owner.address, user2.address, transferAmount);

            expect(await testToken.balanceOf(user2.address)).to.equal(transferAmount);
            expect(await testToken.allowance(owner.address, user1.address)).to.equal(
                ethers.parseEther("1000") // 2K - 1K remaining
            );
        });

        it("Should not transfer more than balance", async function () {
            const { testToken, user1, user2 } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(user1).transfer(user2.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(testToken, "ERC20InsufficientBalance");
        });
    });

    describe("Minting Functions", function () {
        it("Should allow owner to mint tokens", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            const mintAmount = ethers.parseEther("5000");

            await expect(
                testToken.connect(owner).mint(user1.address, mintAmount)
            ).to.emit(testToken, "TokensMinted")
            .withArgs(user1.address, mintAmount);

            expect(await testToken.balanceOf(user1.address)).to.equal(mintAmount);
            expect(await testToken.totalSupply()).to.equal(
                ethers.parseEther("1005000") // 1M + 5K
            );
        });

        it("Should allow authorized minters to mint", async function () {
            const { testToken, owner, user1, minter1 } = await loadFixture(deployTestTokenFixture);

            // Add minter
            await testToken.connect(owner).addMinter(minter1.address);
            expect(await testToken.minters(minter1.address)).to.be.true;

            const mintAmount = ethers.parseEther("3000");

            await expect(
                testToken.connect(minter1).mint(user1.address, mintAmount)
            ).to.emit(testToken, "TokensMinted")
            .withArgs(user1.address, mintAmount);

            expect(await testToken.balanceOf(user1.address)).to.equal(mintAmount);
        });

        it("Should not allow non-minters to mint", async function () {
            const { testToken, user1, user2 } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(user1).mint(user2.address, ethers.parseEther("100"))
            ).to.be.revertedWith("TestToken: Not authorized minter");
        });

        it("Should not allow minting above max supply", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            const maxSupply = ethers.parseEther("1000000000"); // 1B
            const currentSupply = await testToken.totalSupply();
            const exceedAmount = maxSupply - currentSupply + 1n;

            await expect(
                testToken.connect(owner).mint(user1.address, exceedAmount)
            ).to.be.revertedWith("TestToken: Exceeds max supply");
        });

        it("Should not allow minting to zero address", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(owner).mint(ethers.ZeroAddress, ethers.parseEther("100"))
            ).to.be.revertedWith("TestToken: Cannot mint to zero address");
        });

        it("Should not allow minting zero amount", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(owner).mint(user1.address, 0)
            ).to.be.revertedWith("TestToken: Amount must be positive");
        });
    });

    describe("Batch Minting", function () {
        it("Should batch mint to multiple recipients", async function () {
            const { testToken, owner, user1, user2 } = await loadFixture(deployTestTokenFixture);

            const recipients = [user1.address, user2.address];
            const amounts = [ethers.parseEther("1000"), ethers.parseEther("2000")];

            await expect(
                testToken.connect(owner).batchMint(recipients, amounts)
            ).to.emit(testToken, "TokensMinted")
            .withArgs(user1.address, amounts[0])
            .and.to.emit(testToken, "TokensMinted")
            .withArgs(user2.address, amounts[1]);

            expect(await testToken.balanceOf(user1.address)).to.equal(amounts[0]);
            expect(await testToken.balanceOf(user2.address)).to.equal(amounts[1]);
        });

        it("Should not allow mismatched arrays", async function () {
            const { testToken, owner, user1, user2 } = await loadFixture(deployTestTokenFixture);

            const recipients = [user1.address, user2.address];
            const amounts = [ethers.parseEther("1000")]; // Different length

            await expect(
                testToken.connect(owner).batchMint(recipients, amounts)
            ).to.be.revertedWith("TestToken: Arrays length mismatch");
        });

        it("Should not allow empty arrays", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(owner).batchMint([], [])
            ).to.be.revertedWith("TestToken: Empty arrays");
        });

        it("Should not allow too many recipients", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            const recipients = Array(101).fill(owner.address); // 101 recipients (over limit)
            const amounts = Array(101).fill(ethers.parseEther("1"));

            await expect(
                testToken.connect(owner).batchMint(recipients, amounts)
            ).to.be.revertedWith("TestToken: Too many recipients");
        });
    });

    describe("Minter Management", function () {
        it("Should add and remove minters", async function () {
            const { testToken, owner, minter1 } = await loadFixture(deployTestTokenFixture);

            // Add minter
            await expect(
                testToken.connect(owner).addMinter(minter1.address)
            ).to.emit(testToken, "MinterAdded")
            .withArgs(minter1.address);

            expect(await testToken.isMinter(minter1.address)).to.be.true;

            // Remove minter
            await expect(
                testToken.connect(owner).removeMinter(minter1.address)
            ).to.emit(testToken, "MinterRemoved")
            .withArgs(minter1.address);

            expect(await testToken.isMinter(minter1.address)).to.be.false;
        });

        it("Should not allow non-owner to manage minters", async function () {
            const { testToken, user1, minter1 } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(user1).addMinter(minter1.address)
            ).to.be.revertedWithCustomError(testToken, "OwnableUnauthorizedAccount");
        });

        it("Should not allow adding zero address as minter", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(owner).addMinter(ethers.ZeroAddress)
            ).to.be.revertedWith("TestToken: Invalid minter address");
        });

        it("Should not allow adding duplicate minter", async function () {
            const { testToken, owner, minter1 } = await loadFixture(deployTestTokenFixture);

            await testToken.connect(owner).addMinter(minter1.address);

            await expect(
                testToken.connect(owner).addMinter(minter1.address)
            ).to.be.revertedWith("TestToken: Already a minter");
        });
    });

    describe("Burning Functions", function () {
        it("Should allow users to burn their own tokens", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            // First give user1 some tokens
            await testToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));

            const burnAmount = ethers.parseEther("500");
            const balanceBefore = await testToken.balanceOf(user1.address);
            const totalSupplyBefore = await testToken.totalSupply();

            await testToken.connect(user1).burn(burnAmount);

            expect(await testToken.balanceOf(user1.address)).to.equal(balanceBefore - burnAmount);
            expect(await testToken.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
        });

        it("Should allow burning with allowance", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            const burnAmount = ethers.parseEther("1000");

            // Owner approves user1 to burn tokens
            await testToken.connect(owner).approve(user1.address, burnAmount);

            const balanceBefore = await testToken.balanceOf(owner.address);
            const totalSupplyBefore = await testToken.totalSupply();

            await testToken.connect(user1).burnFrom(owner.address, burnAmount);

            expect(await testToken.balanceOf(owner.address)).to.equal(balanceBefore - burnAmount);
            expect(await testToken.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
            expect(await testToken.allowance(owner.address, user1.address)).to.equal(0);
        });

        it("Should not allow burning more than balance", async function () {
            const { testToken, user1 } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(user1).burn(ethers.parseEther("100"))
            ).to.be.revertedWith("TestToken: Insufficient balance");
        });

        it("Should not allow burning zero amount", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(owner).burn(0)
            ).to.be.revertedWith("TestToken: Amount must be positive");
        });
    });

    describe("Airdrop Function", function () {
        it("Should airdrop tokens to multiple recipients", async function () {
            const { testToken, owner, user1, user2 } = await loadFixture(deployTestTokenFixture);

            const recipients = [user1.address, user2.address];
            const amountPerRecipient = ethers.parseEther("100");

            await testToken.connect(owner).airdrop(recipients, amountPerRecipient);

            expect(await testToken.balanceOf(user1.address)).to.equal(amountPerRecipient);
            expect(await testToken.balanceOf(user2.address)).to.equal(amountPerRecipient);
        });

        it("Should not allow too many airdrop recipients", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            const recipients = Array(1001).fill(owner.address); // 1001 recipients (over limit)

            await expect(
                testToken.connect(owner).airdrop(recipients, ethers.parseEther("1"))
            ).to.be.revertedWith("TestToken: Too many recipients");
        });

        it("Should not allow airdrop that exceeds max supply", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            const maxSupply = ethers.parseEther("1000000000"); // 1B
            const currentSupply = await testToken.totalSupply();
            const remainingSupply = maxSupply - currentSupply;
            const tooMuchPerRecipient = remainingSupply + 1n;

            await expect(
                testToken.connect(owner).airdrop([user1.address], tooMuchPerRecipient)
            ).to.be.revertedWith("TestToken: Exceeds max supply");
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow owner to pause and unpause transfers", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            // Give user1 some tokens
            await testToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));

            // Pause transfers
            await expect(testToken.connect(owner).pause())
                .to.emit(testToken, "Paused");
            expect(await testToken.paused()).to.be.true;

            // Should not allow transfers when paused
            await expect(
                testToken.connect(user1).transfer(owner.address, ethers.parseEther("100"))
            ).to.be.revertedWith("TestToken: Token transfers paused");

            // Unpause transfers
            await expect(testToken.connect(owner).unpause())
                .to.emit(testToken, "Unpaused");
            expect(await testToken.paused()).to.be.false;

            // Should allow transfers after unpause
            await expect(
                testToken.connect(user1).transfer(owner.address, ethers.parseEther("100"))
            ).to.not.be.reverted;
        });

        it("Should not allow non-owner to pause", async function () {
            const { testToken, user1 } = await loadFixture(deployTestTokenFixture);

            await expect(
                testToken.connect(user1).pause()
            ).to.be.revertedWithCustomError(testToken, "OwnableUnauthorizedAccount");
        });

        it("Should not allow pausing when already paused", async function () {
            const { testToken, owner } = await loadFixture(deployTestTokenFixture);

            await testToken.connect(owner).pause();

            await expect(
                testToken.connect(owner).pause()
            ).to.be.revertedWith("TestToken: Already paused");
        });
    });

    describe("Token Information", function () {
        it("Should return correct token info", async function () {
            const { testToken } = await loadFixture(deployTestTokenFixture);

            const tokenInfo = await testToken.getTokenInfo();

            expect(tokenInfo.tokenName).to.equal("Test Token");
            expect(tokenInfo.tokenSymbol).to.equal("TEST");
            expect(tokenInfo.tokenDecimals).to.equal(18);
            expect(tokenInfo.tokenTotalSupply).to.equal(ethers.parseEther("1000000"));
            expect(tokenInfo.maxSupply).to.equal(ethers.parseEther("1000000000"));
            expect(tokenInfo.isPaused).to.be.false;
        });

        it("Should return remaining mintable supply", async function () {
            const { testToken } = await loadFixture(deployTestTokenFixture);

            const remaining = await testToken.getRemainingMintableSupply();
            const expected = ethers.parseEther("999000000"); // 1B - 1M

            expect(remaining).to.equal(expected);
        });

        it("Should check minter status", async function () {
            const { testToken, owner, user1, minter1 } = await loadFixture(deployTestTokenFixture);

            expect(await testToken.isMinter(owner.address)).to.be.true; // Owner is always a minter
            expect(await testToken.isMinter(user1.address)).to.be.false;

            await testToken.connect(owner).addMinter(minter1.address);
            expect(await testToken.isMinter(minter1.address)).to.be.true;
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle maximum supply correctly", async function () {
            const TestToken = await ethers.getContractFactory("TestToken");
            const maxSupply = ethers.parseEther("1000000000"); // 1B tokens
            const testToken = await TestToken.deploy("Max Token", "MAX", 18, maxSupply);

            expect(await testToken.totalSupply()).to.equal(maxSupply);
            expect(await testToken.getRemainingMintableSupply()).to.equal(0);

            // Should not be able to mint more
            const [owner, user1] = await ethers.getSigners();
            await expect(
                testToken.connect(owner).mint(user1.address, 1)
            ).to.be.revertedWith("TestToken: Exceeds max supply");
        });

        it("Should handle different decimal places", async function () {
            const TestToken = await ethers.getContractFactory("TestToken");
            
            // Test with 6 decimals (like USDC)
            const testToken6 = await TestToken.deploy("USDC Clone", "USDC", 6, 1000000 * 10**6);
            expect(await testToken6.decimals()).to.equal(6);

            // Test with 8 decimals (like WBTC)
            const testToken8 = await TestToken.deploy("WBTC Clone", "WBTC", 8, 21000000 * 10**8);
            expect(await testToken8.decimals()).to.equal(8);
        });

        it("Should prevent transfers when paused but allow minting", async function () {
            const { testToken, owner, user1 } = await loadFixture(deployTestTokenFixture);

            await testToken.connect(owner).pause();

            // Transfers should fail
            await expect(
                testToken.connect(owner).transfer(user1.address, ethers.parseEther("100"))
            ).to.be.revertedWith("TestToken: Token transfers paused");

            // But minting should still work
            await expect(
                testToken.connect(owner).mint(user1.address, ethers.parseEther("100"))
            ).to.not.be.reverted;
        });
    });
});