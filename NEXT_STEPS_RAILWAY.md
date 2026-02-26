# 🎯 PRÓXIMOS PASOS - RAILWAY DEPLOYMENT

**Status:** ✅ Código listo, pendiente deployment
**Tu situación:** Tienes `BINGO_CONTRACT_ADDRESS` en Railway

---

## ✅ LO QUE YA TIENES

1. ✅ `BINGO_CONTRACT_ADDRESS` configurado en Railway
2. ✅ Scheduler de Bingo creado (`backend/bingo-scheduler.js`)
3. ✅ Event service resiliente (`backend/src/services/bingoEventService.js`)
4. ✅ Scripts de emergencia listos (`contracts/scripts/`)
5. ✅ ABI de BingoGame exportado (`backend/src/chain/abi/BingoGame.json`)

---

## 🔧 CAMBIOS QUE DEBES HACER

### 1. ⚠️ CRÍTICO: Agregar variables de entorno en Railway

Ve a Railway Dashboard → Variables y agrega:

```bash
# Ya tienes:
BINGO_CONTRACT_ADDRESS=<ya_configurado>

# DEBES AGREGAR:
RPC_URL=<tu_alchemy_polygon_amoy_url>
OPERATOR_PRIVATE_KEY=<private_key_del_operador>

# RECOMENDADO AGREGAR (fallbacks):
RPC_FALLBACK_1=https://polygon-amoy.infura.io/v3/TU_KEY
RPC_FALLBACK_2=https://rpc-amoy.polygon.technology
```

### 2. 🔒 MIGRAR OPERATOR_PRIVATE_KEY A SECRETS

**IMPORTANTE:** No pongas la private key en variables normales!

**Opción A: Railway Secrets (si está disponible)**
- Railway Dashboard → Settings → Secrets
- Create secret: `OPERATOR_PRIVATE_KEY`
- Valor: tu private key

**Opción B: Variable encriptada (temporal)**
- Mientras migramos a Secrets en Phase 2
- Usar variable normal PERO cambiar la key después de deployment

### 3. 📝 Actualizar package.json del backend

Agregar script para correr el scheduler:

```json
{
  "scripts": {
    "start": "node index.js",
    "bingo:scheduler": "node bingo-scheduler.js"
  }
}
```

### 4. 🚀 ELEGIR OPCIÓN DE DEPLOYMENT

**Opción A: Servicio separado (RECOMENDADO)**

Crear un nuevo servicio en Railway:
- Mismo repo que tu backend
- Start Command: `node bingo-scheduler.js`
- Variables: copiar las mismas del backend principal
- Deploy

**Ventajas:**
- Scheduler independiente
- Reinicio sin afectar API
- Monitoreo separado

**Opción B: Mismo servicio del backend**

Modificar tu `index.js` o archivo principal:

```javascript
// Al final del archivo, después de app.listen()
if (process.env.ENABLE_BINGO_SCHEDULER === 'true') {
  require('./bingo-scheduler');
}
```

Luego en Railway agregar:
```
ENABLE_BINGO_SCHEDULER=true
```

**Ventajas:**
- Un solo servicio (más económico)

**Desventajas:**
- Si API crashea, scheduler también

---

## 🎬 ORDEN DE EJECUCIÓN

### ANTES de deployar en Railway:

#### 1. Verificar estado del contrato (local)

```bash
cd contracts

# Ver si hay rounds huérfanas
DRY_RUN=true npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Si hay rounds huérfanas, cancelarlas:
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

#### 2. Verificar VRF (local)

```bash
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Debe mostrar:**
- ✅ Subscription tiene fondos
- ✅ BingoGame es consumer
- ✅ Gas estimation exitosa

**Si falla algo:**
- Ir a https://vrf.chain.link
- Fondear subscription (5+ LINK o 50+ MATIC)
- Agregar `BINGO_CONTRACT_ADDRESS` como consumer

#### 3. Configurar variables en Railway

Agregar todas las variables mencionadas arriba.

#### 4. Deploy

**Si elegiste Opción A (servicio separado):**
- Crear nuevo servicio
- Configurar start command: `node bingo-scheduler.js`
- Deploy

**Si elegiste Opción B (mismo servicio):**
- Agregar código al index.js
- Agregar `ENABLE_BINGO_SCHEDULER=true`
- Redeploy

### DESPUÉS del deploy:

#### 5. Monitorear logs (primeras 2 horas)

Buscar en Railway logs:

**✅ Señales de éxito:**
```
✅ Configuración validada
[BingoScheduler] Operator verified ✓
[Recovery] No orphan rounds found ✓
[BingoScheduler] Room 1: Round X created ✓
```

**❌ Errores a buscar:**
```
MaxOpenRoundsReached  → Correr emergency-cancel-rounds.js
VRF request fails     → Verificar VRF config
Connection timeout    → Verificar RPC_URL
Operator mismatch     → Verificar OPERATOR_PRIVATE_KEY
```

#### 6. Validar 48 horas

