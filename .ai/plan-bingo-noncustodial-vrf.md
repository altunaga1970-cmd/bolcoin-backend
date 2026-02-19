# Plan Maestro: Bingo Non-Custodial + VRF On-Chain
**Fecha de auditoría:** 2026-02-18
**Estado actual:** Custodial off-chain · Pseudo-VRF (crypto.randomBytes)
**Objetivo:** Non-custodial · Chainlink VRF v2.5 on-chain · Fondos nunca en manos del servidor

---

## 1. AUDITORÍA DEL ESTADO ACTUAL

### 1.1 Flujo de dinero actual (custodial)
```
Usuario → [USDT en backend DB: users.balance] → Compra cartón (-balance) → Premio (+balance) → Retiro
```
- **Problema crítico:** El servidor controla 100 % de los fondos. Si el servidor es comprometido o actúa de mala fe, puede:
  - No pagar premios
  - Manipular el VRF seed antes de asignarlo
  - Retener fondos de retiro

### 1.2 Generación de aleatoriedad actual
```js
// bingoService.js línea 503
const vrfSeed = '0x' + crypto.randomBytes(32).toString('hex');
```
- **Problema:** El operador genera el seed. El jugador **no puede verificar** que el seed fue generado honestamente y no fue escogido a dedo.
- El seed se guarda en `bingo_rounds.vrf_random_word` pero solo después de que se generó.
- No existe commit-reveal, por lo tanto el operador podría saber el resultado antes de que el jugador lo vea.

### 1.3 Generación de números de cartón
```js
// Generación server-side con Math.random interno
function generateCardNumbers() { ... }
```
- **Problema:** El servidor asigna los números. En teoría podría dar a usuarios "buenos" cartones y a otros "malos" cartones sabiendo el futuro VRF seed (front-running).

### 1.4 Estructura de la base de datos (relevante para migración)
```
bingo_rounds:  round_id, status, vrf_random_word, drawn_balls, line_winner, bingo_winner, prizes
bingo_cards:   card_id, round_id, owner_address, numbers (JSONB), winner flags
bingo_results: vrf_seed, drawn_balls, winner_card_ids, tx_hash (vacío)
bingo_pool:    jackpot_balance (en DB, no en contrato)
users.balance: saldo custodial (punto de fallo central)
```

### 1.5 Lo que SÍ está bien y se reutiliza
- ✅ `bingoResolverService.js` — lógica de sorteo + detección de ganadores (determinista, reutilizable)
- ✅ Scheduler con 4 rooms y timing escalonado (103s stagger)
- ✅ Sincronización del sorteo (draw_started_at + calcSyncState) — no cambia
- ✅ Frontend (BingoRoom, BallDraw, BingoCard) — casi sin cambios
- ✅ Lógica de premios (15% línea / 85% bingo)
- ✅ Sistema de columnas B-I-N-G-O (rangos 1-15, 16-30, etc.)

---

## 2. ARQUITECTURA TARGET

### 2.1 Modelo elegido: Hybrid Oracle + Merkle Settlement

```
┌──────────────────────────────────────────────────────────────────────┐
│                        BingoGame.sol                                 │
│                                                                       │
│  USDT entra por buyCards() → contrato custodia durante la ronda      │
│  VRF se pide on-chain → Chainlink responde con randomWord verificable │
│  Operador computa resultado off-chain → envía merkle root al contrato │
│  Ganadores hacen claim() con merkle proof → contrato paga USDT       │
│                                                                       │
│  En ningún momento el servidor backend toca los fondos               │
└──────────────────────────────────────────────────────────────────────┘
```

**Por qué este modelo y no full on-chain:**
- Full on-chain (detectar ganadores en Solidity) costaría 10-50M gas para 100 cartones (imposible, excede el bloque)
- Hybrid permite cómputo ilimitado off-chain pero la validación de resultados es on-chain y trustless
- El operador NO puede mentir: el contrato verifica que los ganadores pertenecen al merkle root comprometido

