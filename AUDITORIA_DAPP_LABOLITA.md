# AUDITORÍA COMPLETA - LA BOLITA DAPP

**Fecha de Auditoría**: 2026-01-30
**Versión**: 1.0
**Auditor**: Claude Code
**Estado**: Desarrollo Local (Hardhat)

---

## RESUMEN EJECUTIVO

La Bolita es una DApp de lotería descentralizada construida sobre Polygon con tres juegos principales: La Bolita (números tradicionales), La Fortuna (lotería tipo powerball) y Keno. El sistema utiliza un backend híbrido (Node.js + PostgreSQL) con smart contracts en Solidity.

### Calificación General

| Categoría | Estado | Puntuación |
|-----------|--------|------------|
| Smart Contracts | Funcional con observaciones | 7/10 |
| Backend API | Funcional | 8/10 |
| Frontend | Funcional con bugs menores | 7/10 |
| Seguridad | Requiere mejoras | 6/10 |
| Documentación | Parcial | 5/10 |

---

## 1. ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│                         React 19 + ethers.js                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   La Bolita │  │  La Fortuna │  │    Keno     │  │    Admin    │    │
│  │   (Apuestas)│  │  (Lotería)  │  │  (Instant)  │  │  (SIWE)     │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
│                      Node.js + Express + PostgreSQL                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Auth      │  │   Wallet    │  │   Draws     │  │   Payments  │    │
│  │   (JWT/SIWE)│  │   Service   │  │   Service   │  │ (NOWPayments)│   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   VRF       │  │   Risk      │  │   Keno      │  │   Scheduler │    │
│  │   Service   │  │   Service   │  │   Session   │  │   (Cron)    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BLOCKCHAIN                                     │
│                         Polygon (Hardhat Local)                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      LaBolita.sol                                │    │
│  │  - deposit() / withdraw()                                        │    │
│  │  - placeBet() / claimWinnings()                                  │    │
│  │  - buyLotteryTicket() / claimLotteryPrize()                     │    │
│  │  - settleKenoSession() [NUEVO]                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      MockUSDT (ERC20)                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. SMART CONTRACTS

### 2.1 Contratos Desplegados (Hardhat Local)

| Contrato | Dirección | Estado |
|----------|-----------|--------|
| LaBolita | 0x0B306BF915C4d645ff596e518fAf3F9669b97016 | ACTIVO |
| MockUSDT | 0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82 | ACTIVO |
| VRFCoordinatorMock | 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 | ACTIVO |

### 2.2 LaBolita.sol - Análisis

#### FUNCIONA CORRECTAMENTE:
- [x] `deposit()` - Depósitos de USDT al contrato
- [x] `withdraw()` - Retiros de balance
- [x] `placeBet()` - Colocación de apuestas (Fijo, Centena, Parle)
- [x] `buyLotteryTicket()` - Compra de boletos de lotería
- [x] `getUserBalance()` - Consulta de balance
- [x] `settleKenoSession()` - Liquidación de sesiones Keno [NUEVO]
- [x] `adminWithdraw()` - Retiros administrativos [NUEVO]
- [x] Pausable - Pausa de emergencia
- [x] ReentrancyGuard - Protección contra reentrancy

#### REQUIERE ATENCIÓN:
- [ ] `generateRandomResults()` - Usa `block.prevrandao` (predecible en ciertos escenarios)
- [ ] `claimWinnings()` - Funciona pero depende de resultados generados
- [ ] Multiplicadores muy altos (1000x Parle) sin cap de exposición

#### VULNERABILIDADES POTENCIALES:

```solidity
// RIESGO MEDIO: Aleatoriedad predecible
function generateRandomResults(...) internal {
    uint256 randomWord = uint256(keccak256(abi.encodePacked(
        block.prevrandao,  // <-- Mineros pueden influir
        block.timestamp,
        ...
    )));
}

// RECOMENDACIÓN: Usar Chainlink VRF (ya existe LaBolitaVRF.sol)
```

### 2.3 Variantes del Contrato

