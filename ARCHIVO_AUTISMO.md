# ARCHIVO AUTISMO - Resumen Completo del Sistema Keno con Sesiones

**Fecha**: 2026-01-30
**Proyecto**: La Bolita - Sistema de Loteria Descentralizado

---

## PROBLEMA ORIGINAL

El usuario notó que había **dos balances diferentes** en la página de Keno:
1. **Balance del navbar** (parte superior derecha) - Mostraba el balance del contrato
2. **Balance dentro de Keno** - Mostraba el balance de la base de datos

Cuando el usuario jugaba Keno, solo se descontaba del balance interno de Keno, pero el balance del navbar no cambiaba. Esto causaba confusión.

### Solicitud del Usuario
> "prefiero que externamente solo se vea el saldo total del contrato, la parte de arriba, derecha, y que se valla descontando de ese saldo aunque internamente se realice otra cosa, y para que no valla, cada vez que apueste el usuario llamar el contrato podria llamarse al usuario cerrar o salir de la pagina summar lo juagado y hacer el offchain con el total"

---

## SOLUCIÓN IMPLEMENTADA: Sistema de Sesiones

### Concepto
- **Balance Efectivo** = Balance del Contrato + Resultado Neto de la Sesión
- Las partidas se procesan instantáneamente en el backend (sin llamar al contrato)
- Al salir de la página, se liquida la sesión con el contrato en UNA sola transacción

### Ventajas
1. UI más rápida (no espera blockchain por cada apuesta)
2. Menos transacciones en el contrato (ahorro de gas)
3. Balance unificado en toda la aplicación
4. El usuario ve su balance "real" decrementando mientras juega

---

## ARCHIVOS MODIFICADOS/CREADOS

### 1. Smart Contract
**Archivo**: `contracts/LaBolita.sol`

```solidity
// Nueva función para liquidar sesiones de Keno
function settleKenoSession(
    address _user,
    uint256 _netAmount,
    bool _isProfit
) external onlyOwner {
    require(_user != address(0), "Invalid user address");
    if (_isProfit) {
        // Usuario ganó - agregar al balance
        userBalances[_user] += _netAmount;
        emit Deposited(_user, _netAmount);
    } else {
        // Usuario perdió - restar del balance
        require(userBalances[_user] >= _netAmount, "Insufficient user balance");
        userBalances[_user] -= _netAmount;
        emit Withdrawn(_user, _netAmount);
    }
}

// Función auxiliar para retiros admin
function adminWithdraw(address _user, uint256 _amount) external onlyOwner {
    require(_amount > 0, "Amount must be > 0");
    require(_user != address(0), "Invalid user address");
    require(userBalances[_user] >= _amount, "Insufficient user balance");
    userBalances[_user] -= _amount;
    emit Withdrawn(_user, _amount);
}
```

### 2. Migración de Base de Datos
**Archivo**: `backend/src/db/migrations/add-keno-sessions.js`

```sql
CREATE TABLE IF NOT EXISTS keno_sessions (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    session_start TIMESTAMP DEFAULT NOW(),
    session_end TIMESTAMP,
    total_wagered DECIMAL(14,6) DEFAULT 0,
    total_won DECIMAL(14,6) DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',  -- 'active', 'settled', 'expired'
    settled_at TIMESTAMP,
    settlement_tx VARCHAR(66),
    settlement_amount DECIMAL(14,6),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índice único para sesiones activas (solo una por wallet)
CREATE UNIQUE INDEX idx_keno_sessions_active
ON keno_sessions(wallet_address)
WHERE status = 'active';
```

### 3. Servicio de Sesiones
**Archivo**: `backend/src/services/kenoSessionService.js`

```javascript
// Funciones principales:

// Obtener o crear sesión activa
async function getOrCreateSession(walletAddress)

// Obtener sesión activa
async function getActiveSession(walletAddress)

// Actualizar sesión después de una partida
async function updateSessionAfterGame(walletAddress, betAmount, winAmount)

// Obtener balance efectivo (contrato + sesión)
async function getEffectiveBalance(walletAddress)
// Retorna: { contractBalance, sessionNetResult, effectiveBalance }

// Liquidar sesión con el contrato
async function settleSession(walletAddress)
// Llama a settleKenoSession() en el contrato con el netResult

// Liquidar sesiones pendientes antiguas
async function settlePendingSessions(walletAddress)
```

### 4. Rutas de Keno
**Archivo**: `backend/src/routes/keno.js`

```javascript
// Nuevos endpoints de sesión:

GET /api/keno/session
// Obtiene info de sesión activa y balance efectivo

POST /api/keno/session/start
// Inicia o reanuda una sesión

POST /api/keno/session/settle
// Liquida sesión (autenticado con header)

GET /api/keno/session/settle?wallet=0x...
// Liquida sesión via sendBeacon (para cuando cierra pestaña)
```

### 5. API Frontend
**Archivo**: `frontend/src/api/kenoApi.js`

```javascript
// Nuevas funciones:

export async function getSession() {
  const response = await api.get('/keno/session');
  return response.data.data;
}

export async function startSession() {
  const response = await api.post('/keno/session/start');
  return response.data.data;
}

export async function settleSession() {
  const response = await api.post('/keno/session/settle');
  return response.data.data;
}
```

### 6. Contexto de Balance
**Archivo**: `frontend/src/contexts/BalanceContext.jsx`

