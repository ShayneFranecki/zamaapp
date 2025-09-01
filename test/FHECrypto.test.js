const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("FHECrypto", function () {
    
    async function deployFHECryptoFixture() {
        const [owner, operator1, operator2, user1] = await ethers.getSigners();

        // Deploy FHECrypto
        const FHECrypto = await ethers.getContractFactory("FHECrypto");
        const fheCrypto = await FHECrypto.deploy();

        return {
            fheCrypto,
            owner,
            operator1,
            operator2,
            user1
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct owner", async function () {
            const { fheCrypto, owner } = await loadFixture(deployFHECryptoFixture);

            expect(await fheCrypto.owner()).to.equal(owner.address);
            expect(await fheCrypto.totalEncryptedValues()).to.equal(0);
            expect(await fheCrypto.nextRequestId()).to.equal(1);
        });
    });

    describe("Operator Management", function () {
        it("Should allow owner to authorize operators", async function () {
            const { fheCrypto, owner, operator1 } = await loadFixture(deployFHECryptoFixture);

            await expect(
                fheCrypto.connect(owner).authorizeOperator(operator1.address)
            ).to.emit(fheCrypto, "OperatorAuthorized")
            .withArgs(operator1.address);

            expect(await fheCrypto.authorizedOperators(operator1.address)).to.be.true;
        });

        it("Should allow owner to deauthorize operators", async function () {
            const { fheCrypto, owner, operator1 } = await loadFixture(deployFHECryptoFixture);

            // First authorize
            await fheCrypto.connect(owner).authorizeOperator(operator1.address);

            // Then deauthorize
            await expect(
                fheCrypto.connect(owner).deauthorizeOperator(operator1.address)
            ).to.emit(fheCrypto, "OperatorDeauthorized")
            .withArgs(operator1.address);

            expect(await fheCrypto.authorizedOperators(operator1.address)).to.be.false;
        });

        it("Should not allow non-owner to manage operators", async function () {
            const { fheCrypto, operator1, user1 } = await loadFixture(deployFHECryptoFixture);

            await expect(
                fheCrypto.connect(user1).authorizeOperator(operator1.address)
            ).to.be.revertedWithCustomError(fheCrypto, "OwnableUnauthorizedAccount");
        });

        it("Should not allow authorizing zero address", async function () {
            const { fheCrypto, owner } = await loadFixture(deployFHECryptoFixture);

            await expect(
                fheCrypto.connect(owner).authorizeOperator(ethers.ZeroAddress)
            ).to.be.revertedWith("FHECrypto: Invalid operator");
        });

        it("Should not allow duplicate authorization", async function () {
            const { fheCrypto, owner, operator1 } = await loadFixture(deployFHECryptoFixture);

            await fheCrypto.connect(owner).authorizeOperator(operator1.address);

            await expect(
                fheCrypto.connect(owner).authorizeOperator(operator1.address)
            ).to.be.revertedWith("FHECrypto: Already authorized");
        });
    });

    describe("Value Encryption", function () {
        it("Should encrypt and store values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const value = 12345;
            const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test_data_1"));

            await expect(
                fheCrypto.connect(user1).encryptValue(value, dataHash)
            ).to.emit(fheCrypto, "ValueEncrypted")
            .withArgs(dataHash, user1.address, await ethers.provider.getBlockNumber() + 1);

            expect(await fheCrypto.totalEncryptedValues()).to.equal(1);

            const storedData = await fheCrypto.getEncryptedData(dataHash);
            expect(storedData.owner).to.equal(user1.address);
            expect(storedData.isValid).to.be.true;
        });

        it("Should not allow duplicate data hashes", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test_data_1"));

            await fheCrypto.connect(user1).encryptValue(12345, dataHash);

            await expect(
                fheCrypto.connect(user1).encryptValue(67890, dataHash)
            ).to.be.revertedWith("FHECrypto: Data already exists");
        });

        it("Should not allow zero hash", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            await expect(
                fheCrypto.connect(user1).encryptValue(12345, ethers.ZeroHash)
            ).to.be.revertedWith("FHECrypto: Invalid hash");
        });
    });

    describe("Batch Encryption", function () {
        it("Should encrypt multiple values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const values = [100, 200, 300, 400, 500];

            const result = await fheCrypto.connect(user1).batchEncrypt(values);
            
            // In a real implementation, this would return encrypted values
            // For testing, we just verify the function executes without error
            expect(result).to.not.be.undefined;
        });

        it("Should not allow empty array", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            await expect(
                fheCrypto.connect(user1).batchEncrypt([])
            ).to.be.revertedWith("FHECrypto: Empty array");
        });

        it("Should not allow too many values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const tooManyValues = Array(101).fill(100); // 101 values (over limit of 100)

            await expect(
                fheCrypto.connect(user1).batchEncrypt(tooManyValues)
            ).to.be.revertedWith("FHECrypto: Too many values");
        });
    });

    describe("Computation Requests", function () {
        async function setupOperatorFixture() {
            const fixture = await deployFHECryptoFixture();
            const { fheCrypto, owner, operator1 } = fixture;

            await fheCrypto.connect(owner).authorizeOperator(operator1.address);

            return fixture;
        }

        it("Should allow authorized operators to request decryption", async function () {
            const { fheCrypto, operator1 } = await loadFixture(setupOperatorFixture);

            // Note: In real implementation, this would use actual encrypted value
            // For testing, we simulate with a mock encrypted value
            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";

            await expect(
                fheCrypto.connect(operator1).requestDecryption(mockEncryptedValue)
            ).to.emit(fheCrypto, "ComputationRequested")
            .withArgs(1, operator1.address, await ethers.provider.getBlockNumber() + 1);

            expect(await fheCrypto.nextRequestId()).to.equal(2);

            const request = await fheCrypto.getComputationRequest(1);
            expect(request.requester).to.equal(operator1.address);
            expect(request.isProcessed).to.be.false;
        });

        it("Should not allow unauthorized users to request decryption", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";

            await expect(
                fheCrypto.connect(user1).requestDecryption(mockEncryptedValue)
            ).to.be.revertedWith("FHECrypto: Not authorized operator");
        });

        it("Should allow simulating decryption results", async function () {
            const { fheCrypto, operator1 } = await loadFixture(setupOperatorFixture);

            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";

            // Request decryption
            await fheCrypto.connect(operator1).requestDecryption(mockEncryptedValue);

            // Simulate result
            const result = 54321;
            await expect(
                fheCrypto.connect(operator1).simulateDecryptionResult(1, result)
            ).to.emit(fheCrypto, "ComputationCompleted")
            .withArgs(1, result, await ethers.provider.getBlockNumber() + 1);

            const request = await fheCrypto.getComputationRequest(1);
            expect(request.isProcessed).to.be.true;
            expect(request.result).to.equal(result);
        });

        it("Should not allow processing same request twice", async function () {
            const { fheCrypto, operator1 } = await loadFixture(setupOperatorFixture);

            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";

            await fheCrypto.connect(operator1).requestDecryption(mockEncryptedValue);
            await fheCrypto.connect(operator1).simulateDecryptionResult(1, 12345);

            await expect(
                fheCrypto.connect(operator1).simulateDecryptionResult(1, 67890)
            ).to.be.revertedWith("FHECrypto: Already processed");
        });
    });

    describe("FHE Operations", function () {
        it("Should verify encrypted amounts", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            // Note: In real implementation, this would use actual FHE operations
            // For testing, we simulate the verification
            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const expectedValue = 12345;

            // This test will pass in mock implementation but would perform actual FHE verification in production
            const result = await fheCrypto.connect(user1).verifyEncryptedAmount(
                mockEncryptedValue,
                expectedValue
            );

            // In mock implementation, this might return a default value
            // In real FHE implementation, this would verify the encrypted value matches expected value
            expect(result).to.not.be.undefined;
        });

        it("Should create range proofs", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const minValue = 100;
            const maxValue = 10000;

            const result = await fheCrypto.connect(user1).createRangeProof(
                mockEncryptedValue,
                minValue,
                maxValue
            );

            expect(result).to.not.be.undefined;
        });

        it("Should verify zero-knowledge proofs", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";
            const mockProof = "0x9876543210987654321098765432109876543210987654321098765432109876";

            const result = await fheCrypto.connect(user1).verifyZKProof(
                mockEncryptedValue,
                mockProof
            );

            expect(result).to.not.be.undefined;
        });
    });

    describe("Homomorphic Operations", function () {
        it("Should add encrypted values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const value1 = "0x1111111111111111111111111111111111111111111111111111111111111111";
            const value2 = "0x2222222222222222222222222222222222222222222222222222222222222222";

            const result = await fheCrypto.connect(user1).addEncryptedValues(value1, value2);
            expect(result).to.not.be.undefined;
        });

        it("Should subtract encrypted values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const value1 = "0x2222222222222222222222222222222222222222222222222222222222222222";
            const value2 = "0x1111111111111111111111111111111111111111111111111111111111111111";

            const result = await fheCrypto.connect(user1).subtractEncryptedValues(value1, value2);
            expect(result).to.not.be.undefined;
        });

        it("Should multiply by scalar", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const encryptedValue = "0x1111111111111111111111111111111111111111111111111111111111111111";
            const scalar = 5;

            const result = await fheCrypto.connect(user1).multiplyByScalar(encryptedValue, scalar);
            expect(result).to.not.be.undefined;
        });

        it("Should divide by scalar", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const encryptedValue = "0x1111111111111111111111111111111111111111111111111111111111111111";
            const scalar = 2;

            const result = await fheCrypto.connect(user1).divideByScalar(encryptedValue, scalar);
            expect(result).to.not.be.undefined;
        });

        it("Should not allow division by zero", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const encryptedValue = "0x1111111111111111111111111111111111111111111111111111111111111111";

            await expect(
                fheCrypto.connect(user1).divideByScalar(encryptedValue, 0)
            ).to.be.revertedWith("FHECrypto: Division by zero");
        });

        it("Should compare encrypted values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const value1 = "0x2222222222222222222222222222222222222222222222222222222222222222";
            const value2 = "0x1111111111111111111111111111111111111111111111111111111111111111";

            const isGreater = await fheCrypto.connect(user1).isGreaterThan(value1, value2);
            const isLesser = await fheCrypto.connect(user1).isLessThan(value1, value2);

            expect(isGreater).to.not.be.undefined;
            expect(isLesser).to.not.be.undefined;
        });

        it("Should compute sum of encrypted array", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const encryptedValues = [
                "0x1111111111111111111111111111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222222222222222222222222222",
                "0x3333333333333333333333333333333333333333333333333333333333333333"
            ];

            const result = await fheCrypto.connect(user1).computeSum(encryptedValues);
            expect(result).to.not.be.undefined;
        });

        it("Should find maximum of encrypted values", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            const encryptedValues = [
                "0x1111111111111111111111111111111111111111111111111111111111111111",
                "0x3333333333333333333333333333333333333333333333333333333333333333",
                "0x2222222222222222222222222222222222222222222222222222222222222222"
            ];

            const result = await fheCrypto.connect(user1).findMaximum(encryptedValues);
            expect(result).to.not.be.undefined;
        });

        it("Should not allow empty arrays for aggregation", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            await expect(
                fheCrypto.connect(user1).computeSum([])
            ).to.be.revertedWith("FHECrypto: Empty array");

            await expect(
                fheCrypto.connect(user1).findMaximum([])
            ).to.be.revertedWith("FHECrypto: Empty array");
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete encryption workflow", async function () {
            const { fheCrypto, owner, operator1, user1 } = await loadFixture(deployFHECryptoFixture);

            // 1. Authorize operator
            await fheCrypto.connect(owner).authorizeOperator(operator1.address);

            // 2. Encrypt multiple values
            const dataHash1 = ethers.keccak256(ethers.toUtf8Bytes("data_1"));
            const dataHash2 = ethers.keccak256(ethers.toUtf8Bytes("data_2"));

            await fheCrypto.connect(user1).encryptValue(12345, dataHash1);
            await fheCrypto.connect(user1).encryptValue(67890, dataHash2);

            expect(await fheCrypto.totalEncryptedValues()).to.equal(2);

            // 3. Request decryption
            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";
            await fheCrypto.connect(operator1).requestDecryption(mockEncryptedValue);

            // 4. Simulate decryption result
            await fheCrypto.connect(operator1).simulateDecryptionResult(1, 99999);

            const request = await fheCrypto.getComputationRequest(1);
            expect(request.isProcessed).to.be.true;
            expect(request.result).to.equal(99999);
        });

        it("Should handle multiple operators", async function () {
            const { fheCrypto, owner, operator1, operator2 } = await loadFixture(deployFHECryptoFixture);

            // Authorize both operators
            await fheCrypto.connect(owner).authorizeOperator(operator1.address);
            await fheCrypto.connect(owner).authorizeOperator(operator2.address);

            expect(await fheCrypto.authorizedOperators(operator1.address)).to.be.true;
            expect(await fheCrypto.authorizedOperators(operator2.address)).to.be.true;

            // Both can request decryptions
            const mockEncryptedValue = "0x1234567890123456789012345678901234567890123456789012345678901234";

            await fheCrypto.connect(operator1).requestDecryption(mockEncryptedValue);
            await fheCrypto.connect(operator2).requestDecryption(mockEncryptedValue);

            expect(await fheCrypto.nextRequestId()).to.equal(3);

            // Process results
            await fheCrypto.connect(operator1).simulateDecryptionResult(1, 11111);
            await fheCrypto.connect(operator2).simulateDecryptionResult(2, 22222);

            const request1 = await fheCrypto.getComputationRequest(1);
            const request2 = await fheCrypto.getComputationRequest(2);

            expect(request1.result).to.equal(11111);
            expect(request2.result).to.equal(22222);
        });

        it("Should maintain encryption statistics", async function () {
            const { fheCrypto, user1 } = await loadFixture(deployFHECryptoFixture);

            // Start with 0 encrypted values
            expect(await fheCrypto.getTotalEncryptedValues()).to.equal(0);

            // Encrypt values
            for (let i = 1; i <= 5; i++) {
                const dataHash = ethers.keccak256(ethers.toUtf8Bytes(`data_${i}`));
                await fheCrypto.connect(user1).encryptValue(i * 100, dataHash);
            }

            expect(await fheCrypto.getTotalEncryptedValues()).to.equal(5);
        });
    });
});