- [ ] Scheduler corre 48h sin errores
- [ ] Simular 3 restarts
- [ ] Verificar orphan recovery funciona
- [ ] VRF fulfillment 100% exitoso

---

## 💡 SUGERENCIAS ADICIONALES

### 1. Crear `.env.local` para testing

Copia `.env.bingo.example` a `.env` local para testing:

```bash
cd backend
cp .env.bingo.example .env.local

# Editar y llenar con tus valores
# NUNCA commitear .env.local a git!
```

### 2. Verificar que .gitignore incluye:

```
backend/.env
backend/.env.local
backend/.env.*.local
```

### 3. Configurar Healthcheck en Railway (opcional)

Si Railway lo soporta:
- Path: `/health` o crear endpoint de status
- Interval: 60 seconds
- Timeout: 10 seconds

### 4. Agregar endpoint de status (recomendado)

Si tienes un backend API, agrega:

```javascript
// backend/routes/bingo.js o similar
app.get('/api/bingo/scheduler/status', (req, res) => {
  // Leer status del scheduler si está disponible
  res.json({
    status: 'running',
    uptime: process.uptime(),
    // ... más info
  });
});
```

### 5. Logs estructurados (futuro - Phase 3)

Considerar migrar a logs estructurados:
- Winston o Pino
- JSON format
- Niveles: error, warn, info, debug

### 6. Metrics endpoint (futuro - Phase 3)

Para Grafana:
```javascript
app.get('/metrics', (req, res) => {
  res.send(`
    bingo_rounds_created ${stats.roundsCreated}
    bingo_rounds_closed ${stats.roundsClosed}
    bingo_errors ${stats.errors}
  `);
});
```

---

## ⚠️ ADVERTENCIAS IMPORTANTES

### 1. NUNCA commitear la OPERATOR_PRIVATE_KEY

**Verificar ahora:**
```bash
# Buscar si la key está en el historial de git
git log --all --full-history --source -- backend/.env

# Si aparece, ROTAR LA KEY inmediatamente!
```

### 2. RPC Rate Limits

Alchemy/Infura tienen rate limits:
- Alchemy Free: 300 requests/second
- Infura Free: 100,000 requests/day

**Con 4 salas + event listener:**
- ~50-100 requests/min en normal operation
- Picos de ~200 req/min durante VRF

**Si excedes límites:**
- Configurar múltiples RPCs y rotar
- Upgrade a plan paid

### 3. VRF Costs

Cada VRF request cuesta:
- Testnet (Amoy): ~0.5 LINK
- Mainnet (Polygon): ~2-5 LINK

**Con 4 salas @ 2 min/round:**
- ~120 rounds/hour
- ~2,880 rounds/día
- ~1,440 LINK/día en mainnet ⚠️

**Ajustar para producción:**
- Menos salas (2 rooms)
- Mayor intervalo (5 min)
- O usar off-chain randomness (como Keno)

### 4. Database Connections

El scheduler crea conexiones a la blockchain:
- 1 provider principal
- 1-3 fallback providers
- Event listeners

**No exceder límites del RPC provider**

---

## 📋 CHECKLIST FINAL

Antes de deployar, verificar:

- [ ] Variables de entorno configuradas en Railway
- [ ] OPERATOR_PRIVATE_KEY en Secrets (o plan para migrar)
- [ ] RPC_URL válido y con API key
- [ ] Fallback RPCs configurados (opcional)
- [ ] Rounds huérfanas canceladas (si hay)
- [ ] VRF subscription fondeada y configurada
- [ ] BingoGame agregado como VRF consumer
- [ ] .gitignore incluye .env files
- [ ] package.json tiene script `bingo:scheduler`
- [ ] Decidido: servicio separado vs mismo servicio
- [ ] Plan de monitoreo para 48h

---

## 🆘 SI ALGO FALLA

**Error al compilar ABI:**
```bash
cd contracts
npx hardhat clean
npx hardhat compile
node -e "require('./artifacts-v2/contracts/BingoGame.sol/BingoGame.json')"
```

**Scheduler no encuentra módulos:**
```bash
cd backend
npm install
# Verificar que existe:
ls src/services/bingoSchedulerOnChain.js
ls src/chain/abi/BingoGame.json
```

**RPC connection fails:**
- Verificar API key es válida
- Test con: `curl -X POST <RPC_URL> -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`

---

## 📞 SOPORTE

**Documentación creada:**
1. `BINGO_DEPLOYMENT_GUIDE.md` - Guía paso a paso completa
2. `PHASE_1_EMERGENCY_GUIDE.md` - Herramientas de emergencia
3. Este archivo - Next steps específicos

**Si necesitas ayuda:**
1. Revisar logs en Railway
2. Buscar error específico en guías
3. Verificar variables de entorno
4. Probar scripts de diagnóstico local

---

**Última actualización:** 2026-02-19
**¿Listo para deployar?** Sigue `BINGO_DEPLOYMENT_GUIDE.md` paso a paso
