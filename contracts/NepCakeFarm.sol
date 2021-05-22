// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;
import "openzeppelin-solidity/contracts/security/Pausable.sol";
import "openzeppelin-solidity/contracts/security/ReentrancyGuard.sol";
import "./IFarm.sol";
import "./NepBurner.sol";
import "./Libraries/NTransferUtilV1.sol";

contract NepCakeFarm is IFarm, Pausable, ReentrancyGuard, NepBurner {
  using SafeMath for uint256;
  using NTransferUtilV1 for IERC20;

  uint256 public _pid; // PancakeSwap CAKE pool id
  uint256 public _nepUnitPerCakeUnitPerBlock;
  uint256 public _maxCakeStake;

  mapping(address => uint256) public _cakeBalances;
  mapping(address => uint256) public _cakeDeposits;
  mapping(address => uint256) public _cakeWithdrawals;
  mapping(address => uint256) public _rewardHeights;
  mapping(address => uint256) public _depositHeights;

  uint256 public override _totalRewardAllocation;
  uint256 public _totalCakeLocked;
  uint256 public _totalNepRewarded;
  uint256 public _minStakingPeriodInBlocks = 259200; // 24 hours in Binance Smart Chain

  event MinStakingPeriodUpdated(uint256 previous, uint256 current);
  event FarmSet(address indexed account, uint256 nepUnitPerLiquidityTokenUnitPerBlock, uint256 maxLiquidityTokenStake, uint256 amount);

  /**
   * @dev NEP Cake Farm
   * @param nepToken NEP token address
   * @param cakeToken CAKE token address
   * @param cakeMasterChef PancakeSwap master chef address
   * @param pid PancakeSwap CAKE pool id
   */
  constructor(
    address nepToken,
    address cakeToken,
    address cakeMasterChef,
    uint256 pid,
    address pancakeRouter,
    address[] memory burnPath
    ) {
    _nepToken = IERC20(nepToken);
    _cakeToken = IERC20(cakeToken);
    _cakeMasterChef = IPancakeMasterChefLike(cakeMasterChef);
    _pid = pid;

    _pancakeRouter = IPancakeRouterLike(pancakeRouter);
    _burnPath = burnPath;
    _cakeToken.approve(address(_cakeMasterChef), 0);

    emit BurnPathUpdated(burnPath);
  }

  /**
   * @dev Gets the number of blocks since last rewards
   * @param account Provide an address to get the blocks
   */
  function getTotalBlocksSinceLastReward(address account) external view override returns (uint256) {
    uint256 from = _rewardHeights[account];

    if (from == 0) {
      return 0;
    }

    return block.number.sub(from);
  }

  /**
   * @dev Calculates the NEP rewards accumulated on the `account`
   * @param account Provide an address to get the rewards
   */
  function calculateRewards(address account) external view override returns (uint256) {
    uint256 totalBlocks = this.getTotalBlocksSinceLastReward(account);

    if (totalBlocks == 0) {
      return 0;
    }

    uint256 cakeBalance = _cakeBalances[account];
    uint256 rewards = cakeBalance.mul(_nepUnitPerCakeUnitPerBlock).mul(totalBlocks).div(1 ether);

    return rewards;
  }

  function getInfo(address account)
    external
    view
    override
    returns (
      uint256 rewards,
      uint256 staked,
      uint256 nepPerTokenPerBlock,
      uint256 totalTokensLocked,
      uint256 totalNepLocked,
      uint256 maxToStake
    )
  {
    rewards = this.calculateRewards(account); // Your pending reards
    staked = _cakeBalances[account]; // Your cake balance
    nepPerTokenPerBlock = _nepUnitPerCakeUnitPerBlock; // NEP token per liquidity token unit per block
    totalTokensLocked = _totalCakeLocked; // Total liquidity token locked
    totalNepLocked = _nepToken.balanceOf(address(this)); // Total NEP locked
    maxToStake = _maxCakeStake; // Maximum tokens that can be staked in this farm
  }

  function getInfo()
    external
    view
    override
    returns (
      uint256 rewards,
      uint256 staked,
      uint256 nepPerTokenPerBlock,
      uint256 totalTokensLocked,
      uint256 totalNepLocked,
      uint256 maxToStake
    )
  {
    return this.getInfo(super._msgSender());
  }

  /**
   * @dev Reports the remaining amount of CAKE that can be farmed here
   */
  function getRemainingToStake() external view override returns (uint256) {
    if (_totalCakeLocked >= _maxCakeStake) {
      return 0;
    }

    return _maxCakeStake.sub(_totalCakeLocked);
  }

  /**
   * @dev Returns the total NEP locked in this farm
   */
  function getTotalNEPLocked() external view override returns (uint256) {
    uint256 balance = _nepToken.balanceOf(address(this));
    return balance;
  }

  /**
   * @dev Returns the total CAKE staked in this farm
   * @param account Provide account to check
   */
  function getTotalStaked(address account) external view override returns (uint256) {
    return _cakeBalances[account];
  }

  /**
   * @dev Reports when an account can withdraw their staked balance
   * @param account Provide an account
   */
  function canWithdrawFrom(address account) external view override returns (uint256) {
    return _depositHeights[account].add(_minStakingPeriodInBlocks);
  }

  /**
   * @dev Withdraws the NEP rewards accumulated on the `account`
   * @param account Provide an address to get the rewards
   */
  function _withdrawRewards(address account) private {
    uint256 rewards = this.calculateRewards(account);

    _rewardHeights[account] = block.number;

    if (rewards == 0) {
      return;
    }

    _totalNepRewarded = _totalNepRewarded.add(rewards);
    _nepToken.safeTransfer(account, rewards);

    emit RewardsWithdrawn(account, rewards);
  }

  /**
   * @dev Approves cake master chef to spend the specified amount of CAKE
   * @param toApprove The amount to approve
   */
  function _approveCakeMasterChef(uint256 toApprove) private {
    address cakeMasterChef = address(_cakeMasterChef);
    _cakeToken.approve(cakeMasterChef, toApprove);
    emit LiquidityTokenFarmingApproved(toApprove);
  }

  /**
   * @dev Removes cake masterchef approval to spend the specified amount of CAKE
   */
  function _reduceCakeMasterChefAllownace() private {
    address cakeMasterChef = address(_cakeMasterChef);
    _cakeToken.approve(cakeMasterChef, 0);
    emit LiquidityTokenFarmingApprovalReduced(0);
  }

  /**
   * @dev Sets minimum staking period
   * @param value Provide value as number of blocks to wait for
   */
  function setMinStakingPeriodInBlocks(uint256 value) external onlyOwner {
    emit MinStakingPeriodUpdated(_minStakingPeriodInBlocks, value);
    _minStakingPeriodInBlocks = value;
  }

  /**
   * @dev Sets parameters to start the farm
   * @param nepUnitPerLiquidityTokenUnitPerBlock Lowest unit of NEP rewarded per each lowest unit of CAKE per each block advanced
   * @param maxLiquidityTokenStake Maximum CAKE to stake. Does not accept any more CAKE than this
   * @param amount Amount of NEP to transfer to this farming contract
   */
  function setFarm(
    uint256 nepUnitPerLiquidityTokenUnitPerBlock,
    uint256 maxLiquidityTokenStake,
    uint256 amount
  ) external onlyOwner {
    address you = super._msgSender();

    if (amount > 0) {
      _totalRewardAllocation = _totalRewardAllocation.add(amount);
      _nepToken.safeTransferFrom(you, address(this), amount);
    }

    if (nepUnitPerLiquidityTokenUnitPerBlock > 0) {
      _nepUnitPerCakeUnitPerBlock = nepUnitPerLiquidityTokenUnitPerBlock;
    }

    if (maxLiquidityTokenStake > 0) {
      _maxCakeStake = maxLiquidityTokenStake;
    }

    emit FarmSet(you, nepUnitPerLiquidityTokenUnitPerBlock, maxLiquidityTokenStake, amount);
  }

  /**
   * @dev Allows depositing CAKE to enter into farming.
   * The rewards are finite and constant amount of NEP/CAKE/block.
   *
   * There is a maximum limit of CAKE which can be staked in this smart contract
   * based on first come first serve basis.
   * @param amount The amount to deposit to this farm.
   */
  function deposit(uint256 amount) external override whenNotPaused nonReentrant {
    require(amount > 0, "Invalid amount");
    require(this.getRemainingToStake() >= amount, "Sorry, that exceeds target");

    address you = super._msgSender();
    _cakeToken.safeTransferFrom(you, address(this), amount);

    // First transfer your pending rewards
    _withdrawRewards(you);

    // Credit your ledger
    _cakeBalances[you] = _cakeBalances[you].add(amount);
    _cakeDeposits[you] = _cakeDeposits[you].add(amount);

    // Approves farming in masterchef
    _approveCakeMasterChef(amount);
    _cakeMasterChef.enterStaking(amount);
    _totalCakeLocked = _totalCakeLocked.add(amount);
    _depositHeights[you] = block.number;

    super._commitLiquidity();
    emit Deposit(you, amount);
  }

  /**
   * @dev Withdraws the specified amount of staked CAKE from the farm.
   *
   * To avoid spams, the withdrawal can only be unlocked
   *  after 259200 blocks since the last deposit (equivalent to 24 hours).
   * @param amount Amount to withdraw.
   */
  function withdraw(uint256 amount) external override whenNotPaused nonReentrant {
    require(amount > 0, "Invalid amount");

    address you = super._msgSender();
    uint256 balance = _cakeBalances[you];

    require(balance >= amount, "Try again later");
    require(block.number > _depositHeights[you].add(_minStakingPeriodInBlocks), "Withdrawal too early");

    _withdrawRewards(you);

    _totalCakeLocked = _totalCakeLocked.sub(amount);

    // Debit your ledger
    _cakeBalances[you] = _cakeBalances[you].sub(amount);
    _cakeWithdrawals[you] = _cakeWithdrawals[you].add(amount);

    // Unstake your requested amount of CAKE
    _cakeMasterChef.leaveStaking(amount);

    // Reduces masterchef approval in PancakeSwap
    _reduceCakeMasterChefAllownace();

    // Transfer it back to you
    _cakeToken.safeTransfer(you, amount);

    super._commitLiquidity();

    emit Withdrawn(you, amount);
  }

  /**
   * @dev Withdraws the sender's NEP rewards accumulated
   */
  function withdrawRewards() external override whenNotPaused nonReentrant {
    _withdrawRewards(super._msgSender());
    super._commitLiquidity();
  }

  function pause() external onlyOwner whenNotPaused {
    super._pause();
  }

  function unpause() external onlyOwner whenPaused {
    super._unpause();
  }
}
