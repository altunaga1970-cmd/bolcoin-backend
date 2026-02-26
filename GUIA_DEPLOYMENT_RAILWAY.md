# 🚂 GUÍA PASO A PASO: DEPLOYMENT A RAILWAY

**Tiempo estimado:** 10-15 minutos
**Dificultad:** Fácil

---

## 📋 ANTES DE EMPEZAR

### ✅ Tienes que tener:

1. ✅ Cuenta en Railway
2. ✅ Proyecto conectado al repo de Bolcoin
3. ✅ `BINGO_CONTRACT_ADDRESS` ya configurada
4. ✅ RPC URL (Alchemy o Infura)
5. ✅ OPERATOR_PRIVATE_KEY (la del wallet operador del contrato)

### 📄 Archivo de referencia:

**Abre:** `RAILWAY_VARIABLES.txt` (recién creado)

Este archivo tiene TODAS las variables que necesitas con explicaciones.

---

## 🎯 PASO 1: ABRIR RAILWAY

1. Ve a: https://railway.app
2. Login con tu cuenta
3. Selecciona tu proyecto de Bolcoin
4. Click en tu servicio de backend

---

## ⚙️ PASO 2: CONFIGURAR VARIABLES

### A. Abrir panel de variables

1. En Railway Dashboard
2. Click en tu servicio (backend)
3. Ir a **"Variables"** tab
4. Click en **"Raw Editor"** (más fácil para copiar/pegar)

### B. Variables MÍNIMAS REQUERIDAS

Verifica/agrega estas 4 variables:

```bash
# 1. Ya la tienes (verificar que existe)
BINGO_CONTRACT_ADDRESS=0x...

# 2. AGREGAR - Tu RPC de Alchemy/Infura
RPC_URL=https://polygon-amoy.g.alchemy.com/v2/TU_KEY

# 3. AGREGAR - Private key del operador
OPERATOR_PRIVATE_KEY=0x...

# 4. AGREGAR - Habilitar scheduler
ENABLE_BINGO_SCHEDULER=true
```

### C. Variables RECOMENDADAS (agregar también)

```bash
# RPC Fallback (por si el principal falla)
RPC_FALLBACK_1=https://rpc-amoy.polygon.technology

# CORS (si tienes frontend)
FRONTEND_URL=https://tu-frontend.pages.dev
ALLOWED_ORIGINS=https://tu-frontend.pages.dev

# Node environment
NODE_ENV=production
```

### D. Variables OPCIONALES (si quieres personalizar)

```bash
NUM_ROOMS=4
BUY_WINDOW_SECONDS=45
ROUND_INTERVAL_SECONDS=120
LOG_LEVEL=info
```

**💡 TIP:** Copia las variables desde `RAILWAY_VARIABLES.txt` y pega en Raw Editor.

---

## 🔑 PASO 3: VERIFICAR OPERATOR_PRIVATE_KEY

**⚠️ MUY IMPORTANTE:**

La `OPERATOR_PRIVATE_KEY` **DEBE** ser del mismo wallet que está configurado como `operator` en el contrato BingoGame.

### Cómo verificar:

```bash
# Opción A: Desde Hardhat Console
cd contracts
npx hardhat console --network amoy

const bingo = await ethers.getContractAt("BingoGame", "TU_BINGO_CONTRACT_ADDRESS");
const operator = await bingo.operator();
console.log("Operator:", operator);
```

```bash
# Opción B: Desde Polygonscan
1. Ir a: https://amoy.polygonscan.com/address/TU_BINGO_CONTRACT_ADDRESS
2. Contract → Read Contract
3. Buscar función "operator"
4. Ver address
```

**La OPERATOR_PRIVATE_KEY debe corresponder a ese address.**

---

## 🚀 PASO 4: DEPLOY

### Opción A: Redeploy automático

Si Railway tiene "Auto Deploy" habilitado:

1. Las variables se guardan automáticamente
2. Railway detecta cambios
3. Redeploy automático

**Espera 2-3 minutos**

### Opción B: Deploy manual

1. Railway Dashboard → Tu servicio
2. Click en **"Deploy"**
3. O botón **"Redeploy"**
4. Esperar 2-3 minutos

---

## 👀 PASO 5: VERIFICAR DEPLOYMENT

### A. Revisar Logs

1. Railway Dashboard → Tu servicio
2. Click en **"Logs"** tab
3. **Buscar estas líneas:**

```
✅ ÉXITO - Debes ver:
╔════════════════════════════════════════╗
║  🎰 BINGO SCHEDULER - PRODUCTION      ║
╚════════════════════════════════════════╝

✅ Configuración validada
   Contract: 0x...
   RPC: https://...
   Rooms: 4

[BingoScheduler] Starting...
[BingoScheduler] Connected at block 12345678
[BingoScheduler] Operator verified ✓

[Recovery] Scanning for orphan rounds...
[Recovery] No orphan rounds found ✓

[BingoScheduler] Starting scheduling loop...
[BingoScheduler] Room 1: Creating round...
[BingoScheduler] Room 1: Round X created ✓
```

```
❌ ERRORES - Si ves:

"Missing required env vars: ..."
→ Falta una variable, agrégala

"Operator mismatch! Contract: 0x..., Signer: 0x..."
→ OPERATOR_PRIVATE_KEY incorrecta

"execution reverted: MaxOpenRoundsReached"
→ Hay rounds huérfanas, ver PASO 6

"Connection timeout"
→ RPC_URL incorrecta o sin API key
```

