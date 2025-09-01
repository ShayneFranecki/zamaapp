// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@fhevm/solidity/lib/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FHECrypto
 * @dev Utility contract for Fully Homomorphic Encryption operations
 * @notice Provides FHE encryption, decryption, and computation utilities for private DeFi operations
 */
contract FHECrypto is Ownable {

    struct EncryptedData {
        euint64 value;
        uint256 timestamp;
        address owner;
        bool isValid;
    }

    struct ComputationRequest {
        uint256 requestId;
        address requester;
        uint256 timestamp;
        bool isProcessed;
        uint64 result;
    }

    mapping(bytes32 => EncryptedData) public encryptedStorage;
    mapping(uint256 => ComputationRequest) public computationRequests;
    mapping(address => bool) public authorizedOperators;
    
    uint256 public nextRequestId = 1;
    uint256 public totalEncryptedValues;

    event ValueEncrypted(
        bytes32 indexed dataHash,
        address indexed owner,
        uint256 timestamp
    );

    event ComputationRequested(
        uint256 indexed requestId,
        address indexed requester,
        uint256 timestamp
    );

    event ComputationCompleted(
        uint256 indexed requestId,
        uint64 result,
        uint256 timestamp
    );

    event OperatorAuthorized(address indexed operator);
    event OperatorDeauthorized(address indexed operator);

    modifier onlyAuthorizedOperator() {
        require(
            authorizedOperators[msg.sender] || msg.sender == owner(),
            "FHECrypto: Not authorized operator"
        );
        _;
    }

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Encrypt a value and store it
     */
    function encryptValue(
        uint64 _value,
        bytes32 _dataHash
    ) external returns (euint64) {
        require(_dataHash != bytes32(0), "FHECrypto: Invalid hash");
        require(!encryptedStorage[_dataHash].isValid, "FHECrypto: Data already exists");

        euint64 encryptedValue = FHE.asEuint64(_value);
        FHE.allowThis(encryptedValue);

        encryptedStorage[_dataHash] = EncryptedData({
            value: encryptedValue,
            timestamp: block.timestamp,
            owner: msg.sender,
            isValid: true
        });

        totalEncryptedValues++;

        emit ValueEncrypted(_dataHash, msg.sender, block.timestamp);
        return encryptedValue;
    }

    /**
     * @dev Verify encrypted amount matches expected value
     */
    function verifyEncryptedAmount(
        euint64 _encryptedAmount,
        uint64 _expectedAmount
    ) external view returns (bool) {
        ebool isEqual = FHE.eq(_encryptedAmount, FHE.asEuint64(_expectedAmount));
        return FHE.decrypt(isEqual);
    }

    /**
     * @dev Add two encrypted values
     */
    function addEncryptedValues(
        euint64 _value1,
        euint64 _value2
    ) external pure returns (euint64) {
        return FHE.add(_value1, _value2);
    }

    /**
     * @dev Subtract encrypted values
     */
    function subtractEncryptedValues(
        euint64 _value1,
        euint64 _value2
    ) external pure returns (euint64) {
        return FHE.sub(_value1, _value2);
    }

    /**
     * @dev Compare encrypted values (greater than)
     */
    function isGreaterThan(
        euint64 _value1,
        euint64 _value2
    ) external view returns (bool) {
        ebool result = FHE.gt(_value1, _value2);
        return FHE.decrypt(result);
    }

    /**
     * @dev Compare encrypted values (less than)
     */
    function isLessThan(
        euint64 _value1,
        euint64 _value2
    ) external view returns (bool) {
        ebool result = FHE.lt(_value1, _value2);
        return FHE.decrypt(result);
    }

    /**
     * @dev Multiply encrypted value by plaintext scalar
     */
    function multiplyByScalar(
        euint64 _encryptedValue,
        uint64 _scalar
    ) external pure returns (euint64) {
        return FHE.mul(_encryptedValue, FHE.asEuint64(_scalar));
    }

    /**
     * @dev Divide encrypted value by plaintext scalar
     */
    function divideByScalar(
        euint64 _encryptedValue,
        uint64 _scalar
    ) external pure returns (euint64) {
        require(_scalar > 0, "FHECrypto: Division by zero");
        return FHE.div(_encryptedValue, FHE.asEuint64(_scalar));
    }

    /**
     * @dev Create a range proof for encrypted value
     */
    function createRangeProof(
        euint64 _value,
        uint64 _minValue,
        uint64 _maxValue
    ) external view returns (bool) {
        ebool aboveMin = FHE.gte(_value, FHE.asEuint64(_minValue));
        ebool belowMax = FHE.lte(_value, FHE.asEuint64(_maxValue));
        ebool inRange = FHE.and(aboveMin, belowMax);
        return FHE.decrypt(inRange);
    }

    /**
     * @dev Verify zero-knowledge proof of encrypted value
     */
    function verifyZKProof(
        euint64 _encryptedValue,
        bytes calldata _proof
    ) external pure returns (bool) {
        // Simplified ZK proof verification
        // In production, this would use actual ZK proof verification
        return _proof.length > 0 && FHE.decrypt(FHE.ne(_encryptedValue, FHE.asEuint64(0)));
    }

    /**
     * @dev Request decryption of encrypted value
     */
    function requestDecryption(
        euint64 _encryptedValue
    ) external onlyAuthorizedOperator returns (uint256) {
        uint256 requestId = nextRequestId++;
        
        computationRequests[requestId] = ComputationRequest({
            requestId: requestId,
            requester: msg.sender,
            timestamp: block.timestamp,
            isProcessed: false,
            result: 0
        });

        // In real implementation, this would trigger oracle decryption
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(_encryptedValue);
        
        emit ComputationRequested(requestId, msg.sender, block.timestamp);
        return requestId;
    }

    /**
     * @dev Simulate decryption result (for testing)
     */
    function simulateDecryptionResult(
        uint256 _requestId,
        uint64 _result
    ) external onlyAuthorizedOperator {
        require(computationRequests[_requestId].requestId != 0, "FHECrypto: Invalid request");
        require(!computationRequests[_requestId].isProcessed, "FHECrypto: Already processed");

        computationRequests[_requestId].result = _result;
        computationRequests[_requestId].isProcessed = true;

        emit ComputationCompleted(_requestId, _result, block.timestamp);
    }

    /**
     * @dev Get stored encrypted data
     */
    function getEncryptedData(bytes32 _dataHash) 
        external 
        view 
        returns (
            address owner,
            uint256 timestamp,
            bool isValid
        ) 
    {
        EncryptedData storage data = encryptedStorage[_dataHash];
        return (data.owner, data.timestamp, data.isValid);
    }

    /**
     * @dev Get computation request details
     */
    function getComputationRequest(uint256 _requestId)
        external
        view
        returns (
            address requester,
            uint256 timestamp,
            bool isProcessed,
            uint64 result
        )
    {
        ComputationRequest storage request = computationRequests[_requestId];
        return (
            request.requester,
            request.timestamp,
            request.isProcessed,
            request.result
        );
    }

    /**
     * @dev Authorize operator for FHE operations
     */
    function authorizeOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "FHECrypto: Invalid operator");
        require(!authorizedOperators[_operator], "FHECrypto: Already authorized");
        
        authorizedOperators[_operator] = true;
        emit OperatorAuthorized(_operator);
    }

    /**
     * @dev Deauthorize operator
     */
    function deauthorizeOperator(address _operator) external onlyOwner {
        require(authorizedOperators[_operator], "FHECrypto: Not authorized");
        
        authorizedOperators[_operator] = false;
        emit OperatorDeauthorized(_operator);
    }

    /**
     * @dev Batch encrypt multiple values
     */
    function batchEncrypt(
        uint64[] calldata _values
    ) external returns (euint64[] memory) {
        require(_values.length > 0, "FHECrypto: Empty array");
        require(_values.length <= 100, "FHECrypto: Too many values");

        euint64[] memory encryptedValues = new euint64[](_values.length);
        
        for (uint256 i = 0; i < _values.length; i++) {
            euint64 encrypted = FHE.asEuint64(_values[i]);
            FHE.allowThis(encrypted);
            encryptedValues[i] = encrypted;
        }

        return encryptedValues;
    }

    /**
     * @dev Compute homomorphic sum of encrypted array
     */
    function computeSum(
        euint64[] calldata _encryptedValues
    ) external pure returns (euint64) {
        require(_encryptedValues.length > 0, "FHECrypto: Empty array");

        euint64 sum = _encryptedValues[0];
        for (uint256 i = 1; i < _encryptedValues.length; i++) {
            sum = FHE.add(sum, _encryptedValues[i]);
        }

        return sum;
    }

    /**
     * @dev Find maximum of encrypted values
     */
    function findMaximum(
        euint64[] calldata _encryptedValues
    ) external pure returns (euint64) {
        require(_encryptedValues.length > 0, "FHECrypto: Empty array");

        euint64 maximum = _encryptedValues[0];
        for (uint256 i = 1; i < _encryptedValues.length; i++) {
            ebool isGreater = FHE.gt(_encryptedValues[i], maximum);
            maximum = FHE.select(isGreater, _encryptedValues[i], maximum);
        }

        return maximum;
    }

    /**
     * @dev Get total number of encrypted values stored
     */
    function getTotalEncryptedValues() external view returns (uint256) {
        return totalEncryptedValues;
    }
}