### 2.2 Diagrama de flujo completo
```
[OPEN 45s]
  │  Usuario: approve(USDT, bingoContract) + buyCards(roundId, count, cardHashes[])
  │  Contrato: almacena hashes de cartones, recibe USDT, emite CardsPurchased event
  │  Backend: escucha evento, guarda números reales en DB (off-chain)
  │
[CLOSE]
  │  Operador: llama closeRound(roundId) en contrato
  │  Contrato: cambia status a CLOSED, emite RoundClosed
  │
[VRF_REQUESTED]
  │  Operador: llama requestVRF(roundId) → contrato pide randomWord a Chainlink
  │  Chainlink: ~2-3 min después, llama fulfillRandomWords(requestId, [randomWord])
  │  Contrato: almacena randomWord, emite VRFReceived, cambia a DRAWING
  │
[DRAWING (backend + frontend)]
  │  Backend: lee randomWord del contrato, ejecuta drawBallsFromVrfSeed()
  │  Backend: detecta ganadores, construye merkle tree de {address, amount}
  │  Backend: llama submitResults(roundId, merkleRoot, lineWinnerBall, bingoWinnerBall)
  │  Contrato: almacena merkleRoot, emite ResultsSubmitted
  │  Frontend: anima el sorteo en tiempo real (sin cambios)
  │
[RESOLVED]
  │  Opción A (batch pay): Operador llama batchPay(addresses[], amounts[], proofs[][])
  │  Opción B (self-claim): Ganador llama claim(roundId, amount, proof[])
  │  Contrato: verifica merkle proof, transfiere USDT al ganador
  │  Backend: finaliza round en DB, marca tx_hash
```

### 2.3 Red objetivo
**Recomendación: Polygon PoS**
- Chainlink VRF v2.5 disponible ✅
- Gas: $0.001-0.01 por tx ✅
- USDT (Polygon) con 6 decimales ✅
- Confirmaciones VRF: ~1-2 min ✅
- Ecosistema maduro, liquidez USDT alta ✅
- Alternativa: Arbitrum (más barato aún pero VRF slightly higher cost)

---

## 3. SMART CONTRACT: BingoGame.sol

### 3.1 Estructura de datos Solidity
```solidity
struct Round {
    uint256 roundId;
    uint8   roomNumber;
    RoundStatus status;       // OPEN, CLOSED, VRF_PENDING, DRAWING, RESOLVED, CANCELLED
    uint256 scheduledClose;   // unix timestamp
    uint256 totalCards;
    uint256 totalRevenue;     // en USDT (6 decimales)
    uint256 vrfRequestId;
    uint256 vrfRandomWord;    // 0 hasta que Chainlink responde
    bytes32 cardMerkleRoot;   // merkle root de todos los card hashes comprados
    bytes32 resultMerkleRoot; // merkle root de {address, amount} para claims
    uint256 lineWinnerBall;
    uint256 bingoWinnerBall;
    uint256 drawStartedAt;
    uint256 linePrize;
    uint256 bingoPrize;
    bool    jackpotWon;
    uint256 jackpotPaid;
}

struct CardCommitment {
    bytes32 cardHash;         // keccak256(roundId, ownerAddress, cardIndex, numbers[])
    address owner;
    bool    claimed;
}

mapping(uint256 => Round)                           public rounds;
mapping(uint256 => mapping(uint256 => CardCommitment)) public roundCards; // roundId => cardId => card
mapping(address => mapping(uint256 => bool))        public hasClaimed;
mapping(uint256 => uint256)                         public vrfRequestToRound;

uint256 public jackpotBalance;
uint256 public accruedFees;
uint256 public cardPrice;       // en USDT micro-units
uint256 public feeBps;          // 1000 = 10%
uint256 public reserveBps;      // 1000 = 10%
uint256 public linePrizeBps;    // 1500 = 15%
uint256 public bingoPrizeBps;   // 8500 = 85%
uint256 public jackpotBallThreshold; // 25
uint256 public maxCardsPerUser;      // 4
```

