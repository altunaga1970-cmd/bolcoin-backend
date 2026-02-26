# 🔍 AUDITORÍA BINGO — RAILWAY DEPLOYMENT
**Fecha:** 2026-02-19
**Auditor:** Claude Code (Autonomous)
**Alcance:** Análisis de errores en producción Railway + revisión completa del sistema Bingo
**Estado del Sistema:** 🔴 **BLOQUEADO** — Scheduler fallando en bucle

---

## 🚨 HALLAZGOS CRÍTICOS (P0)

### ❌ **C-01: Scheduler bloqueado por límite de rondas abiertas**
**Severidad:** 🔴 CRÍTICA
**Archivo:** `bingoSchedulerOnChain.js:118`, `BingoGame.sol:228`
**Error observado:**
```
[BingoOnChainScheduler] Room 1 error: execution reverted (unknown custom error)
(action="estimateGas", data="0x25470bc4", ...)
```

**Análisis:**
- El error `0x25470bc4` corresponde a `MaxOpenRoundsReached()` en el smart contract
- El contrato tiene un límite `MAX_OPEN_ROUNDS = 4` (línea 38 de `BingoGame.sol`)
- El scheduler de 4 salas está intentando crear nuevas rondas, pero **todas las salas están bloqueadas** con rondas que nunca se cerraron
- Las rondas abiertas se acumulan en el array `_openRoundIds` y nunca se remueven porque el ciclo de cierre falla

**Causa raíz:**
1. El scheduler crea rondas exitosamente (`createRound()`)
2. Espera 45s de buy window
3. **Intenta cerrar** (`closeRound()`) pero **falla en `estimateGas`**
4. La ronda queda en estado `OPEN` indefinidamente
5. Después de 4 intentos (4 salas), el array `_openRoundIds.length >= 4`
6. Nuevas creaciones fallan con `MaxOpenRoundsReached()`

**Impacto:**
- ✅ El sistema **NO pierde fondos** (rondas abiertas sin cartones no tienen revenue)
- ❌ El juego **NO funciona** — ninguna sala puede avanzar
- ❌ Usuarios **NO pueden jugar** — no hay rondas activas
- ⚠️ **Reiniciar el backend NO resuelve** el problema (estado persiste en blockchain)

**Solución requerida (URGENTE):**
1. **Cancelar manualmente** las 4+ rondas huérfanas desde la wallet del operador:
   ```javascript
   // Script de emergencia
   const roundIds = [1, 2, 3, 4]; // IDs de rondas bloqueadas
   for (const id of roundIds) {
     await bingoContract.emergencyCancelRound(id);
   }
   ```
2. **Diagnosticar** por qué `closeAndRequestVRF()` falla en `estimateGas` (ver C-02)

---

### ❌ **C-02: Configuración VRF posiblemente incorrecta o sin fondos**
**Severidad:** 🔴 CRÍTICA
**Archivo:** `BingoGame.sol:297-308`, `.env` (VRF config)

**Hipótesis:**
El `estimateGas` falla en `closeAndRequestVRF()` porque:
1. **Subscription sin fondos:** El VRF subscription no tiene LINK/MATIC para pagar
2. **VRF config incorrecta:** `vrfSubscriptionId`, `vrfKeyHash`, o `s_vrfCoordinator` apuntan a addresses inválidas
3. **Contrato no autorizado:** El BingoGame no está agregado como consumidor en el VRF subscription

**Evidencia:**
- El método `s_vrfCoordinator.requestRandomWords()` es el único punto de fallo externo en `closeAndRequestVRF`
- No hay errores de `NotOperator()` → la wallet tiene permisos
- No hay errores de `RoundNotOpen()` → las rondas existen y están OPEN

**Verificación necesaria:**
```bash
# Revisar config VRF en .env
echo $VRF_SUBSCRIPTION_ID
echo $VRF_KEY_HASH
echo $VRF_COORDINATOR_ADDRESS

# Verificar fondos en Chainlink VRF UI
# https://vrf.chain.link/polygon-amoy (testnet)
# https://vrf.chain.link/polygon (mainnet)
```

