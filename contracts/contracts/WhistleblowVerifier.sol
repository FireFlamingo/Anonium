// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {GroupManager} from "./GroupManager.sol";

/// @title WhistleblowVerifier
/// @notice Accepts anonymous reports backed by a Semaphore zero-knowledge proof of group membership.
/// A valid proof shows the sender is *some* member of the organisation, never *which* one.
/// @dev Only hashes are stored. The report text stays off-chain with the whistleblower and recipient.
///
/// Signal binding: `proof.message` is the report hash (the signal) and `proof.scope` must equal it.
/// The nullifier is Poseidon(scope, secret), so one identity can submit a given report only once,
/// while *different* insiders submitting the same report each count as an independent corroboration.
contract WhistleblowVerifier {
    struct Submission {
        uint256 id;
        uint256 groupId;
        uint256 signal;
        uint256 nullifier;
        uint256 merkleTreeRoot;
        uint64 timestamp;
        uint64 blockNumber;
    }

    ISemaphore public immutable semaphore;
    GroupManager public immutable groupManager;

    Submission[] private _submissions;
    mapping(uint256 => uint256[]) private _idsBySignal;
    mapping(uint256 => mapping(uint256 => bool)) public nullifierUsed; // groupId => nullifier => used

    event ReportVerified(
        uint256 indexed id,
        uint256 indexed groupId,
        uint256 indexed signal,
        uint256 nullifier,
        uint256 merkleTreeRoot,
        uint256 timestamp
    );

    error UnknownGroup(uint256 groupId);
    error ScopeMustEqualSignal();
    error DuplicateSubmission(uint256 nullifier);
    error InvalidProof();
    error SubmissionNotFound(uint256 id);

    constructor(ISemaphore semaphore_, GroupManager groupManager_) {
        semaphore = semaphore_;
        groupManager = groupManager_;
    }

    /// @notice Verifies the membership proof and, if valid, logs the report hash as a verified insider signal.
    /// Reverts on an invalid proof, an unknown group, an expired/unknown Merkle root, or a reused nullifier.
    function submitReport(uint256 groupId, ISemaphore.SemaphoreProof calldata proof) external returns (uint256 id) {
        if (!groupManager.groupExists(groupId)) revert UnknownGroup(groupId);
        if (proof.scope != proof.message) revert ScopeMustEqualSignal();
        if (nullifierUsed[groupId][proof.nullifier]) revert DuplicateSubmission(proof.nullifier);

        // Semaphore checks the Groth16 proof against the group's current (or recently superseded) root.
        if (!semaphore.verifyProof(groupId, proof)) revert InvalidProof();

        nullifierUsed[groupId][proof.nullifier] = true;

        id = _submissions.length;
        _submissions.push(
            Submission({
                id: id,
                groupId: groupId,
                signal: proof.message,
                nullifier: proof.nullifier,
                merkleTreeRoot: proof.merkleTreeRoot,
                timestamp: uint64(block.timestamp),
                blockNumber: uint64(block.number)
            })
        );
        _idsBySignal[proof.message].push(id);

        emit ReportVerified(id, groupId, proof.message, proof.nullifier, proof.merkleTreeRoot, block.timestamp);
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Was this report hash submitted with a valid insider proof?
    /// @return verified True if at least one valid submission exists.
    /// @return groupId Group of the first verified submission.
    /// @return timestamp Time of the first verified submission.
    /// @return corroborations Number of distinct verified submissions of this exact report.
    function isVerified(
        uint256 signal
    ) external view returns (bool verified, uint256 groupId, uint256 timestamp, uint256 corroborations) {
        uint256[] storage ids = _idsBySignal[signal];
        if (ids.length == 0) return (false, 0, 0, 0);
        Submission storage first = _submissions[ids[0]];
        return (true, first.groupId, first.timestamp, ids.length);
    }

    function getSubmission(uint256 id) external view returns (Submission memory) {
        if (id >= _submissions.length) revert SubmissionNotFound(id);
        return _submissions[id];
    }

    function getSubmissionsBySignal(uint256 signal) external view returns (Submission[] memory list) {
        uint256[] storage ids = _idsBySignal[signal];
        list = new Submission[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) list[i] = _submissions[ids[i]];
    }

    function getSubmissionCount() external view returns (uint256) {
        return _submissions.length;
    }

    /// @notice Most-recent-first page of submissions, for the public verification dashboard.
    function getRecentSubmissions(uint256 offset, uint256 limit) external view returns (Submission[] memory page) {
        uint256 total = _submissions.length;
        if (offset >= total) return new Submission[](0);
        uint256 count = total - offset < limit ? total - offset : limit;
        page = new Submission[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _submissions[total - 1 - offset - i];
        }
    }
}
