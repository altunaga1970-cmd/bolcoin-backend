// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title KenoGame — On-chain Keno with Chainlink VRF (MVP)
/// @notice MVP flow: 1 bet = 1 VRF request. Direct ERC20 payout. No internal balances.
/// @dev Session-based net settlement (settleKenoSession) is Phase 2, disabled by default.
///
/// TRUST MODEL (MVP — VRF On-Chain):
///   1. User calls placeBet() → tokens transferred to contract → VRF requested.
///   2. Chainlink VRF fulfills with provably random word → contract draws 20 numbers,
///      calculates hits/payout, pays user directly via ERC20 transfer.
///   3. Payout table is on-chain and versioned. Each bet snapshots the active version.
///   4. The contract is fully trustless: no operator can fabricate results.
///   5. RESIDUAL RISK: Owner can update payout table (with 24h timelock + no pending bets).
///
/// PHASE 2 — Session Settlement (disabled by default):
///   settleKenoSession() exists for backward compatibility with the off-chain backend.
///   It requires an EIP-712 operator signature and per-user anti-replay.
///   Enable only after backend EIP-712 integration. Not used in MVP.
contract KenoGame is VRFConsumerBaseV2Plus, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ─── CONSTANTS ───
    uint8 public constant TOTAL_NUMBERS = 80;
    uint8 public constant DRAWN_NUMBERS = 20;
    uint8 public constant MIN_SPOTS = 1;
    uint8 public constant MAX_SPOTS = 10;

    // ─── IMMUTABLES ───
    IERC20 public immutable paymentToken;

    // ─── VRF CONFIG ───
    uint256 public vrfSubscriptionId;
    bytes32 public vrfKeyHash;
    uint32 public vrfCallbackGasLimit = 300_000;
    uint16 public vrfRequestConfirmations = 3;

    // ─── OPERATOR (Phase 2 settlement) ───
    address public operator;

    // ─── FLOW GATING ───
    bool public settlementEnabled; // false by default (Phase 2)

    // ─── FEES ───
    uint16 public feeBps = 1200; // 12% on losses only
    uint256 public accruedFees;

    // ─── BET STATE ───
    uint256 public betCounter;
    uint256 public betAmount = 1e6; // 1 USDT (6 decimals)
    uint256 public pendingBetCount;
    uint256 public constant BET_TIMEOUT = 1 hours;

    enum BetStatus { PENDING, PAID, UNPAID }

    struct Bet {
        address user;
        uint128 amount;
        uint128 payout;
        uint8 spots;
        uint8 hits;
        uint256 selectedBitmap; // bit N set = number N selected (1-80)
        uint256 drawnBitmap;    // bit N set = number N drawn (1-80)
        BetStatus status;
    }

    mapping(uint256 => Bet) public bets;
    mapping(uint256 => uint256) public vrfRequestToBet;
    mapping(uint256 => uint256) public betPlacedAt; // betId => block.timestamp

    // ─── PAYOUT TABLE (versioned) ───
    // _payoutTables[version][spots][hits] = multiplier (1e2 scaled: 300 = 3.00x)
    mapping(uint256 => mapping(uint8 => mapping(uint8 => uint32))) internal _payoutTables;
    uint256 public payoutTableVersion;
    uint256 public payoutEffectiveFromBetId;
    uint256 public lastPayoutUpdateTimestamp;
    mapping(uint256 => uint256) public betPayoutVersion;
    mapping(uint256 => uint256) internal _populatedSpots; // version => bitmap of populated spots

    // ─── SETTLEMENT ANTI-REPLAY (Phase 2) ───
    mapping(address => mapping(bytes32 => bool)) public usedSessionIds;
    bytes32 public constant SETTLE_TYPEHASH = keccak256(
        "SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId)"
    );

    // ─── CUSTOM ERRORS ───
    error InvalidSpots();
    error InvalidNumber();
    error DuplicateNumber();
    error TimelockActive();
    error NotAllSpotsPopulated();
    error SettlementDisabled();
    error SessionAlreadySettled();
    error InvalidSignature();
    error NotUnpaid();
    error InsufficientPool();
    error NoPayoutTable();
    error PendingBetsExist();
    error BetNotExpired();
    error BetNotPending();

    // ─── EVENTS ───
    event BetPlaced(
        uint256 indexed betId, address indexed user,
        uint256 amount, uint8 spots, uint256 vrfRequestId
    );
    event BetResolved(
        uint256 indexed betId, address indexed user,
        uint8 hits, uint256 payout, bool paid
    );
    event BetUnpaid(uint256 indexed betId, uint256 payoutNeeded, uint256 poolAvailable);
    event BetRetryPaid(uint256 indexed betId, address indexed user, uint256 payout);
    event BetCancelled(uint256 indexed betId, address indexed user, uint256 refund);
    event FeesAccrued(uint256 feeAmount, uint256 totalAccrued);
    event PayoutTableUpdated(uint256 version, uint256 effectiveFromBetId);
    event OperatorUpdated(address indexed oldOp, address indexed newOp);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PoolFunded(address indexed from, uint256 amount);
    event KenoSessionSettled(
        address indexed user, uint256 netAmount, bool isProfit, bytes32 sessionId
    );

    // ─── CONSTRUCTOR ───
    /// @param _token Payment token address (USDT 6 decimals)
    /// @param _vrfCoordinator Chainlink VRF V2.5 Coordinator
    /// @param _vrfSubId VRF subscription ID
    /// @param _vrfKeyHash VRF key hash for gas lane
    /// @param _operator Backend operator address (Phase 2 settlement)
    constructor(
        address _token,
        address _vrfCoordinator,
        uint256 _vrfSubId,
        bytes32 _vrfKeyHash,
        address _operator
    )
        VRFConsumerBaseV2Plus(_vrfCoordinator)
        EIP712("KenoGame", "1")
    {
        paymentToken = IERC20(_token);
        vrfSubscriptionId = _vrfSubId;
        vrfKeyHash = _vrfKeyHash;
        operator = _operator;
        // settlementEnabled = false by default (Phase 2 disabled)
    }

    // ═══════════════════════════════════════
    //  POOL — derived from token balance
    // ═══════════════════════════════════════

    /// @notice Available pool for payouts = token balance - fees owed to owner.
    /// @dev No stored poolBalance variable. Tokens sent directly to contract increase pool.
    function availablePool() public view returns (uint256) {
        uint256 bal = paymentToken.balanceOf(address(this));
        return bal > accruedFees ? bal - accruedFees : 0;
    }

    // ═══════════════════════════════════════
    //  MVP FLOW: placeBet → VRF → payout
    // ═══════════════════════════════════════

    /// @notice Place a Keno bet. Transfers betAmount from caller. Requests Chainlink VRF.
    /// @param selectedNumbers Array of 1-10 unique numbers in range [1, 80]
    function placeBet(uint8[] calldata selectedNumbers) external whenNotPaused nonReentrant {
        uint8 spots = uint8(selectedNumbers.length);
        if (spots < MIN_SPOTS || spots > MAX_SPOTS) revert InvalidSpots();
        if (payoutTableVersion == 0) revert NoPayoutTable();

        // Build bitmap and validate uniqueness + range
        uint256 bitmap = 0;
        for (uint8 i = 0; i < spots; i++) {
            uint8 num = selectedNumbers[i];
            if (num < 1 || num > TOTAL_NUMBERS) revert InvalidNumber();
            uint256 bit = uint256(1) << num;
            if ((bitmap & bit) != 0) revert DuplicateNumber();
            bitmap |= bit;
        }

        // Transfer bet from user to contract
        uint256 bet = betAmount;
        paymentToken.safeTransferFrom(msg.sender, address(this), bet);

        // Store bet
        uint256 betId = ++betCounter;
        bets[betId] = Bet({
            user: msg.sender,
            amount: uint128(bet),
            payout: 0,
            spots: spots,
            hits: 0,
            selectedBitmap: bitmap,
            drawnBitmap: 0,
            status: BetStatus.PENDING
        });
        betPayoutVersion[betId] = payoutTableVersion;
        betPlacedAt[betId] = block.timestamp;
        pendingBetCount++;

        // Request VRF randomness
        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );
        vrfRequestToBet[requestId] = betId;

        emit BetPlaced(betId, msg.sender, bet, spots, requestId);
    }

    /// @notice Chainlink VRF callback. Draws 20 numbers, calculates payout, pays or marks UNPAID.
    /// @dev NEVER REVERTS. Uses low-level call for token transfer to prevent VRF callback failure.
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 betId = vrfRequestToBet[requestId];
        Bet storage b = bets[betId];

        // Safety: skip unknown requests (should not happen)
        if (b.user == address(0)) return;

        // If bet was already cancelled, skip
        if (b.status != BetStatus.PENDING) return;

        // Draw 20 numbers from VRF randomness
        uint256 drawnBitmap = _drawNumbers(randomWords[0]);
        b.drawnBitmap = drawnBitmap;

        // Count hits
        uint8 hits = _countHits(b.selectedBitmap, drawnBitmap);
        b.hits = hits;

        // Lookup multiplier from versioned payout table
        uint256 version = betPayoutVersion[betId];
        uint32 multiplier = _payoutTables[version][b.spots][hits];

        // Calculate payout (multiplier is 1e2 scaled: 300 = 3.00x)
        uint256 payout = (uint256(b.amount) * uint256(multiplier)) / 100;
        b.payout = uint128(payout);

        // Fee on loss: fee = (bet - payout) * feeBps / 10000
        if (payout < uint256(b.amount)) {
            uint256 loss = uint256(b.amount) - payout;
            uint256 fee = (loss * uint256(feeBps)) / 10000;
            accruedFees += fee;
            emit FeesAccrued(fee, accruedFees);
        }

        // Pay user or mark UNPAID
        bool paid = false;
        if (payout > 0) {
            uint256 pool = availablePool();
            if (pool >= payout) {
                // Low-level call to prevent revert in VRF callback
                (bool success, ) = address(paymentToken).call(
                    abi.encodeCall(IERC20.transfer, (b.user, payout))
                );
                if (success) {
                    paid = true;
                    b.status = BetStatus.PAID;
                } else {
                    b.status = BetStatus.UNPAID;
                    emit BetUnpaid(betId, payout, pool);
                }
            } else {
                b.status = BetStatus.UNPAID;
                emit BetUnpaid(betId, payout, pool);
            }
        } else {
            paid = true;
            b.status = BetStatus.PAID; // Nothing to pay (loss)
        }

        if (pendingBetCount > 0) {
            pendingBetCount--;
        }

        emit BetResolved(betId, b.user, hits, payout, paid);
    }

    /// @dev Draw DRAWN_NUMBERS unique numbers in [1, TOTAL_NUMBERS] from a VRF random word.
    ///      Uses iterative hashing with bitmap for O(1) duplicate check.
    function _drawNumbers(uint256 randomWord) internal pure returns (uint256 bitmap) {
        uint8 count = 0;
        uint256 seed = randomWord;
        while (count < DRAWN_NUMBERS) {
            seed = uint256(keccak256(abi.encodePacked(seed)));
            uint8 num = uint8((seed % TOTAL_NUMBERS) + 1);
            uint256 bit = uint256(1) << num;
            if ((bitmap & bit) == 0) {
                bitmap |= bit;
                count++;
            }
        }
    }

    /// @dev Count set bits in the intersection of two bitmaps (popcount of AND).
    function _countHits(
        uint256 selectedBitmap,
        uint256 drawnBitmap
    ) internal pure returns (uint8 count) {
        uint256 matched = selectedBitmap & drawnBitmap;
        while (matched != 0) {
            matched &= (matched - 1); // clear lowest set bit
            count++;
        }
    }

    // ═══════════════════════════════════════
    //  UNPAID RETRY
    // ═══════════════════════════════════════

    /// @notice Retry payout for a bet marked UNPAID due to insufficient pool.
    ///         Pays EXACTLY the pre-calculated payout. Does NOT recompute from table.
    /// @param betId The bet ID to retry
    function retryUnpaidBet(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        if (b.status != BetStatus.UNPAID) revert NotUnpaid();
        uint256 payout = uint256(b.payout);
        if (availablePool() < payout) revert InsufficientPool();

        b.status = BetStatus.PAID;
        paymentToken.safeTransfer(b.user, payout);
        emit BetRetryPaid(betId, b.user, payout);
    }

    // ═══════════════════════════════════════
    //  CANCEL STALE BETS
    // ═══════════════════════════════════════

    /// @notice Cancel a stuck PENDING bet after timeout. Refunds user. Anyone can call.
    function cancelStaleBet(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        if (b.status != BetStatus.PENDING) revert BetNotPending();
        if (block.timestamp < betPlacedAt[betId] + BET_TIMEOUT) revert BetNotExpired();

        b.status = BetStatus.PAID; // Mark resolved to prevent VRF late callback
        b.payout = b.amount;       // Full refund
        b.hits = 0;

        if (pendingBetCount > 0) pendingBetCount--;

        paymentToken.safeTransfer(b.user, uint256(b.amount));
        emit BetCancelled(betId, b.user, uint256(b.amount));
    }

    // ═══════════════════════════════════════
    //  PAYOUT TABLE MANAGEMENT
    // ═══════════════════════════════════════

    /// @notice Write payout multipliers for a spot count (pending, not yet active).
    /// @param spots Number of spots (1-10)
    /// @param multipliers Array of multipliers for 0..spots hits (1e2 scaled: 300 = 3.00x)
    function updatePayoutRow(
        uint8 spots,
        uint32[] calldata multipliers
    ) external onlyOwner {
        if (spots < MIN_SPOTS || spots > MAX_SPOTS) revert InvalidSpots();
        require(multipliers.length == uint256(spots) + 1, "Wrong length");

        uint256 nextVersion = payoutTableVersion + 1;
        for (uint8 i = 0; i <= spots; i++) {
            _payoutTables[nextVersion][spots][i] = multipliers[i];
        }
        _populatedSpots[nextVersion] |= (uint256(1) << spots);
    }

    /// @notice Activate the pending payout table version.
    /// @dev First commit has no timelock. Subsequent commits require 24h + no pending bets.
    function commitPayoutUpdate() external onlyOwner {
        uint256 nextVersion = payoutTableVersion + 1;

        // Verify all spot rows (1-10) are populated
        uint256 required = 0;
        for (uint8 i = MIN_SPOTS; i <= MAX_SPOTS; i++) {
            required |= (uint256(1) << i);
        }
        if (_populatedSpots[nextVersion] != required) revert NotAllSpotsPopulated();

        // Timelock: first commit is free, subsequent require 24h + no pending bets
        if (payoutTableVersion > 0) {
            if (block.timestamp < lastPayoutUpdateTimestamp + 24 hours) revert TimelockActive();
            if (pendingBetCount > 0) revert PendingBetsExist();
        }

        payoutTableVersion = nextVersion;
        lastPayoutUpdateTimestamp = block.timestamp;
        payoutEffectiveFromBetId = betCounter + 1;
        emit PayoutTableUpdated(nextVersion, payoutEffectiveFromBetId);
    }

    /// @notice Get payout multiplier for current table version
    function getPayoutMultiplier(
        uint8 spots,
        uint8 hits
    ) external view returns (uint32) {
        return _payoutTables[payoutTableVersion][spots][hits];
    }

    /// @notice Get payout multiplier for a specific table version
    function getPayoutMultiplierForVersion(
        uint256 version,
        uint8 spots,
        uint8 hits
    ) external view returns (uint32) {
        return _payoutTables[version][spots][hits];
    }

    // ═══════════════════════════════════════
    //  PHASE 2: SESSION SETTLEMENT (disabled)
    // ═══════════════════════════════════════

    /// @notice Settle a Keno session's net result. PHASE 2 — disabled by default.
    /// @dev TRUST MODEL (Phase 2 — Off-chain Settlement):
    ///   1. RNG: Backend computes SHA-256(serverSeed + clientSeed + nonce) per game.
    ///      serverSeedHash is committed before play; seed revealed after → verifiable.
    ///   2. Aggregation: Sessions accumulate N verifiable games.
    ///      Net result = sum(payouts) - sum(bets).
    ///   3. Signature: Operator signs EIP-712 typed data:
    ///      (user, netAmount, isProfit, sessionId).
    ///      Contract verifies signature matches registered operator.
    ///      sessionId is per-user unique (anti-replay).
    ///   4. CURRENT STUB: Emits event only. No fund movement.
    ///      Full implementation requires userBalances mapping + withdraw() pattern.
    ///   5. RESIDUAL RISK: Operator controls server_seed generation.
    ///      Mitigated by commit-reveal. MVP uses VRF flow instead (trustless).
    function settleKenoSession(
        address user,
        uint256 netAmount,
        bool isProfit,
        bytes32 sessionId,
        bytes calldata signature
    ) external whenNotPaused {
        if (!settlementEnabled) revert SettlementDisabled();
        if (usedSessionIds[user][sessionId]) revert SessionAlreadySettled();

        // Verify EIP-712 operator signature
        bytes32 structHash = keccak256(
            abi.encode(SETTLE_TYPEHASH, user, netAmount, isProfit, sessionId)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != operator) revert InvalidSignature();

        usedSessionIds[user][sessionId] = true;

        // Phase 2 stub: emit event only, no fund movement
        emit KenoSessionSettled(user, netAmount, isProfit, sessionId);
    }

    // ═══════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════

    /// @notice Fund the pool by transferring tokens to the contract
    function fundPool(uint256 amount) external onlyOwner {
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Withdraw accrued fees (12% of losses)
    function withdrawFees(uint256 amount, address to) external onlyOwner {
        require(amount <= accruedFees, "Exceeds accrued fees");
        require(to != address(0), "Zero address");
        accruedFees -= amount;
        paymentToken.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    /// @notice Set the operator address (Phase 2 settlement signer)
    function setOperator(address _operator) external onlyOwner {
        address old = operator;
        operator = _operator;
        emit OperatorUpdated(old, _operator);
    }

    /// @notice Set the fixed bet amount (in token decimals)
    function setBetAmount(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Zero amount");
        betAmount = _amount;
    }

    /// @notice Enable/disable Phase 2 settlement flow
    function setSettlementEnabled(bool _enabled) external onlyOwner {
        settlementEnabled = _enabled;
    }

    /// @notice Update Chainlink VRF configuration
    function setVrfConfig(
        uint256 _subId,
        bytes32 _keyHash,
        uint32 _gasLimit,
        uint16 _confirmations
    ) external onlyOwner {
        vrfSubscriptionId = _subId;
        vrfKeyHash = _keyHash;
        vrfCallbackGasLimit = _gasLimit;
        vrfRequestConfirmations = _confirmations;
    }

    /// @notice Pause all bet placement and settlement
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract
    function unpause() external onlyOwner {
        _unpause();
    }
}
