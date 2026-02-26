# ✅ DEPLOYMENT FINAL CHECKLIST

**Fecha:** 2026-02-19
**Objetivo:** Desplegar Bingo Scheduler a Railway en producción
**Tiempo estimado:** 30-45 minutos

---

## 📦 ARCHIVOS CREADOS (RESUMEN)

### Backend Principal
```
backend/
├── index.js                              ✅ NUEVO - Entry point con scheduler integrado
├── bingo-scheduler.js                    ✅ NUEVO - Scheduler standalone
├── .env.bingo.example                    ✅ NUEVO - Template de variables
│
├── src/
│   ├── services/
│   │   ├── bingoSchedulerOnChain.js      ✅ NUEVO - Scheduler con recovery
│   │   └── bingoEventService.js          ✅ NUEVO - Event listener resiliente
│   └── chain/
│       └── abi/
│           └── BingoGame.json            ✅ NUEVO - ABI del contrato
│
└── scripts/
    ├── check-deployment.js               ✅ NUEVO - Verificar deployment readiness
    ├── test-rpc-connection.js            ✅ NUEVO - Test RPC connectivity
    ├── monitor-scheduler.js              ✅ NUEVO - Monitor en producción
    └── security-check.js                 ✅ CREADO - Security scan
```

### Contratos
```
contracts/
└── scripts/
    ├── emergency-cancel-rounds.js        ✅ CREADO - Cancelar rounds huérfanas
    └── diagnose-vrf-config.js            ✅ CREADO - Diagnosticar VRF
```

### Documentación
```
docs/
├── PHASE_1_EMERGENCY_GUIDE.md            ✅ CREADO
├── PHASE_2_SECURITY_AUDIT.md             ✅ CREADO
├── BINGO_DEPLOYMENT_GUIDE.md             ✅ CREADO
├── NEXT_STEPS_RAILWAY.md                 ✅ CREADO
└── DEPLOYMENT_FINAL_CHECKLIST.md         ✅ ESTE ARCHIVO
```

---

## 🚀 DEPLOYMENT PASO A PASO

### PASO 0: Pre-flight Checks (Local)

```bash
# 1. Verificar deployment readiness
cd backend
node scripts/check-deployment.js

# Si hay errores, intentar fix automático:
node scripts/check-deployment.js --fix

# 2. Test RPC connection
node scripts/test-rpc-connection.js
# O con URL específica:
# node scripts/test-rpc-connection.js https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
```

**Debe pasar todos los checks ✅**

---

### PASO 1: Limpiar Estado del Contrato

```bash
cd contracts

# Ver si hay rounds huérfanas (dry run)
DRY_RUN=true npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Si hay rounds, cancelarlas:
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Verificar VRF
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Exit criteria:**
- ✅ 0 orphan rounds
- ✅ VRF subscription funded (≥5 LINK)
- ✅ BingoGame is VRF consumer
- ✅ Gas estimation succeeds

---

### PASO 2: Configurar Variables en Railway

#### A. Variables Requeridas (CRÍTICAS)

```bash
# Blockchain
BINGO_CONTRACT_ADDRESS=0x...              # Ya tienes ✅
RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
OPERATOR_PRIVATE_KEY=0x...                # ⚠️ Mover a Secrets después!

# Scheduler
ENABLE_BINGO_SCHEDULER=true
```

#### B. Variables Opcionales (Recomendadas)

```bash
# RPC Fallbacks
RPC_FALLBACK_1=https://polygon-amoy.infura.io/v3/YOUR_KEY
RPC_FALLBACK_2=https://rpc-amoy.polygon.technology

# Scheduler Config
NUM_ROOMS=4
BUY_WINDOW_SECONDS=45
ROUND_INTERVAL_SECONDS=120

# Recovery
ENABLE_ORPHAN_RECOVERY=true
ORPHAN_RECOVERY_INTERVAL=300000

# Circuit Breaker
MAX_CONSECUTIVE_FAILURES=5
CIRCUIT_BREAKER_COOLDOWN=60000

