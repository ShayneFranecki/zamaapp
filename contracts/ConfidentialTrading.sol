// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./FHECrypto.sol";

/**
 * @title ConfidentialTrading  
 * @dev Privacy-preserving decentralized exchange using FHE
 * @notice Enables anonymous trading with encrypted order amounts and hidden balances
 */
contract ConfidentialTrading is SepoliaConfig, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    enum OrderType { Buy, Sell }
    enum OrderStatus { Active, PartiallyFilled, Filled, Cancelled }

    struct TradingOrder {
        uint256 orderId;
        address trader;
        address baseToken;
        address quoteToken;
        OrderType orderType;
        OrderStatus status;
        uint256 createdAt;
        uint256 expiresAt;
        // Encrypted amounts
        euint64 encryptedAmount;
        euint64 encryptedPrice;
        euint64 encryptedFilled;
        // Public amounts (for verification only)
        uint256 actualAmount;
        uint256 actualPrice;
        uint256 filledAmount;
        bool isActive;
    }

    struct TraderBalance {
        mapping(address => euint64) encryptedBalances;
        mapping(address => uint256) lockedBalances;
        uint256 totalDeposits;
        uint256 totalWithdrawals;
        uint256 lastUpdateTime;
    }

    mapping(uint256 => TradingOrder) public orders;
    mapping(address => TraderBalance) public traderBalances;
    mapping(address => uint256[]) public traderOrders;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public tokenPrecisions;
    
    FHECrypto public immutable fheCrypto;
    
    uint256 public nextOrderId = 1;
    uint256 public tradingFeeRate = 30; // 0.3%
    uint256 public constant MAX_TRADING_FEE = 100; // 1.0%
    uint256 public constant ORDER_DURATION = 7 days;
    
    address public feeCollector;
    address[] public activeTradingPairs;

    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        address indexed baseToken,
        address quoteToken,
        OrderType orderType,
        uint256 createdAt
    );

    event OrderMatched(
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        address indexed trader,
        uint256 matchedAt
    );

    event OrderCancelled(
        uint256 indexed orderId,
        address indexed trader,
        uint256 cancelledAt
    );

    event TokensDeposited(
        address indexed trader,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    event TokensWithdrawn(
        address indexed trader,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    event TradingPairAdded(
        address indexed baseToken,
        address indexed quoteToken
    );

    modifier onlyValidToken(address _token) {
        require(supportedTokens[_token], "ConfidentialTrading: Token not supported");
        _;
    }

    modifier orderExists(uint256 _orderId) {
        require(orders[_orderId].orderId != 0, "ConfidentialTrading: Order not found");
        _;
    }

    modifier onlyOrderOwner(uint256 _orderId) {
        require(orders[_orderId].trader == msg.sender, "ConfidentialTrading: Not order owner");
        _;
    }

    constructor(
        address _feeCollector,
        address _fheCrypto
    ) Ownable(msg.sender) {
        require(_feeCollector != address(0), "ConfidentialTrading: Invalid fee collector");
        require(_fheCrypto != address(0), "ConfidentialTrading: Invalid FHE crypto");
        
        feeCollector = _feeCollector;
        fheCrypto = FHECrypto(_fheCrypto);
    }

    /**
     * @dev Deposit tokens for trading
     */
    function depositTokens(
        address _token,
        uint256 _amount
    ) external nonReentrant onlyValidToken(_token) {
        require(_amount > 0, "ConfidentialTrading: Invalid amount");

        // Transfer tokens to contract
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        // Encrypt the deposited amount
        euint64 encryptedAmount = FHE.asEuint64(_amount);
        FHE.allowThis(encryptedAmount);

        // Update trader's encrypted balance
        TraderBalance storage balance = traderBalances[msg.sender];
        if (FHE.decrypt(FHE.eq(balance.encryptedBalances[_token], FHE.asEuint64(0)))) {
            balance.encryptedBalances[_token] = encryptedAmount;
        } else {
            balance.encryptedBalances[_token] = FHE.add(balance.encryptedBalances[_token], encryptedAmount);
        }
        
        balance.totalDeposits += _amount;
        balance.lastUpdateTime = block.timestamp;
        
        emit TokensDeposited(msg.sender, _token, _amount, block.timestamp);
    }

    /**
     * @dev Withdraw tokens from trading balance
     */
    function withdrawTokens(
        address _token,
        uint256 _amount
    ) external nonReentrant onlyValidToken(_token) {
        require(_amount > 0, "ConfidentialTrading: Invalid amount");

        TraderBalance storage balance = traderBalances[msg.sender];
        
        // Check if withdrawal amount is available
        euint64 encryptedAmount = FHE.asEuint64(_amount);
        euint64 lockedAmount = FHE.asEuint64(balance.lockedBalances[_token]);
        euint64 availableBalance = FHE.sub(balance.encryptedBalances[_token], lockedAmount);
        
        ebool canWithdraw = FHE.gte(availableBalance, encryptedAmount);
        require(FHE.decrypt(canWithdraw), "ConfidentialTrading: Insufficient balance");

        // Update encrypted balance
        balance.encryptedBalances[_token] = FHE.sub(balance.encryptedBalances[_token], encryptedAmount);
        balance.totalWithdrawals += _amount;
        balance.lastUpdateTime = block.timestamp;

        // Transfer tokens to trader
        IERC20(_token).safeTransfer(msg.sender, _amount);

        emit TokensWithdrawn(msg.sender, _token, _amount, block.timestamp);
    }

    /**
     * @dev Place a confidential trading order
     */
    function placeOrder(
        address _baseToken,
        address _quoteToken,
        OrderType _orderType,
        inEuint64 calldata _encryptedAmount,
        inEuint64 calldata _encryptedPrice,
        bytes calldata _amountProof,
        bytes calldata _priceProof,
        uint256 _actualAmount,
        uint256 _actualPrice
    ) external nonReentrant onlyValidToken(_baseToken) onlyValidToken(_quoteToken) {
        require(_baseToken != _quoteToken, "ConfidentialTrading: Same token pair");
        require(_actualAmount > 0, "ConfidentialTrading: Invalid amount");
        require(_actualPrice > 0, "ConfidentialTrading: Invalid price");

        // Process encrypted inputs
        euint64 orderAmount = FHE.fromExternal(_encryptedAmount, _amountProof);
        euint64 orderPrice = FHE.fromExternal(_encryptedPrice, _priceProof);

        // Verify encrypted values match actual values
        ebool amountMatches = FHE.eq(orderAmount, FHE.asEuint64(_actualAmount));
        ebool priceMatches = FHE.eq(orderPrice, FHE.asEuint64(_actualPrice));
        require(FHE.decrypt(amountMatches), "ConfidentialTrading: Amount mismatch");
        require(FHE.decrypt(priceMatches), "ConfidentialTrading: Price mismatch");

        // Determine required token and amount for locking
        address tokenToLock;
        uint256 amountToLock;
        
        if (_orderType == OrderType.Buy) {
            tokenToLock = _quoteToken;
            amountToLock = (_actualAmount * _actualPrice) / (10 ** tokenPrecisions[_baseToken]);
        } else {
            tokenToLock = _baseToken;
            amountToLock = _actualAmount;
        }

        // Check and lock required balance
        _lockBalance(msg.sender, tokenToLock, amountToLock);

        uint256 orderId = nextOrderId++;
        uint256 expiresAt = block.timestamp + ORDER_DURATION;

        orders[orderId] = TradingOrder({
            orderId: orderId,
            trader: msg.sender,
            baseToken: _baseToken,
            quoteToken: _quoteToken,
            orderType: _orderType,
            status: OrderStatus.Active,
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            encryptedAmount: orderAmount,
            encryptedPrice: orderPrice,
            encryptedFilled: FHE.asEuint64(0),
            actualAmount: _actualAmount,
            actualPrice: _actualPrice,
            filledAmount: 0,
            isActive: true
        });

        FHE.allowThis(orders[orderId].encryptedFilled);
        traderOrders[msg.sender].push(orderId);

        emit OrderPlaced(
            orderId,
            msg.sender,
            _baseToken,
            _quoteToken,
            _orderType,
            block.timestamp
        );

        // Attempt to match order immediately
        _attemptOrderMatching(orderId);
    }

    /**
     * @dev Cancel an active order
     */
    function cancelOrder(uint256 _orderId) 
        external 
        nonReentrant 
        orderExists(_orderId) 
        onlyOrderOwner(_orderId) 
    {
        TradingOrder storage order = orders[_orderId];
        require(order.status == OrderStatus.Active, "ConfidentialTrading: Order not active");

        order.status = OrderStatus.Cancelled;
        order.isActive = false;

        // Unlock locked balance
        address tokenToUnlock;
        uint256 unfilledAmount;
        
        if (order.orderType == OrderType.Buy) {
            tokenToUnlock = order.quoteToken;
            unfilledAmount = ((order.actualAmount - order.filledAmount) * order.actualPrice) / 
                           (10 ** tokenPrecisions[order.baseToken]);
        } else {
            tokenToUnlock = order.baseToken;
            unfilledAmount = order.actualAmount - order.filledAmount;
        }

        _unlockBalance(msg.sender, tokenToUnlock, unfilledAmount);

        emit OrderCancelled(_orderId, msg.sender, block.timestamp);
    }

    /**
     * @dev Attempt to match orders (simplified matching algorithm)
     */
    function _attemptOrderMatching(uint256 _newOrderId) internal {
        TradingOrder storage newOrder = orders[_newOrderId];
        
        // Find matching orders (opposite type, same pair)
        for (uint256 i = 1; i < nextOrderId; i++) {
            if (i == _newOrderId) continue;
            
            TradingOrder storage existingOrder = orders[i];
            
            if (_canMatch(newOrder, existingOrder)) {
                _executeMatch(_newOrderId, i);
                if (newOrder.status == OrderStatus.Filled) {
                    break;
                }
            }
        }
    }

    /**
     * @dev Check if two orders can be matched
     */
    function _canMatch(
        TradingOrder storage _order1,
        TradingOrder storage _order2
    ) internal view returns (bool) {
        if (!_order1.isActive || !_order2.isActive) return false;
        if (_order1.baseToken != _order2.baseToken) return false;
        if (_order1.quoteToken != _order2.quoteToken) return false;
        if (_order1.orderType == _order2.orderType) return false;
        if (block.timestamp > _order1.expiresAt || block.timestamp > _order2.expiresAt) return false;

        // Price matching logic (buy price >= sell price)
        if (_order1.orderType == OrderType.Buy) {
            return _order1.actualPrice >= _order2.actualPrice;
        } else {
            return _order2.actualPrice >= _order1.actualPrice;
        }
    }

    /**
     * @dev Execute order matching
     */
    function _executeMatch(uint256 _buyOrderId, uint256 _sellOrderId) internal {
        TradingOrder storage buyOrder = orders[_buyOrderId];
        TradingOrder storage sellOrder = orders[_sellOrderId];

        // Determine match amount (minimum of unfilled amounts)
        uint256 buyUnfilled = buyOrder.actualAmount - buyOrder.filledAmount;
        uint256 sellUnfilled = sellOrder.actualAmount - sellOrder.filledAmount;
        uint256 matchAmount = buyUnfilled < sellUnfilled ? buyUnfilled : sellUnfilled;

        // Execute trade at sell price
        uint256 tradePrice = sellOrder.actualPrice;
        uint256 totalValue = (matchAmount * tradePrice) / (10 ** tokenPrecisions[buyOrder.baseToken]);

        // Calculate trading fees
        uint256 fee = (totalValue * tradingFeeRate) / 10000;
        uint256 netValue = totalValue - fee;

        // Update order filled amounts
        buyOrder.filledAmount += matchAmount;
        sellOrder.filledAmount += matchAmount;

        // Update encrypted filled amounts
        euint64 encryptedMatchAmount = FHE.asEuint64(matchAmount);
        buyOrder.encryptedFilled = FHE.add(buyOrder.encryptedFilled, encryptedMatchAmount);
        sellOrder.encryptedFilled = FHE.add(sellOrder.encryptedFilled, encryptedMatchAmount);

        // Update order statuses
        if (buyOrder.filledAmount == buyOrder.actualAmount) {
            buyOrder.status = OrderStatus.Filled;
            buyOrder.isActive = false;
        } else {
            buyOrder.status = OrderStatus.PartiallyFilled;
        }

        if (sellOrder.filledAmount == sellOrder.actualAmount) {
            sellOrder.status = OrderStatus.Filled;
            sellOrder.isActive = false;
        } else {
            sellOrder.status = OrderStatus.PartiallyFilled;
        }

        // Execute token transfers
        _executeTokenTransfer(buyOrder.trader, sellOrder.trader, buyOrder.baseToken, matchAmount);
        _executeTokenTransfer(sellOrder.trader, buyOrder.trader, buyOrder.quoteToken, netValue);
        
        // Transfer fee to fee collector
        if (fee > 0) {
            _unlockBalance(buyOrder.trader, buyOrder.quoteToken, fee);
            IERC20(buyOrder.quoteToken).safeTransfer(feeCollector, fee);
        }

        emit OrderMatched(_buyOrderId, _sellOrderId, buyOrder.trader, block.timestamp);
    }

    /**
     * @dev Execute token transfer between traders
     */
    function _executeTokenTransfer(
        address _from,
        address _to,
        address _token,
        uint256 _amount
    ) internal {
        // Unlock from sender's balance
        _unlockBalance(_from, _token, _amount);
        
        // Subtract from sender's encrypted balance
        euint64 encryptedAmount = FHE.asEuint64(_amount);
        traderBalances[_from].encryptedBalances[_token] = 
            FHE.sub(traderBalances[_from].encryptedBalances[_token], encryptedAmount);

        // Add to receiver's encrypted balance
        if (FHE.decrypt(FHE.eq(traderBalances[_to].encryptedBalances[_token], FHE.asEuint64(0)))) {
            traderBalances[_to].encryptedBalances[_token] = encryptedAmount;
        } else {
            traderBalances[_to].encryptedBalances[_token] = 
                FHE.add(traderBalances[_to].encryptedBalances[_token], encryptedAmount);
        }
    }

    /**
     * @dev Lock balance for order
     */
    function _lockBalance(address _trader, address _token, uint256 _amount) internal {
        TraderBalance storage balance = traderBalances[_trader];
        
        // Check available balance
        euint64 lockedAmount = FHE.asEuint64(balance.lockedBalances[_token]);
        euint64 availableBalance = FHE.sub(balance.encryptedBalances[_token], lockedAmount);
        euint64 requiredAmount = FHE.asEuint64(_amount);
        
        ebool canLock = FHE.gte(availableBalance, requiredAmount);
        require(FHE.decrypt(canLock), "ConfidentialTrading: Insufficient balance to lock");

        balance.lockedBalances[_token] += _amount;
    }

    /**
     * @dev Unlock balance after order completion/cancellation
     */
    function _unlockBalance(address _trader, address _token, uint256 _amount) internal {
        TraderBalance storage balance = traderBalances[_trader];
        require(balance.lockedBalances[_token] >= _amount, "ConfidentialTrading: Insufficient locked balance");
        
        balance.lockedBalances[_token] -= _amount;
    }

    /**
     * @dev Add supported trading token
     */
    function addSupportedToken(address _token, uint256 _precision) external onlyOwner {
        require(_token != address(0), "ConfidentialTrading: Invalid token");
        require(!supportedTokens[_token], "ConfidentialTrading: Already supported");
        
        supportedTokens[_token] = true;
        tokenPrecisions[_token] = _precision;
    }

    /**
     * @dev Remove supported trading token
     */
    function removeSupportedToken(address _token) external onlyOwner {
        require(supportedTokens[_token], "ConfidentialTrading: Not supported");
        
        supportedTokens[_token] = false;
        delete tokenPrecisions[_token];
    }

    /**
     * @dev Get order details
     */
    function getOrder(uint256 _orderId) 
        external 
        view 
        orderExists(_orderId)
        returns (
            address trader,
            address baseToken,
            address quoteToken,
            OrderType orderType,
            OrderStatus status,
            uint256 createdAt,
            uint256 expiresAt,
            uint256 actualAmount,
            uint256 actualPrice,
            uint256 filledAmount,
            bool isActive
        )
    {
        TradingOrder storage order = orders[_orderId];
        return (
            order.trader,
            order.baseToken,
            order.quoteToken,
            order.orderType,
            order.status,
            order.createdAt,
            order.expiresAt,
            order.actualAmount,
            order.actualPrice,
            order.filledAmount,
            order.isActive
        );
    }

    /**
     * @dev Get trader's orders
     */
    function getTraderOrders(address _trader) external view returns (uint256[] memory) {
        return traderOrders[_trader];
    }

    /**
     * @dev Get active orders
     */
    function getActiveOrders() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].isActive) count++;
        }

        uint256[] memory activeOrders = new uint256[](count);
        uint256 index = 0;

        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].isActive) {
                activeOrders[index] = i;
                index++;
            }
        }

        return activeOrders;
    }

    /**
     * @dev Update trading fee rate
     */
    function updateTradingFeeRate(uint256 _newRate) external onlyOwner {
        require(_newRate <= MAX_TRADING_FEE, "ConfidentialTrading: Fee too high");
        tradingFeeRate = _newRate;
    }

    /**
     * @dev Update fee collector
     */
    function updateFeeCollector(address _newCollector) external onlyOwner {
        require(_newCollector != address(0), "ConfidentialTrading: Invalid collector");
        feeCollector = _newCollector;
    }
}