// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.4.22 <0.9.0;

import "openzeppelin-solidity/contracts/utils/math/SafeMath.sol";
import "./Recoverable.sol";
import "./IPancakeMasterChefLike.sol";
import "./IPancakeRouterLike.sol";

abstract contract NepBurner is Recoverable {
  using SafeMath for uint256;

  IPancakeMasterChefLike public _cakeMasterChef;
  IPancakeRouterLike public _pancakeRouter;
  IERC20 public _nepToken;
  IERC20 public _cakeToken;
  address[] public _burnPath;

  event LiquidityCommited(address indexed liquidityToken, uint256 amount);
  event BurnPathUpdated(address[] path);

  function updateBurnPath(address[] memory burnPath) external onlyOwner {
    _burnPath = burnPath;
    emit BurnPathUpdated(burnPath);
  }

  /**
   * @dev Commits the liquidity harvested in the pool.
   *
   * The generated harvest is used to purchase NEP tokens to be burned.
   *
   */
  function _commitLiquidity() internal {
    _cakeMasterChef.leaveStaking(0);
    uint256 amount = _cakeToken.balanceOf(address(this));

    // slither-disable-next-line incorrect-equality
    if (amount == 0) {
      return;
    }

    require(_cakeToken.approve(address(_pancakeRouter), amount), "Pancake Router approval failed");

    // slither-disable-next-line unused-return
    _pancakeRouter.swapExactTokensForTokens(amount, 0, _burnPath, 0x0000000000000000000000000000000000000001, block.timestamp.add(1 hours));
    // solhint-disable-previous-line not-rely-on-time
    emit LiquidityCommited(address(_cakeToken), amount);
  }
}
