// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;

import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

contract FakeCakeMasterChef {
  address public _token;

  constructor(address token) {
    _token = token;
  }

  // Stake CAKE tokens to MasterChef
  function enterStaking(uint256 amount) external {
    IERC20 erc20 = IERC20(_token);
    erc20.transferFrom(msg.sender, address(this), amount);
  }

  // Withdraw CAKE tokens from STAKING.
  function leaveStaking(uint256 amount) external {
    IERC20 erc20 = IERC20(_token);
    erc20.transfer(msg.sender, amount);
  }
}
