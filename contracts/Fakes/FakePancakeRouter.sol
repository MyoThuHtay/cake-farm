/* solhint-disable */
// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;

contract FakePancakeRouter {
  function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
  ) external returns (uint256[] memory amounts) {}
}