# Logs
LOG_LEVEL=info
NODE_ENV=production
```

#### C. CORS & Frontend

```bash
FRONTEND_URL=https://tu-frontend.pages.dev
ALLOWED_ORIGINS=https://tu-frontend.pages.dev,https://www.tu-frontend.pages.dev
```

---

### PASO 3: Deploy a Railway

#### Opción A: Servicio Separado (RECOMENDADO)

1. Railway Dashboard → **New Service**
2. Conectar al mismo repo
3. Settings → **Start Command:**
   ```
   node index.js
   ```
4. Variables → Copiar todas las variables del paso 2
5. **Deploy**

**Ventajas:**
- Scheduler independiente del API
- Puede reiniciarse sin afectar API
- Logs separados

#### Opción B: Mismo Servicio

1. Ya tienes `index.js` que auto-detecta `ENABLE_BINGO_SCHEDULER`
2. En Railway → Variables → Agregar:
   ```
   ENABLE_BINGO_SCHEDULER=true
   ```
3. **Redeploy**

**Ventajas:**
- Un solo servicio (más económico)
- Código ya está listo en `index.js`

---

### PASO 4: Verificar Deployment (Primeras 2 horas)

#### A. Verificar que el servicio arrancó

Railway → Logs, buscar:

```
✅ SEÑALES DE ÉXITO:
╔════════════════════════════════════════╗
║  🎰 BINGO SCHEDULER - PRODUCTION      ║
╚════════════════════════════════════════╝

✅ Configuración validada
[BingoScheduler] Operator verified ✓
[Recovery] No orphan rounds found ✓
[BingoEventService] Connected at block 12345678
[BingoScheduler] Room 1: Round X created ✓
```

```
❌ ERRORES A BUSCAR:
MaxOpenRoundsReached     → Correr emergency-cancel-rounds.js
VRF request fails        → Verificar VRF config
Connection timeout       → Verificar RPC_URL
Operator mismatch        → Verificar OPERATOR_PRIVATE_KEY
MODULE_NOT_FOUND         → Faltan archivos en deploy
```

#### B. Test health endpoints

```bash
# Health básico
curl https://tu-app.railway.app/health

# Health detallado
curl https://tu-app.railway.app/health/detailed

# Bingo status
curl https://tu-app.railway.app/api/bingo/status
```

**Debe retornar:**
```json
{
  "status": "ok",
  "services": {
    "scheduler": "healthy"
  }
}
```

#### C. Monitor desde local

```bash
# Monitorear cada 30 segundos
HEALTH_URL=https://tu-app.railway.app/health/detailed node scripts/monitor-scheduler.js --interval 30
```

---

### PASO 5: Validación Continua (48 horas)

#### Cada 6 horas:

1. **Revisar logs en Railway**
   - Buscar errores: `grep -i error`
   - Verificar rounds creadas
   - Ver status report (cada 5 min)

2. **Verificar métricas**
   ```bash
   curl https://tu-app.railway.app/health/detailed | jq '.services.scheduler.stats'
   ```

   Debe mostrar:
   ```json
   {
     "roundsCreated": 100,   // Incrementando
     "roundsClosed": 95,
     "roundsResolved": 90,
     "orphansRecovered": 2,
     "errors": 0            // Idealmente 0
   }
   ```

3. **Test orphan rounds**
   ```bash
   # Cada 12 horas
   npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
   # Debe decir: "No orphan rounds found"
   ```

#### Simular restarts (3 veces en 48h):

1. Railway → Restart service
2. Esperar 2-3 minutos
3. Ver logs: buscar `[Recovery] Processing orphan round`
4. Verificar que recovery funciona

---

## 🔒 PASO 6: Migrar OPERATOR_PRIVATE_KEY a Secrets

**⚠️ IMPORTANTE: Hacer DESPUÉS de validar que el scheduler funciona**

### Opción A: Railway Secrets (si disponible)

1. Railway → Settings → Secrets
2. Create secret: `OPERATOR_PRIVATE_KEY`
3. Valor: tu private key
4. Remove de variables normales
5. Redeploy

### Opción B: Encriptar en variables (temporal)

Si Railway Secrets no está disponible:
- Usar la key actual PERO planear rotarla
- En Phase 2 implementar vault (AWS KMS, Hashicorp Vault)

---

## 📊 PASO 7: Success Criteria

### ✅ Phase 1 Complete cuando:

- [ ] Scheduler corre **48h** sin errores críticos
- [ ] **0 orphan rounds** después de 3 restarts
- [ ] Event listener **reconecta automáticamente**
- [ ] VRF fulfillment **100% exitoso** (n≥10 rounds)
- [ ] Circuit breaker **NO se abre**
- [ ] Stats muestran progreso:
  ```
  roundsCreated > 0
  roundsClosed ≈ roundsCreated
  roundsResolved ≈ roundsClosed
  errors = 0 (o muy bajo)
  ```

---

## 🆘 TROUBLESHOOTING RÁPIDO

### Error: "MaxOpenRoundsReached"

```bash
# Local
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
# Debe limpiar las rounds huérfanas
```

### Error: "VRF request fails"

```bash
# Local
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
# Verificar:
# - Subscription tiene fondos
# - BingoGame es consumer
```

### Error: "Connection timeout"

```bash
# Test RPC
node scripts/test-rpc-connection.js

