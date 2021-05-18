// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;

// Pancake Farm: https://github.com/pancakeswap/pancake-farm
interface IPancakeMasterChefLike {
  // View function to see pending CAKEs on frontend.
  function pendingCake(uint256 _pid, address _user) external view returns (uint256);

  // Stake CAKE tokens to MasterChef
  function enterStaking(uint256 _amount) external;

  // Withdraw CAKE tokens from STAKING.
  function leaveStaking(uint256 _amount) external;
}
