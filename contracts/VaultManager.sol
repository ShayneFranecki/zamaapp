// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VaultManager
 * @dev Secure token vault for managing campaign rewards and distributions
 * @notice Handles token deposits, releases, and emergency operations for fundraising campaigns
 */
contract VaultManager is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct TokenVault {
        uint256 campaignId;
        address tokenAddress;
        address depositor;
        uint256 totalDeposited;
        uint256 totalReleased;
        uint256 remainingBalance;
        bool isLocked;
        uint256 createdAt;
    }

    mapping(uint256 => TokenVault) public vaults;
    mapping(address => uint256[]) public depositorVaults;
    mapping(address => bool) public authorizedContracts;
    
    uint256 public totalVaults;
    uint256 public constant VAULT_LOCK_DURATION = 30 days;

    event TokensDeposited(
        uint256 indexed campaignId,
        address indexed tokenAddress,
        address indexed depositor,
        uint256 amount
    );

    event TokensReleased(
        uint256 indexed campaignId,
        address indexed recipient,
        uint256 amount
    );

    event TokensReturned(
        uint256 indexed campaignId,
        address indexed depositor,
        uint256 amount
    );

    event VaultLocked(
        uint256 indexed campaignId,
        uint256 lockedAt
    );

    event VaultUnlocked(
        uint256 indexed campaignId,
        uint256 unlockedAt
    );

    event AuthorizedContractAdded(address indexed contractAddress);
    event AuthorizedContractRemoved(address indexed contractAddress);

    modifier onlyAuthorized() {
        require(
            authorizedContracts[msg.sender] || msg.sender == owner(),
            "VaultManager: Not authorized"
        );
        _;
    }

    modifier vaultExists(uint256 _campaignId) {
        require(vaults[_campaignId].campaignId != 0, "VaultManager: Vault not found");
        _;
    }

    modifier vaultNotLocked(uint256 _campaignId) {
        require(!vaults[_campaignId].isLocked, "VaultManager: Vault is locked");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Deposit tokens into campaign vault
     */
    function depositTokens(
        address _tokenAddress,
        address _depositor,
        uint256 _amount,
        uint256 _campaignId
    ) external onlyAuthorized nonReentrant {
        require(_tokenAddress != address(0), "VaultManager: Invalid token");
        require(_depositor != address(0), "VaultManager: Invalid depositor");
        require(_amount > 0, "VaultManager: Invalid amount");
        require(_campaignId > 0, "VaultManager: Invalid campaign ID");
        require(vaults[_campaignId].campaignId == 0, "VaultManager: Vault already exists");

        // Transfer tokens from depositor to this contract
        IERC20(_tokenAddress).safeTransferFrom(_depositor, address(this), _amount);

        // Create vault record
        vaults[_campaignId] = TokenVault({
            campaignId: _campaignId,
            tokenAddress: _tokenAddress,
            depositor: _depositor,
            totalDeposited: _amount,
            totalReleased: 0,
            remainingBalance: _amount,
            isLocked: false,
            createdAt: block.timestamp
        });

        depositorVaults[_depositor].push(_campaignId);
        totalVaults++;

        emit TokensDeposited(_campaignId, _tokenAddress, _depositor, _amount);
    }

    /**
     * @dev Release tokens to recipient
     */
    function releaseTokens(
        address _tokenAddress,
        address _recipient,
        uint256 _amount,
        uint256 _campaignId
    ) external onlyAuthorized nonReentrant vaultExists(_campaignId) {
        TokenVault storage vault = vaults[_campaignId];
        
        require(vault.tokenAddress == _tokenAddress, "VaultManager: Token mismatch");
        require(_recipient != address(0), "VaultManager: Invalid recipient");
        require(_amount > 0, "VaultManager: Invalid amount");
        require(_amount <= vault.remainingBalance, "VaultManager: Insufficient balance");

        vault.totalReleased += _amount;
        vault.remainingBalance -= _amount;

        IERC20(_tokenAddress).safeTransfer(_recipient, _amount);

        emit TokensReleased(_campaignId, _recipient, _amount);
    }

    /**
     * @dev Return tokens to original depositor
     */
    function returnTokens(
        address _tokenAddress,
        address _depositor,
        uint256 _amount,
        uint256 _campaignId
    ) external onlyAuthorized nonReentrant vaultExists(_campaignId) vaultNotLocked(_campaignId) {
        TokenVault storage vault = vaults[_campaignId];
        
        require(vault.tokenAddress == _tokenAddress, "VaultManager: Token mismatch");
        require(vault.depositor == _depositor, "VaultManager: Depositor mismatch");
        require(_amount > 0, "VaultManager: Invalid amount");
        require(_amount <= vault.remainingBalance, "VaultManager: Insufficient balance");

        vault.remainingBalance -= _amount;

        IERC20(_tokenAddress).safeTransfer(_depositor, _amount);

        emit TokensReturned(_campaignId, _depositor, _amount);
    }

    /**
     * @dev Lock vault to prevent token returns
     */
    function lockVault(uint256 _campaignId) 
        external 
        onlyAuthorized 
        vaultExists(_campaignId) 
    {
        TokenVault storage vault = vaults[_campaignId];
        require(!vault.isLocked, "VaultManager: Already locked");
        
        vault.isLocked = true;
        emit VaultLocked(_campaignId, block.timestamp);
    }

    /**
     * @dev Unlock vault (only after lock duration)
     */
    function unlockVault(uint256 _campaignId) 
        external 
        onlyAuthorized 
        vaultExists(_campaignId) 
    {
        TokenVault storage vault = vaults[_campaignId];
        require(vault.isLocked, "VaultManager: Not locked");
        require(
            block.timestamp >= vault.createdAt + VAULT_LOCK_DURATION,
            "VaultManager: Lock period not expired"
        );
        
        vault.isLocked = false;
        emit VaultUnlocked(_campaignId, block.timestamp);
    }

    /**
     * @dev Get vault information
     */
    function getVault(uint256 _campaignId) 
        external 
        view 
        vaultExists(_campaignId)
        returns (
            uint256 campaignId,
            address tokenAddress,
            address depositor,
            uint256 totalDeposited,
            uint256 totalReleased,
            uint256 remainingBalance,
            bool isLocked,
            uint256 createdAt
        ) 
    {
        TokenVault storage vault = vaults[_campaignId];
        return (
            vault.campaignId,
            vault.tokenAddress,
            vault.depositor,
            vault.totalDeposited,
            vault.totalReleased,
            vault.remainingBalance,
            vault.isLocked,
            vault.createdAt
        );
    }

    /**
     * @dev Get depositor's vaults
     */
    function getDepositorVaults(address _depositor) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return depositorVaults[_depositor];
    }

    /**
     * @dev Check vault balance
     */
    function getVaultBalance(uint256 _campaignId) 
        external 
        view 
        vaultExists(_campaignId)
        returns (uint256) 
    {
        return vaults[_campaignId].remainingBalance;
    }

    /**
     * @dev Add authorized contract
     */
    function addAuthorizedContract(address _contract) external onlyOwner {
        require(_contract != address(0), "VaultManager: Invalid contract");
        require(!authorizedContracts[_contract], "VaultManager: Already authorized");
        
        authorizedContracts[_contract] = true;
        emit AuthorizedContractAdded(_contract);
    }

    /**
     * @dev Remove authorized contract
     */
    function removeAuthorizedContract(address _contract) external onlyOwner {
        require(authorizedContracts[_contract], "VaultManager: Not authorized");
        
        authorizedContracts[_contract] = false;
        emit AuthorizedContractRemoved(_contract);
    }

    /**
     * @dev Emergency token recovery (owner only)
     */
    function emergencyTokenRecovery(
        address _tokenAddress,
        address _recipient,
        uint256 _amount
    ) external onlyOwner {
        require(_tokenAddress != address(0), "VaultManager: Invalid token");
        require(_recipient != address(0), "VaultManager: Invalid recipient");
        require(_amount > 0, "VaultManager: Invalid amount");
        
        IERC20(_tokenAddress).safeTransfer(_recipient, _amount);
    }

    /**
     * @dev Force vault unlock (emergency only)
     */
    function emergencyUnlockVault(uint256 _campaignId) 
        external 
        onlyOwner 
        vaultExists(_campaignId) 
    {
        vaults[_campaignId].isLocked = false;
        emit VaultUnlocked(_campaignId, block.timestamp);
    }
}