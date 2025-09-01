const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("ConfidentialTrading", function () {
    
    async function deployConfidentialTradingFixture() {
        const [owner, feeCollector, trader1, trader2, trader3] = await ethers.getSigners();

        // Deploy dependencies
        const FHECrypto = await ethers.getContractFactory("FHECrypto");
        const fheCrypto = await FHECrypto.deploy();
        
        const TestToken = await ethers.getContractFactory("TestToken");
        const testToken = await TestToken.deploy(
            "Test Token",
            "TEST",
            18,
            ethers.parseEther("1000000")
        );

        // Deploy main contract
        const ConfidentialTrading = await ethers.getContractFactory("ConfidentialTrading");
        const confidentialTrading = await ConfidentialTrading.deploy(
            feeCollector.address,
            await fheCrypto.getAddress()
        );

        // Setup authorizations
        await fheCrypto.authorizeOperator(await confidentialTrading.getAddress());

        // Add supported tokens
        await confidentialTrading.addSupportedToken(await testToken.getAddress(), 18);

        // Mint tokens for traders
        await testToken.mint(trader1.address, ethers.parseEther("10000"));
        await testToken.mint(trader2.address, ethers.parseEther("10000"));
        await testToken.mint(trader3.address, ethers.parseEther("10000"));

        // Approve trading contract
        const contractAddress = await confidentialTrading.getAddress();
        await testToken.connect(trader1).approve(contractAddress, ethers.parseEther("10000"));
        await testToken.connect(trader2).approve(contractAddress, ethers.parseEther("10000"));
        await testToken.connect(trader3).approve(contractAddress, ethers.parseEther("10000"));

        return {
            confidentialTrading,
            fheCrypto,
            testToken,
            owner,
            feeCollector,
            trader1,
            trader2,
            trader3
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct initial parameters", async function () {
            const { confidentialTrading, feeCollector, fheCrypto } = await loadFixture(deployConfidentialTradingFixture);

            expect(await confidentialTrading.feeCollector()).to.equal(feeCollector.address);
            expect(await confidentialTrading.nextOrderId()).to.equal(1);
            expect(await confidentialTrading.tradingFeeRate()).to.equal(30); // 0.3%
        });

        it("Should revert if deployed with zero address", async function () {
            const FHECrypto = await ethers.getContractFactory("FHECrypto");
            const fheCrypto = await FHECrypto.deploy();

            const ConfidentialTrading = await ethers.getContractFactory("ConfidentialTrading");
            
            await expect(
                ConfidentialTrading.deploy(
                    ethers.ZeroAddress,
                    await fheCrypto.getAddress()
                )
            ).to.be.revertedWith("ConfidentialTrading: Invalid fee collector");
        });
    });

    describe("Token Management", function () {
        it("Should add supported tokens", async function () {
            const { confidentialTrading, testToken, owner } = await loadFixture(deployConfidentialTradingFixture);

            expect(await confidentialTrading.supportedTokens(await testToken.getAddress())).to.be.true;
            expect(await confidentialTrading.tokenPrecisions(await testToken.getAddress())).to.equal(18);
        });

        it("Should remove supported tokens", async function () {
            const { confidentialTrading, testToken, owner } = await loadFixture(deployConfidentialTradingFixture);

            await confidentialTrading.connect(owner).removeSupportedToken(await testToken.getAddress());
            
            expect(await confidentialTrading.supportedTokens(await testToken.getAddress())).to.be.false;
            expect(await confidentialTrading.tokenPrecisions(await testToken.getAddress())).to.equal(0);
        });

        it("Should not allow non-owner to manage tokens", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            const TestToken2 = await ethers.getContractFactory("TestToken");
            const testToken2 = await TestToken2.deploy("Test2", "TEST2", 18, ethers.parseEther("1000"));

            await expect(
                confidentialTrading.connect(trader1).addSupportedToken(await testToken2.getAddress(), 18)
            ).to.be.revertedWithCustomError(confidentialTrading, "OwnableUnauthorizedAccount");
        });
    });

    describe("Token Deposits and Withdrawals", function () {
        it("Should allow token deposits", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            const depositAmount = ethers.parseEther("100");

            await expect(
                confidentialTrading.connect(trader1).depositTokens(
                    await testToken.getAddress(),
                    depositAmount
                )
            ).to.emit(confidentialTrading, "TokensDeposited")
            .withArgs(trader1.address, await testToken.getAddress(), depositAmount, await time.latest() + 1);

            // Check token transfer
            expect(await testToken.balanceOf(await confidentialTrading.getAddress())).to.equal(depositAmount);
        });

        it("Should reject deposits of unsupported tokens", async function () {
            const { confidentialTrading, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            const TestToken2 = await ethers.getContractFactory("TestToken");
            const testToken2 = await TestToken2.deploy("Test2", "TEST2", 18, ethers.parseEther("1000"));

            await expect(
                confidentialTrading.connect(trader1).depositTokens(
                    await testToken2.getAddress(),
                    ethers.parseEther("100")
                )
            ).to.be.revertedWith("ConfidentialTrading: Token not supported");
        });

        it("Should allow token withdrawals", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("50");

            // First deposit
            await confidentialTrading.connect(trader1).depositTokens(
                await testToken.getAddress(),
                depositAmount
            );

            const balanceBefore = await testToken.balanceOf(trader1.address);

            await expect(
                confidentialTrading.connect(trader1).withdrawTokens(
                    await testToken.getAddress(),
                    withdrawAmount
                )
            ).to.emit(confidentialTrading, "TokensWithdrawn")
            .withArgs(trader1.address, await testToken.getAddress(), withdrawAmount, await time.latest() + 1);

            const balanceAfter = await testToken.balanceOf(trader1.address);
            expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
        });
    });

    describe("Order Placement", function () {
        async function setupTradingFixture() {
            const fixture = await deployConfidentialTradingFixture();
            const { confidentialTrading, testToken, trader1, trader2 } = fixture;

            // Deposit tokens for trading
            await confidentialTrading.connect(trader1).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            // Send ETH to trading contract for trader2 to have ETH balance for buy orders
            await trader2.sendTransaction({
                to: await confidentialTrading.getAddress(),
                value: ethers.parseEther("10")
            });

            await confidentialTrading.connect(trader2).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            return fixture;
        }

        it("Should place buy orders successfully", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(setupTradingFixture);

            // Note: In real implementation, these would be actual FHE encrypted values
            const mockEncryptedAmount = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const mockEncryptedPrice = "0x5678901234567890123456789012345678901234567890123456789012345678";
            const mockAmountProof = "0x";
            const mockPriceProof = "0x";
            
            const amount = 100;
            const price = ethers.parseEther("0.001");

            await expect(
                confidentialTrading.connect(trader1).placeOrder(
                    await testToken.getAddress(), // base token
                    ethers.ZeroAddress, // quote token (ETH)
                    0, // Buy order
                    mockEncryptedAmount,
                    mockEncryptedPrice,
                    mockAmountProof,
                    mockPriceProof,
                    amount,
                    price
                )
            ).to.emit(confidentialTrading, "OrderPlaced");

            expect(await confidentialTrading.nextOrderId()).to.equal(2);
        });

        it("Should place sell orders successfully", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(setupTradingFixture);

            const mockEncryptedAmount = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const mockEncryptedPrice = "0x5678901234567890123456789012345678901234567890123456789012345678";
            const mockAmountProof = "0x";
            const mockPriceProof = "0x";
            
            const amount = 100;
            const price = ethers.parseEther("0.001");

            await expect(
                confidentialTrading.connect(trader1).placeOrder(
                    await testToken.getAddress(),
                    ethers.ZeroAddress,
                    1, // Sell order
                    mockEncryptedAmount,
                    mockEncryptedPrice,
                    mockAmountProof,
                    mockPriceProof,
                    amount,
                    price
                )
            ).to.emit(confidentialTrading, "OrderPlaced");
        });

        it("Should reject orders with same base and quote token", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(setupTradingFixture);

            const mockEncryptedAmount = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const mockEncryptedPrice = "0x5678901234567890123456789012345678901234567890123456789012345678";
            const mockAmountProof = "0x";
            const mockPriceProof = "0x";
            
            await expect(
                confidentialTrading.connect(trader1).placeOrder(
                    await testToken.getAddress(),
                    await testToken.getAddress(), // Same as base token
                    0,
                    mockEncryptedAmount,
                    mockEncryptedPrice,
                    mockAmountProof,
                    mockPriceProof,
                    100,
                    ethers.parseEther("0.001")
                )
            ).to.be.revertedWith("ConfidentialTrading: Same token pair");
        });

        it("Should reject orders with zero amounts", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(setupTradingFixture);

            const mockEncryptedAmount = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const mockEncryptedPrice = "0x5678901234567890123456789012345678901234567890123456789012345678";
            const mockAmountProof = "0x";
            const mockPriceProof = "0x";

            await expect(
                confidentialTrading.connect(trader1).placeOrder(
                    await testToken.getAddress(),
                    ethers.ZeroAddress,
                    0,
                    mockEncryptedAmount,
                    mockEncryptedPrice,
                    mockAmountProof,
                    mockPriceProof,
                    0, // Zero amount
                    ethers.parseEther("0.001")
                )
            ).to.be.revertedWith("ConfidentialTrading: Invalid amount");
        });
    });

    describe("Order Management", function () {
        async function placeOrderFixture() {
            const fixture = await loadFixture(deployConfidentialTradingFixture);
            const { confidentialTrading, testToken, trader1 } = fixture;

            await confidentialTrading.connect(trader1).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            // Place a test order
            await confidentialTrading.connect(trader1).placeOrder(
                await testToken.getAddress(),
                ethers.ZeroAddress,
                1, // Sell order
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x5678901234567890123456789012345678901234567890123456789012345678",
                "0x",
                "0x",
                100,
                ethers.parseEther("0.001")
            );

            return { ...fixture, orderId: 1 };
        }

        it("Should allow order owner to cancel orders", async function () {
            const { confidentialTrading, trader1, orderId } = await loadFixture(placeOrderFixture);

            await expect(
                confidentialTrading.connect(trader1).cancelOrder(orderId)
            ).to.emit(confidentialTrading, "OrderCancelled")
            .withArgs(orderId, trader1.address, await time.latest() + 1);
        });

        it("Should not allow non-owner to cancel orders", async function () {
            const { confidentialTrading, trader2, orderId } = await loadFixture(placeOrderFixture);

            await expect(
                confidentialTrading.connect(trader2).cancelOrder(orderId)
            ).to.be.revertedWith("ConfidentialTrading: Not order owner");
        });

        it("Should get order details", async function () {
            const { confidentialTrading, trader1, testToken, orderId } = await loadFixture(placeOrderFixture);

            const order = await confidentialTrading.getOrder(orderId);
            
            expect(order.trader).to.equal(trader1.address);
            expect(order.baseToken).to.equal(await testToken.getAddress());
            expect(order.quoteToken).to.equal(ethers.ZeroAddress);
            expect(order.orderType).to.equal(1); // Sell
            expect(order.isActive).to.be.true;
        });

        it("Should track trader orders", async function () {
            const { confidentialTrading, trader1, orderId } = await loadFixture(placeOrderFixture);

            const traderOrders = await confidentialTrading.getTraderOrders(trader1.address);
            expect(traderOrders.length).to.equal(1);
            expect(traderOrders[0]).to.equal(orderId);
        });

        it("Should get active orders", async function () {
            const { confidentialTrading, orderId } = await loadFixture(placeOrderFixture);

            const activeOrders = await confidentialTrading.getActiveOrders();
            expect(activeOrders.length).to.equal(1);
            expect(activeOrders[0]).to.equal(orderId);
        });
    });

    describe("Fee Management", function () {
        it("Should allow owner to update trading fee", async function () {
            const { confidentialTrading, owner } = await loadFixture(deployConfidentialTradingFixture);

            await expect(
                confidentialTrading.connect(owner).updateTradingFeeRate(50) // 0.5%
            ).to.not.be.reverted;

            expect(await confidentialTrading.tradingFeeRate()).to.equal(50);
        });

        it("Should not allow fee above maximum", async function () {
            const { confidentialTrading, owner } = await loadFixture(deployConfidentialTradingFixture);

            await expect(
                confidentialTrading.connect(owner).updateTradingFeeRate(150) // 1.5% (above 1% max)
            ).to.be.revertedWith("ConfidentialTrading: Fee too high");
        });

        it("Should allow owner to update fee collector", async function () {
            const { confidentialTrading, owner, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            await expect(
                confidentialTrading.connect(owner).updateFeeCollector(trader1.address)
            ).to.not.be.reverted;

            expect(await confidentialTrading.feeCollector()).to.equal(trader1.address);
        });

        it("Should not allow non-owner to update fees", async function () {
            const { confidentialTrading, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            await expect(
                confidentialTrading.connect(trader1).updateTradingFeeRate(50)
            ).to.be.revertedWithCustomError(confidentialTrading, "OwnableUnauthorizedAccount");
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete trading flow", async function () {
            const { confidentialTrading, testToken, trader1, trader2 } = 
                await loadFixture(deployConfidentialTradingFixture);

            // Setup: Both traders deposit tokens
            await confidentialTrading.connect(trader1).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            await confidentialTrading.connect(trader2).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            // Trader1 places sell order
            await confidentialTrading.connect(trader1).placeOrder(
                await testToken.getAddress(),
                ethers.ZeroAddress,
                1, // Sell
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x5678901234567890123456789012345678901234567890123456789012345678",
                "0x",
                "0x",
                100,
                ethers.parseEther("0.001")
            );

            // Trader2 places buy order
            await confidentialTrading.connect(trader2).placeOrder(
                await testToken.getAddress(),
                ethers.ZeroAddress,
                0, // Buy
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x5678901234567890123456789012345678901234567890123456789012345678",
                "0x",
                "0x",
                50,
                ethers.parseEther("0.0012") // Higher price (should match)
            );

            // Verify orders were created
            expect(await confidentialTrading.nextOrderId()).to.equal(3);

            // Check active orders
            const activeOrders = await confidentialTrading.getActiveOrders();
            expect(activeOrders.length).to.equal(2);

            // Check trader order tracking
            const trader1Orders = await confidentialTrading.getTraderOrders(trader1.address);
            const trader2Orders = await confidentialTrading.getTraderOrders(trader2.address);
            
            expect(trader1Orders.length).to.equal(1);
            expect(trader2Orders.length).to.equal(1);
        });

        it("Should handle multiple orders from same trader", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            await confidentialTrading.connect(trader1).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            // Place multiple orders
            for (let i = 0; i < 3; i++) {
                await confidentialTrading.connect(trader1).placeOrder(
                    await testToken.getAddress(),
                    ethers.ZeroAddress,
                    1, // Sell
                    "0x1234567890123456789012345678901234567890123456789012345678901234",
                    "0x5678901234567890123456789012345678901234567890123456789012345678",
                    "0x",
                    "0x",
                    100 + i,
                    ethers.parseEther("0.001")
                );
            }

            const traderOrders = await confidentialTrading.getTraderOrders(trader1.address);
            expect(traderOrders.length).to.equal(3);

            const activeOrders = await confidentialTrading.getActiveOrders();
            expect(activeOrders.length).to.equal(3);
        });

        it("Should handle order cancellation properly", async function () {
            const { confidentialTrading, testToken, trader1 } = await loadFixture(deployConfidentialTradingFixture);

            await confidentialTrading.connect(trader1).depositTokens(
                await testToken.getAddress(),
                ethers.parseEther("1000")
            );

            // Place two orders
            await confidentialTrading.connect(trader1).placeOrder(
                await testToken.getAddress(),
                ethers.ZeroAddress,
                1,
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x5678901234567890123456789012345678901234567890123456789012345678",
                "0x",
                "0x",
                100,
                ethers.parseEther("0.001")
            );

            await confidentialTrading.connect(trader1).placeOrder(
                await testToken.getAddress(),
                ethers.ZeroAddress,
                1,
                "0x1234567890123456789012345678901234567890123456789012345678901234",
                "0x5678901234567890123456789012345678901234567890123456789012345678",
                "0x",
                "0x",
                200,
                ethers.parseEther("0.002")
            );

            // Cancel first order
            await confidentialTrading.connect(trader1).cancelOrder(1);

            const activeOrders = await confidentialTrading.getActiveOrders();
            expect(activeOrders.length).to.equal(1);
            expect(activeOrders[0]).to.equal(2);

            // Verify cancelled order status
            const cancelledOrder = await confidentialTrading.getOrder(1);
            expect(cancelledOrder.isActive).to.be.false;
        });
    });
});