### 3.2 Funciones principales

**Compra de cartones (usuario llama)**
```solidity
function buyCards(
    uint256 roundId,
    bytes32[] calldata cardHashes  // un hash por cartón
) external nonReentrant
```
- Verifica: round OPEN, antes del scheduledClose, no supera maxCardsPerUser
- Transfiere `cardHashes.length * cardPrice` USDT del usuario al contrato
- Almacena hashes en `roundCards`, actualiza merkle root acumulativo
- Emite: `CardsPurchased(roundId, msg.sender, cardHashes.length, txCost)`

**Cierre de ronda (operador)**
```solidity
function closeRound(uint256 roundId) external onlyOperator
```
- Si 0 cartones → `CANCELLED`, devuelve fondos (no hay nada que devolver porque nadie compró)
- Si ≥ 1 cartón → `CLOSED`

**Request VRF (operador)**
```solidity
function requestRoundVRF(uint256 roundId) external onlyOperator returns (uint256 requestId)
```
- Llama `VRFCoordinatorV2_5.requestRandomWords(...)` con parámetros
- Guarda `vrfRequestToRound[requestId] = roundId`
- Status → `VRF_PENDING`

**Callback Chainlink (solo VRFCoordinator puede llamar)**
```solidity
function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override
```
- Lee `roundId = vrfRequestToRound[requestId]`
- Almacena `rounds[roundId].vrfRandomWord = randomWords[0]`
- `rounds[roundId].drawStartedAt = block.timestamp`
- Status → `DRAWING`
- Emite: `VRFReceived(roundId, randomWords[0], block.timestamp)`

**Envío de resultados (operador)**
```solidity
function submitResults(
    uint256 roundId,
    bytes32 resultMerkleRoot,   // raíz del árbol {address, amount}
    uint256 lineWinnerBall,
    uint256 bingoWinnerBall,
    uint256 linePrize,
    uint256 bingoPrize,
    bool    jackpotWon
) external onlyOperator
```
- Solo acepta si status == DRAWING
- Verifica que `linePrize + bingoPrize ≤ availablePot` (anti-fraude)
- Si jackpotWon: descuenta de `jackpotBalance`, suma a `bingoPrize`
- Actualiza jackpot con `reserveAmount`
- Almacena `resultMerkleRoot`
- Status → `RESOLVED`
- Emite: `ResultsSubmitted(roundId, resultMerkleRoot, linePrize + bingoPrize)`

**Claim de premio (ganador o batch por operador)**
```solidity
// Auto-claim: el ganador lo llama
function claim(
    uint256 roundId,
    uint256 amount,
    bytes32[] calldata proof
) external nonReentrant

// Batch: operador paga a todos los ganadores en una tx
function batchPay(
    uint256 roundId,
    address[] calldata winners,
    uint256[] calldata amounts,
    bytes32[][] calldata proofs
) external onlyOperator nonReentrant
```
- Verifica merkle proof: `MerkleProof.verify(proof, resultMerkleRoot, keccak256(abi.encode(address, amount)))`
- Marca `hasClaimed[user][roundId] = true` (previene doble claim)
- Transfiere USDT

**Cancelación con reembolso**
```solidity
function cancelRound(uint256 roundId) external onlyOperator
function refund(uint256 roundId) external nonReentrant
```
- Cancelación: operador, solo si OPEN o VRF_PENDING
- Refund: usuario recupera cardPrice * susCortones

**Emergencia (pausa global)**
```solidity
// Hereda Pausable de OpenZeppelin
function pause() external onlyOwner
function unpause() external onlyOwner
```

### 3.3 Seguridad del contrato (checklist obligatorio)

