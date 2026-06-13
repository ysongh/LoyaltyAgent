// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LoyaltyPoints} from "./LoyaltyPoints.sol";

/// @title MerchantEscrow
/// @notice Holds per-merchant native-USDC reward pools and settles loyalty-point redemptions.
/// @dev On Arc, USDC is the native gas token, so this escrow funds and pays out in native
///      value (no ERC-20 token). Native amounts use 18 decimals (1 USDC = 1e18), unlike the
///      ERC-20 USDC representation which uses 6 — keep that in mind when setting rates.
///
///      A merchant funds its pool with native USDC and sets a `usdcPerPoint` rate. A customer
///      redeems points by calling {redeem}; the escrow burns their points on {LoyaltyPoints}
///      and pays out native USDC from that merchant's pool.
///
///      Redemption burns the customer's points via {LoyaltyPoints-burn}, which requires the
///      customer to have approved this escrow as an operator beforehand:
///      `loyalty.setApprovalForAll(address(escrow), true)`.
contract MerchantEscrow is ReentrancyGuard {
    /// @notice The loyalty-points contract whose token ids are merchant ids.
    LoyaltyPoints public immutable loyalty;

    /// @notice merchant id => native USDC (18-decimal wei) currently escrowed for that merchant.
    mapping(uint256 => uint256) public escrowBalance;

    /// @notice merchant id => native USDC (18-decimal wei) paid per 1 loyalty point.
    mapping(uint256 => uint256) public usdcPerPoint;

    event Funded(uint256 indexed merchantId, address indexed from, uint256 usdcAmount);
    event Withdrawn(uint256 indexed merchantId, address indexed to, uint256 usdcAmount);
    event RateSet(uint256 indexed merchantId, uint256 usdcPerPoint);
    event Redeemed(
        uint256 indexed merchantId,
        address indexed customer,
        uint256 pointsBurned,
        uint256 usdcPaid
    );

    error MerchantNotRegistered(uint256 merchantId);
    error NotMerchantOwner(uint256 merchantId, address caller);
    error RateNotSet(uint256 merchantId);
    error InsufficientEscrow(uint256 merchantId, uint256 needed, uint256 available);
    error NativeTransferFailed(address to, uint256 amount);
    error ZeroAmount();
    error ZeroAddress();

    constructor(LoyaltyPoints loyalty_) {
        if (address(loyalty_) == address(0)) revert ZeroAddress();
        loyalty = loyalty_;
    }

    /// @notice Restricts to the controlling owner of `merchantId` on {LoyaltyPoints}.
    modifier onlyMerchantOwner(uint256 merchantId) {
        address owner_ = loyalty.merchantOwner(merchantId);
        if (owner_ == address(0)) revert MerchantNotRegistered(merchantId);
        if (msg.sender != owner_) revert NotMerchantOwner(merchantId, msg.sender);
        _;
    }

    /// @notice Adds native USDC to a merchant's reward pool. Open to anyone (e.g. sponsors).
    /// @dev The amount funded is the native value (`msg.value`) sent with the call.
    function fund(uint256 merchantId) external payable nonReentrant {
        if (loyalty.merchantOwner(merchantId) == address(0)) {
            revert MerchantNotRegistered(merchantId);
        }
        if (msg.value == 0) revert ZeroAmount();

        escrowBalance[merchantId] += msg.value;
        emit Funded(merchantId, msg.sender, msg.value);
    }

    /// @notice Sets the redemption rate (native USDC wei paid per 1 point) for a merchant.
    function setRate(uint256 merchantId, uint256 newUsdcPerPoint)
        external
        onlyMerchantOwner(merchantId)
    {
        usdcPerPoint[merchantId] = newUsdcPerPoint;
        emit RateSet(merchantId, newUsdcPerPoint);
    }

    /// @notice Withdraws unredeemed native USDC from a merchant's pool.
    function withdraw(uint256 merchantId, uint256 usdcAmount, address to)
        external
        nonReentrant
        onlyMerchantOwner(merchantId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (usdcAmount == 0) revert ZeroAmount();

        uint256 available = escrowBalance[merchantId];
        if (usdcAmount > available) {
            revert InsufficientEscrow(merchantId, usdcAmount, available);
        }

        escrowBalance[merchantId] = available - usdcAmount;
        _sendNative(to, usdcAmount);
        emit Withdrawn(merchantId, to, usdcAmount);
    }

    /// @notice Redeems loyalty points for native USDC from a merchant's pool.
    /// @dev Burns `pointsAmount` of the caller's points (caller must have approved this
    ///      escrow as an operator on {LoyaltyPoints}) and pays the equivalent native USDC.
    /// @param merchantId The merchant whose points are being redeemed.
    /// @param pointsAmount Number of points to redeem.
    /// @return usdcOut Native USDC wei paid out to the caller.
    function redeem(uint256 merchantId, uint256 pointsAmount)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        if (pointsAmount == 0) revert ZeroAmount();

        uint256 rate = usdcPerPoint[merchantId];
        if (rate == 0) revert RateNotSet(merchantId);

        usdcOut = pointsAmount * rate;

        uint256 available = escrowBalance[merchantId];
        if (usdcOut > available) {
            revert InsufficientEscrow(merchantId, usdcOut, available);
        }

        // Checks-effects-interactions: update accounting before external calls.
        escrowBalance[merchantId] = available - usdcOut;

        // Burn the customer's points (reverts if escrow is not an approved operator).
        loyalty.burn(msg.sender, merchantId, pointsAmount);

        _sendNative(msg.sender, usdcOut);
        emit Redeemed(merchantId, msg.sender, pointsAmount, usdcOut);
    }

    /// @notice Returns the native USDC that `pointsAmount` would yield for a merchant.
    function quoteRedeem(uint256 merchantId, uint256 pointsAmount)
        external
        view
        returns (uint256 usdcOut)
    {
        return pointsAmount * usdcPerPoint[merchantId];
    }

    /// @dev Sends native USDC via a low-level call, reverting on failure.
    function _sendNative(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed(to, amount);
    }
}
