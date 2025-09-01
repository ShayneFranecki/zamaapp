// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./VaultManager.sol";
import "./FHECrypto.sol";

/**
 * @title SecretFundraiser
 * @dev Privacy-first fundraising platform using Zama FHE for hidden contribution amounts
 * @notice Enables completely anonymous participation in token sales and fundraising campaigns
 */
contract SecretFundraiser is SepoliaConfig, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Campaign lifecycle states
    enum CampaignState { 
        Draft,        // Campaign created but not launched
        Live,         // Active and accepting contributions
        Processing,   // Computing encrypted totals
        Successful,   // Target reached, tokens distributed
        Failed,       // Target not reached, refunds available
        Completed     // All operations finished
    }

    // Decryption process states
    enum ComputationState {
        Idle,
        Computing,
        Finished
    }

    struct Campaign {
        uint256 campaignId;
        address creator;
        address rewardToken;
        uint256 tokenSupply;
        uint256 fundingGoal;
        uint256 pricePerToken;
        uint32 launchTime;
        uint32 closingTime;
        uint256 minimumBid;
        uint256 maximumBid;
        bool isLive;
        CampaignState currentState;
        string infoHash;
        // Encrypted aggregate contributions
        euint64 hiddenTotalRaised;
        // Revealed total after computation
        uint64 revealedTotalRaised;
        ComputationState computeState;
    }

    struct SecretContribution {
        address contributor;
        uint256 campaignId;
        uint32 blockTimestamp;
        // Hidden contribution amount
        euint64 hiddenAmount;
        // Actual ETH value for verification
        uint256 actualValue;
        bool rewardsClaimed;
        bool fundsReclaimed;
    }

    VaultManager public immutable vaultManager;
    FHECrypto public immutable fheCrypto;

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => SecretContribution[]) public campaignContributions;
    mapping(address => uint256[]) public userCampaigns;
    mapping(uint256 => mapping(address => bool)) public hasContributed;
    mapping(uint256 => mapping(address => uint256)) public totalContributed;
    
    uint32 public nextCampaignId = 1;
    uint16 public serviceFeeRate = 200; // 2.0%
    uint16 public constant MAX_SERVICE_FEE = 500; // 5.0%
    
    address public feeCollector;

    event CampaignLaunched(
        uint256 indexed campaignId,
        address indexed creator,
        address rewardToken,
        uint256 fundingGoal,
        uint256 pricePerToken
    );

    event SecretContributionReceived(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 blockTimestamp
    );

    event ComputationStarted(
        uint256 indexed campaignId,
        uint256 requestId
    );

    event CampaignSucceeded(
        uint256 indexed campaignId,
        uint64 totalRaised,
        uint256 blockTimestamp
    );

    event RewardsClaimed(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 tokenAmount
    );

    event CampaignStateChanged(
        uint256 indexed campaignId,
        CampaignState newState
    );

    event FundsReclaimed(
        uint256 indexed campaignId,
        address indexed contributor,
        uint256 amount
    );

    modifier onlyCampaignCreator(uint256 _campaignId) {
        require(
            campaigns[_campaignId].creator == msg.sender,
            "SecretFundraiser: Not campaign creator"
        );
        _;
    }

    modifier campaignExists(uint256 _campaignId) {
        require(campaigns[_campaignId].campaignId != 0, "SecretFundraiser: Campaign not found");
        _;
    }

    constructor(
        address _feeCollector,
        address _vaultManager,
        address _fheCrypto
    ) Ownable(msg.sender) {
        require(_feeCollector != address(0), "SecretFundraiser: Invalid fee collector");
        require(_vaultManager != address(0), "SecretFundraiser: Invalid vault manager");
        require(_fheCrypto != address(0), "SecretFundraiser: Invalid FHE crypto");
        
        feeCollector = _feeCollector;
        vaultManager = VaultManager(_vaultManager);
        fheCrypto = FHECrypto(_fheCrypto);
    }

    /**
     * @dev Launch a new fundraising campaign
     */
    function launchCampaign(
        address _rewardToken,
        uint256 _tokenSupply,
        uint256 _fundingGoal,
        uint256 _pricePerToken,
        uint256 _duration,
        uint256 _minimumBid,
        uint256 _maximumBid,
        string calldata _infoHash
    ) external nonReentrant returns (uint256) {
        require(_rewardToken != address(0), "SecretFundraiser: Invalid token");
        require(_tokenSupply > 0, "SecretFundraiser: Invalid supply");
        require(_fundingGoal > 0, "SecretFundraiser: Invalid goal");
        require(_pricePerToken > 0, "SecretFundraiser: Invalid price");
        require(_duration > 0, "SecretFundraiser: Invalid duration");
        require(_minimumBid > 0, "SecretFundraiser: Invalid minimum");
        require(_maximumBid >= _minimumBid, "SecretFundraiser: Max < min bid");
        require(bytes(_infoHash).length > 0, "SecretFundraiser: Invalid info hash");

        uint256 campaignId = nextCampaignId++;
        uint32 launchTime = uint32(block.timestamp);
        uint32 closingTime = launchTime + uint32(_duration);

        // Initialize encrypted total to zero
        euint64 encryptedZero = FHE.asEuint64(0);
        FHE.allowThis(encryptedZero);

        campaigns[campaignId] = Campaign({
            campaignId: campaignId,
            creator: msg.sender,
            rewardToken: _rewardToken,
            tokenSupply: _tokenSupply,
            fundingGoal: _fundingGoal,
            pricePerToken: _pricePerToken,
            launchTime: launchTime,
            closingTime: closingTime,
            minimumBid: _minimumBid,
            maximumBid: _maximumBid,
            isLive: true,
            currentState: CampaignState.Live,
            infoHash: _infoHash,
            hiddenTotalRaised: encryptedZero,
            revealedTotalRaised: 0,
            computeState: ComputationState.Idle
        });

        // Transfer reward tokens to vault
        vaultManager.depositTokens(
            _rewardToken,
            msg.sender,
            _tokenSupply,
            campaignId
        );

        emit CampaignLaunched(
            campaignId,
            msg.sender,
            _rewardToken,
            _fundingGoal,
            _pricePerToken
        );

        return campaignId;
    }

    /**
     * @dev Make a secret contribution using FHE encryption
     */
    function contributeSecretly(
        uint256 _campaignId,
        inEuint64 calldata _encryptedValue,
        bytes calldata _proof
    ) external payable nonReentrant campaignExists(_campaignId) {
        Campaign storage campaign = campaigns[_campaignId];
        
        require(campaign.isLive, "SecretFundraiser: Campaign not live");
        require(block.timestamp >= campaign.launchTime, "SecretFundraiser: Not started");
        require(block.timestamp <= campaign.closingTime, "SecretFundraiser: Campaign ended");
        require(campaign.currentState == CampaignState.Live, "SecretFundraiser: Not accepting contributions");
        require(msg.value >= campaign.minimumBid, "SecretFundraiser: Below minimum");
        require(msg.value <= campaign.maximumBid, "SecretFundraiser: Above maximum");

        // Process encrypted contribution
        euint64 contributionAmount = FHE.fromExternal(_encryptedValue, _proof);
        
        // Verify encrypted value matches actual ETH
        ebool valueMatches = FHE.eq(contributionAmount, FHE.asEuint64(msg.value));
        require(FHE.decrypt(valueMatches), "SecretFundraiser: Value mismatch");

        // Check contribution limits
        uint256 newUserTotal = totalContributed[_campaignId][msg.sender] + msg.value;
        require(newUserTotal <= campaign.maximumBid, "SecretFundraiser: Exceeds max contribution");

        // Record secret contribution
        campaignContributions[_campaignId].push(SecretContribution({
            contributor: msg.sender,
            campaignId: _campaignId,
            blockTimestamp: uint32(block.timestamp),
            hiddenAmount: contributionAmount,
            actualValue: msg.value,
            rewardsClaimed: false,
            fundsReclaimed: false
        }));

        // Update encrypted total
        campaign.hiddenTotalRaised = FHE.add(campaign.hiddenTotalRaised, contributionAmount);
        FHE.allowThis(campaign.hiddenTotalRaised);

        // Update user tracking
        if (!hasContributed[_campaignId][msg.sender]) {
            userCampaigns[msg.sender].push(_campaignId);
            hasContributed[_campaignId][msg.sender] = true;
        }
        totalContributed[_campaignId][msg.sender] = newUserTotal;

        emit SecretContributionReceived(
            _campaignId,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @dev Request computation of encrypted totals to determine campaign success
     * @notice Can be called after campaign end time or by creator
     */
    function computeCampaignTotals(uint256 _campaignId) 
        public 
        campaignExists(_campaignId)
        returns (uint256)
    {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.isLive, "SecretFundraiser: Campaign not live");
        require(
            block.timestamp > campaign.closingTime || msg.sender == campaign.creator,
            "SecretFundraiser: Cannot compute yet"
        );
        require(
            campaign.computeState == ComputationState.Idle,
            "SecretFundraiser: Already computing"
        );

        campaign.currentState = CampaignState.Processing;
        campaign.computeState = ComputationState.Computing;

        // Request decryption from FHE oracle
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(campaign.hiddenTotalRaised);
        uint256 requestId = FHE.requestDecryption(
            ciphertexts, 
            this.handleComputationResult.selector
        );

        emit ComputationStarted(_campaignId, requestId);
        return requestId;
    }

    /**
     * @dev Callback for FHE decryption oracle
     */
    function handleComputationResult(
        uint256 _requestId,
        uint64 _revealedTotal,
        bytes[] memory _signatures
    ) public {
        // Verify oracle signatures
        FHE.checkSignatures(_requestId, _signatures);

        // Find campaign for this computation
        for (uint256 campaignId = 1; campaignId < nextCampaignId; campaignId++) {
            Campaign storage campaign = campaigns[campaignId];
            if (campaign.computeState == ComputationState.Computing) {
                campaign.revealedTotalRaised = _revealedTotal;
                campaign.computeState = ComputationState.Finished;

                // Determine campaign outcome
                if (_revealedTotal >= campaign.fundingGoal) {
                    _processSucessfulCampaign(campaignId, _revealedTotal);
                } else {
                    // Goal not reached
                    campaign.currentState = CampaignState.Failed;
                    emit CampaignStateChanged(campaignId, CampaignState.Failed);
                }
                break;
            }
        }
    }

    /**
     * @dev Process a successful campaign
     */
    function _processSucessfulCampaign(uint256 _campaignId, uint64 _totalRaised) internal {
        Campaign storage campaign = campaigns[_campaignId];
        
        campaign.currentState = CampaignState.Successful;
        
        // Calculate fees
        uint256 serviceFee = (_totalRaised * serviceFeeRate) / 10000;
        uint256 creatorAmount = _totalRaised - serviceFee;
        
        payable(feeCollector).transfer(serviceFee);
        payable(campaign.creator).transfer(creatorAmount);
        
        emit CampaignSucceeded(_campaignId, _totalRaised, block.timestamp);
    }

    /**
     * @dev Claim reward tokens after successful campaign
     */
    function claimRewards(uint256 _campaignId) external nonReentrant campaignExists(_campaignId) {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.currentState == CampaignState.Successful, "SecretFundraiser: Not successful");
        require(hasContributed[_campaignId][msg.sender], "SecretFundraiser: No contribution found");

        SecretContribution[] storage contributions = campaignContributions[_campaignId];
        uint256 totalTokens = 0;

        for (uint256 i = 0; i < contributions.length; i++) {
            if (contributions[i].contributor == msg.sender && !contributions[i].rewardsClaimed) {
                uint256 contributionValue = contributions[i].actualValue;
                uint256 tokenAmount = (contributionValue * 1e18) / campaign.pricePerToken;
                
                totalTokens += tokenAmount;
                contributions[i].rewardsClaimed = true;
            }
        }

        require(totalTokens > 0, "SecretFundraiser: No rewards to claim");
        
        vaultManager.releaseTokens(
            campaign.rewardToken,
            msg.sender,
            totalTokens,
            _campaignId
        );
        
        emit RewardsClaimed(_campaignId, msg.sender, totalTokens);
    }

    /**
     * @dev Cancel campaign (creator only, before processing)
     */
    function cancelCampaign(uint256 _campaignId) 
        external 
        onlyCampaignCreator(_campaignId) 
        campaignExists(_campaignId) 
    {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.isLive, "SecretFundraiser: Not live");
        require(campaign.currentState != CampaignState.Successful, "SecretFundraiser: Already successful");
        
        campaign.isLive = false;
        campaign.currentState = CampaignState.Failed;
        
        // Return tokens to creator
        vaultManager.returnTokens(
            campaign.rewardToken,
            campaign.creator,
            campaign.tokenSupply,
            _campaignId
        );
        
        emit CampaignStateChanged(_campaignId, CampaignState.Failed);
    }

    /**
     * @dev Reclaim funds from failed campaigns
     */
    function reclaimFunds(uint256 _campaignId) 
        external 
        nonReentrant 
        campaignExists(_campaignId) 
    {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.currentState == CampaignState.Failed, "SecretFundraiser: Not failed");
        require(hasContributed[_campaignId][msg.sender], "SecretFundraiser: No contribution found");

        SecretContribution[] storage contributions = campaignContributions[_campaignId];
        uint256 totalRefund = 0;

        for (uint256 i = 0; i < contributions.length; i++) {
            if (contributions[i].contributor == msg.sender && 
                !contributions[i].rewardsClaimed && 
                !contributions[i].fundsReclaimed) {
                
                totalRefund += contributions[i].actualValue;
                contributions[i].fundsReclaimed = true;
            }
        }

        require(totalRefund > 0, "SecretFundraiser: No funds to reclaim");
        payable(msg.sender).transfer(totalRefund);
        
        emit FundsReclaimed(_campaignId, msg.sender, totalRefund);
    }

    /**
     * @dev Get campaign information
     */
    function getCampaign(uint256 _campaignId) 
        external 
        view 
        returns (
            uint256 campaignId,
            address creator,
            address rewardToken,
            uint256 tokenSupply,
            uint256 fundingGoal,
            uint256 pricePerToken,
            uint32 launchTime,
            uint32 closingTime,
            uint256 minimumBid,
            uint256 maximumBid,
            bool isLive,
            CampaignState currentState,
            string memory infoHash,
            uint64 revealedTotalRaised,
            ComputationState computeState
        )
    {
        Campaign storage campaign = campaigns[_campaignId];
        return (
            campaign.campaignId,
            campaign.creator,
            campaign.rewardToken,
            campaign.tokenSupply,
            campaign.fundingGoal,
            campaign.pricePerToken,
            campaign.launchTime,
            campaign.closingTime,
            campaign.minimumBid,
            campaign.maximumBid,
            campaign.isLive,
            campaign.currentState,
            campaign.infoHash,
            campaign.revealedTotalRaised,
            campaign.computeState
        );
    }

    /**
     * @dev Get live campaigns
     */
    function getLiveCampaigns() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextCampaignId; i++) {
            if (campaigns[i].isLive && campaigns[i].currentState == CampaignState.Live) {
                count++;
            }
        }
        
        uint256[] memory liveCampaigns = new uint256[](count);
        uint256 index = 0;
        
        for (uint256 i = 1; i < nextCampaignId; i++) {
            if (campaigns[i].isLive && campaigns[i].currentState == CampaignState.Live) {
                liveCampaigns[index] = i;
                index++;
            }
        }
        
        return liveCampaigns;
    }

    /**
     * @dev Get user's campaign participations
     */
    function getUserCampaigns(address _user) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return userCampaigns[_user];
    }

    /**
     * @dev Update service fee rate (owner only)
     */
    function updateServiceFeeRate(uint16 _newRate) external onlyOwner {
        require(_newRate <= MAX_SERVICE_FEE, "SecretFundraiser: Fee too high");
        serviceFeeRate = _newRate;
    }

    /**
     * @dev Update fee collector (owner only)
     */
    function updateFeeCollector(address _newCollector) external onlyOwner {
        require(_newCollector != address(0), "SecretFundraiser: Invalid address");
        feeCollector = _newCollector;
    }

    /**
     * @dev Emergency campaign termination
     */
    function emergencyTerminateCampaign(uint256 _campaignId) 
        external 
        onlyOwner 
        campaignExists(_campaignId) 
    {
        Campaign storage campaign = campaigns[_campaignId];
        require(campaign.isLive, "SecretFundraiser: Not live");
        
        // Force end campaign and start computation
        campaign.closingTime = uint32(block.timestamp);
        computeCampaignTotals(_campaignId);
    }
}