| Riesgo | Mitigación |
|--------|-----------|
| Reentrancy en claim/batchPay | `nonReentrant` (OpenZeppelin ReentrancyGuard) |
| Operador roba fondos | `submitResults` verifica que los prizes ≤ revenue - fees; merkle root es inmutable una vez enviado |
| Operador no envía resultados | `emergencyCancel` disponible después de X horas; usuarios pueden reclamar refund |
| Chainlink VRF nunca responde | Timeout configurable (48h) → permite cancel y refund |
| Double-claim | `hasClaimed[user][roundId]` mapping |
| Precio incorrecto en claim | El `amount` es parte del leaf del merkle tree, verificado on-chain |
| Integer overflow | Solidity 0.8.x + SafeERC20 |
| Operador malicioso submitResults con merkle root falso | El merkle root fue construido en base a `cardMerkleRoot` (los hashes comprometidos); auditar que los ganadores existen en cardMerkleRoot es posible pero añade complejidad — suficiente con merkle root de resultados |
| Flash loan / price manipulation | No aplica (precio fijo en USDT, no AMM) |
| Front-running en VRF request | VRF pedido después de cierre, no antes; seed generado por Chainlink, no por el operador |
| Admin key comprometida | Multisig (Gnosis Safe) para owner functions |

### 3.4 Herencia y librerías
```solidity
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/interfaces/IVRFCoordinatorV2Plus.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
```

### 3.5 Roles de acceso
```
OWNER_ROLE:    Deployer / Gnosis Safe — pausar, cambiar configuración crítica
OPERATOR_ROLE: Backend automático — closeRound, requestVRF, submitResults, batchPay
```

---

## 4. GENERACIÓN DE CARTONES (COMMIT-REVEAL)

### 4.1 El problema a resolver
Si el operador genera los números del cartón ANTES de saber el VRF seed, y el VRF seed se decide después, el operador NO puede elegir seeds para favorecer cartones específicos (el seed lo da Chainlink). Pero el jugador necesita poder verificar que sus números no fueron manipulados.

### 4.2 Esquema recomendado: Operator Pre-commitment + User Verifiable

**Al inicio de cada ronda, el operador publica un `operatorSeed` hasheado:**
```
operatorSeedHash = keccak256(operatorSeed) → guardado en contrato al abrir ronda
```

**Al comprar un cartón, los números se generan así:**
```
cardNumbers = deriveCard(operatorSeed, userAddress, roundId, cardIndex)
            = deterministic shuffle using keccak256(operatorSeed || userAddress || roundId || cardIndex)
```

El jugador recibe sus números. El `operatorSeed` permanece secreto hasta el cierre de la ronda (para que nadie pueda pre-calcular todos los cartones de otros).

**Al cerrar la ronda, el operador revela `operatorSeed`:**
- El contrato verifica: `keccak256(operatorSeed) == operatorSeedHash` ✅
- Cualquier jugador puede recomputar sus números para verificar que son correctos

**Compromiso de cartón en el contrato:**
```
cardHash = keccak256(abi.encode(roundId, ownerAddress, cardIndex, numbers[15]))
```
Este hash se almacena en el contrato al comprar. Después, si el jugador quiere verificar, puede reconstruir sus números desde el `operatorSeed` revelado y verificar que el hash coincide.

### 4.3 Por qué no se puede hacer full on-chain
```
// Coste estimado de detectar ganadores en Solidity:
// 100 cartones × 15 números × 75 bolas = 112,500 comparaciones
// ≈ 15-25M gas → excede el block gas limit típico de 30M en Polygon
// Con 200+ cartones (ronda activa real) → imposible
```

El cómputo off-chain es obligatorio. El merkle tree garantiza que el resultado no puede ser fabricado.

---

## 5. MIGRACIÓN BACKEND

### 5.1 Cambios en bingoService.js

