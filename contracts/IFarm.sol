// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;

interface IFarm {
  event Deposit(address indexed account, uint256 amount);
  event RewardsWithdrawn(address indexed account, uint256 amount);
  event LiquidityTokenFarmingApproved(uint256 amount);
  event LiquidityTokenFarmingApprovalReduced(uint256 amount);
  event Withdrawn(address indexed account, uint256 amount);

  /**
   * @dev Gets the total number of NEP allocated to be distributed as reward
   */
  function _totalRewardAllocation() external view returns (uint256);

  /**
   * @dev Gets the remaining number of NEP tokens in this farm to be distributed as reward
   */
  function _remainingNEPRewards() external view returns (uint256);

  /**
   * @dev Gets the number of blocks since last rewards
   * @param account Provide an address to get the blocks
   */
  function getTotalBlocksSinceLastReward(address account) external view returns (uint256);

  /**
   * @dev Calculates the NEP rewards accumulated on the `account`
   * @param account Provide an address to get the rewards
   */
  function calculateRewards(address account) external view returns (uint256);

  /**
   * @dev Reports the remaining amount of liquidity token that can be farmed here
   */
  function getRemainingToStake() external view returns (uint256);

  /**
   * @dev Returns the total NEP locked in this farm
   */
  function getTotalNEPLocked() external view returns (uint256);

  /**
   * @dev Returns the total liquidity token staked in this farm
   * @param account Provide account to check
   */
  function getTotalStaked(address account) external view returns (uint256);


  /**
   * @dev Gets the summary of the Cake Farm
   * @param account Account to obtain summary of
   * @param values[0] rewards Your pending rewards
   * @param values[1] staked Your liquidity token balance
   * @param values[2] nepPerTokenPerBlock NEP token per liquidity token unit per block
   * @param values[3] totalTokensLocked Total liquidity token locked
   * @param values[4] totalNepLocked Total NEP locked
   * @param values[5] maxToStake Total tokens to be staked
   * @param values[6] myNepRewards Sum of NEP rewareded to the account in this farm
   * @param values[7] totalNepRewards Sum of all NEP rewarded in this farm
   * @param values[8] remainingNEPRewards Remaining NEP in this farm
   */
  function getInfo(address account) external view returns (uint256[] memory values);

  /**
   * @dev Reports when an account can withdraw their staked balance
   * @param account Provide an account
   */
  function canWithdrawFrom(address account) external view returns (uint256);

  /**
   * @dev Allows depositing liquidity tokens to enter into farming.
   * The rewards are finite and constant amount of NEP per stake per block.
   *
   * There is a maximum limit of liquidity tokens which can be staked in this smart contract
   * based on first come first serve basis.
   * @param amount The amount to deposit to this farm.
   */
  function deposit(uint256 amount) external;

  /**
   * @dev Withdraws the specified amount of staked liquidity tokens from the farm.
   *
   * To avoid spams, the withdrawal can only be unlocked
   *  after 259200 blocks since the last deposit (equivalent to 24 hours).
   * @param amount Amount to withdraw.
   */
  function withdraw(uint256 amount) external;

  /**
   * @dev Withdraws the sender's NEP rewards accumulated
   */
  function withdrawRewards() external;
}
