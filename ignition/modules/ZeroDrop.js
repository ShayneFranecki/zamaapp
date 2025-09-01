const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ZeroDropModule", (m) => {
  // Parameters with default values
  const feeCollector = m.getParameter("feeCollector", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  const initialTokenSupply = m.getParameter("initialTokenSupply", "1000000000000000000000000"); // 1M tokens

  // Deploy FHECrypto utility contract first
  const fheCrypto = m.contract("FHECrypto", []);

  // Deploy VaultManager contract
  const vaultManager = m.contract("VaultManager", []);

  // Deploy TestToken for testing
  const testToken = m.contract("TestToken", [
    "ZeroDrop Test Token",
    "ZTEST",
    18,
    initialTokenSupply
  ]);

  // Deploy main SecretFundraiser contract
  const secretFundraiser = m.contract("SecretFundraiser", [
    feeCollector,
    vaultManager,
    fheCrypto
  ]);

  // Deploy ConfidentialTrading contract
  const confidentialTrading = m.contract("ConfidentialTrading", [
    feeCollector,
    fheCrypto
  ]);

  // Post-deployment setup calls
  m.call(vaultManager, "addAuthorizedContract", [secretFundraiser]);
  m.call(fheCrypto, "authorizeOperator", [secretFundraiser]);
  m.call(fheCrypto, "authorizeOperator", [confidentialTrading]);
  
  // Setup test token for trading
  m.call(confidentialTrading, "addSupportedToken", [testToken, 18]);
  m.call(testToken, "addMinter", [secretFundraiser]);

  return {
    fheCrypto,
    vaultManager,
    testToken,
    secretFundraiser,
    confidentialTrading
  };
});