| Función actual | Cambio |
|---------------|--------|
| `buyCardsOffChain()` | → Eliminar. Compra ahora es tx on-chain |
| `resolveRoundOffChain()` | → Leer VRF del contrato, generar merkle, llamar `submitResults()` |
| `closeRoundOffChain()` | → Llamar `contract.closeRound()` |
| `finalizeDrawing()` | → Llamar `contract.batchPay()` después de la animación |
| `getConfig()` | → Ya tiene soporte on-chain (leer de contrato) |
| Pago de premios (UPDATE users.balance) | → Eliminar. El contrato paga directamente |

**Nueva capa: bingoContractListener.js**
```javascript
// Escucha eventos del contrato y sincroniza DB
contract.on('CardsPurchased', (roundId, buyer, count, amount) => {
  // Guardar cartones en DB (números reales, derivados del operatorSeed)
  // El contrato ya tiene los hashes — DB tiene los números reales para la UI
});

contract.on('VRFReceived', (roundId, randomWord, drawStartedAt) => {
  // Calcular bolas, ganadores, generar merkle tree
  // Llamar submitResults() en el contrato
  // Actualizar DB para que la UI funcione
});

contract.on('ResultsSubmitted', (roundId, merkleRoot) => {
  // Después del tiempo de animación: llamar batchPay()
  // Actualizar DB: status=resolved, marcar tx_hash
});
```

### 5.2 Cambios en bingoScheduler.js

| Fase actual | Fase nueva |
|-------------|-----------|
| `createRoundOffChain()` (DB) | `contract.openRound()` (on-chain) + escuchar evento |
| `sleep(45s)` | `sleep(45s)` (sin cambio) |
| `closeRoundOffChain()` (DB) | `contract.closeRound()` (on-chain) |
| `resolveRoundOffChain()` (DB + crypto.randomBytes) | `contract.requestRoundVRF()` → esperar evento VRFReceived |
| `sleep(drawDuration)` | `sleep(drawDuration)` (sin cambio, animación igual) |
| `finalizeDrawing()` (DB) | `contract.batchPay()` (on-chain) |
| `sleep(cooldown)` | `sleep(cooldown)` (sin cambio) |

**Timing nuevo (considerando VRF wait ~2 min):**
```
Buy window:     45s  (sin cambio)
Close:           0s
VRF request:     2s
VRF wait:      ~120s (promedio Polygon, configurable)
Draw animation: variable (bingoBall × 4.5s + pausas)
Batch pay:       5s
Cooldown:       30s
─────────────────
Total:        ~7-10 min por ciclo (vs ~2 min actual)
```
Con 4 rooms escalonadas a 103s, el usuario sigue viendo una nueva ronda cada ~1.7 min.

### 5.3 Sincronización DB / contrato
El backend mantiene la DB como **cache de lectura** para la UI (polling cada 5s):
- Todo lo que cambia en la DB debe haber ocurrido primero on-chain (event-driven)
- La DB NUNCA es source of truth para fondos (solo el contrato lo es)
- El campo `users.balance` en la DB se convierte en un BALANCE OFF-CHAIN separado del bingo (solo para keno u otros juegos)

---

## 6. MIGRACIÓN FRONTEND

### 6.1 Cambios en useBingoGame.js

| Acción actual | Acción nueva |
|--------------|-------------|
| `POST /api/bingo/buy-cards` | `approve(USDT) + contract.buyCards(roundId, cardHashes[])` |
| Poll `GET /rounds/:id` | Sin cambio (backend sigue exponiendo la API) |
| Mostrar balance custodial | Mostrar USDT en wallet (useBalance ya lo hace) |

**Flujo de compra nuevo (wallet tx):**
1. Frontend genera 15 números aleatorios por cartón usando `deriveCard(roundId, account, cardIndex)` (js puro)
2. Calcula `cardHash = keccak256(abi.encode(...))` via ethers.js
3. Llama `usdt.approve(bingoAddress, totalCost)` si allowance insuficiente
4. Llama `bingo.buyCards(roundId, cardHashes[])`
5. Espera confirmación → backend escucha evento → guarda en DB → frontend recibe via poll

