// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {ISemaphoreGroups} from "@semaphore-protocol/contracts/interfaces/ISemaphoreGroups.sol";

/// @title GroupManager
/// @notice Registers organisations as Semaphore groups and manages their membership.
/// Only identity commitments (Poseidon hashes) are stored. No personal data ever touches the chain.
/// @dev This contract is the Semaphore admin of every group it creates; the human admin of each
/// organisation is tracked here and enforced by `onlyGroupAdmin`.
contract GroupManager {
    struct Organization {
        uint256 groupId;
        string name;
        address admin;
        uint64 createdAt;
        uint32 activeMembers;
    }

    /// How long a superseded Merkle root keeps accepting proofs (Semaphore's revocation window).
    uint256 public constant DEFAULT_ROOT_DURATION = 1 hours;

    ISemaphore public immutable semaphore;

    uint256[] private _groupIds;
    mapping(uint256 => Organization) private _orgs;
    mapping(uint256 => bool) public groupExists;

    /// Leaves of each group's Merkle tree in insertion order. A removed member's leaf is 0,
    /// mirroring Semaphore's LeanIMT, so clients can rebuild the exact on-chain tree.
    mapping(uint256 => uint256[]) private _leaves;
    /// groupId => commitment => (leaf index + 1). Zero means "not an active member".
    mapping(uint256 => mapping(uint256 => uint256)) private _leafIndexPlusOne;

    event OrganizationCreated(uint256 indexed groupId, string name, address indexed admin);
    event MemberAdded(uint256 indexed groupId, uint256 indexed identityCommitment, uint256 index);
    event MemberRemoved(uint256 indexed groupId, uint256 indexed identityCommitment, uint256 index);
    event AdminTransferred(uint256 indexed groupId, address indexed previousAdmin, address indexed newAdmin);

    error GroupNotFound(uint256 groupId);
    error NotGroupAdmin(uint256 groupId, address caller);
    error EmptyName();
    error InvalidCommitment();
    error AlreadyMember(uint256 identityCommitment);
    error NotMember(uint256 identityCommitment);
    error ZeroAddress();

    modifier onlyExisting(uint256 groupId) {
        if (!groupExists[groupId]) revert GroupNotFound(groupId);
        _;
    }

    modifier onlyGroupAdmin(uint256 groupId) {
        if (!groupExists[groupId]) revert GroupNotFound(groupId);
        if (_orgs[groupId].admin != msg.sender) revert NotGroupAdmin(groupId, msg.sender);
        _;
    }

    constructor(ISemaphore semaphore_) {
        if (address(semaphore_) == address(0)) revert ZeroAddress();
        semaphore = semaphore_;
    }

    // ───────────────────────────── Admin actions ─────────────────────────────

    /// @notice Registers a new organisation and creates its Semaphore group. The caller becomes admin.
    /// @dev Semaphore v4 uses a dynamic-depth LeanIMT, so no tree depth parameter is needed.
    function createGroup(string calldata name) external returns (uint256 groupId) {
        if (bytes(name).length == 0) revert EmptyName();

        groupId = semaphore.createGroup(address(this), DEFAULT_ROOT_DURATION);

        _orgs[groupId] = Organization({
            groupId: groupId,
            name: name,
            admin: msg.sender,
            createdAt: uint64(block.timestamp),
            activeMembers: 0
        });
        groupExists[groupId] = true;
        _groupIds.push(groupId);

        emit OrganizationCreated(groupId, name, msg.sender);
    }

    /// @notice Adds one employee identity commitment to the organisation's Merkle tree.
    function addMember(uint256 groupId, uint256 identityCommitment) external onlyGroupAdmin(groupId) {
        _recordMember(groupId, identityCommitment);
        semaphore.addMember(groupId, identityCommitment);
    }

    /// @notice Adds several identity commitments in one transaction (cheaper than one by one).
    function addMembers(uint256 groupId, uint256[] calldata identityCommitments) external onlyGroupAdmin(groupId) {
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            _recordMember(groupId, identityCommitments[i]);
        }
        semaphore.addMembers(groupId, identityCommitments);
    }

    /// @notice Removes a member (e.g. after termination). The leaf is zeroed and the Merkle root changes.
    /// @param merkleProofSiblings Siblings of the member's leaf, computed off-chain from `getMembers`.
    function removeMember(
        uint256 groupId,
        uint256 identityCommitment,
        uint256[] calldata merkleProofSiblings
    ) external onlyGroupAdmin(groupId) {
        uint256 indexPlusOne = _leafIndexPlusOne[groupId][identityCommitment];
        if (indexPlusOne == 0) revert NotMember(identityCommitment);

        semaphore.removeMember(groupId, identityCommitment, merkleProofSiblings);

        uint256 index = indexPlusOne - 1;
        _leaves[groupId][index] = 0;
        delete _leafIndexPlusOne[groupId][identityCommitment];
        _orgs[groupId].activeMembers -= 1;

        emit MemberRemoved(groupId, identityCommitment, index);
    }

    /// @notice Hands the organisation over to a new admin address.
    function transferAdmin(uint256 groupId, address newAdmin) external onlyGroupAdmin(groupId) {
        if (newAdmin == address(0)) revert ZeroAddress();
        address previous = _orgs[groupId].admin;
        _orgs[groupId].admin = newAdmin;
        emit AdminTransferred(groupId, previous, newAdmin);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getOrganization(uint256 groupId) external view onlyExisting(groupId) returns (Organization memory) {
        return _orgs[groupId];
    }

    function getOrganizations() external view returns (Organization[] memory list) {
        list = new Organization[](_groupIds.length);
        for (uint256 i = 0; i < _groupIds.length; i++) {
            list[i] = _orgs[_groupIds[i]];
        }
    }

    function getOrganizationCount() external view returns (uint256) {
        return _groupIds.length;
    }

    /// @notice All leaves of the group's Merkle tree, in order, with removed members as 0.
    function getMembers(uint256 groupId) external view onlyExisting(groupId) returns (uint256[] memory) {
        return _leaves[groupId];
    }

    function isMember(uint256 groupId, uint256 identityCommitment) external view returns (bool) {
        return _leafIndexPlusOne[groupId][identityCommitment] != 0;
    }

    function getMerkleRoot(uint256 groupId) external view onlyExisting(groupId) returns (uint256) {
        return ISemaphoreGroups(address(semaphore)).getMerkleTreeRoot(groupId);
    }

    // ───────────────────────────── Internal ─────────────────────────────

    function _recordMember(uint256 groupId, uint256 identityCommitment) private {
        if (identityCommitment == 0) revert InvalidCommitment();
        if (_leafIndexPlusOne[groupId][identityCommitment] != 0) revert AlreadyMember(identityCommitment);

        _leaves[groupId].push(identityCommitment);
        uint256 index = _leaves[groupId].length - 1;
        _leafIndexPlusOne[groupId][identityCommitment] = index + 1;
        _orgs[groupId].activeMembers += 1;

        emit MemberAdded(groupId, identityCommitment, index);
    }
}
