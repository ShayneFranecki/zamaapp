// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestToken
 * @dev Simple ERC20 token for testing confidential trading platform
 * @notice This token is only for testing purposes in development environment
 */
contract TestToken is ERC20, Ownable {
    uint8 private _tokenDecimals;
    uint256 public constant MAX_SUPPLY = 1000000000 * 10**18; // 1 billion tokens
    
    mapping(address => bool) public minters;
    
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event TokensMinted(address indexed to, uint256 amount);

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "TestToken: Not authorized minter");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _initialSupply
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(_decimals <= 18, "TestToken: Decimals too high");
        require(_initialSupply <= MAX_SUPPLY, "TestToken: Initial supply too high");
        
        _tokenDecimals = _decimals;
        
        if (_initialSupply > 0) {
            _mint(msg.sender, _initialSupply);
        }
    }

    /**
     * @dev Returns the number of decimals used to get its user representation
     */
    function decimals() public view virtual override returns (uint8) {
        return _tokenDecimals;
    }

    /**
     * @dev Mint tokens to specified address
     */
    function mint(address _to, uint256 _amount) external onlyMinter {
        require(_to != address(0), "TestToken: Cannot mint to zero address");
        require(_amount > 0, "TestToken: Amount must be positive");
        require(totalSupply() + _amount <= MAX_SUPPLY, "TestToken: Exceeds max supply");
        
        _mint(_to, _amount);
        emit TokensMinted(_to, _amount);
    }

    /**
     * @dev Batch mint tokens to multiple addresses
     */
    function batchMint(
        address[] calldata _recipients,
        uint256[] calldata _amounts
    ) external onlyMinter {
        require(_recipients.length == _amounts.length, "TestToken: Arrays length mismatch");
        require(_recipients.length > 0, "TestToken: Empty arrays");
        require(_recipients.length <= 100, "TestToken: Too many recipients");

        uint256 totalMintAmount = 0;
        for (uint256 i = 0; i < _amounts.length; i++) {
            totalMintAmount += _amounts[i];
        }
        
        require(totalSupply() + totalMintAmount <= MAX_SUPPLY, "TestToken: Exceeds max supply");

        for (uint256 i = 0; i < _recipients.length; i++) {
            require(_recipients[i] != address(0), "TestToken: Cannot mint to zero address");
            require(_amounts[i] > 0, "TestToken: Amount must be positive");
            
            _mint(_recipients[i], _amounts[i]);
            emit TokensMinted(_recipients[i], _amounts[i]);
        }
    }

    /**
     * @dev Add authorized minter
     */
    function addMinter(address _minter) external onlyOwner {
        require(_minter != address(0), "TestToken: Invalid minter address");
        require(!minters[_minter], "TestToken: Already a minter");
        
        minters[_minter] = true;
        emit MinterAdded(_minter);
    }

    /**
     * @dev Remove authorized minter
     */
    function removeMinter(address _minter) external onlyOwner {
        require(minters[_minter], "TestToken: Not a minter");
        
        minters[_minter] = false;
        emit MinterRemoved(_minter);
    }

    /**
     * @dev Burn tokens from caller's balance
     */
    function burn(uint256 _amount) external {
        require(_amount > 0, "TestToken: Amount must be positive");
        require(balanceOf(msg.sender) >= _amount, "TestToken: Insufficient balance");
        
        _burn(msg.sender, _amount);
    }

    /**
     * @dev Burn tokens from specified address (with allowance)
     */
    function burnFrom(address _from, uint256 _amount) external {
        require(_amount > 0, "TestToken: Amount must be positive");
        require(balanceOf(_from) >= _amount, "TestToken: Insufficient balance");
        
        uint256 currentAllowance = allowance(_from, msg.sender);
        require(currentAllowance >= _amount, "TestToken: Burn amount exceeds allowance");
        
        _approve(_from, msg.sender, currentAllowance - _amount);
        _burn(_from, _amount);
    }

    /**
     * @dev Airdrop tokens to multiple addresses
     */
    function airdrop(
        address[] calldata _recipients,
        uint256 _amountPerRecipient
    ) external onlyOwner {
        require(_recipients.length > 0, "TestToken: Empty recipients");
        require(_recipients.length <= 1000, "TestToken: Too many recipients");
        require(_amountPerRecipient > 0, "TestToken: Amount must be positive");
        
        uint256 totalAmount = _recipients.length * _amountPerRecipient;
        require(totalSupply() + totalAmount <= MAX_SUPPLY, "TestToken: Exceeds max supply");

        for (uint256 i = 0; i < _recipients.length; i++) {
            require(_recipients[i] != address(0), "TestToken: Invalid recipient");
            _mint(_recipients[i], _amountPerRecipient);
        }
    }

    /**
     * @dev Emergency pause functionality (override transfer)
     */
    bool public paused = false;
    
    event Paused();
    event Unpaused();

    modifier whenNotPaused() {
        require(!paused, "TestToken: Token transfers paused");
        _;
    }

    function pause() external onlyOwner {
        require(!paused, "TestToken: Already paused");
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        require(paused, "TestToken: Not paused");
        paused = false;
        emit Unpaused();
    }

    /**
     * @dev Override transfer to add pause functionality
     */
    function transfer(address to, uint256 amount) public virtual override whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    /**
     * @dev Override transferFrom to add pause functionality
     */
    function transferFrom(address from, address to, uint256 amount) public virtual override whenNotPaused returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    /**
     * @dev Get token info
     */
    function getTokenInfo() external view returns (
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals,
        uint256 tokenTotalSupply,
        uint256 maxSupply,
        bool isPaused
    ) {
        return (
            name(),
            symbol(),
            decimals(),
            totalSupply(),
            MAX_SUPPLY,
            paused
        );
    }

    /**
     * @dev Check if address is authorized minter
     */
    function isMinter(address _address) external view returns (bool) {
        return minters[_address];
    }

    /**
     * @dev Get remaining mintable supply
     */
    function getRemainingMintableSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}