// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title LoyaltyPoints
/// @notice ERC-1155 loyalty token where each token id maps 1:1 to a registered merchant id.
/// @dev Two authority levels:
///      - the contract owner (the platform / relayer) registers merchants, and
///      - each merchant owner mints points for their own merchant id.
///      Points are burned on redemption via {ERC1155Burnable}; the {MerchantEscrow}
///      burns a customer's points by acting as their approved operator
///      (customer must call {setApprovalForAll}(escrow, true) first).
contract LoyaltyPoints is ERC1155, ERC1155Burnable, ERC1155Supply, Ownable {
    /// @notice Next merchant id to assign. Starts at 1 so that id 0 always means "unregistered".
    uint256 public nextMerchantId = 1;

    /// @notice merchant id => address that controls (mints for) that id.
    mapping(uint256 => address) public merchantOwner;

    event MerchantRegistered(uint256 indexed merchantId, address indexed owner);
    event MerchantOwnershipTransferred(
        uint256 indexed merchantId,
        address indexed previousOwner,
        address indexed newOwner
    );
    event PointsMinted(uint256 indexed merchantId, address indexed to, uint256 amount);

    error MerchantNotRegistered(uint256 merchantId);
    error NotMerchantOwner(uint256 merchantId, address caller);
    error ZeroAddress();

    /// @param uri_ Base metadata URI (ERC-1155 `{id}` substitution applies).
    /// @param initialOwner Platform/relayer address that may register merchants.
    constructor(string memory uri_, address initialOwner)
        ERC1155(uri_)
        Ownable(initialOwner)
    {}

    /// @notice Restricts to the owner of `merchantId`, with the contract owner as a fallback admin.
    modifier onlyMerchantOwner(uint256 merchantId) {
        if (merchantOwner[merchantId] == address(0)) {
            revert MerchantNotRegistered(merchantId);
        }
        if (msg.sender != merchantOwner[merchantId] && msg.sender != owner()) {
            revert NotMerchantOwner(merchantId, msg.sender);
        }
        _;
    }

    /// @notice Registers a new merchant and assigns it the next sequential token id.
    /// @dev Only the platform owner may onboard merchants.
    /// @param merchant Address that will own/mint the new merchant id.
    /// @return merchantId The freshly assigned merchant id (also the ERC-1155 token id).
    function registerMerchant(address merchant) external onlyOwner returns (uint256 merchantId) {
        if (merchant == address(0)) revert ZeroAddress();
        merchantId = nextMerchantId++;
        merchantOwner[merchantId] = merchant;
        emit MerchantRegistered(merchantId, merchant);
    }

    /// @notice Transfers control of a merchant id to a new owner.
    function transferMerchantOwnership(uint256 merchantId, address newOwner)
        external
        onlyMerchantOwner(merchantId)
    {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = merchantOwner[merchantId];
        merchantOwner[merchantId] = newOwner;
        emit MerchantOwnershipTransferred(merchantId, previous, newOwner);
    }

    /// @notice Mints loyalty points for a merchant to a customer.
    /// @param merchantId The merchant (token) id to mint.
    /// @param to Customer receiving the points.
    /// @param amount Number of points to mint.
    function mint(uint256 merchantId, address to, uint256 amount)
        external
        onlyMerchantOwner(merchantId)
    {
        if (to == address(0)) revert ZeroAddress();
        _mint(to, merchantId, amount, "");
        emit PointsMinted(merchantId, to, amount);
    }

    /// @dev True once a merchant id has been registered.
    function isRegistered(uint256 merchantId) external view returns (bool) {
        return merchantOwner[merchantId] != address(0);
    }

    // --- required overrides (ERC1155 + ERC1155Supply) ---

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}