**Acción inmediata:**
1. Confirmar que el VRF subscription tiene fondos (LINK o MATIC según configuración)
2. Verificar que `BINGO_CONTRACT_ADDRESS` está registrado como consumidor en el subscription
3. Validar que `vrfKeyHash` corresponde a la red correcta (Amoy vs Mainnet)

---

### ⚠️ **C-03: Event listeners perdiendo conexión con RPC**
**Severidad:** 🟠 ALTA
**Archivo:** `bingoEventService.js` (implícito por logs)
**Error observado:**
```
@TODO Error: could not coalesce error (error={ "code": -32000, "message": "filter not found" },
payload={ "method": "eth_getFilterChanges", "params": [ "0x1e548d523f65f13b2591a163c78736a8" ] })
```

**Análisis:**
- `eth_getFilterChanges` es usado por ethers.js para polling de eventos
- El error `filter not found` indica que el RPC node **borró el filtro** (timeout o reinicio)
- Los event listeners de `bingoEventService` usan `contract.on(...)` que crean filtros persistentes
- **Filtros expiran** si el RPC node reinicia o si pasan >5 min sin polling

**Impacto:**
- ⚠️ Eventos `VrfFulfilled` podrían **no indexarse** en la DB
- ⚠️ Auto-resolución de rondas podría **no ejecutarse** si el evento se pierde
- ⚠️ Datos financieros (`jackpotBalance`, `accruedFees`) podrían **desincronizarse**

**Solución:**
1. **Añadir reconexión automática** en `bingoEventService`:
   ```javascript
   provider.on('error', async (error) => {
     console.error('[BingoEvents] Provider error, reconnecting...', error);
     await this.stop();
     await this.start();
   });
   ```
2. **Polling fallback:** Si un filtro falla, hacer `queryFilter` desde el último bloque indexado
3. **Health check:** Verificar cada 60s que los listeners siguen activos

---

## 🛡️ HALLAZGOS DE SEGURIDAD (P1)

### 🔒 **S-01: Wallet privada del operador expuesta en servidor**
**Severidad:** 🔴 CRÍTICA
**Archivo:** `.env` (OPERATOR_PRIVATE_KEY), `provider.js:20`

**Riesgo:**
- La private key del operador está en `.env` del servidor Railway
- **Si el servidor es comprometido**, el atacante puede:
  - Robar todos los fondos del contrato (`accruedFees`)
  - Manipular resultados de rondas (firmar resoluciones falsas)
  - Cancelar rondas activas y robar revenue

**Mejores prácticas NO implementadas:**
- ❌ No hay KMS (AWS KMS, Google Secret Manager, Railway Secrets con rotación)
- ❌ No hay rate limiting en llamadas on-chain
- ❌ No hay multi-sig para operaciones financieras (withdrawFees)

**Recomendación (P1):**
1. **Inmediato:** Mover `OPERATOR_PRIVATE_KEY` a Railway Secrets (encriptado)
2. **Corto plazo:** Implementar Gnosis Safe multi-sig para el operador
3. **Largo plazo:** Migrar a AWS KMS o HashiCorp Vault

---

### 🔒 **S-02: Sin validación de gas price en transacciones on-chain**
**Severidad:** 🟡 MEDIA
**Archivo:** `bingoService.js:201-202`, `bingoResolverService.js:316-323`

**Riesgo:**
- Las transacciones `createRound()`, `closeAndRequestVRF()`, `resolveRound()` no configuran `maxFeePerGas`
- En picos de congestión de red, el operador podría **pagar gas excesivo**
- **Sin límite de gas**, una tx podría costar >$100 USDT en Polygon mainnet

**Ejemplo actual:**
```javascript
const tx = await contract.createRound(scheduledCloseTimestamp);
// ❌ Sin maxFeePerGas, sin maxPriorityFeePerGas
```

**Recomendación:**
```javascript
const feeData = await provider.getFeeData();
const tx = await contract.createRound(scheduledCloseTimestamp, {
  maxFeePerGas: feeData.maxFeePerGas * 120n / 100n, // +20% buffer
  maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
});
```