### 6.2 UX de la compra (2 transacciones)
```
┌─────────────────────────────────────────────┐
│  Paso 1/2: Aprobar gasto de USDT            │
│  [Firmar en MetaMask]                       │
│  (Solo necesario la primera vez o si        │
│   el allowance es insuficiente)             │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│  Paso 2/2: Comprar cartones                 │
│  [Firmar en MetaMask]                       │
│  ✅ Confirmado — tus cartones están listos  │
└─────────────────────────────────────────────┘
```
Alternativa: infinite approve en paso 1 (no preguntar de nuevo).

### 6.3 Cambios menores en frontend
- `useBingoRooms.js`: sin cambios (lee de API)
- `BingoRoom.jsx`: añadir estados de tx pending (`buying`, `approving`)
- `BalanceContext.jsx`: eliminar bingo-related balance updates (los fondos van directos al wallet)
- Añadir hook `useBingoContract.js` para interacciones on-chain

---

## 7. HOJA DE RUTA POR FASES

### Fase 0 — Preparación (1-2 semanas)
- [ ] Decidir red definitiva (Polygon vs Arbitrum)
- [ ] Crear cuenta Chainlink VRF subscription en la red elegida
- [ ] Comprar LINK para el subscription
- [ ] Configurar Gnosis Safe multisig para el owner del contrato
- [ ] Escribir spec completa del contrato (ABI antes de implementar)
- [ ] Definir `cardPrice`, `feeBps`, `reserveBps`, `linePrizeBps`, `bingoPrizeBps` definitivos on-chain

### Fase 1 — Smart Contract (3-4 semanas)
- [ ] `BingoGame.sol` base: estado, compra, cierre
- [ ] VRF integration: `VRFConsumerBaseV2Plus`, `requestRandomWords`, `fulfillRandomWords`
- [ ] Commit scheme: `operatorSeedHash` en `openRound`, reveal en `closeRound`
- [ ] Merkle settlement: `submitResults`, `claim`, `batchPay`
- [ ] Emergencia: `pause`, `cancelRound`, `refund`
- [ ] Tests unitarios Hardhat: 100% branches del state machine
- [ ] Tests de integración: ciclo completo con VRF mock
- [ ] Fuzzing: Foundry para edge cases en merkle proofs y arithmetic
- [ ] Gas profiling: asegurarse que `batchPay` con 8 ganadores < 500k gas

### Fase 2 — Auditoría de contrato (2 semanas)
- [ ] Auditoría interna: security checklist completo
- [ ] Auditoría externa: contratar audit firm (Code4rena, Sherlock, o similar)
- [ ] Resolver todos los findings críticos y altos antes de continuar
- [ ] Freeze del contrato post-auditoría (no más cambios excepto bug fixes críticos)

### Fase 3 — Backend (2-3 semanas)
- [ ] `bingoContractListener.js`: event listeners para CardsPurchased, VRFReceived, ResultsSubmitted
- [ ] Adaptar `bingoService.js`: eliminar funciones off-chain, añadir on-chain
- [ ] `merkleService.js`: nuevo servicio para construir árbol y generar proofs
- [ ] `operatorKeyService.js`: gestión segura de la clave del operador (HSM o KMS)
- [ ] Adaptar `bingoScheduler.js`: lifecycle basado en eventos del contrato
- [ ] Adaptar rutas: mantener API pública igual (para UI sin cambios)
- [ ] DB: añadir campos `tx_hash`, `block_number`, `contract_round_id` a tablas bingo

### Fase 4 — Frontend (1-2 semanas)
- [ ] `useBingoContract.js`: hook para wagmi/ethers interactions
- [ ] Flujo de compra: approve → buyCards (2-tx flow con UX clara)
- [ ] Estados de pending tx: spinner mientras se mina, toast de confirmación
- [ ] Eliminar dependencia de `users.balance` para bingo
- [ ] Testear con MetaMask en testnet

