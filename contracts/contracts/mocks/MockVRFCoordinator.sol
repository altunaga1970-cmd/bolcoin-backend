// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title MockVRFCoordinator — Minimal VRF V2.5 coordinator mock for testing
/// @dev Implements only requestRandomWords. Test calls fulfillRandomWords to trigger callback.
contract MockVRFCoordinator {
    uint256 private _nextRequestId;

    struct Request {
        address consumer;
        bool fulfilled;
    }

    mapping(uint256 => Request) public requests;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId);

    /// @notice Mock requestRandomWords — stores consumer and returns incremental requestId
    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata /* req */
    ) external returns (uint256 requestId) {
        requestId = ++_nextRequestId;
        requests[requestId] = Request({consumer: msg.sender, fulfilled: false});
        emit RandomWordsRequested(requestId, msg.sender);
    }

    /// @notice Fulfill a pending VRF request (test helper)
    /// @dev Calls rawFulfillRandomWords on the consumer. This contract must be
    ///      the vrfCoordinator address that the consumer was deployed with.
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) external {
        Request storage req = requests[requestId];
        require(req.consumer != address(0), "Request not found");
        require(!req.fulfilled, "Already fulfilled");
        req.fulfilled = true;

        // Call rawFulfillRandomWords on the consumer
        // This works because this contract IS the registered vrfCoordinator
        (bool success, bytes memory reason) = req.consumer.call(
            abi.encodeWithSignature(
                "rawFulfillRandomWords(uint256,uint256[])",
                requestId,
                randomWords
            )
        );
        if (!success) {
            // Bubble up revert reason
            if (reason.length > 0) {
                assembly { revert(add(reason, 32), mload(reason)) }
            }
            revert("Fulfill failed");
        }

        emit RandomWordsFulfilled(requestId);
    }

    /// @notice Get the next request ID that will be assigned
    function nextRequestId() external view returns (uint256) {
        return _nextRequestId + 1;
    }
}