### B. Test Health Endpoint

Abre tu navegador o usa curl:

```bash
# Cambiar TU-APP por tu URL de Railway
https://TU-APP.railway.app/health
```

**Debe retornar:**
```json
{
  "status": "ok",
  "uptime": 123,
  "services": {
    "api": "healthy",
    "scheduler": "healthy"
  }
}
```

### C. Test Bingo Status

```bash
https://TU-APP.railway.app/api/bingo/status
```

**Debe retornar:**
```json
{
  "status": "ok",
  "scheduler": {
    "running": true,
    "circuitBreaker": "closed",
    "stats": {
      "roundsCreated": 4,
      "roundsClosed": 2,
      ...
    }
  }
}
```

---

## 🆘 PASO 6: SI HAY ERRORES

### Error: "MaxOpenRoundsReached"

Hay rounds huérfanas en el contrato.

**Fix:**

```bash
# Desde tu computadora local
cd contracts

# Ver cuántas hay (dry run)
DRY_RUN=true npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Cancelarlas
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Esperar 1 minuto, Railway reiniciará automáticamente
```

### Error: "VRF request fails"

VRF no configurado correctamente.

**Diagnóstico:**

```bash
cd contracts
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Fix común:**
- Fondear subscription: https://vrf.chain.link
- Agregar BingoGame como consumer

### Error: "Connection timeout"

RPC no funciona.

**Test:**

```bash
cd backend
node scripts/test-rpc-connection.js
```

**Fix:**
- Verificar API key de Alchemy/Infura
- Agregar `RPC_FALLBACK_1` en Railway

### Error: "MODULE_NOT_FOUND"

Archivos no se subieron a Railway.

**Verificar:**
1. Railway → Files tab
2. Debe existir:
   - `index.js`
   - `src/services/bingoSchedulerOnChain.js`
   - `src/services/bingoEventService.js`
   - `src/chain/abi/BingoGame.json`

**Fix:**
- Hacer commit y push de todos los archivos
- Verificar que no estén en `.gitignore`

---

## 📊 PASO 7: MONITOREO (PRIMERAS 2 HORAS)

### Desde Railway Dashboard (cada 30 min):

1. **Logs** → Buscar errores
2. Verificar que se crean rounds cada 2 minutos
3. Ver "📊 Status Report" cada 5 min

### Desde tu computadora local:

```bash
cd backend

# Monitor en tiempo real cada 30s
HEALTH_URL=https://TU-APP.railway.app/health/detailed npm run monitor:fast
```

**Debe mostrar:**
```
[2026-02-19T10:00:00.000Z]
  Scheduler: healthy
    Running: ✅
    Circuit Breaker: 🟢 closed
    Failures: 0
    Stats:
      Rounds Created: 10
      Rounds Closed: 8
      Rounds Resolved: 7
      Orphans Recovered: 0
      Errors: 0
```

---

## ✅ PASO 8: VALIDACIÓN (48 HORAS)

### Cada 6 horas verificar:

1. **Health endpoint:**
   ```bash
   curl https://TU-APP.railway.app/health | jq .
   ```
   → Debe ser `"status": "ok"`

2. **Rounds creadas:**
   ```bash
   curl https://TU-APP.railway.app/api/bingo/status | jq '.scheduler.stats'
   ```
   → `roundsCreated` debe incrementar

3. **Orphan rounds:**
   ```bash
   cd contracts
   npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
   ```
   → Debe decir "No orphan rounds found"

### Simular restart (3 veces en 48h):

1. Railway → Redeploy
2. Esperar 2 min
3. Ver logs: buscar `[Recovery] Processing orphan round`
4. Verificar que recovery funciona

---

## 🎉 SUCCESS!

### ✅ Deployment exitoso si:

- [ ] Logs muestran "Scheduler corriendo..."
- [ ] `/health` retorna 200 OK
- [ ] `/api/bingo/status` muestra stats
- [ ] Rounds se crean cada 2 min
- [ ] 0 errores en 2 horas
- [ ] Recovery funciona después de restart

### 🎯 Próximos pasos:

1. **Monitorear 48 horas**
2. **Migrar OPERATOR_KEY a Secrets** (Railway Settings)
3. **Phase 2: Security Audit**
4. **Load testing**

---

## 🔒 SEGURIDAD POST-DEPLOYMENT

### ⚠️ IMPORTANTE - Migrar Private Key

**Después de validar que todo funciona (2-4 horas):**

1. Railway Dashboard → Settings → Secrets
2. Create secret: `OPERATOR_PRIVATE_KEY`
3. Copiar valor de la variable actual
4. Guardar secret
5. Eliminar variable `OPERATOR_PRIVATE_KEY` de Variables normales
6. Redeploy

---

## 📞 AYUDA

**Si algo falla:**

1. Revisar logs de Railway
2. Ejecutar scripts de diagnóstico:
   - `npm run test:rpc`
   - `contracts/scripts/diagnose-vrf-config.js`
   - `contracts/scripts/emergency-cancel-rounds.js`

3. Verificar variables en Railway

**Archivos útiles:**
- `RAILWAY_VARIABLES.txt` - Lista de variables
- `DEPLOYMENT_FINAL_CHECKLIST.md` - Checklist completo
- `backend/README.md` - Documentación

---

**Última actualización:** 2026-02-19
**Versión:** 1.0 - Guía Railway Deployment
