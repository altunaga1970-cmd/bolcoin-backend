# 🚀 GUÍA RÁPIDA: DEPLOYMENT BINGO SCHEDULER

**Fecha:** 2026-02-19
**Objetivo:** Poner en producción el scheduler de Bingo en Railway
**Tiempo estimado:** 30-45 minutos

---

## ✅ PRE-REQUISITOS

Antes de empezar, verifica que tienes:

- [x] `BINGO_CONTRACT_ADDRESS` en Railway
- [ ] `OPERATOR_PRIVATE_KEY` configurado
- [ ] `RPC_URL` (Alchemy/Infura) funcionando
- [ ] Contrato BingoGame deployado en Polygon Amoy
- [ ] VRF subscription fondeado y configurado
- [ ] Backend corriendo en Railway

---

## 📋 PASO 1: VERIFICAR ESTADO ACTUAL

### 1.1 Verificar si hay rondas huérfanas

```bash
cd contracts

# Dry run para ver qué rounds se cancelarían
DRY_RUN=true npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

**Si hay rounds huérfanas:**
```bash
# Cancelarlas
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

**Resultado esperado:**
```
✅ SUCCESS: All orphan rounds cancelled!
   The scheduler should now be able to create new rounds.
```

### 1.2 Diagnosticar VRF

```bash
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Checks importantes:**
- ✅ VRF Subscription tiene fondos (≥5 LINK o ≥50 MATIC)
- ✅ BingoGame está registrado como consumer
- ✅ Gas estimation exitosa

**Si falla algún check:**
1. Ir a https://vrf.chain.link
2. Conectar con wallet owner de la subscription
3. Fondear subscription
4. Agregar `BINGO_CONTRACT_ADDRESS` como consumer

---

## 🔧 PASO 2: CONFIGURAR VARIABLES EN RAILWAY

### 2.1 Variables requeridas

Ve a Railway Dashboard → Tu proyecto → Variables:

```bash
# Blockchain
BINGO_CONTRACT_ADDRESS=<tu_contrato_address>
RPC_URL=<tu_alchemy_url>
OPERATOR_PRIVATE_KEY=<operator_private_key>

# RPC Fallbacks (opcional pero recomendado)
RPC_FALLBACK_1=https://polygon-amoy.infura.io/v3/YOUR_KEY
RPC_FALLBACK_2=https://rpc-amoy.polygon.technology

# Scheduler config (opcional, usa defaults si no se especifican)
NUM_ROOMS=4
BUY_WINDOW_SECONDS=45
ENABLE_ORPHAN_RECOVERY=true
```

### 2.2 ⚠️ IMPORTANTE: Migrar OPERATOR_PRIVATE_KEY a Secrets

**NUNCA** pongas la private key en texto plano en variables normales!

En Railway:
1. Ir a Settings → Secrets
2. Crear secret: `OPERATOR_PRIVATE_KEY`
3. Valor: tu private key
4. Guardar

---

## 🚀 PASO 3: DEPLOYMENT

### 3.1 Opción A: Deploy como servicio separado (RECOMENDADO)

Si quieres correr el scheduler como un proceso separado en Railway:

**Crear nuevo servicio:**
1. Railway Dashboard → New Service
2. Conectar al mismo repo
3. Configurar Start Command: `node bingo-scheduler.js`
4. Usar las mismas variables de entorno
5. Deploy

**Ventajas:**
- Scheduler independiente del API backend
- Puede reiniciarse sin afectar API
- Monitoreo separado

### 3.2 Opción B: Agregar al backend existente

Si quieres correr el scheduler en el mismo proceso que tu backend:

**Editar tu archivo principal (ej: `index.js` o `app.js`):**

```javascript
// ... tu código existente ...

// Al final, antes de listen()
if (process.env.ENABLE_BINGO_SCHEDULER === 'true') {
  const BingoScheduler = require('./bingo-scheduler');
  // El scheduler se auto-inicia
  console.log('✅ Bingo Scheduler enabled');
}
```

**En Railway, agregar:**
```
ENABLE_BINGO_SCHEDULER=true
```

**Ventajas:**
- Un solo servicio
- Menos costo de infraestructura

**Desventajas:**
- Si el API crashea, el scheduler también
- Logs mezclados

---

## 📊 PASO 4: MONITOREAR

### 4.1 Verificar logs en Railway

En Railway → Logs, deberías ver:

```
╔════════════════════════════════════════╗
║  🎰 BINGO SCHEDULER - PRODUCTION      ║
╚════════════════════════════════════════╝

✅ Configuración validada
   Contract: 0x...
   RPC: https://polygon-amoy...
   Fallbacks: 2
   Rooms: 4
   Buy window: 45s

📦 Inicializando scheduler...
[BingoScheduler] Starting...
[BingoScheduler] Connected at block 12345678
[BingoScheduler] Operator verified ✓

[Recovery] Scanning for orphan rounds...
[Recovery] No orphan rounds found ✓

[BingoEventService] Connected at block 12345678
[BingoEventService] Event listeners set up