---

### 🔒 **S-03: Signature replay vulnerable si se redeploya el contrato**
**Severidad:** 🟡 MEDIA
**Archivo:** `bingoResolverService.js:199-204` (EIP-712 domain)

**Análisis:**
- El dominio EIP-712 incluye `chainId` y `verifyingContract`, pero **no version hash**
- Si el contrato se actualiza/redeploya a la misma address (proxy upgrade), las firmas viejas podrían re-usarse
- **No es un riesgo en deployment actual** (no es upgradeable), pero sí en futuros upgrades

**Recomendación:**
- Si se migra a proxy upgradeable, añadir `version: '2'` al domain para invalidar firmas anteriores

---

## 🏗️ HALLAZGOS TÉCNICOS (P1-P2)

### ⚠️ **T-01: Scheduler no recupera rondas huérfanas al reiniciar**
**Severidad:** 🟠 ALTA
**Archivo:** `bingoSchedulerOnChain.js` (falta función `recoverOrphanRounds`)
**Estado:** ✅ **YA REPORTADO** en `audit-master-bingo.md` (P0), pero **NO resuelto**

**Problema:**
- Si el servidor Railway **reinicia** (deploy, crash), el scheduler arranca desde cero
- Las rondas que estaban en `vrf_wait`, `drawing`, o `closed` quedan **huérfanas**
- **No hay recovery logic** — el scheduler crea nuevas rondas en lugar de continuar las existentes

**Impacto actual:**
- En el loop actual, **este bug no se manifiesta** porque las rondas nunca avanzan de `OPEN`
- **Cuando se resuelva C-01**, este bug bloqueará rondas en estado intermedio

**Solución (del backlog P0):**
```javascript
async function recoverOrphanRounds() {
  const orphans = await bingoService.getOrphanRounds();

  for (const drawing of orphans.drawing) {
    const elapsed = Date.now() - new Date(drawing.draw_started_at);
    const remaining = calcDrawDurationMs(...) - elapsed;
    if (remaining > 0) await sleep(remaining);
    await bingoService.finalizeDrawing(drawing.round_id);
  }

  for (const closed of orphans.closed) {
    // Trigger manual resolution
    await bingoResolverService.resolveRound(closed.round_id);
  }

  for (const stale of orphans.staleOpen) {
    await bingoService.closeRoundOffChain(stale.round_id);
  }
}
```

**Prioridad:** 🔴 **CRÍTICA** — debe implementarse ANTES de resolver C-01, o habrá pérdida de revenue en rondas colgadas

---

### ⚠️ **T-02: VRF polling usa tiempo fijo sin considerar latencia de red**
**Severidad:** 🟡 MEDIA
**Archivo:** `bingoSchedulerOnChain.js:34-35`

**Código actual:**
```javascript
const VRF_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min fijo
const VRF_POLL_INTERVAL_MS = 3000;          // 3s fijo
```

**Problema:**
- En **testnet Amoy**, VRF puede tardar 30-120s (10 blocks * ~3s)
- En **mainnet Polygon**, VRF puede tardar 30-60s (10 blocks * ~2s)
- El timeout de 10min es **excesivo** para ambos casos
- El polling cada 3s **genera 200 queries** por ronda → high RPC usage

**Recomendación:**
```javascript
const VRF_WAIT_TIMEOUT_MS = process.env.NODE_ENV === 'production'
  ? 3 * 60 * 1000  // 3min en mainnet
  : 5 * 60 * 1000; // 5min en testnet
const VRF_POLL_INTERVAL_MS = 5000; // 5s (40% menos queries)
```

---

### ⚠️ **T-03: Sin circuit breaker si VRF falla repetidamente**
**Severidad:** 🟡 MEDIA
**Archivo:** `bingoSchedulerOnChain.js:104-194` (roomLoop)

**Problema:**
- Si VRF falla 10 veces seguidas (Chainlink outage, config error), el scheduler **continúa creando rondas**
- Cada ronda fallida queda en `VRF_REQUESTED` indefinidamente
- **Sin límite de reintentos**, podría crear 100+ rondas fallidas antes de que un humano note