| Variante | Uso | Estado |
|----------|-----|--------|
| LaBolita.sol | Principal (desarrollo) | EN USO |
| LaBolitaVRF.sol | Con Chainlink VRF | DISPONIBLE |
| LaBolitaRiskManaged.sol | Con gestión de riesgo | DISPONIBLE |

**RECOMENDACIÓN**: Para producción, usar `LaBolitaRiskManaged.sol` con VRF integrado.

---

## 3. BACKEND API

### 3.1 Endpoints - Estado

#### AUTENTICACIÓN
| Endpoint | Método | Estado | Notas |
|----------|--------|--------|-------|
| /api/auth/register | POST | FUNCIONA | JWT |
| /api/auth/login | POST | FUNCIONA | JWT |
| /api/admin/auth/nonce | GET | FUNCIONA | SIWE |
| /api/admin/auth/verify | POST | FUNCIONA | SIWE |

#### WALLET
| Endpoint | Método | Estado | Notas |
|----------|--------|--------|-------|
| /api/wallet/balance | GET | FUNCIONA | Requiere x-wallet-address |
| /api/wallet/deposit | POST | FUNCIONA | Via NOWPayments |
| /api/wallet/withdraw | POST | FUNCIONA | - |

#### SORTEOS (DRAWS)
| Endpoint | Método | Estado | Notas |
|----------|--------|--------|-------|
| /api/draws | GET | FUNCIONA | Lista sorteos |
| /api/draws/:id | GET | FUNCIONA | Detalle sorteo |
| /api/draws/active | GET | FUNCIONA | Sorteos activos |

#### APUESTAS (BETS)
| Endpoint | Método | Estado | Notas |
|----------|--------|--------|-------|
| /api/bets | POST | FUNCIONA | Crear apuesta |
| /api/bets/history | GET | FUNCIONA | Historial |
| /api/bets/claim/:id | POST | FUNCIONA | Reclamar premio |

#### KENO [NUEVO]
| Endpoint | Método | Estado | Notas |
|----------|--------|--------|-------|
| /api/keno/config | GET | FUNCIONA | Config del juego |
| /api/keno/play | POST | FUNCIONA | Jugar partida |
| /api/keno/history | GET | FUNCIONA | Historial |
| /api/keno/session | GET | FUNCIONA | Info de sesión |
| /api/keno/session/start | POST | FUNCIONA | Iniciar sesión |
| /api/keno/session/settle | POST | FUNCIONA | Liquidar sesión |
| /api/keno/session/settle | GET | FUNCIONA | Liquidar via beacon |

#### ADMIN
| Endpoint | Método | Estado | Notas |
|----------|--------|--------|-------|
| /api/admin/dashboard | GET | FUNCIONA | Métricas |
| /api/admin/users | GET | FUNCIONA | Lista usuarios |
| /api/admin/draws | GET/POST | FUNCIONA | Gestión sorteos |
| /api/keno/admin/stats | GET | FUNCIONA | Stats Keno (auth requerida) |

### 3.2 Servicios - Estado

| Servicio | Estado | Descripción |
|----------|--------|-------------|
| walletService | FUNCIONA | Gestión de balances |
| drawService | FUNCIONA | Gestión de sorteos |
| betService | FUNCIONA | Gestión de apuestas |
| vrfService | SIMULADO | VRF en modo simulación |
| kenoService | FUNCIONA | Lógica de Keno |
| kenoSessionService | FUNCIONA | Sesiones de Keno |
| nowPaymentsService | CONFIGURADO | Requiere testing real |
| riskService | DISPONIBLE | No integrado activamente |

### 3.3 Scheduler (Cron Jobs)

| Job | Frecuencia | Estado | Descripción |
|-----|------------|--------|-------------|
| drawScheduler | Cada hora | FUNCIONA | Crea sorteos diarios |
| drawCloser | Cada minuto | FUNCIONA | Cierra apuestas |
| vrfRequester | Cada minuto | CON ERRORES | Errores de constraint |
| resultProcessor | Cada minuto | FUNCIONA | Procesa resultados |
| dataCleanup | Domingo 3AM | PROGRAMADO | Limpieza de datos |