```javascript
// Cambios principales:

// Nuevo estado
const [effectiveBalance, setEffectiveBalance] = useState('0');
const [sessionNetResult, setSessionNetResult] = useState(0);

// Nueva función para cargar balance efectivo
const loadEffectiveBalance = useCallback(async () => {
  const session = await kenoApi.getSession();
  setEffectiveBalance(session.balances?.effectiveBalance || 0);
  setSessionNetResult(session.balances?.sessionNetResult || 0);
}, [isConnected]);

// formattedContractBalance ahora usa effectiveBalance
formattedContractBalance: `$${parseFloat(effectiveBalance).toFixed(2)}`,
```

### 7. Página de Keno
**Archivo**: `frontend/src/pages/user/KenoPage.jsx`

```javascript
// Ciclo de vida de sesión:

// 1. Iniciar sesión al entrar
useEffect(() => {
  if (isConnected) {
    kenoApi.startSession()
      .then(() => loadSession());
  }
}, [isConnected]);

// 2. Recargar sesión después de cada juego
useEffect(() => {
  if (currentResult) {
    loadSession();
  }
}, [currentResult]);

// 3. Liquidar al salir
useEffect(() => {
  const handleBeforeUnload = (e) => {
    if (sessionData?.hasActiveSession && sessionData?.session?.gamesPlayed > 0) {
      // sendBeacon para cuando cierra pestaña
      const settleUrl = `${apiUrl}/keno/session/settle?wallet=${account}`;
      navigator.sendBeacon?.(settleUrl);
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    // Liquidar al desmontar (navegación interna)
    settleSession();
  };
}, [sessionData, account]);
```

### 8. Hook useKenoGame
**Archivo**: `frontend/src/hooks/useKenoGame.js`

```javascript
// Ahora usa effectiveBalance desde la sesión
const [effectiveBalance, setEffectiveBalance] = useState(0);

const loadEffectiveBalance = useCallback(async () => {
  const session = await kenoApi.getSession();
  setEffectiveBalance(session.balances?.effectiveBalance || 0);
}, [isConnected]);

// Validación de balance usa effectiveBalance
if (bet > userBalance) {  // userBalance = effectiveBalance
  showError('Balance insuficiente');
  return;
}
```

---

## FLUJO DE FUNCIONAMIENTO

```
┌─────────────────────────────────────────────────────────────────┐
│                    USUARIO ENTRA A KENO                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. POST /api/keno/session/start                                │
│     - Liquida sesiones antiguas si hay                          │
│     - Crea nueva sesión o recupera existente                    │
│     - Retorna balance efectivo                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. USUARIO JUEGA (POST /api/keno/play)                         │
│     - Backend procesa instantáneamente                          │
│     - Actualiza keno_sessions (total_wagered, total_won)        │
│     - NO llama al contrato                                      │
│     - UI muestra balance efectivo actualizado                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. NAVBAR MUESTRA BALANCE EFECTIVO                             │
│     effectiveBalance = contractBalance + sessionNetResult       │
│     (Si perdió $5, navbar baja $5 aunque contrato no cambió)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. USUARIO SALE DE LA PÁGINA                                   │
│     - beforeunload: sendBeacon para liquidar                    │
│     - O cleanup del useEffect llama settleSession()             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. LIQUIDACIÓN CON CONTRATO                                    │
│     - Calcula netResult = totalWon - totalWagered               │
│     - Si netResult > 0: Usuario ganó, agregar al balance        │
│     - Si netResult < 0: Usuario perdió, restar del balance      │
│     - UNA sola transacción blockchain                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## DIRECCIONES DE CONTRATO (Hardhat Local)

```env
# backend/.env y frontend/.env
CONTRACT_ADDRESS=0x0B306BF915C4d645ff596e518fAf3F9669b97016
TOKEN_ADDRESS=0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82
```

---

## COMANDOS ÚTILES

```bash
# Ejecutar migración de sesiones
cd backend && node src/db/migrations/add-keno-sessions.js

# Recompilar contrato
cd contracts && npx hardhat compile

# Redesplegar contratos
cd contracts && npx hardhat run scripts/deploy.js --network localhost

# Iniciar nodo local
cd contracts && npx hardhat node

# Iniciar backend
cd backend && npm start

# Iniciar frontend
cd frontend && npm start
```

---

## PRUEBAS DE ENDPOINTS

```bash
# Obtener sesión
curl -s http://localhost:5000/api/keno/session \
  -H "x-wallet-address: 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

# Iniciar sesión
curl -s -X POST http://localhost:5000/api/keno/session/start \
  -H "x-wallet-address: 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"

# Liquidar sesión (beacon)
curl -s "http://localhost:5000/api/keno/session/settle?wallet=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
```

---

## NOTAS IMPORTANTES

1. **Sesión única por wallet**: Solo puede haber una sesión activa por wallet (índice único en DB)

2. **Liquidación automática**: Si el usuario vuelve a entrar con sesiones antiguas, se liquidan automáticamente

3. **sendBeacon fallback**: Si el navegador no soporta sendBeacon o falla, la liquidación ocurre en el próximo login

4. **Balance efectivo global**: El navbar ahora muestra el balance efectivo en TODA la aplicación, no solo en Keno

5. **Seguridad**: El endpoint GET de settle acepta wallet como query param solo para sendBeacon. El POST sigue requiriendo autenticación.

---

## MEJORAS ANTERIORES A KENO (misma sesión)

1. **Eliminada duplicidad de Quick Pick**: Solo aparece en la barra de acciones del grid
2. **Documentado DEFAULT_PAYOUT_TABLE**: Comentario indicando que es fallback del backend
3. **Eliminado código muerto**: `initContract()`, imports de ethers no usados
4. **Agregada autenticación a /admin/stats**: Ahora requiere `authenticate, requireAdmin`
5. **Simplificado getTotalBalance**: Usa el servicio de sesiones

---

*Este archivo sirve como referencia completa del sistema de sesiones de Keno implementado.*