**Solución:**
```javascript
let consecutiveVrfFailures = 0;
const MAX_VRF_FAILURES = 3;

if (!resolution) {
  consecutiveVrfFailures++;
  if (consecutiveVrfFailures >= MAX_VRF_FAILURES) {
    console.error('[BingoScheduler] Circuit breaker: VRF failing repeatedly, pausing scheduler');
    _stopRequested = true;
    // Enviar alerta (email, Slack, PagerDuty)
    return;
  }
} else {
  consecutiveVrfFailures = 0; // Reset en éxito
}
```

---

## 💰 HALLAZGOS FINANCIEROS (P2)

### 💸 **F-01: Sin monitoreo de saldo USDT del contrato**
**Severidad:** 🟡 MEDIA
**Archivo:** N/A (falta telemetría)

**Riesgo:**
- El contrato debe tener USDT para pagar premios
- Si `jackpotBalance + availablePool < suma de revenue de rondas activas`, **no puede pagar**
- **No hay alertas** si el saldo cae por debajo de un umbral

**Recomendación:**
```javascript
async function checkContractBalance() {
  const usdtBalance = await paymentToken.balanceOf(BINGO_CONTRACT_ADDRESS);
  const requiredReserve = await contract.jackpotBalance() + estimatedPendingPrizes();

  if (usdtBalance < requiredReserve * 110n / 100n) { // <110% reserve
    console.error('[Bingo] ⚠️ LOW BALANCE ALERT');
    // Send alert
  }
}
```

---

### 💸 **F-02: Fees acumulados nunca se retiran automáticamente**
**Severidad:** 🟢 BAJA
**Archivo:** `BingoGame.sol` (falta `autoWithdrawFees`)

**Observación:**
- `accruedFees` se acumulan en el contrato indefinidamente
- Requiere llamada manual de `withdrawFees(address to, uint256 amount)` por el owner
- **No es un bug**, pero sí falta automatización

**Recomendación (nice-to-have):**
- Retirar fees automáticamente cuando `accruedFees > threshold` (ej: 1000 USDT)

---

## 🎨 HALLAZGOS DE UX (P2)

### 🧑‍💻 **UX-01: Sin indicador visual de estado del scheduler**
**Severidad:** 🟢 BAJA
**Archivo:** Frontend (falta health endpoint)

**Problema:**
- Usuarios ven "No hay salas activas" sin explicación
- **No saben** si el sistema está down o simplemente sin jugadores

**Solución:**
```javascript
// Backend: GET /api/bingo/health
router.get('/health', (req, res) => {
  const rooms = bingoScheduler.getRoomStates();
  const allStuck = Object.values(rooms).every(r => r.phase === 'error');
  res.json({
    healthy: !allStuck,
    rooms,
    message: allStuck ? 'Sistema temporalmente fuera de servicio' : 'Operando normalmente'
  });
});
```

---

## 📊 RESUMEN EJECUTIVO

### Estado Actual del Sistema
```
┌─────────────────────────────┬──────────┬─────────────────────────┐
│ Componente                  │ Estado   │ Bloqueador              │
├─────────────────────────────┼──────────┼─────────────────────────┤
│ Backend API                 │ ✅ UP    │ -                       │
│ Database PostgreSQL         │ ✅ UP    │ -                       │
│ Scheduler On-Chain          │ 🔴 DOWN  │ MaxOpenRoundsReached()  │
│ VRF Integration             │ ❓ ???   │ Requiere verificación   │
│ Event Indexer               │ ⚠️ FLAKY │ Filter timeouts         │
│ Smart Contract              │ ✅ UP    │ Bloqueado por scheduler │
└─────────────────────────────┴──────────┴─────────────────────────┘
```

### Priorización de Fixes

#### 🚨 **URGENTE (Próximas 24h)**
1. **C-01:** Cancelar rondas huérfanas manualmente → Desbloquearcondador
2. **C-02:** Verificar y financiar VRF subscription
3. **T-01:** Implementar recovery de rondas huérfanas (para evitar recurrencia)

