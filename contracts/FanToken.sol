// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FanToken (FAN)
/// @notice Free-to-play game token with no monetary value. Anyone can claim
///         from the faucet once per cooldown period.
contract FanToken is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed user, uint256 amount);

    constructor() ERC20("Fantasy Fan Token", "FAN") Ownable(msg.sender) {}

    function claimFaucet() external {
        require(block.timestamp >= lastClaim[msg.sender] + FAUCET_COOLDOWN, "Faucet: cooldown");
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Mint tokens for sponsored prize pools.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