### Fase 5 — Testnet (2 semanas)
- [ ] Deploy en Mumbai (Polygon testnet) o Sepolia
- [ ] Probar ciclo completo: compra → VRF real → sorteo → claim
- [ ] Load test: 4 salas simultáneas, 50+ usuarios, 200+ cartones por ronda
- [ ] Probar escenarios de fallo: VRF timeout, operador caído, red congestionada
- [ ] Bug fixes de testnet

### Fase 6 — Mainnet (1 semana)
- [ ] Deploy BingoGame.sol en Polygon mainnet
- [ ] Verificar contrato en Polygonscan
- [ ] Configurar VRF subscription mainnet con LINK real
- [ ] Rollout gradual: 1 sala primero, monitorear 48h
- [ ] Activar las 4 salas
- [ ] Desactivar backend custodial de bingo (usuarios migran gradualmente)

---

## 8. ESTIMACIÓN DE COSTES ON-CHAIN (Polygon)

| Operación | Gas estimado | Coste ~(MATIC $0.5) |
|-----------|-------------|---------------------|
| `buyCards` (1 cartón) | ~120,000 | ~$0.01 |
| `buyCards` (4 cartones) | ~250,000 | ~$0.02 |
| `closeRound` | ~50,000 | ~$0.004 |
| `requestRoundVRF` | ~120,000 | ~$0.01 |
| VRF fulfillment (Chainlink cobra LINK) | ~200,000 | ~0.0003 LINK ≈ $0.05 |
| `submitResults` | ~100,000 | ~$0.008 |
| `batchPay` (8 ganadores) | ~400,000 | ~$0.03 |
| **Total por ciclo de ronda** | ~1.2M | ~$0.10 + 0.05 LINK |

**Coste mensual estimado (4 rooms, ciclo ~8 min, 24/7):**
- Ciclos por mes: `60min/8 × 24h × 30d × 4rooms` ≈ 10,800 ciclos
- Coste: `10,800 × $0.15` ≈ **$1,620/mes** en gas + LINK
- Con card revenue de $1/cartón y ~20 cartones/ronda: `10,800 × $20 = $216,000 revenue/mes`
- Gas cost como % de revenue: **< 1%**

---

## 9. RIESGOS Y MITIGACIONES

### 9.1 Riesgo: Chainlink VRF no responde
**Probabilidad:** Baja (SLA 99.9%)
**Impacto:** Ronda bloqueada en VRF_PENDING
**Mitigación:**
- Timeout de 4 horas en el contrato
- Si timeout: cualquier usuario puede triggear `emergencyCancel(roundId)`
- Contrato devuelve USDT a todos los compradores via `refund()`

### 9.2 Riesgo: Clave de operador comprometida
**Probabilidad:** Baja (con buenas prácticas)
**Impacto:** Operador malicioso podría enviar `submitResults` con merkle root falso, pagándose a sí mismo
**Mitigación:**
- El contrato verifica: `linePrize + bingoPrize ≤ availablePot` — no puede robar más de lo que hay en el pot de esa ronda
- El jackpot tiene límite (`jackpotBalance`) — no puede robarlo entero
- Time-delay (24h) en cambios de operador via AccessControl
- Fondos de usuarios NO comprometidos si operador envía resultado falso: el jackpot de esa ronda se pierde, pero las rondas anteriores ya están pagadas y el jackpot nunca supera el acumulado de reserves

### 9.3 Riesgo: Contrato con bugs (pre-auditoría)
**Probabilidad:** Media
**Impacto:** Pérdida de fondos
**Mitigación:**
- Cap de fondos por contrato durante primeros 30 días (máximo $50,000 en el contrato)
- `pause()` por owner disponible siempre
- Upgrade path vía Proxy si es necesario (OpenZeppelin TransparentUpgradeableProxy)

### 9.4 Riesgo: Gas spike en Polygon
**Probabilidad:** Baja-media
**Impacto:** Transacciones fallidas o muy caras
**Mitigación:**
- Usar EIP-1559 con gas premium configurado
- Scheduler con retry logic (máx 3 intentos, incrementando gas tip)
- Monitoreo de gas price antes de enviar tx