#### ERROR CONOCIDO en vrfRequester:
```
Error: el nuevo registro para la relación «draws» viola la restricción
«check» «draws_status_check»
```
**Causa**: El status 'vrf_requested' no está en el CHECK constraint de la tabla.
**Impacto**: Los sorteos se quedan en estado 'closed' sin procesar VRF.
**Solución**: Actualizar constraint o agregar 'vrf_requested' como status válido.

---

## 4. FRONTEND

### 4.1 Páginas - Estado

#### PÚBLICAS
| Página | Ruta | Estado |
|--------|------|--------|
| Home | / | FUNCIONA |
| Login | /login | FUNCIONA |
| Register | /register | FUNCIONA |
| Resultados | /results | FUNCIONA |
| FAQ | /faq | FUNCIONA |
| Estadísticas | /statistics | FUNCIONA |

#### USUARIO (Requiere Auth)
| Página | Ruta | Estado |
|--------|------|--------|
| La Bolita | /bet | FUNCIONA |
| La Fortuna | /lottery | FUNCIONA |
| Keno | /keno | FUNCIONA |
| Wallet | /wallet | FUNCIONA |
| Historial | /history | FUNCIONA |
| Claims | /claims | FUNCIONA |
| Referidos | /referrals | PARCIAL |

#### ADMIN (Requiere SIWE)
| Página | Ruta | Estado |
|--------|------|--------|
| Admin Login | /admin/login | FUNCIONA |
| Dashboard | /admin/dashboard | FUNCIONA |
| Bankroll | /admin/bankroll | FUNCIONA |
| Manage Draws | /admin/manage-draws | FUNCIONA |
| Audit Logs | /admin/audit-logs | FUNCIONA |

### 4.2 Contextos

| Contexto | Estado | Descripción |
|----------|--------|-------------|
| AuthContext | FUNCIONA | Auth JWT tradicional |
| AdminAuthContext | FUNCIONA | Auth SIWE para admin |
| Web3Context | FUNCIONA | Conexión MetaMask |
| BalanceContext | ACTUALIZADO | Ahora con effectiveBalance |
| DrawContext | FUNCIONA | Estado de sorteos |
| ToastContext | FUNCIONA | Notificaciones |

### 4.3 Bugs Conocidos

1. **Balance dual resuelto**: El navbar ahora muestra effectiveBalance
2. **Quick Pick duplicado resuelto**: Solo aparece en barra de acciones
3. **Geo-blocking**: Solo client-side (fácil de burlar)

---

## 5. BASE DE DATOS

### 5.1 Tablas Principales

| Tabla | Registros Est. | Estado |
|-------|----------------|--------|
| users | Variable | FUNCIONA |
| draws | ~100+ | FUNCIONA |
| bets | Variable | FUNCIONA |
| payments | Variable | FUNCIONA |
| withdrawals | Variable | FUNCIONA |
| audit_logs | Variable | FUNCIONA |
| keno_sessions | Variable | NUEVA |
| keno_results | Variable | FUNCIONA |

### 5.2 Migraciones

| Migración | Estado | Fecha |
|-----------|--------|-------|
| Initial schema | APLICADA | - |
| add-payments-tables | APLICADA | - |
| add-vrf-columns | APLICADA | - |
| add-keno-tables | APLICADA | - |
| add-keno-sessions | APLICADA | 2026-01-30 |

### 5.3 Constraint Issue

```sql
-- PROBLEMA: draws_status_check no incluye 'vrf_requested'
-- El scheduler intenta cambiar status a 'vrf_requested' pero falla

-- SOLUCIÓN:
ALTER TABLE draws DROP CONSTRAINT draws_status_check;
ALTER TABLE draws ADD CONSTRAINT draws_status_check
CHECK (status IN ('scheduled', 'open', 'closed', 'vrf_requested',
                  'vrf_fulfilled', 'completed', 'cancelled'));
```

---

## 6. SEGURIDAD

### 6.1 Análisis de Vulnerabilidades

