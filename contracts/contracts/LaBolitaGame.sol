// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title LaBolitaGame — On-chain La Bolita (numbers game) with Chainlink VRF
/// @notice Draw-based betting: users place bets on draws, VRF generates winning number,
///         winners are paid automatically. 3 bet types: Fijo (65x), Centena (300x), Parle (1000x).
///
/// TRUST MODEL:
///   1. Owner creates draws with scheduled times.
///   2. Users place bets (Fijo/Centena/Parle) during open draws.
///   3. Owner closes draw → VRF requested → 4-digit number generated.
///   4. fulfillRandomWords resolves all bets, pays winners directly.
///   5. If >MAX_BETS_PER_RESOLVE bets, paged resolution is used.
///   6. Fully trustless: no operator can fabricate results.
contract LaBolitaGame is VRFConsumerBaseV2Plus, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── CONSTANTS ───
    uint256 public constant MAX_BETS_PER_DRAW = 500;
    uint256 public constant MAX_BETS_PER_RESOLVE = 100;
    uint256 public constant VRF_TIMEOUT = 2 hours;

    // ─── BET TYPES ───
    enum BetType { FIJO, CENTENA, PARLE }

    // ─── DRAW STATUS ───
    enum DrawStatus { SCHEDULED, OPEN, CLOSED, VRF_PENDING, VRF_FULFILLED, COMPLETED, CANCELLED }

    // ─── IMMUTABLES ───
    IERC20 public immutable paymentToken;

    // ─── VRF CONFIG ───
    uint256 public vrfSubscriptionId;
    bytes32 public vrfKeyHash;
    uint32 public vrfCallbackGasLimit = 200_000;
    uint16 public vrfRequestConfirmations = 3;

    // ─── FEES ───
    uint16 public feeBps = 500; // 5% on all bets
    uint256 public accruedFees;

    // ─── MULTIPLIERS (1e2 scaled: 6500 = 65.00x) ───
    uint32 public fijoMultiplier = 6500;
    uint32 public centenaMultiplier = 30000;
    uint32 public parleMultiplier = 100000;

    // ─── BET LIMITS ───
    uint256 public minBetAmount = 100_000;  // 0.10 USDT (6 decimals)
    uint256 public maxBetAmount = 100_000_000; // 100 USDT
    uint256 public maxExposurePerNumber = 500_000_000; // 500 USDT max exposure per number per draw

    // ─── DRAW STATE ───
    uint256 public drawCounter;

    struct Draw {
        uint256 id;
        string drawNumber;
        uint256 scheduledTime;
        DrawStatus status;
        uint16 winningNumber;   // 0-9999
        uint256 totalBets;
        uint256 totalAmount;
        uint256 totalPaidOut;
        uint256 vrfRequestId;
        uint256 vrfRequestedAt;
        uint256 betsResolved;   // for paged resolution
    }

    mapping(uint256 => Draw) public draws;
    mapping(uint256 => uint256) public vrfRequestToDraw;

    // ─── BET STATE ───
    uint256 public betCounter;

    struct Bet {
        address player;
        uint256 drawId;
        BetType betType;
        uint16 number;         // 2-digit (00-99), 3-digit (000-999), or 4-digit (0000-9999)
        uint128 amount;
        uint128 payout;
        bool resolved;
        bool won;
    }

    mapping(uint256 => Bet) public bets;

    // Draw => list of bet IDs
    mapping(uint256 => uint256[]) internal _drawBets;

    // Exposure tracking: drawId => betType => number => totalAmount
    mapping(uint256 => mapping(uint8 => mapping(uint16 => uint256))) public numberExposure;

    // User bets tracking
    mapping(address => uint256[]) internal _userBets;

    // ─── CUSTOM ERRORS ───
    error DrawNotFound();
    error DrawNotOpen();
    error DrawNotVrfFulfilled();
    error InvalidBetType();
    error InvalidNumber();
    error InvalidAmount();
    error ExposureLimitExceeded();
    error MaxBetsPerDrawReached();
    error InsufficientPool();
    error VrfNotTimedOut();
    error NothingToResolve();
    error BatchEmpty();

    // ─── EVENTS ───
    event DrawCreated(uint256 indexed drawId, string drawNumber, uint256 scheduledTime);
    event DrawOpened(uint256 indexed drawId);
    event DrawClosed(uint256 indexed drawId, uint256 vrfRequestId);
    event DrawResolved(uint256 indexed drawId, uint16 winningNumber, uint256 totalPaidOut);
    event DrawCancelled(uint256 indexed drawId, uint256 refundedAmount);
    event BetPlaced(
        uint256 indexed betId, uint256 indexed drawId, address indexed player,
        uint8 betType, uint16 number, uint256 amount
    );
    event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PoolFunded(address indexed from, uint256 amount);
    event MultipliersUpdated(uint32 fijo, uint32 centena, uint32 parle);

    // ─── CONSTRUCTOR ───
    constructor(
        address _token,
        address _vrfCoordinator,
        uint256 _vrfSubId,
        bytes32 _vrfKeyHash
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        paymentToken = IERC20(_token);
        vrfSubscriptionId = _vrfSubId;
        vrfKeyHash = _vrfKeyHash;
    }

    // ═══════════════════════════════════════
    //  POOL
    // ═══════════════════════════════════════

    function availablePool() public view returns (uint256) {
        uint256 bal = paymentToken.balanceOf(address(this));
        return bal > accruedFees ? bal - accruedFees : 0;
    }

    // ═══════════════════════════════════════
    //  DRAW MANAGEMENT (Owner)
    // ═══════════════════════════════════════

    function createDraw(
        string calldata drawNumber,
        uint256 scheduledTime
    ) external onlyOwner returns (uint256) {
        require(scheduledTime > block.timestamp, "Must be future");

        uint256 drawId = ++drawCounter;
        draws[drawId] = Draw({
            id: drawId,
            drawNumber: drawNumber,
            scheduledTime: scheduledTime,
            status: DrawStatus.SCHEDULED,
            winningNumber: 0,
            totalBets: 0,
            totalAmount: 0,
            totalPaidOut: 0,
            vrfRequestId: 0,
            vrfRequestedAt: 0,
            betsResolved: 0
        });

        emit DrawCreated(drawId, drawNumber, scheduledTime);
        return drawId;
    }

    function openDraw(uint256 drawId) external onlyOwner {
        Draw storage d = draws[drawId];
        if (d.id == 0) revert DrawNotFound();
        require(d.status == DrawStatus.SCHEDULED, "Not scheduled");
        d.status = DrawStatus.OPEN;
        emit DrawOpened(drawId);
    }

    function closeDraw(uint256 drawId) external onlyOwner whenNotPaused {
        Draw storage d = draws[drawId];
        if (d.id == 0) revert DrawNotFound();
        if (d.status != DrawStatus.OPEN) revert DrawNotOpen();

        d.status = DrawStatus.VRF_PENDING;

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

        d.vrfRequestId = requestId;
        d.vrfRequestedAt = block.timestamp;
        vrfRequestToDraw[requestId] = drawId;

        emit DrawClosed(drawId, requestId);
    }

    function cancelDraw(uint256 drawId) external onlyOwner nonReentrant {
        Draw storage d = draws[drawId];
        if (d.id == 0) revert DrawNotFound();
        require(
            d.status == DrawStatus.SCHEDULED ||
            d.status == DrawStatus.OPEN,
            "Cannot cancel"
        );

        d.status = DrawStatus.CANCELLED;

        // Refund all bets
        uint256 totalRefunded = _refundDrawBets(drawId);
        emit DrawCancelled(drawId, totalRefunded);
    }

    /// @notice Cancel a stale draw where VRF timed out
    function cancelStaleDraw(uint256 drawId) external nonReentrant {
        Draw storage d = draws[drawId];
        if (d.id == 0) revert DrawNotFound();
        require(d.status == DrawStatus.VRF_PENDING, "Not VRF pending");
        if (block.timestamp < d.vrfRequestedAt + VRF_TIMEOUT) revert VrfNotTimedOut();

        d.status = DrawStatus.CANCELLED;

        uint256 totalRefunded = _refundDrawBets(drawId);
        emit DrawCancelled(drawId, totalRefunded);
    }

    function _refundDrawBets(uint256 drawId) internal returns (uint256 totalRefunded) {
        uint256[] storage betIds = _drawBets[drawId];
        for (uint256 i = 0; i < betIds.length; i++) {
            Bet storage b = bets[betIds[i]];
            if (!b.resolved) {
                b.resolved = true;
                uint256 refund = uint256(b.amount);
                // Refund the fee portion too
                uint256 fee = (refund * uint256(feeBps)) / 10000;
                if (accruedFees >= fee) {
                    accruedFees -= fee;
                }
                b.payout = uint128(refund);
                totalRefunded += refund;
                paymentToken.safeTransfer(b.player, refund);
            }
        }
    }

    // ═══════════════════════════════════════
    //  BETTING
    // ═══════════════════════════════════════

    /// @notice Place a single bet on an open draw
    /// @param drawId The draw to bet on
    /// @param betType 0=FIJO, 1=CENTENA, 2=PARLE
    /// @param number The number to bet on (2/3/4 digits depending on type)
    /// @param amount Bet amount in token decimals
    function placeBet(
        uint256 drawId,
        uint8 betType,
        uint16 number,
        uint256 amount
    ) external whenNotPaused nonReentrant returns (uint256) {
        return _placeBet(drawId, betType, number, amount, msg.sender);
    }

    /// @notice Place multiple bets in a single transaction (cart checkout)
    struct BetInput {
        uint8 betType;
        uint16 number;
        uint256 amount;
    }

    function placeBetsBatch(
        uint256 drawId,
        BetInput[] calldata betInputs
    ) external whenNotPaused nonReentrant returns (uint256[] memory betIds) {
        if (betInputs.length == 0) revert BatchEmpty();

        betIds = new uint256[](betInputs.length);
        for (uint256 i = 0; i < betInputs.length; i++) {
            betIds[i] = _placeBet(
                drawId,
                betInputs[i].betType,
                betInputs[i].number,
                betInputs[i].amount,
                msg.sender
            );
        }
    }

    function _placeBet(
        uint256 drawId,
        uint8 betType,
        uint16 number,
        uint256 amount,
        address player
    ) internal returns (uint256) {
        Draw storage d = draws[drawId];
        if (d.id == 0) revert DrawNotFound();
        if (d.status != DrawStatus.OPEN) revert DrawNotOpen();
        if (betType > 2) revert InvalidBetType();
        if (amount < minBetAmount || amount > maxBetAmount) revert InvalidAmount();

        // Validate number range based on bet type
        if (betType == uint8(BetType.FIJO)) {
            if (number > 99) revert InvalidNumber(); // 00-99
        } else if (betType == uint8(BetType.CENTENA)) {
            if (number > 999) revert InvalidNumber(); // 000-999
        } else {
            if (number > 9999) revert InvalidNumber(); // 0000-9999
        }

        // Check draw bet limit
        if (_drawBets[drawId].length >= MAX_BETS_PER_DRAW) revert MaxBetsPerDrawReached();

        // Check exposure limit
        uint256 currentExposure = numberExposure[drawId][betType][number];
        if (currentExposure + amount > maxExposurePerNumber) revert ExposureLimitExceeded();

        // Transfer tokens from player
        paymentToken.safeTransferFrom(player, address(this), amount);

        // Accrue fee immediately
        uint256 fee = (amount * uint256(feeBps)) / 10000;
        accruedFees += fee;

        // Store bet
        uint256 betId = ++betCounter;
        bets[betId] = Bet({
            player: player,
            drawId: drawId,
            betType: BetType(betType),
            number: number,
            amount: uint128(amount),
            payout: 0,
            resolved: false,
            won: false
        });

        _drawBets[drawId].push(betId);
        _userBets[player].push(betId);
        numberExposure[drawId][betType][number] += amount;

        d.totalBets++;
        d.totalAmount += amount;

        emit BetPlaced(betId, drawId, player, betType, number, amount);
        return betId;
    }

    // ═══════════════════════════════════════
    //  VRF CALLBACK + RESOLUTION
    // ═══════════════════════════════════════

    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 drawId = vrfRequestToDraw[requestId];
        Draw storage d = draws[drawId];

        if (d.id == 0) return;
        if (d.status != DrawStatus.VRF_PENDING) return;

        // Generate 4-digit winning number (0000-9999)
        d.winningNumber = uint16(randomWords[0] % 10000);
        d.status = DrawStatus.VRF_FULFILLED;

        // If few bets, resolve all immediately
        uint256[] storage betIds = _drawBets[drawId];
        if (betIds.length <= MAX_BETS_PER_RESOLVE) {
            _resolveBets(d, betIds, 0, betIds.length);
            d.status = DrawStatus.COMPLETED;
            emit DrawResolved(drawId, d.winningNumber, d.totalPaidOut);
        }
        // Otherwise, paged resolution via resolveDrawBatch()
    }

    /// @notice Resolve a batch of bets for a VRF_FULFILLED draw (paged resolution)
    /// @dev Anyone can call this to process bets in gas-safe batches
    function resolveDrawBatch(uint256 drawId, uint256 limit) external nonReentrant {
        Draw storage d = draws[drawId];
        if (d.id == 0) revert DrawNotFound();
        if (d.status != DrawStatus.VRF_FULFILLED) revert DrawNotVrfFulfilled();

        uint256[] storage betIds = _drawBets[drawId];
        uint256 start = d.betsResolved;
        uint256 end = start + limit;
        if (end > betIds.length) end = betIds.length;
        if (start >= end) revert NothingToResolve();

        _resolveBets(d, betIds, start, end);

        // If all resolved, mark completed
        if (d.betsResolved >= betIds.length) {
            d.status = DrawStatus.COMPLETED;
            emit DrawResolved(drawId, d.winningNumber, d.totalPaidOut);
        }
    }

    function _resolveBets(
        Draw storage d,
        uint256[] storage betIds,
        uint256 start,
        uint256 end
    ) internal {
        uint16 winning = d.winningNumber;
        uint16 fijoNum = winning % 100;      // last 2 digits
        uint16 centenaNum = winning % 1000;   // last 3 digits

        for (uint256 i = start; i < end; i++) {
            Bet storage b = bets[betIds[i]];
            if (b.resolved) continue;

            b.resolved = true;
            bool won = false;

            if (b.betType == BetType.FIJO) {
                won = (b.number == fijoNum);
            } else if (b.betType == BetType.CENTENA) {
                won = (b.number == centenaNum);
            } else {
                won = (b.number == winning);
            }

            if (won) {
                uint32 mult;
                if (b.betType == BetType.FIJO) mult = fijoMultiplier;
                else if (b.betType == BetType.CENTENA) mult = centenaMultiplier;
                else mult = parleMultiplier;

                // Payout = (amount - fee) * multiplier / 100
                uint256 netAmount = uint256(b.amount) - (uint256(b.amount) * uint256(feeBps) / 10000);
                uint256 payout = (netAmount * uint256(mult)) / 100;
                b.payout = uint128(payout);
                b.won = true;

                // Pay winner (low-level to prevent revert in VRF callback)
                if (availablePool() >= payout) {
                    (bool success, ) = address(paymentToken).call(
                        abi.encodeCall(IERC20.transfer, (b.player, payout))
                    );
                    if (success) {
                        d.totalPaidOut += payout;
                    }
                }

                emit BetResolved(betIds[i], b.player, true, payout);
            } else {
                emit BetResolved(betIds[i], b.player, false, 0);
            }

            d.betsResolved++;
        }
    }

    /// @notice Retry payout for a resolved winning bet where transfer failed
    function retryUnpaidBet(uint256 betId) external nonReentrant {
        Bet storage b = bets[betId];
        require(b.resolved && b.won && b.payout > 0, "Not eligible");

        uint256 payout = uint256(b.payout);
        if (availablePool() < payout) revert InsufficientPool();

        paymentToken.safeTransfer(b.player, payout);
    }

    // ═══════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════

    function getDraw(uint256 drawId) external view returns (
        uint256 id,
        string memory drawNumber,
        uint256 scheduledTime,
        uint8 status,
        uint16 winningNumber,
        uint256 totalBets,
        uint256 totalAmount,
        uint256 totalPaidOut
    ) {
        Draw storage d = draws[drawId];
        return (
            d.id, d.drawNumber, d.scheduledTime,
            uint8(d.status), d.winningNumber,
            d.totalBets, d.totalAmount, d.totalPaidOut
        );
    }

    function getOpenDraws() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= drawCounter; i++) {
            if (draws[i].status == DrawStatus.OPEN) count++;
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i <= drawCounter; i++) {
            if (draws[i].status == DrawStatus.OPEN) {
                result[idx++] = i;
            }
        }
        return result;
    }

    function getBet(uint256 betId) external view returns (
        address player,
        uint256 drawId,
        uint8 betType,
        uint16 number,
        uint256 amount,
        uint256 payout,
        bool resolved,
        bool won
    ) {
        Bet storage b = bets[betId];
        return (
            b.player, b.drawId, uint8(b.betType), b.number,
            uint256(b.amount), uint256(b.payout), b.resolved, b.won
        );
    }

    function getDrawBetCount(uint256 drawId) external view returns (uint256) {
        return _drawBets[drawId].length;
    }

    function getDrawBetIds(uint256 drawId, uint256 offset, uint256 limit)
        external view returns (uint256[] memory)
    {
        uint256[] storage all = _drawBets[drawId];
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        if (offset >= all.length) return new uint256[](0);
        uint256[] memory result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = all[i];
        }
        return result;
    }

    function getUserBetCount(address user) external view returns (uint256) {
        return _userBets[user].length;
    }

    function getUserBetIds(address user, uint256 offset, uint256 limit)
        external view returns (uint256[] memory)
    {
        uint256[] storage all = _userBets[user];
        uint256 end = offset + limit;
        if (end > all.length) end = all.length;
        if (offset >= all.length) return new uint256[](0);
        uint256[] memory result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = all[i];
        }
        return result;
    }

    function getNumberExposure(uint256 drawId, uint8 betType, uint16 number)
        external view returns (uint256)
    {
        return numberExposure[drawId][betType][number];
    }

    function getMultipliers() external view returns (uint32 fijo, uint32 centena, uint32 parle) {
        return (fijoMultiplier, centenaMultiplier, parleMultiplier);
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

    function setMultipliers(
        uint32 _fijo,
        uint32 _centena,
        uint32 _parle
    ) external onlyOwner {
        require(_fijo > 0 && _centena > 0 && _parle > 0, "Zero multiplier");
        fijoMultiplier = _fijo;
        centenaMultiplier = _centena;
        parleMultiplier = _parle;
        emit MultipliersUpdated(_fijo, _centena, _parle);
    }

    function setBetLimits(
        uint256 _minBet,
        uint256 _maxBet,
        uint256 _maxExposure
    ) external onlyOwner {
        require(_minBet > 0 && _maxBet > _minBet, "Invalid limits");
        minBetAmount = _minBet;
        maxBetAmount = _maxBet;
        maxExposurePerNumber = _maxExposure;
    }

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= 2000, "Fee too high"); // max 20%
        feeBps = _feeBps;
    }

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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