### 9.5 Riesgo: Front-running del operatorSeed reveal
**Probabilidad:** Media (MEV bots)
**Impacto:** Alguien podría calcular cartones de otros usuarios al ver el reveal en mempool
**Mitigación:**
- El reveal ocurre en `closeRound()` — en ese momento ya no se pueden comprar más cartones
- Los números ya están comprometidos en el contrato (sus hashes)
- El reveal no permite crear nuevos cartones, solo verificar los existentes
- No hay ventaja en saber los números de otros cartones ajenos

### 9.6 Riesgo: UX degradada (2 transacciones para comprar)
**Probabilidad:** Alta (fricción real para usuarios)
**Impacto:** Menos conversión de compra
**Mitigación:**
- Approve infinito en la primera tx (no pedir de nuevo)
- EIP-2612 (permit) si USDT en la red elegida lo soporta → 1 tx en total
- Permit2 de Uniswap como alternativa universal de 1 tx
- UX clara: "Paso 1/2 solo se hace una vez"

---

## 10. DECISIONES QUE DEBES TOMAR ANTES DE EMPEZAR

| Decisión | Opciones | Recomendación |
|----------|---------|---------------|
| Red | Polygon / Arbitrum / Base | **Polygon** (VRF probado, gas barato, USDT nativo) |
| Upgrade pattern | Immutable / Proxy | **Proxy transparente** (permite fix bugs post-lanzamiento) |
| Operador key | EOA / HSM / KMS | **AWS KMS** o Fireblocks (nunca key plana en servidor) |
| Batch vs Claim | Operador paga todos / Usuario reclama | **Operador paga todos** (mejor UX, 0 acción requerida del ganador) |
| Card generation | Full on-chain hash / operatorSeed | **operatorSeed + commit-reveal** (balance seguridad/UX) |
| VRF confirmaciones | 3 / 10 / 20 | **10** (mínimo recomendado por Chainlink, ~60s en Polygon) |
| Jackpot | En contrato / separado | **En el mismo contrato** (más simple, una sola autorización) |
| Multisig | Gnosis Safe 2-de-3 / EOA | **Gnosis Safe** obligatorio para owner |

---

## 11. RESUMEN EJECUTIVO

```
Lo que cambia PARA EL USUARIO:
  ✅ Comprar cartones → firmar wallet (approve 1 vez + buy)
  ✅ Premio → llega automáticamente a su wallet (no balance custodial)
  ✅ Puede verificar que el VRF fue honesto en el explorador de bloques
  ✅ No necesita "retirar" premios — llegan directamente
  ❌ 1-2 tx por compra (en lugar de un click) → mitigar con buen UX

Lo que cambia PARA EL OPERADOR:
  ✅ No custodiar fondos (cero riesgo legal/operacional de "custodio")
  ✅ Revenue via fees automático on-chain
  ❌ Necesita LINK para VRF (~$0.05/ronda)
  ❌ Necesita gestionar clave de operador de forma segura
  ❌ ~$1,600/mes en gas (< 1% del revenue proyectado)

Lo que NO cambia:
  ✅ Toda la UI del juego (sorteo animado, cartones 3x5, overlays)
  ✅ Lógica de detección de ganadores (bingoResolverService.js)
  ✅ Sincronización multiplayer (draw_started_at + calcSyncState)
  ✅ Scheduler de 4 salas
  ✅ Sistema de premios (15%/85%)
  ✅ i18n, sonidos, confetti
```

**Esfuerzo total estimado:** 12-17 semanas para un equipo de 1 dev (backend/solidity) + 1 dev (frontend).
**Inversión de auditoría:** $15,000-40,000 USD (depending on audit firm).
**ROI:** Elimina el riesgo regulatorio de custodiar fondos de usuarios, habilitando operación legal en muchas más jurisdicciones.