# Si falla, agregar fallbacks en Railway:
RPC_FALLBACK_1=...
RPC_FALLBACK_2=...
```

### Error: "Operator mismatch"

- Verificar que `OPERATOR_PRIVATE_KEY` es la correcta
- Debe coincidir con el operator del contrato
- Ver en contrato: `await bingo.operator()`

### Error: "MODULE_NOT_FOUND"

- Verificar que todos los archivos se deployaron
- Railway → Files → Verificar estructura
- Puede ser que `src/` no se subió

### Scheduler se detiene después de 1 hora

- Verificar memoria en Railway
- Ver logs para OOM (Out of Memory)
- Puede necesitar upgrade de plan Railway

---

## 📈 MÉTRICAS A MONITOREAR

### Durante las primeras 48h:

| Métrica | Target | Cómo verificar |
|---------|--------|----------------|
| Uptime | 100% | Railway dashboard |
| Rounds created/hour | ~30 (4 rooms @ 2min) | Logs + /health/detailed |
| Error rate | <1% | `errors / (created + closed)` |
| VRF fulfillment | 100% | Logs: "VrfFulfilled" events |
| Orphan rounds | 0 | `emergency-cancel-rounds.js` |
| Circuit breaker | CLOSED | /health/detailed |
| Memory usage | <256MB | /health/detailed |
| Response time /health | <200ms | Monitor script |

---

## 🎯 DESPUÉS DE 48H DE VALIDACIÓN

Si todo pasa ✅, proceder a:

### Phase 2.1: Security Audit

```bash
# Smart contracts
pip install slither-analyzer
bash contracts/scripts/security-audit.sh all

# Backend
node backend/scripts/security-check.js
```

### Phase 2.2: Migrar Secrets

- OPERATOR_PRIVATE_KEY → Railway Secrets
- Rotar key si estuvo expuesta

### Phase 2.3: E2E Testing

- Crear test suite
- Test full VRF flow
- Load testing (100 users)

---

## 📞 CHECKLIST FINAL

Antes de considerar deployment exitoso:

### Pre-deployment
- [ ] `check-deployment.js` pasa todos los checks
- [ ] `test-rpc-connection.js` muestra "EXCELLENT" o "MODERATE"
- [ ] Rounds huérfanas canceladas (0 OPEN/CLOSED)
- [ ] VRF diagnostic pasa (funds, consumer, gas)

### Deployment
- [ ] Variables configuradas en Railway (12+ vars)
- [ ] `ENABLE_BINGO_SCHEDULER=true`
- [ ] Servicio deployado y arrancó sin errores
- [ ] Health endpoint retorna 200 OK

### Validación (2h)
- [ ] Logs muestran "Scheduler corriendo..."
- [ ] Primeras 4 rondas creadas exitosamente
- [ ] Event listener conectado
- [ ] Orphan recovery ejecutado en startup
- [ ] Status report cada 5 min
- [ ] 0 errores críticos

### Validación (48h)
- [ ] 48h uptime continuo
- [ ] 0 orphan rounds después de 3 restarts
- [ ] Stats muestran progreso (rounds created > 100)
- [ ] Circuit breaker nunca se abrió
- [ ] VRF 100% exitoso
- [ ] Error rate <1%

### Security
- [ ] OPERATOR_KEY migrada a Secrets
- [ ] .env no commiteado a git
- [ ] Security audit corrido (Phase 2)

---

## 🎉 SUCCESS!

Si completaste todos los checks:

**✅ PHASE 1 COMPLETE**

Ahora puedes proceder a:
1. Phase 2: Security & Testing (1 semana)
2. Phase 3: Production Hardening (3 semanas)
3. Phase 4: Go-Live (1 semana)

**Total timeline:** 6-8 semanas hasta producción con dinero real

---

## 📚 RECURSOS

**Scripts creados:**
- `backend/scripts/check-deployment.js` - Verificar readiness
- `backend/scripts/test-rpc-connection.js` - Test RPC
- `backend/scripts/monitor-scheduler.js` - Monitor producción
- `contracts/scripts/emergency-cancel-rounds.js` - Cleanup
- `contracts/scripts/diagnose-vrf-config.js` - VRF debug

**Documentación:**
- `BINGO_DEPLOYMENT_GUIDE.md` - Guía completa paso a paso
- `PHASE_1_EMERGENCY_GUIDE.md` - Herramientas emergencia
- `NEXT_STEPS_RAILWAY.md` - Next steps específicos
- Este archivo - Checklist final

**Endpoints:**
- `/health` - Health básico
- `/health/detailed` - Health con métricas
- `/healthz` - Liveness probe
- `/ready` - Readiness probe
- `/api/bingo/status` - Scheduler status

---

**Última actualización:** 2026-02-19
**Versión:** 1.0 Final
**Status:** ✅ Ready for deployment

¡Buena suerte con el deployment! 🚀
