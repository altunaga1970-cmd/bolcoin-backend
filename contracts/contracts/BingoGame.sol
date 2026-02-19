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

/// @title BingoGame — Non-custodial Bingo 3×5 with Chainlink VRF
/// @notice Multiplayer draw-based Bingo. Card purchases go to contract, payouts from contract.
///
/// REVENUE MODEL:
///   10% Fee (operator) | 10% Reserve (jackpot) | 80% Winner Pot
///   Winner Pot: 15% → Line winner(s) | 85% → Bingo winner(s) (100% distributed)
///   Jackpot: accumulated reserve, paid to bingo winner(s) if bingo on or before ball #25
///   No winners after all balls → 10% fee + 90% to jackpot
///
/// TRUST MODEL (Hybrid Non-Custodial):
///   1. Users call buyCards() → USDT transferred to contract (non-custodial)
///   2. Operator calls closeAndRequestVRF() → Chainlink VRF provides random seed
///   3. Backend resolves off-chain (deterministic from VRF seed), signs EIP-712
///   4. Operator calls resolveRound() with signed results → contract pays winners
///   5. Anyone can verify results by recalculating from public VRF seed + card data
contract BingoGame is VRFConsumerBaseV2Plus, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ─── CONSTANTS ───
    uint8  public constant CARD_ROWS        = 3;
    uint8  public constant CARD_COLS        = 5;
    uint8  public constant NUMBERS_PER_CARD = 15;
    uint8  public constant TOTAL_BALLS      = 75;
    uint8  public constant MAX_CARDS_PER_USER = 4;
    uint8  public constant MAX_CO_WINNERS   = 10;  // [F-05] cap winner arrays to bound gas
    uint8  public constant MAX_OPEN_ROUNDS  = 4;   // [F-12] enforce scheduler invariant

    // ─── IMMUTABLES ───
    IERC20 public immutable paymentToken;

    // ─── VRF CONFIG ───
    uint256 public vrfSubscriptionId;
    bytes32 public vrfKeyHash;
    uint32  public vrfCallbackGasLimit     = 300_000;
    uint16  public vrfRequestConfirmations = 10;          // [prev fix] 10 blocks for security
    uint256 public vrfTimeoutSeconds       = 4 hours;     // [F-03] emergency cancel after this

    // ─── OPERATOR ───
    address public operator;

    // ─── GAME CONFIG ───
    uint256 public cardPrice           = 1e6; // 1 USDT (6 decimals)
    uint8   public jackpotBallThreshold = 25; // Bingo on or before this ball wins jackpot

    // ─── DISTRIBUTION DEFAULTS (stored per-round at creation, see Round struct) ───
    uint16 public feeBps        = 1000;  // 10%
    uint16 public reserveBps    = 1000;  // 10%
    uint16 public linePrizeBps  = 1500;  // 15% of winner pot
    uint16 public bingoPrizeBps = 8500;  // 85% of winner pot (sum must be 10000)

    // ─── ROUND STATE ───
    uint256   public roundCounter;
    uint256[] internal _openRoundIds; // [F-12] O(1) set of open rounds, max MAX_OPEN_ROUNDS

    enum RoundStatus {
        NONE,
        OPEN,
        CLOSED,
        VRF_REQUESTED,
        VRF_FULFILLED,
        RESOLVED,
        CANCELLED
    }

    struct Round {
        uint256 id;
        RoundStatus status;
        uint256 scheduledClose;          // unix timestamp when round closes
        uint256 totalCards;
        uint256 totalRevenue;            // cardPrice × totalCards
        uint256 vrfRequestId;
        uint256 vrfRequestedAt;          // [F-03/F-08] timestamp of VRF request
        uint256 vrfRandomWord;           // Chainlink VRF seed for ball generation
        // [F-13] price and [F-14] BPS frozen at round creation for correct refunds/prizes
        uint256 cardPriceAtCreation;
        uint16  feeBpsAtCreation;
        uint16  reserveBpsAtCreation;
        uint16  linePrizeBpsAtCreation;
        uint16  bingoPrizeBpsAtCreation;
        // Winners — arrays support co-winners
        address[] lineWinners;
        uint8     lineWinnerBall;        // 0 = no line winner
        address[] bingoWinners;
        uint8     bingoWinnerBall;       // 0 = no bingo winner
        bool    jackpotWon;
        uint256 jackpotPaid;
        // Financials (set at resolution)
        uint256 feeAmount;
        uint256 reserveAmount;
        uint256 linePrize;   // total line pool (split equally)
        uint256 bingoPrize;  // total bingo pool (split equally)
    }

    struct Card {
        address owner;
        uint256 roundId;
        uint8[15] numbers; // row-major 3×5
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => uint256) public vrfRequestToRound;

    // Cards
    uint256 public cardCounter;
    mapping(uint256 => Card) public cards;
    mapping(uint256 => uint256[]) internal _roundCards;

    // User cards per round
    mapping(uint256 => mapping(address => uint8))       public userCardCount;
    mapping(uint256 => mapping(address => uint256[]))   internal _userCards;

    // ─── FINANCIALS ───
    uint256 public accruedFees;
    uint256 public jackpotBalance;

    // ─── REFUNDS ───
    // [F-03/F-04] Cancel refunds computed on-demand in claimRefund — no loop in cancel tx
    mapping(uint256 => mapping(address => bool))    public refundClaimed;
    // [F-05] Fallback for failed prize transfers (USDT blacklist protection)
    mapping(uint256 => mapping(address => uint256)) public pendingPrizes;

    // ─── SETTLEMENT ANTI-REPLAY ───
    mapping(uint256 => bool) public roundResolved;

    // [F-07] EIP-712 typehash. Arrays encoded via _hashAddressArray (EIP-712 compliant).
    bytes32 public constant RESOLVE_TYPEHASH = keccak256(
        "ResolveRound(uint256 roundId,address[] lineWinners,uint8 lineWinnerBall,address[] bingoWinners,uint8 bingoWinnerBall)"
    );

    // ─── CUSTOM ERRORS ───
    error RoundNotFound();
    error RoundNotOpen();
    error RoundNotVrfFulfilled();
    error RoundAlreadyResolved();
    error InvalidCardCount();
    error MaxCardsExceeded();
    error NotOperator();
    error InvalidSignature();
    error VrfTimeoutNotReached();
    error NoRefundAvailable();
    error TooManyWinners();
    error InconsistentWinnerParams();
    error ZeroAddressWinner();
    error BallOutOfRange();
    error MaxOpenRoundsReached();

    // ─── EVENTS ───
    event RoundCreated(uint256 indexed roundId, uint256 scheduledClose);
    event CardsPurchased(
        uint256 indexed roundId, address indexed buyer,
        uint8 count, uint256[] cardIds, uint256 totalCost
    );
    event RoundClosed(uint256 indexed roundId, uint256 vrfRequestId);
    event VrfFulfilled(uint256 indexed roundId, uint256 randomWord);
    event RoundResolved(
        uint256 indexed roundId,
        address[] lineWinners, uint8 lineWinnerBall,
        address[] bingoWinners, uint8 bingoWinnerBall,
        bool jackpotWon, uint256 jackpotPaid
    );
    event RoundNoWinner(uint256 indexed roundId, uint256 toJackpot);
    event RoundCancelled(uint256 indexed roundId, uint256 totalRevenue);
    event EmergencyCancelled(uint256 indexed roundId);
    event RefundClaimed(uint256 indexed roundId, address indexed user, uint256 amount);
    event PrizeDeferred(uint256 indexed roundId, address indexed winner, uint256 amount);
    event JackpotContribution(uint256 indexed roundId, uint256 amount, uint256 newBalance);
    event JackpotPaid(uint256 indexed roundId, address indexed winner, uint256 amount);
    event FeesAccrued(uint256 indexed roundId, uint256 amount, uint256 totalAccrued);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PoolFunded(address indexed from, uint256 amount);
    event OperatorUpdated(address indexed oldOp, address indexed newOp);

    // ─── MODIFIERS ───
    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    // ─── CONSTRUCTOR ───
    constructor(
        address _token,
        address _vrfCoordinator,
        uint256 _vrfSubId,
        bytes32 _vrfKeyHash,
        address _operator
    )
        VRFConsumerBaseV2Plus(_vrfCoordinator)
        EIP712("BingoGame", "1")
    {
        require(_operator != address(0), "Zero operator");
        paymentToken = IERC20(_token);
        vrfSubscriptionId = _vrfSubId;
        vrfKeyHash = _vrfKeyHash;
        operator = _operator;
    }

    // ═══════════════════════════════════════
    //  POOL
    // ═══════════════════════════════════════

    /// @notice Available pool = token balance - accrued fees - jackpot
    function availablePool() public view returns (uint256) {
        uint256 bal = paymentToken.balanceOf(address(this));
        uint256 reserved = accruedFees + jackpotBalance;
        return bal > reserved ? bal - reserved : 0;
    }

    // ═══════════════════════════════════════
    //  ROUND LIFECYCLE
    // ═══════════════════════════════════════

    /// @notice Create a new bingo round. Only operator/owner.
    function createRound(uint256 scheduledClose) external onlyOperator {
        require(scheduledClose > block.timestamp, "Close time must be future");
        // [F-12] Enforce max concurrent open rounds (scheduler invariant)
        if (_openRoundIds.length >= MAX_OPEN_ROUNDS) revert MaxOpenRoundsReached();

        uint256 roundId = ++roundCounter;
        Round storage r = rounds[roundId];
        r.id = roundId;
        r.status = RoundStatus.OPEN;
        r.scheduledClose = scheduledClose;
        // [F-13] Freeze price at round creation
        r.cardPriceAtCreation = cardPrice;
        // [F-14] Freeze distribution BPS at round creation
        r.feeBpsAtCreation        = feeBps;
        r.reserveBpsAtCreation    = reserveBps;
        r.linePrizeBpsAtCreation  = linePrizeBps;
        r.bingoPrizeBpsAtCreation = bingoPrizeBps;

        _openRoundIds.push(roundId);

        emit RoundCreated(roundId, scheduledClose);
    }

    /// @notice Purchase bingo cards for an open round.
    function buyCards(uint256 roundId, uint8 count) external nonReentrant whenNotPaused {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.OPEN) revert RoundNotOpen();
        if (count < 1 || count > MAX_CARDS_PER_USER) revert InvalidCardCount();
        if (userCardCount[roundId][msg.sender] + count > MAX_CARDS_PER_USER) revert MaxCardsExceeded();

        uint256 totalCost = r.cardPriceAtCreation * uint256(count);
        paymentToken.safeTransferFrom(msg.sender, address(this), totalCost);

        uint256[] memory newCardIds = new uint256[](count);

        for (uint8 i = 0; i < count; i++) {
            uint256 cardId = ++cardCounter;
            uint8 cardIndex = userCardCount[roundId][msg.sender] + i;

            uint8[15] memory nums = _generateCardNumbers(roundId, msg.sender, cardIndex);

            cards[cardId] = Card({owner: msg.sender, roundId: roundId, numbers: nums});

            _roundCards[roundId].push(cardId);
            _userCards[roundId][msg.sender].push(cardId);
            newCardIds[i] = cardId;
        }

        userCardCount[roundId][msg.sender] += count;
        r.totalCards   += uint256(count);
        r.totalRevenue += totalCost;

        emit CardsPurchased(roundId, msg.sender, count, newCardIds, totalCost);
    }

    /// @notice Close a round and request Chainlink VRF randomness. Only operator.
    function closeAndRequestVRF(uint256 roundId) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.OPEN) revert RoundNotOpen();

        _removeFromOpenRounds(roundId);

        if (r.totalCards == 0) {
            r.status = RoundStatus.CANCELLED;
            emit RoundCancelled(roundId, 0);
            return;
        }

        r.status = RoundStatus.CLOSED;

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

        r.vrfRequestId  = requestId;
        r.vrfRequestedAt = block.timestamp;
        r.status = RoundStatus.VRF_REQUESTED;
        vrfRequestToRound[requestId] = roundId;

        emit RoundClosed(roundId, requestId);
    }

    /// @notice Chainlink VRF callback — stores random word, advances to VRF_FULFILLED.
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 roundId = vrfRequestToRound[requestId];
        Round storage r = rounds[roundId];
        if (r.id == 0) return;
        if (r.status != RoundStatus.VRF_REQUESTED) return;

        r.vrfRandomWord = randomWords[0];
        r.status = RoundStatus.VRF_FULFILLED;

        emit VrfFulfilled(roundId, randomWords[0]);
    }

    /// @notice Emergency cancel if VRF or operator does not respond within timeout.
    ///         [F-03] No loops — refunds computed on-demand in claimRefund().
    ///         [F-08] Works from VRF_REQUESTED (after 1× timeout) or VRF_FULFILLED (after 2× timeout).
    ///         Callable by anyone — protects users from a stuck round.
    function emergencyCancel(uint256 roundId) external {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();

        if (r.status == RoundStatus.VRF_REQUESTED) {
            // VRF never came — 1 timeout window
            if (block.timestamp < r.vrfRequestedAt + vrfTimeoutSeconds) revert VrfTimeoutNotReached();
        } else if (r.status == RoundStatus.VRF_FULFILLED) {
            // VRF came but operator never resolved — 2 timeout windows
            if (block.timestamp < r.vrfRequestedAt + vrfTimeoutSeconds * 2) revert VrfTimeoutNotReached();
        } else {
            revert("Cannot emergency cancel in current status");
        }

        r.status = RoundStatus.CANCELLED;
        emit EmergencyCancelled(roundId);
    }

    /// @notice Resolve a round with off-chain computed results, signed by operator (EIP-712).
    ///         Supports co-winners: prizes split equally. Remainder (dust) goes to first winner.
    ///         [F-05] USDT blacklist: failed transfers fall back to pendingPrizes (pull pattern).
    ///
    ///         Distribution:
    ///           Winners:   10% fee + 10% reserve + 80% pot (15% line + 85% bingo = 100%)
    ///           No winner: 10% fee + 90% → jackpot
    function resolveRound(
        uint256 roundId,
        address[] calldata lineWinners,
        uint8 lineWinnerBall,
        address[] calldata bingoWinners,
        uint8 bingoWinnerBall,
        bytes calldata signature
    ) external nonReentrant onlyOperator {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.VRF_FULFILLED) revert RoundNotVrfFulfilled();
        if (roundResolved[roundId]) revert RoundAlreadyResolved();

        // [F-02] Coherence: winners ↔ ball number must be consistent
        if (lineWinners.length > MAX_CO_WINNERS || bingoWinners.length > MAX_CO_WINNERS)
            revert TooManyWinners();
        if (lineWinnerBall > TOTAL_BALLS || bingoWinnerBall > TOTAL_BALLS)
            revert BallOutOfRange();
        if ((lineWinners.length == 0) != (lineWinnerBall == 0))
            revert InconsistentWinnerParams();
        if ((bingoWinners.length == 0) != (bingoWinnerBall == 0))
            revert InconsistentWinnerParams();
        for (uint256 i = 0; i < lineWinners.length; i++) {
            if (lineWinners[i] == address(0)) revert ZeroAddressWinner();
        }
        for (uint256 i = 0; i < bingoWinners.length; i++) {
            if (bingoWinners[i] == address(0)) revert ZeroAddressWinner();
        }

        // [F-07] EIP-712 signature — arrays hashed correctly per EIP-712 spec
        bytes32 structHash = keccak256(abi.encode(
            RESOLVE_TYPEHASH,
            roundId,
            _hashAddressArray(lineWinners),
            lineWinnerBall,
            _hashAddressArray(bingoWinners),
            bingoWinnerBall
        ));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != operator) revert InvalidSignature();

        roundResolved[roundId] = true;
        uint256 revenue = r.totalRevenue;
        bool hasWinner = (bingoWinners.length > 0 && bingoWinnerBall > 0);

        // [F-14] Use BPS frozen at round creation
        uint256 fee     = (revenue * uint256(r.feeBpsAtCreation)) / 10000;
        uint256 reserve = (revenue * uint256(r.reserveBpsAtCreation)) / 10000;

        if (hasWinner) {
            // ── NORMAL CASE ──
            uint256 pot = revenue - fee - reserve;

            uint256 totalLinePrize  = lineWinners.length > 0
                ? (pot * uint256(r.linePrizeBpsAtCreation)) / 10000
                : 0;
            uint256 totalBingoPrize = (pot * uint256(r.bingoPrizeBpsAtCreation)) / 10000;

            // Store
            r.feeAmount     = fee;
            r.reserveAmount = reserve;
            r.linePrize     = totalLinePrize;
            r.bingoPrize    = totalBingoPrize;
            r.lineWinnerBall  = lineWinnerBall;
            r.bingoWinnerBall = bingoWinnerBall;
            for (uint256 i = 0; i < lineWinners.length; i++) { r.lineWinners.push(lineWinners[i]); }
            for (uint256 i = 0; i < bingoWinners.length; i++) { r.bingoWinners.push(bingoWinners[i]); }

            accruedFees += fee;
            emit FeesAccrued(roundId, fee, accruedFees);

            jackpotBalance += reserve;
            emit JackpotContribution(roundId, reserve, jackpotBalance);

            // Pay line winners — [F-06] remainder to first winner
            if (totalLinePrize > 0 && lineWinners.length > 0) {
                uint256 perLine = totalLinePrize / lineWinners.length;
                uint256 lineRemainder = totalLinePrize - perLine * lineWinners.length;
                for (uint256 i = 0; i < lineWinners.length; i++) {
                    _safePay(lineWinners[i], perLine + (i == 0 ? lineRemainder : 0), roundId);
                }
            }

            // Pay bingo winners — [F-06] remainder to first winner
            {
                uint256 perBingo = totalBingoPrize / bingoWinners.length;
                uint256 bingoRemainder = totalBingoPrize - perBingo * bingoWinners.length;
                for (uint256 i = 0; i < bingoWinners.length; i++) {
                    _safePay(bingoWinners[i], perBingo + (i == 0 ? bingoRemainder : 0), roundId);
                }
            }

            // Jackpot: bingo on or before threshold — [F-06] remainder to first winner
            if (bingoWinnerBall <= jackpotBallThreshold && jackpotBalance > 0) {
                uint256 jackpotPayout = jackpotBalance;
                jackpotBalance = 0;
                r.jackpotWon  = true;
                r.jackpotPaid = jackpotPayout;

                uint256 perJackpot = jackpotPayout / bingoWinners.length;
                uint256 jackpotRemainder = jackpotPayout - perJackpot * bingoWinners.length;
                for (uint256 i = 0; i < bingoWinners.length; i++) {
                    uint256 amount = perJackpot + (i == 0 ? jackpotRemainder : 0);
                    _safePay(bingoWinners[i], amount, roundId);
                    emit JackpotPaid(roundId, bingoWinners[i], amount);
                }
            }

            r.status = RoundStatus.RESOLVED;
            emit RoundResolved(
                roundId,
                lineWinners, lineWinnerBall,
                bingoWinners, bingoWinnerBall,
                r.jackpotWon, r.jackpotPaid
            );

        } else {
            // ── NO WINNER: 10% fee + 90% → jackpot ──
            uint256 toJackpot = revenue - fee;

            r.feeAmount     = fee;
            r.reserveAmount = toJackpot;

            accruedFees += fee;
            emit FeesAccrued(roundId, fee, accruedFees);

            jackpotBalance += toJackpot;
            emit JackpotContribution(roundId, toJackpot, jackpotBalance);

            r.status = RoundStatus.RESOLVED;
            emit RoundNoWinner(roundId, toJackpot);
        }
    }

    /// @notice Cancel an open or closed round.
    ///         [F-04] No transfer loop — refunds computed on-demand in claimRefund().
    function cancelRound(uint256 roundId) external onlyOperator {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        require(
            r.status == RoundStatus.OPEN || r.status == RoundStatus.CLOSED,
            "Cannot cancel in current status"
        );

        if (r.status == RoundStatus.OPEN) {
            _removeFromOpenRounds(roundId);
        }

        r.status = RoundStatus.CANCELLED;
        emit RoundCancelled(roundId, r.totalRevenue);
    }

    /// @notice Claim refund from a cancelled round, or deferred prize from a resolved round.
    ///         [F-03/F-04] Cancel refunds computed from userCardCount (no pre-loop needed).
    ///         [F-05] Deferred prizes from failed transfers are also claimable here.
    function claimRefund(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();

        uint256 total = 0;

        // Cancel refund — computed on-demand from card count
        if (r.status == RoundStatus.CANCELLED && !refundClaimed[roundId][msg.sender]) {
            uint256 cardCount = userCardCount[roundId][msg.sender];
            if (cardCount > 0) {
                refundClaimed[roundId][msg.sender] = true;
                total += uint256(cardCount) * r.cardPriceAtCreation;
            }
        }

        // Deferred prize — fallback from failed safeTransfer in resolveRound
        uint256 deferred = pendingPrizes[roundId][msg.sender];
        if (deferred > 0) {
            pendingPrizes[roundId][msg.sender] = 0;
            total += deferred;
        }

        if (total == 0) revert NoRefundAvailable();
        paymentToken.safeTransfer(msg.sender, total);
        emit RefundClaimed(roundId, msg.sender, total);
    }

    // ═══════════════════════════════════════
    //  CARD GENERATION (on-chain, deterministic)
    // ═══════════════════════════════════════

    /// @dev Generate 15 numbers for a 3×5 bingo card using Fisher-Yates per column.
    ///      Column ranges: B 1-15 | I 16-30 | N 31-45 | G 46-60 | O 61-75
    ///      NOTE: Uses block.prevrandao + block.timestamp — a validator could influence card
    ///      numbers. Impact is limited because the draw order comes from Chainlink VRF (independent).
    function _generateCardNumbers(
        uint256 roundId,
        address buyer,
        uint8 cardIndex
    ) internal view returns (uint8[15] memory nums) {
        bytes32 baseSeed = keccak256(abi.encodePacked(
            roundId, buyer, cardIndex, block.prevrandao, block.timestamp
        ));

        for (uint8 col = 0; col < CARD_COLS; col++) {
            uint8 rangeStart = col * 15 + 1; // 1, 16, 31, 46, 61
            uint8[15] memory pool;
            for (uint8 p = 0; p < 15; p++) { pool[p] = rangeStart + p; }

            for (uint8 row = 0; row < CARD_ROWS; row++) {
                bytes32 rng = keccak256(abi.encodePacked(baseSeed, col, row));
                uint8 remaining = 15 - row;
                uint8 idx = row + uint8(uint256(rng) % remaining);
                uint8 temp = pool[idx];
                pool[idx]  = pool[row];
                pool[row]  = temp;
                nums[row * CARD_COLS + col] = temp; // row-major
            }
        }
    }

    // ═══════════════════════════════════════
    //  INTERNAL HELPERS
    // ═══════════════════════════════════════

    /// @dev [F-05] Attempt safeTransfer; on failure (e.g. USDT blacklist) defer to pendingPrizes.
    function _safePay(address to, uint256 amount, uint256 roundId) internal {
        if (amount == 0) return;
        try IERC20(address(paymentToken)).transfer(to, amount) returns (bool ok) {
            if (!ok) {
                pendingPrizes[roundId][to] += amount;
                emit PrizeDeferred(roundId, to, amount);
            }
        } catch {
            pendingPrizes[roundId][to] += amount;
            emit PrizeDeferred(roundId, to, amount);
        }
    }

    /// @dev [F-07] Hash an address[] per EIP-712 spec:
    ///      enc(arr) = keccak256( enc(arr[0]) ‖ enc(arr[1]) ‖ ... )
    ///      where enc(address) = abi.encode(address) = 32-byte left-padded value.
    function _hashAddressArray(address[] calldata arr) internal pure returns (bytes32) {
        bytes32[] memory encoded = new bytes32[](arr.length);
        for (uint256 i = 0; i < arr.length; i++) {
            encoded[i] = bytes32(uint256(uint160(arr[i])));
        }
        return keccak256(abi.encodePacked(encoded));
    }

    /// @dev [F-12] Remove roundId from _openRoundIds via swap-and-pop.
    function _removeFromOpenRounds(uint256 roundId) internal {
        uint256 len = _openRoundIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (_openRoundIds[i] == roundId) {
                _openRoundIds[i] = _openRoundIds[len - 1];
                _openRoundIds.pop();
                return;
            }
        }
        // If not found, the invariant was already broken — revert defensively
        revert("Round not in open set");
    }

    // ═══════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════

    function getRoundInfo(uint256 roundId) external view returns (
        uint256 id, uint8 status, uint256 scheduledClose,
        uint256 totalCards, uint256 totalRevenue, uint256 vrfRandomWord
    ) {
        Round storage r = rounds[roundId];
        return (r.id, uint8(r.status), r.scheduledClose, r.totalCards, r.totalRevenue, r.vrfRandomWord);
    }

    function getRoundResults(uint256 roundId) external view returns (
        address[] memory lineWinners, uint8 lineWinnerBall,
        address[] memory bingoWinners, uint8 bingoWinnerBall,
        bool jackpotWon, uint256 jackpotPaid,
        uint256 feeAmount, uint256 reserveAmount,
        uint256 linePrize, uint256 bingoPrize
    ) {
        Round storage r = rounds[roundId];
        return (
            r.lineWinners, r.lineWinnerBall,
            r.bingoWinners, r.bingoWinnerBall,
            r.jackpotWon, r.jackpotPaid,
            r.feeAmount, r.reserveAmount,
            r.linePrize, r.bingoPrize
        );
    }

    function getRoundCardIds(uint256 roundId, uint256 offset, uint256 limit)
        external view returns (uint256[] memory)
    {
        uint256[] storage all = _roundCards[roundId];
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        if (offset >= all.length) return new uint256[](0);
        uint256[] memory result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) { result[i - offset] = all[i]; }
        return result;
    }

    function getRoundCardCount(uint256 roundId) external view returns (uint256) {
        return _roundCards[roundId].length;
    }

    function getCardNumbers(uint256 cardId) external view returns (uint8[15] memory) {
        return cards[cardId].numbers;
    }

    function getUserCardIds(uint256 roundId, address user)
        external view returns (uint256[] memory)
    {
        return _userCards[roundId][user];
    }

    /// @notice Currently open round IDs (max MAX_OPEN_ROUNDS = 4)
    function getOpenRounds() external view returns (uint256[] memory) {
        return _openRoundIds;
    }

    function getVrfRequestedAt(uint256 roundId) external view returns (uint256) {
        return rounds[roundId].vrfRequestedAt;
    }

    // ═══════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════

    function fundPool(uint256 amount) external onlyOwner {
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    function withdrawFees(uint256 amount, address to) external onlyOwner {
        require(amount <= accruedFees, "Exceeds accrued fees");
        require(to != address(0), "Zero address");
        accruedFees -= amount;
        paymentToken.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    /// @notice Update operator. [F-09] Rejects address(0).
    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Zero operator");
        address old = operator;
        operator = _operator;
        emit OperatorUpdated(old, _operator);
    }

    function setCardPrice(uint256 _price) external onlyOwner {
        require(_price > 0, "Zero price");
        cardPrice = _price;
    }

    /// @notice Set distribution defaults for future rounds. linePrizeBps + bingoPrizeBps must = 10000.
    function setDistribution(
        uint16 _feeBps, uint16 _reserveBps,
        uint16 _linePrizeBps, uint16 _bingoPrizeBps
    ) external onlyOwner {
        require(_feeBps + _reserveBps <= 10000, "Fee+reserve exceeds 100%");
        require(_linePrizeBps + _bingoPrizeBps == 10000, "Prize bps must sum to 10000");
        feeBps        = _feeBps;
        reserveBps    = _reserveBps;
        linePrizeBps  = _linePrizeBps;
        bingoPrizeBps = _bingoPrizeBps;
    }

    function setJackpotBallThreshold(uint8 _threshold) external onlyOwner {
        require(_threshold > 0 && _threshold <= TOTAL_BALLS, "Invalid threshold");
        jackpotBallThreshold = _threshold;
    }

    function setVrfTimeout(uint256 _seconds) external onlyOwner {
        require(_seconds >= 1 hours, "Timeout too short");
        vrfTimeoutSeconds = _seconds;
    }

    function setVrfConfig(
        uint256 _subId, bytes32 _keyHash,
        uint32 _gasLimit, uint16 _confirmations
    ) external onlyOwner {
        vrfSubscriptionId      = _subId;
        vrfKeyHash             = _keyHash;
        vrfCallbackGasLimit    = _gasLimit;
        vrfRequestConfirmations = _confirmations;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