| Vulnerabilidad | Severidad | Estado | Descripción |
|----------------|-----------|--------|-------------|
| Credenciales en .env | ALTA | PENDIENTE | API keys expuestas |
| Aleatoriedad predecible | MEDIA | PENDIENTE | block.prevrandao en producción |
| Geo-blocking client-side | MEDIA | PENDIENTE | Fácil de burlar |
| Sin rate limiting | BAJA | PENDIENTE | Posible DoS |
| XSS/CSRF | BAJA | MITIGADO | Helmet + CORS configurados |

### 6.2 Credenciales Expuestas

```env
# ESTAS CREDENCIALES DEBEN ROTARSE ANTES DE PRODUCCIÓN:

# NOWPayments (backend/.env)
NOWPAYMENTS_API_KEY=QPH8WDY-EEZM755-HAVP49J-6BS4XAE
NOWPAYMENTS_IPN_SECRET=GnpnYxn4as4EmNQwOiY4L6WxeQx8GYid
NOWPAYMENTS_PUBLIC_KEY=b71546af-5041-4fa3-bda6-c8474cf8a0b3

# Database (backend/.env)
DATABASE_URL=postgresql://postgres:Erik2018@localhost:5432/labolita

# JWT (backend/.env)
JWT_SECRET=dev-secret-key-change-in-production-123456789

# Private Key (contracts/.env)
PRIVATE_KEY=803e7d97363196fe2353db9f66fa89dba03746be9da9d7a605697359905af44f
```

### 6.3 Recomendaciones de Seguridad

1. **CRÍTICO**: Rotar todas las credenciales
2. **CRÍTICO**: Usar variables de entorno en servidor, no en repo
3. **ALTO**: Implementar Chainlink VRF para producción
4. **ALTO**: Agregar geo-blocking server-side
5. **MEDIO**: Implementar rate limiting
6. **MEDIO**: Agregar 2FA para admin
7. **BAJO**: Auditoría de smart contracts por terceros

---

## 7. FUNCIONALIDADES POR JUEGO

### 7.1 La Bolita

| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Selección de números | FUNCIONA | 2-4 dígitos según tipo |
| Tipos de apuesta (Fijo/Centena/Parle) | FUNCIONA | Multiplicadores correctos |
| Colocación de apuesta | FUNCIONA | Valida balance y límites |
| Historial de apuestas | FUNCIONA | - |
| Reclamación de premios | FUNCIONA | - |
| Sorteos automáticos | FUNCIONA | 3 diarios |
| Resultados VRF | SIMULADO | En desarrollo usa simulación |

### 7.2 La Fortuna (Lotería)

| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Compra de boletos | FUNCIONA | 5 números + clave |
| Jackpot acumulativo | FUNCIONA | - |
| Categorías de premios | FUNCIONA | 6 categorías |
| Sorteos programados | FUNCIONA | Miércoles y Sábado |
| Reclamación de premios | FUNCIONA | - |

### 7.3 Keno

| Funcionalidad | Estado | Notas |
|---------------|--------|-------|
| Selección de números (1-10) | FUNCIONA | Grid 1-80 |
| Tabla de pagos dinámica | FUNCIONA | Según cantidad seleccionada |
| Sistema de sesiones | FUNCIONA | [NUEVO] |
| Balance efectivo | FUNCIONA | [NUEVO] |
| Liquidación al salir | FUNCIONA | [NUEVO] |
| Historial de partidas | FUNCIONA | - |
| Quick Pick | FUNCIONA | Aleatorio 5 o 10 |

---

## 8. INTEGRACIONES

### 8.1 MetaMask / Web3

| Funcionalidad | Estado |
|---------------|--------|
| Conexión de wallet | FUNCIONA |
| Firma de transacciones | FUNCIONA |
| Cambio de red | FUNCIONA |
| SIWE para admin | FUNCIONA |

### 8.2 Chainlink VRF

| Funcionalidad | Estado |
|---------------|--------|
| Mock local | FUNCIONA |
| Integración real | NO CONFIGURADO |

### 8.3 NOWPayments

| Funcionalidad | Estado |
|---------------|--------|
| Crear pago | CONFIGURADO |
| Webhook IPN | CONFIGURADO |
| Verificación | PENDIENTE TESTING |

---

