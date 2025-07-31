// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
pragma abicoder v2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IHypervisor} from "./interfaces/IHypervisor.sol";
import "./libraries/RewardCalculations.sol";
import "./interfaces/IIncentiveMaker.sol";

/// @title Multi Fee Distribution Contract
/// @author Gamma
/// @dev All function calls are currently implemented without side effects
contract MultiFeeDistribution is
Initializable,
PausableUpgradeable,
OwnableUpgradeable,
ReentrancyGuard
{
    using SafeERC20 for IERC20;

    struct RewardData {
        uint256 amount;
        uint256 lastTimeUpdated;
        uint256 rewardPerToken;
    }

    struct UserData {
        uint256 tokenAmount;
        uint256 lastTimeUpdated;
        uint256 tokenClaimable;
        mapping(address => uint256) rewardPerToken;
    }
    /********************** Contract Addresses ***********************/

    /// @notice Address of LP token
    address public stakingToken;

    /********************** Lock & Earn Info ***********************/

    /// @notice Total locked value
    uint256 public totalStakes;

    /********************** Reward Info ***********************/

    /// @notice Reward tokens being distributed
    address[] public rewardTokens;

    /// @notice address => RPT
    mapping(address => RewardData) public rewardData;

    /// @notice address => RPT
    mapping(address => UserData) public userData;

    /// @notice rewardToken => user => claimable amount
    mapping(address => mapping(address => uint256)) public claimable;
    /********************** Other Info ***********************/

    /// @notice Addresses approved to call mint
    mapping(address => bool) public managers;

    /********************** Events ***********************/

    event Stake(
        address indexed user,
        uint256 amount
    );
    event Unstake(
        address indexed user,
        uint256 receivedAmount
    );
    event RewardPaid(
        address indexed user,
        address indexed rewardToken,
        uint256 reward
    );
    event Recovered(address indexed token, uint256 amount);

    /********************** Errors ***********************/
    error AddressZero();
    error InvalidBurn();
    error InsufficientPermission();
    error ActiveReward();
    error InvalidAmount();
    error InvalidToken();

    /**
     * @dev Constructor
     */
    function initialize(
        address[] memory _rewardTokens
    ) public initializer {
        for (uint i; i < _rewardTokens.length; i ++) {
            if (_rewardTokens[i] == address(0)) revert InvalidBurn();
            rewardTokens.push(_rewardTokens[i]);
        }

        __Pausable_init();
        __Ownable_init();
    }

    /********************** Setters ***********************/

    /**
     * @notice Set managers
     * @param _managers array of address
     */
    function setManagers(address[] calldata _managers) external onlyOwner {
        uint256 length = _managers.length;
        for (uint256 i; i < length; i ++) {
            if (_managers[i] == address(0)) revert AddressZero();
            managers[_managers[i]] = true;
        }
    }

    /**
     * @notice Remove managers
     * @param _managers array of address
     */
    function removeManagers(address[] calldata _managers) external onlyOwner {
        uint256 length = _managers.length;
        for (uint256 i; i < length; i ++) {
            if (_managers[i] == address(0)) revert AddressZero();
            managers[_managers[i]] = false;
        }
    }

    /**
     * @notice Set LP token.
     * @param _stakingToken LP token address
     */
    function setStakingToken(address _stakingToken) external onlyOwner {
        if (_stakingToken == address(0)) revert AddressZero();
        if (stakingToken != address(0)) revert AddressZero();
        stakingToken = _stakingToken;
    }

    /**
     * @notice Add a new reward token to be distributed to stakers.
     * @param _rewardToken address
     */
    function addReward(address _rewardToken) external {
        if (_rewardToken == address(0)) revert InvalidBurn();
        if (!managers[msg.sender]) revert InsufficientPermission();
        for (uint i; i < rewardTokens.length; i ++) {
            if (rewardTokens[i] == _rewardToken) revert ActiveReward();
        }
        rewardTokens.push(_rewardToken);
    }

    /**
     * @notice Add a new reward token to be distributed to stakers.
     * @param _rewardToken address
     */
    function removeRewardToken(address _rewardToken) external onlyOwner {
        (bool isRewardTokenExist, uint256 index) = _isRewardTokenExist(_rewardToken);
        if (!isRewardTokenExist)
            revert InvalidToken();

        rewardTokens[index] = rewardTokens[rewardTokens.length - 1];
        rewardTokens.pop();
    }

    /********************** View functions ***********************/

    /**
     * @notice Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders.
     * @param tokenAddress to recover.
     * @param tokenAmount to recover.
     */
    function recoverERC20(
        address tokenAddress,
        uint256 tokenAmount
    ) external onlyOwner {
        if (rewardData[tokenAddress].lastTimeUpdated > 0) revert ActiveReward();
        if (tokenAddress == address(stakingToken)) revert InvalidToken();
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /**
     * @notice Total balance of an account, including unlocked, locked and earned tokens.
     * @param user address.
     */
    function totalBalance(
        address user
    ) external view returns (uint256) {
        return userData[user].tokenAmount;
    }

    /********************** Reward functions ***********************/

    function totalUnclaimedRewards() public view returns (address[] memory rewardAddresses, uint256[] memory rewardAmounts) {
        // Get NFT IDs from hypervisor
        uint256 baseNftId = IHypervisor(stakingToken).baseNftId();
        uint256 limitNftId = IHypervisor(stakingToken).limitNftId();

        // Get farming center and pool from hypervisor
        IFarmingCenter farmingCenter = IFarmingCenter(IHypervisor(stakingToken).farmingCenter());
        IAlgebraPool pool = IAlgebraPool(IHypervisor(stakingToken).pool());

        // Initialize arrays
        rewardAddresses = new address[](2);
        rewardAmounts = new uint256[](2);

        // Get reward tokens from hypervisor
        rewardAddresses[0] = address(IHypervisor(stakingToken).rewardToken());
        rewardAddresses[1] = address(IHypervisor(stakingToken).bonusRewardToken());

        // Calculate unclaimed rewards for base position
        (uint256 baseReward, uint256 baseBonusReward) = RewardCalculations.getRewardsForPosition(
            baseNftId,
            farmingCenter,
            pool
        );

        // Calculate unclaimed rewards for limit position
        (uint256 limitReward, uint256 limitBonusReward) = RewardCalculations.getRewardsForPosition(
            limitNftId,
            farmingCenter,
            pool
        );

        // Sum up total unclaimed rewards
        rewardAmounts[0] = baseReward + limitReward;
        rewardAmounts[1] = baseBonusReward + limitBonusReward;
    }

    /**
     * @notice Address and claimable amount of all reward tokens for the given account.
     * @param account for rewards
     * @return rewardsData array of rewards
     */

    function claimableRewards(
        address account
    ) public view returns (address[] memory, uint256[] memory) {
        uint256[] memory rewardAmounts = new uint256[](rewardTokens.length);

        // Get unclaimed farming rewards
        (address[] memory unclaimedAddresses, uint256[] memory unclaimedAmounts) = totalUnclaimedRewards();

        for (uint256 i; i < rewardTokens.length; i++) {
            address token = rewardTokens[i];
            RewardData memory r = rewardData[token];
            uint256 newRewardPerToken = r.rewardPerToken;

            // Check if this reward token is either the main reward token or bonus reward token
            if (token == unclaimedAddresses[0] || token == unclaimedAddresses[1]) {
                uint256 unclaimedAmount = token == unclaimedAddresses[0] ? unclaimedAmounts[0] : unclaimedAmounts[1];
                uint256 currentBalance = IERC20(token).balanceOf(address(this));

                // Calculate new reward per token including unclaimed rewards
                if (totalStakes > 0) {
                    uint256 additionalRewards = currentBalance + unclaimedAmount - r.amount;
                    newRewardPerToken += additionalRewards * 1e50 / totalStakes;
                }
            }

            // Calculate claimable amount using potentially updated reward per token
            uint256 userRewardPerToken = userData[account].rewardPerToken[token];
            uint256 pendingReward = 0;

            if (userData[account].lastTimeUpdated > 0 && userData[account].tokenAmount > 0) {
                pendingReward = (newRewardPerToken - userRewardPerToken) * userData[account].tokenAmount / 1e50;
            }

            rewardAmounts[i] = claimable[token][account] + pendingReward;
        }

        return (rewardTokens, rewardAmounts);
    }

    /**
     * @notice Get the current reward rates per second for each reward token
     * @return rewardAddresses Array of reward token addresses [rewardToken, bonusRewardToken]
     * @return rewardRatesPerSecond Array of reward rates per second [reward rate, bonus reward rate]
     */
    function getRewardRatesPerSecond() public view returns (
        address[] memory rewardAddresses,
        uint256[] memory rewardRatesPerSecond
    ) {
        // Get NFT IDs from hypervisor
        uint256 baseNftId = IHypervisor(stakingToken).baseNftId();
        uint256 limitNftId = IHypervisor(stakingToken).limitNftId();

        // Get farming center and pool from hypervisor
        IFarmingCenter farmingCenter = IFarmingCenter(IHypervisor(stakingToken).farmingCenter());
        IAlgebraPool pool = IAlgebraPool(IHypervisor(stakingToken).pool());

        // Initialize arrays
        rewardAddresses = new address[](2);
        rewardRatesPerSecond = new uint256[](2);

        // Get reward tokens from hypervisor
        rewardAddresses[0] = address(IHypervisor(stakingToken).rewardToken());
        rewardAddresses[1] = address(IHypervisor(stakingToken).bonusRewardToken());

        // Get rewards per second for base position
        (uint256 baseReward, uint256 baseBonusReward) = RewardCalculations.getLastSecondRewards(
            baseNftId,
            farmingCenter,
            pool
        );

        // Get rewards per second for limit position
        (uint256 limitReward, uint256 limitBonusReward) = RewardCalculations.getLastSecondRewards(
            limitNftId,
            farmingCenter,
            pool
        );

        // Combine rates from both positions
        rewardRatesPerSecond[0] = baseReward + limitReward;
        rewardRatesPerSecond[1] = baseBonusReward + limitBonusReward;
    }

    /********************** Operate functions ***********************/

    /**
     * @notice Stake tokens to receive rewards.
     * @dev Locked tokens cannot be withdrawn for defaultLockDuration and are eligible to receive rewards.
     * @param amount to stake.
     * @param onBehalfOf address for staking.
     */
    function stake(
        uint256 amount,
        address onBehalfOf
    ) external nonReentrant{
        _stake(amount, onBehalfOf);
    }

    /**
    * @notice Stake all available tokens to receive rewards.
    * @dev Locked tokens cannot be withdrawn for defaultLockDuration and are eligible to receive rewards.
    * @param onBehalfOf address for staking.
    */
    function stakeAll(address onBehalfOf) external nonReentrant {
        uint256 amount = IERC20(stakingToken).balanceOf(msg.sender);
        _stake(amount, onBehalfOf);
    }

    /**
     * @notice Stake tokens to receive rewards.
     * @dev Locked tokens cannot be withdrawn for defaultLockDuration and are eligible to receive rewards.
     * @param amount to stake.
     * @param onBehalfOf address for staking.
     */
    function _stake(
        uint256 amount,
        address onBehalfOf
    ) internal whenNotPaused {
        if (amount == 0) return;
        _updateReward();

        for (uint i; i < rewardTokens.length; i ++) {
            _calculateClaimable(onBehalfOf, rewardTokens[i]);
        }

        IERC20(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        UserData storage userInfo = userData[onBehalfOf];
        userInfo.tokenAmount += amount;
        totalStakes += amount;

        emit Stake(onBehalfOf, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        _unstake(amount, msg.sender);
        _getReward(msg.sender, rewardTokens);
    }

    function _unstake(uint256 amount, address onBehalfOf) internal {
        UserData storage userInfo = userData[onBehalfOf];
        if (userInfo.tokenAmount < amount)
            revert InvalidAmount();
        _updateReward();
        for (uint i; i < rewardTokens.length; i ++) {
            _calculateClaimable(onBehalfOf, rewardTokens[i]);
        }
        IERC20(stakingToken).safeTransfer(onBehalfOf, amount);

        userInfo.tokenAmount -= amount;
        totalStakes -= amount;

        emit Unstake(onBehalfOf, amount);
    }
    /**
     * @notice Claim all pending staking rewards.
     * @param _rewardTokens array of reward tokens
     */
    function getReward(address _onBehalfOf, address[] memory _rewardTokens) external nonReentrant {
        _getReward(_onBehalfOf, _rewardTokens);
    }

    /**
     * @notice Claim all pending staking rewards.
     */
    function getAllRewards() external nonReentrant {
        _getReward(msg.sender, rewardTokens);
    }

    function updateReward() external {
        _updateReward();
    }

    /**
     * @notice Calculate earnings.
     * @param _user address of earning owner
     * @param _rewardToken address
     * @return earnings amount
     */
    function _earned(
        address _user,
        address _rewardToken
    ) internal view returns (uint256 earnings) {
        RewardData memory rewardInfo = rewardData[_rewardToken];
        UserData storage userInfo = userData[_user];

        return (rewardInfo.rewardPerToken - userInfo.rewardPerToken[_rewardToken]) * userInfo.tokenAmount;
    }

    /**
     * @notice Update user reward info.
     */
    function _updateReward() internal {
        IHypervisor(stakingToken).getReward();
        for (uint i; i < rewardTokens.length; i ++) {
            address rewardToken = rewardTokens[i];
            if (totalStakes > 0) {
                RewardData storage r = rewardData[rewardToken];
                uint256 currentBalance = IERC20(rewardToken).balanceOf(address(this));
                uint256 diff =  currentBalance - r.amount;
                r.lastTimeUpdated = block.timestamp;
                r.rewardPerToken += diff * 1e50 / totalStakes;
                r.amount = currentBalance;
            }
        }
    }

    function _calculateClaimable(address _onBehalf, address _rewardToken) internal {
        UserData storage userInfo = userData[_onBehalf];
        RewardData memory r = rewardData[_rewardToken];

        if (userInfo.lastTimeUpdated > 0 && userInfo.tokenAmount > 0) {
            claimable[_rewardToken][_onBehalf] += (r.rewardPerToken - userInfo.rewardPerToken[_rewardToken]) * userInfo.tokenAmount / 1e50;
        }

        userInfo.rewardPerToken[_rewardToken] = r.rewardPerToken;
        userInfo.lastTimeUpdated = block.timestamp;
    }

    /**
     * @notice User gets reward
     * @param _user address
     * @param _rewardTokens array of reward tokens
     */
    function _getReward(
        address _user,
        address[] memory _rewardTokens
    ) internal whenNotPaused {
        for (uint256 i; i < _rewardTokens.length; i ++) {
            address token = _rewardTokens[i];
            RewardData storage r = rewardData[token];
            _updateReward();
            _calculateClaimable(_user, token);
            if (claimable[token][_user] > 0) {
                IERC20(token).safeTransfer(_user, claimable[token][_user]);
                r.amount -= claimable[token][_user];
                claimable[token][_user] = 0;
                emit RewardPaid(_user, token, claimable[token][_user]);
            }
        }
    }

    function _isRewardTokenExist(address _rewardToken) internal view returns (bool rewardTokenFound, uint256 index) {
        uint256 rewardTokenLength = rewardTokens.length;

        for (uint256 i; i < rewardTokenLength; i ++) {
            if (rewardTokens[i] == _rewardToken) {
                rewardTokenFound = true;
                index = i;
                break;
            }
        }
    }

    /********************** Eligibility + Disqualification ***********************/

    /**
     * @notice Pause MFD functionalities
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @notice Resume MFD functionalities
     */
    function unpause() public onlyOwner {
        _unpause();
    }
}