#### 🔴 **ALTA (Esta semana)**
4. **S-01:** Mover OPERATOR_PRIVATE_KEY a Railway Secrets
5. **C-03:** Añadir reconexión automática de event listeners
6. **T-03:** Implementar circuit breaker para VRF

#### 🟡 **MEDIA (Próximo sprint)**
7. **S-02:** Añadir límites de gas price
8. **T-02:** Optimizar timeouts de VRF según red
9. **F-01:** Monitoreo de saldo del contrato

#### 🟢 **BAJA (Backlog)**
10. **S-03:** Version hash en EIP-712 (solo si se hace upgradeable)
11. **F-02:** Auto-retiro de fees
12. **UX-01:** Endpoint de health

---

## 🛠️ PLAN DE REMEDIACIÓN

### Fase 1: Desbloqueo (Hoy)
```bash
# 1. Conectar a la wallet del operador
cd contracts
npx hardhat console --network <amoy|polygon>

# 2. Obtener IDs de rondas bloqueadas
const bingo = await ethers.getContractAt("BingoGame", process.env.BINGO_CONTRACT_ADDRESS);
const openRounds = await bingo.getOpenRoundIds(); // Función a añadir
console.log("Rondas bloqueadas:", openRounds);

# 3. Cancelar cada una
for (const id of openRounds) {
  const tx = await bingo.emergencyCancelRound(id);
  await tx.wait();
  console.log(`Ronda ${id} cancelada`);
}

# 4. Verificar VRF config
const subId = await bingo.vrfSubscriptionId();
console.log("VRF Subscription:", subId);
# Ir a https://vrf.chain.link y verificar fondos + consumidores
```

### Fase 2: Estabilización (Esta semana)
1. Implementar `recoverOrphanRounds()` en scheduler
2. Añadir reconexión de event listeners
3. Mover secrets a Railway Secrets
4. Desplegar y monitorear 24h

### Fase 3: Hardening (Próximo sprint)
1. Circuit breaker
2. Gas price limits
3. Health monitoring
4. Alertas (Slack/email en errores críticos)

---

## 📈 MÉTRICAS DE CALIDAD

### Cobertura de Tests
```
Backend Services:     ✅ 139 tests pasando
Frontend Components:  ❓ No verificado
Smart Contract:       ❓ No verificado (requiere hardhat test)
Integration E2E:      ❌ No existe
```

### Deuda Técnica Identificada
- **Crítica:** 3 items (C-01, C-02, C-03)
- **Alta:** 4 items (S-01, T-01, T-03, F-01)
- **Media:** 3 items (S-02, S-03, T-02)
- **Baja:** 2 items (F-02, UX-01)

**Total:** 12 items técnicos + riesgo financiero moderado

---

## ✅ CONCLUSIONES

### ¿Está listo para producción con dinero real?
**❌ NO.** El sistema tiene 3 blockers críticos:

1. **Scheduler completamente bloqueado** (C-01) — el juego NO funciona
2. **Config VRF sin verificar** (C-02) — podría ser la causa raíz de C-01
3. **Private key sin protección** (S-01) — riesgo de robo de fondos

### ¿Qué funciona bien?
✅ **Arquitectura sólida:** Separación on-chain/off-chain bien diseñada
✅ **Smart contract robusto:** Límites de seguridad (MAX_OPEN_ROUNDS, MAX_CO_WINNERS)
✅ **Recovery considerado:** Función `getOrphanRounds()` existe (solo falta invocarla)
✅ **Tests comprehensivos:** 139 tests en servicios core

### Recomendación Final
**HOLD** en producción hasta:
1. Resolver C-01 (cancelar rondas huérfanas)
2. Confirmar C-02 (VRF funcional)
3. Implementar T-01 (recovery de orphans)
4. Desplegar y **probar 48h** en staging con load testing

**Tiempo estimado:** 2-3 días de trabajo focalizado.

---

**Auditor:** Claude Code
**Firma digital:** Generado el 2026-02-19 13:30 UTC
**Contacto:** Este informe es autónomo. Para seguimiento, consultar PROJECT_STATE.md