[BingoScheduler] Starting scheduling loop...
[BingoScheduler] Room 1: Creating round...
[BingoScheduler] Room 1: Round 5 created ✓
```

### 4.2 Verificar que no hay errores

**❌ Errores comunes:**

1. **MaxOpenRoundsReached**
   ```
   [BingoScheduler] CRITICAL: MaxOpenRoundsReached!
   ```
   **Fix:** Correr `emergency-cancel-rounds.js` de nuevo

2. **VRF request fails**
   ```
   Failed to close round: execution reverted
   ```
   **Fix:** Correr `diagnose-vrf-config.js` y verificar subscription

3. **RPC connection timeout**
   ```
   [BingoEventService] Health check failed: connection timeout
   ```
   **Fix:** Verificar RPC_URL, agregar fallbacks

4. **Wrong operator**
   ```
   Operator mismatch! Contract: 0x..., Signer: 0x...
   ```
   **Fix:** Verificar que OPERATOR_PRIVATE_KEY es correcta

### 4.3 Verificar métricas cada 5 minutos

El scheduler reporta automáticamente:

```
📊 Status Report:
   Running: true
   Circuit breaker: 🟢 CLOSED
   Consecutive failures: 0
   Stats:
     - Rounds created: 10
     - Rounds closed: 8
     - Rounds resolved: 7
     - Orphans recovered: 2
     - Errors: 0
```

---

## ✅ PASO 5: VALIDACIÓN (48 HORAS)

### Exit Criteria para Phase 1:

- [ ] Scheduler corre 48h sin errores críticos
- [ ] 0 orphan rounds después de 3 restarts simulados
- [ ] Event listener reconecta automáticamente
- [ ] VRF fulfillment 100% exitoso (n=10 rounds)
- [ ] Circuit breaker no se abre

### Cómo validar:

**Cada 6 horas:**
1. Revisar logs en Railway
2. Verificar stats en status report
3. Buscar errores con: `grep -i error` en logs
4. Verificar 0 orphan rounds:
   ```bash
   npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
   # Debe decir: "No orphan rounds found"
   ```

**Simular restart (3 veces en 48h):**
1. Railway Dashboard → Restart service
2. Esperar 2-3 minutos
3. Verificar en logs: `[Recovery] Processing orphan round X`
4. Confirmar que recovery funciona

**Si todo pasa:** ✅ Phase 1 COMPLETE, proceder a Phase 2

---

## 🆘 TROUBLESHOOTING

### Scheduler no inicia

**Error:** `MODULE_NOT_FOUND: Cannot find module './src/services/bingoSchedulerOnChain'`

**Fix:**
```bash
# Verificar que los archivos existen
ls backend/src/services/bingoSchedulerOnChain.js
ls backend/src/services/bingoEventService.js
ls backend/src/chain/abi/BingoGame.json

# Si faltan, copiar del repo
git pull
```

### Scheduler crashea cada minuto

**Síntoma:** Circuit breaker se abre constantemente

**Diagnóstico:**
1. Ver logs para identificar el error
2. Verificar RPC_URL está respondiendo
3. Verificar OPERATOR_PRIVATE_KEY es correcta
4. Verificar contract address es correcto

**Fix temporal:**
- Aumentar `MAX_CONSECUTIVE_FAILURES=10`
- Aumentar `CIRCUIT_BREAKER_COOLDOWN=300000` (5 min)

### VRF nunca se cumple

**Síntoma:** Rounds se quedan en VRF_REQUESTED forever

**Diagnóstico:**
```bash
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Posibles causas:**
- Subscription sin fondos
- BingoGame no está como consumer
- Wrong VRF Coordinator address

**Fix:**
1. Fondear subscription en vrf.chain.link
2. Agregar contract como consumer
3. Esperar 2-5 min (VRF puede tardar en testnet)

---

## 📈 PRÓXIMOS PASOS

Una vez que Phase 1 esté validado (48h uptime):

1. **Phase 2.1:** Security audit
   ```bash
   pip install slither-analyzer
   bash contracts/scripts/security-audit.sh all
   ```

2. **Phase 2.2:** Migrar OPERATOR_KEY a Railway Secrets (si no lo hiciste)

3. **Phase 2.3:** E2E testing
   - Crear test suite
   - Validar full flow con VRF

4. **Phase 2.4:** Load testing
   - 100 concurrent users
   - Target: p95 <500ms, error <1%

---

## 📞 CHECKLIST DE DEPLOYMENT

Antes de considerar el deployment exitoso:

- [ ] Rondas huérfanas canceladas (0 rounds OPEN/CLOSED)
- [ ] VRF diagnostic pasa todos los checks
- [ ] Variables de entorno configuradas en Railway
- [ ] OPERATOR_PRIVATE_KEY en Railway Secrets
- [ ] Scheduler desplegado (servicio separado o integrado)
- [ ] Logs muestran "Scheduler corriendo..."
- [ ] Primeras 4 rondas creadas exitosamente
- [ ] Event listener conectado
- [ ] Orphan recovery ejecutado en startup
- [ ] Status report generándose cada 5 min
- [ ] 0 errores críticos en primeras 2 horas
- [ ] Plan de monitoreo para 48h

---

**Última actualización:** 2026-02-19
**Autor:** Claude Code (Autonomous)
**Versión:** 1.0