## 9. TESTING

### 9.1 Tests Disponibles

| Área | Cobertura | Estado |
|------|-----------|--------|
| Smart Contracts | ~60% | PARCIAL |
| Backend API | ~40% | PARCIAL |
| Frontend | ~20% | MÍNIMO |
| E2E | 0% | NO EXISTE |

### 9.2 Comandos de Test

```bash
# Contracts
cd contracts && npx hardhat test

# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

---

## 10. DEPLOYMENT

### 10.1 Estado Actual

| Ambiente | Estado | URL |
|----------|--------|-----|
| Local (Hardhat) | ACTIVO | localhost |
| Testnet (Amoy) | NO DESPLEGADO | - |
| Mainnet (Polygon) | NO DESPLEGADO | - |

### 10.2 Checklist Pre-Producción

- [ ] Rotar todas las credenciales
- [ ] Configurar Chainlink VRF real
- [ ] Desplegar en testnet (Amoy)
- [ ] Auditoría de smart contracts
- [ ] Penetration testing
- [ ] Configurar geo-blocking server-side
- [ ] Configurar CDN/WAF
- [ ] Configurar backups de BD
- [ ] Configurar monitoring/alertas
- [ ] Documentación de usuario final

---

## 11. LOGS DE ERRORES ACTUALES

### Backend (últimas 24h)

```
ERROR: el nuevo registro para la relación «draws» viola la restricción
«check» «draws_status_check»
- Frecuencia: Cada minuto
- Impacto: VRF no se procesa correctamente
- Causa: Constraint de status no incluye 'vrf_requested'

WARN: [BalanceContext] Error loading effective balance
- Frecuencia: Ocasional
- Impacto: Bajo (fallback a onChainBalance)
- Causa: Sesión de Keno no iniciada
```

### Frontend (consola)

```
No hay errores críticos en consola.
Warnings menores de React relacionados con keys.
```

---

## 12. MÉTRICAS DE CÓDIGO

| Métrica | Valor |
|---------|-------|
| Líneas de código (Backend) | ~15,000 |
| Líneas de código (Frontend) | ~12,000 |
| Líneas de código (Contracts) | ~4,000 |
| Archivos JavaScript | ~150 |
| Archivos JSX | ~80 |
| Archivos Solidity | 5 |
| Dependencias (Backend) | 45 |
| Dependencias (Frontend) | 35 |

---

## 13. CONCLUSIONES

### Lo que FUNCIONA BIEN:
1. Sistema de apuestas La Bolita completo
2. Sistema de lotería La Fortuna completo
3. Juego Keno con sistema de sesiones
4. Autenticación dual (JWT + SIWE)
5. Panel de administración funcional
6. Balance efectivo unificado en navbar
7. Scheduler de sorteos automáticos
8. Sistema de auditoría completo

### Lo que NECESITA MEJORAS:
1. Aleatoriedad (usar VRF real en producción)
2. Geo-blocking (implementar server-side)
3. Seguridad de credenciales (rotar antes de producción)
4. Constraint de BD (agregar 'vrf_requested')
5. Testing (aumentar cobertura)
6. Documentación (completar)

### Lo que NO FUNCIONA:
1. VRF real (solo simulación)
2. Pagos NOWPayments (no testeado en producción)
3. Despliegue en testnets

### RIESGO GENERAL: MEDIO
El sistema es funcional para desarrollo pero requiere trabajo significativo antes de producción.

---

## 14. PRÓXIMOS PASOS RECOMENDADOS

### Inmediato (antes de testnet):
1. Corregir constraint de draws_status_check
2. Rotar credenciales expuestas
3. Implementar geo-blocking server-side

### Corto plazo (antes de mainnet):
1. Configurar Chainlink VRF real
2. Auditoría de smart contracts
3. Penetration testing
4. Aumentar cobertura de tests

### Mediano plazo:
1. Sistema de referidos completo
2. App móvil
3. Soporte multi-idioma
4. Dashboard de analytics

---

*Auditoría realizada por Claude Code - 2026-01-30*
*Este documento es una evaluación técnica y no constituye asesoría legal o financiera.*
