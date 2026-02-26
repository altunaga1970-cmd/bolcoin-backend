# 🎯 EMPIEZA AQUÍ - DEPLOYMENT EN 3 PASOS

**Tiempo total:** 15-20 minutos

---

## ✅ PASO 1: VERIFICACIÓN (5 min)

### A. Obtén tu BINGO_CONTRACT_ADDRESS

1. Ve a Railway Dashboard
2. Tu proyecto → Variables
3. Busca `BINGO_CONTRACT_ADDRESS`
4. **Copia ese valor** (0x...)

### B. Verifica el contrato

```bash
cd contracts

# Pega tu dirección aquí ↓
BINGO_CONTRACT_ADDRESS=0xTU_DIRECCION npx hardhat run scripts/pre-deployment-check.js --network amoy
```

### C. Resultado esperado:

```
✅ ALL CHECKS PASSED
Ready to deploy!
```

**Si hay errores:**
- ❌ Orphan rounds → `npx hardhat run scripts/emergency-cancel-rounds.js --network amoy`
- ❌ Operator mismatch → Necesitas la private key correcta

---

## ⚙️ PASO 2: CONFIGURAR RAILWAY (5 min)

1. Railway Dashboard → Tu proyecto → Variables
2. Click **"Raw Editor"**
3. **Pega esto** (cambia los valores `TU_...`):

```bash
# Ya la tienes
BINGO_CONTRACT_ADDRESS=0x...

# AGREGAR ESTAS 3:
RPC_URL=https://polygon-amoy.g.alchemy.com/v2/TU_ALCHEMY_KEY
OPERATOR_PRIVATE_KEY=0xTU_OPERATOR_PRIVATE_KEY
ENABLE_BINGO_SCHEDULER=true

# OPCIONAL (recomendado):
RPC_FALLBACK_1=https://rpc-amoy.polygon.technology
NODE_ENV=production
```

4. Click **"Save"**

### Dónde conseguir los valores:

- **RPC_URL:**
  - Alchemy: https://dashboard.alchemy.com → Create App → Polygon Amoy
  - Infura: https://infura.io → Create Key → Polygon Amoy

- **OPERATOR_PRIVATE_KEY:**
  - Es la private key del wallet que salió en el check del PASO 1
  - Debe ser el operator del contrato

---

## 🚀 PASO 3: DEPLOY Y VERIFICAR (5-10 min)

### A. Deploy

Railway hace redeploy automáticamente después de guardar variables.

**Espera 2-3 minutos**

### B. Ver Logs

Railway Dashboard → Logs

**Busca:**
```
✅ ÉXITO:
╔════════════════════════════════════════╗
║  🎰 BINGO SCHEDULER - PRODUCTION      ║
╚════════════════════════════════════════╝

✅ Configuración validada
[BingoScheduler] Operator verified ✓
[BingoScheduler] Room 1: Round X created ✓
```

```
❌ ERROR COMÚN:
"MaxOpenRoundsReached"
→ Vuelve al PASO 1B y cancela orphan rounds
```

### C. Test Health

Abre en navegador:
```
https://TU-APP.railway.app/health
```

Debe mostrar:
```json
{
  "status": "ok",
  "services": {
    "scheduler": "healthy"
  }
}
```

---

## 🎉 ¡LISTO!

Si llegaste aquí sin errores: **DEPLOYMENT EXITOSO** ✅

### Próximos pasos (opcional):

1. **Monitorear 2 horas**
   ```bash
   cd backend
   HEALTH_URL=https://TU-APP.railway.app/health/detailed npm run monitor:fast
   ```

2. **Migrar private key a Secrets** (después de 2-4h)
   - Railway → Settings → Secrets
   - Crear secret: `OPERATOR_PRIVATE_KEY`

3. **Validar 48 horas** para completar Phase 1

---

## 📚 ARCHIVOS DE AYUDA

Si algo falla, consulta:

1. **`VERIFICACION_RAPIDA.md`** - Troubleshooting detallado
2. **`GUIA_DEPLOYMENT_RAILWAY.md`** - Guía completa paso a paso
3. **`RAILWAY_VARIABLES.txt`** - Lista completa de variables
4. **`DEPLOYMENT_FINAL_CHECKLIST.md`** - Checklist completo

---

## 🆘 ERRORES COMUNES

### "Missing required env vars"
→ Falta una variable en Railway, agrégala

### "Operator mismatch"
→ OPERATOR_PRIVATE_KEY incorrecta, usa la del PASO 1

### "MaxOpenRoundsReached"
→ Hay orphan rounds:
```bash
cd contracts
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

### "Connection timeout"
→ RPC_URL incorrecta, verifica tu API key de Alchemy/Infura

### "MODULE_NOT_FOUND"
→ Archivos no se subieron, verifica git commit/push

---

## 📞 COMANDOS ÚTILES

```bash
# Verificar deployment
cd backend
npm run check:deployment

# Test RPC
npm run test:rpc

# Monitor producción
HEALTH_URL=https://tu-app.railway.app/health/detailed npm run monitor

# Cancelar orphan rounds
cd contracts
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Diagnosticar VRF
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

---

**¡Empieza con el PASO 1 ahora!** 🚀

Si tienes dudas, pregunta antes de continuar.
