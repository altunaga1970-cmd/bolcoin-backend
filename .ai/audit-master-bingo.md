# Auditoría Maestra — Bingo Game (Bolcoin)
**Fecha:** 2026-02-18
**Sesiones cubiertas:** 2 sesiones de desarrollo
**Estado del proyecto:** MVP funcional con sorteo multiplayer sincronizado

---

## Lo que se ha implementado

### Sesión 1 — Arquitectura base del Bingo
- Sistema de 4 salas paralelas con ciclos escalonados (scheduler)
- Compra de cartones off-chain con deducción de balance en DB
- Generación de números VRF (crypto.randomBytes + LCG shuffle)
- Detección de ganadores: línea (primera fila completa) y bingo (todos los números)
- Co-ganadores: si dos cartones completan línea/bingo en el mismo ball, se divide el premio
- Rutas protegidas: compra requiere `authenticateWallet` + `requireFlag('game_bingo')`

### Sesión 2 — Sorteo Sincronizado Multiplayer
**Problema resuelto:** Antes, el sorteo era independiente en cada cliente. Ahora todos los clientes ven la misma bola al mismo tiempo.

**Solución implementada:**
1. Nueva columna `draw_started_at TIMESTAMP` en `bingo_rounds`
2. Estado `drawing` entre `closed` y `resolved`
3. Función pura `calcSyncState(elapsedMs, lineBall, bingoBall, total)` en frontend
4. Cliente calcula `ballIndex = floor((now - draw_started_at) / 4500)`
5. Si llega tarde: "catch up" instantáneo hasta la bola actual
6. Scheduler espera la duración exacta del sorteo antes de finalizarlo

**Correcciones adicionales:**
- Fix del timing de `bingo_pause` (antes se quedaba infinito, ahora tiene window de tiempo)
- Auto-retorno al lobby después de 3 segundos en estado RESOLVED
- Balance actualiza inmediatamente al ganar (via `loadDatabaseBalance` en BalanceContext)
- Distribución de premios: línea 15% del pot, bingo 85% del pot (100% distribuido)
- i18n completo en 10 idiomas para todos los componentes Bingo
- Bingo siempre visible en navegación (sin feature flag)

---

## Resumen de Auditorías

### 🔒 Seguridad (ver `audit-security-bingo.md`)
**Puntuación: 6.5/10**

| Nivel | Issue |
|-------|-------|
| 🔴 CRÍTICA | VRF seed no verificable por el usuario (sin commit-reveal) |
| ✅ RESUELTO | Pagos de premios: ya eran atómicos. Fix: jackpot read movido a FOR UPDATE dentro de la tx |
| 🟠 ALTA | Race condition en check de límite de cartones (sin FOR UPDATE) |
| 🟡 MEDIA | Información de ganadores accesible en API durante `drawing` |
| 🟡 MEDIA | Seed VRF expuesto en respuestas de API |

**Acción inmediata requerida:** Mover pagos de premios dentro de la misma transacción de resolución.

---

### 🏗️ Arquitectura Técnica (ver `audit-tech-bingo.md`)
**Puntuación: 7.5/10**

| Nivel | Issue |
|-------|-------|
| 🟠 ALTA | Sin recovery de rondas huérfanas en `drawing` al reiniciar servidor |
| 🟠 ALTA | Constants de timing hardcodeadas (deben coincidir frontend/backend) |
| 🟡 MEDIA | `calcSyncState` sin protección para elapsedMs < 0 |
| 🟡 MEDIA | Lógica de balance "el mayor gana" puede ser imprecisa con sesiones keno |
| 🟢 BAJA | Sin telemetría ni alertas para room loops |

**Deuda técnica principal:** Recovery de rondas + pagos atómicos.

---

### 🎨 UX/Experiencia de Usuario (ver `audit-ux-bingo.md`)
**Puntuación: 6.8/10**

| Nivel | Issue |
|-------|-------|
| 🔴 CRÍTICO | Sin confirmación antes de cargo (compra de cartones) |
| 🔴 CRÍTICO | Auto-retorno en 3s demasiado rápido si el usuario GANÓ |
| 🟠 ALTA | Sin celebración visual al ganar (confeti / animación) |
| 🟠 ALTA | No se indica quién ganó la línea durante la pausa |
| 🟡 MEDIA | Precios de premios estimados sin disclamer de "estimado" |

**Acción inmediata requerida:** Modal de confirmación en compra + No auto-retornar si ganó.

---

### 💻 Calidad de Código (ver `audit-code-bingo.md`)
**Puntuación: 7/10**

| Nivel | Issue |
|-------|-------|
| 🔴 Bug real | Pagos fuera de transacción DB (duplicado de seguridad) |
| 🔴 Anti-patrón | `setAnimatedBalls` dentro del updater de `setCurrentBallIndex` |
| 🟡 Potencial | Race condition en compras concurrentes (sin FOR UPDATE) |
| 🟡 Potencial | Lógica de balance puede mostrar valor inflado |
| 🟢 Tests | `calcSyncState` carece de tests para edge cases |

---

## Backlog Priorizado

### P0 — Crítico (antes de producción real)
- [x] ~~Incluir pagos de premios en la misma transacción DB~~ — ya eran atómicos
- [x] **Fix jackpot double-payout**: jackpot read movido dentro de transacción con `FOR UPDATE` (2026-02-18)
- [x] **Modal de confirmación** antes de cargo en compra de cartones (2026-02-18)
- [x] **Recovery de rondas huérfanas** al arrancar scheduler (2026-02-18)

### P1 — Alto (próximo sprint)
- [x] **`calcSyncState`**: proteger contra elapsedMs < 0 y totalBalls = 0 (2026-02-18)
- [x] **No auto-retornar si ganó**: banner de celebración + retorno manual; countdown 5s solo para perdedores (2026-02-18)
- [x] **Indicador "EN VIVO"**: badge rojo pulsante en el header durante DRAWING / LINE_ANNOUNCED / BINGO_ANNOUNCED, i18n (EN VIVO / LIVE) (2026-02-18)
- [x] **Fix race condition en compras**: `SELECT * FROM bingo_rounds FOR UPDATE` al inicio de la tx serializa compras concurrentes; card count re-leído dentro de la tx bajo el lock (2026-02-18)
- [x] **Filtrar ganadores en API durante drawing**: `GET /rounds/:id` redacta `line_winner`, `bingo_winner`, premios, `vrf_random_word`, flags de cartas — pero preserva `line_winner_ball` / `bingo_winner_ball` para la animación. `GET /verify/:id` bloquea VRF seed hasta que status=resolved (2026-02-18)

### P2 — Medio (siguiente sprint)
- [ ] Commit-reveal scheme para el seed VRF
- [x] **Cuadrícula 3x5 visual**: row wrappers explícitos, headers B-I-N-G-O con colores por columna (azul/violeta/room/verde/ámbar), row-complete destaca fila completa, celda FREE → ★, celdas más grandes (minmax 240px) (2026-02-18)
- [x] **Mostrar quién ganó la línea durante la pausa**: banner personalizado (ganaste / ganó X), bola donde ocurrió, mensaje "BINGO sigue disponible" en verde (2026-02-18)
- [x] **Celebración visual**: confetti canvas (130 partículas, 5.5s) + fanfarria de audio al ganar (2026-02-18)
- [ ] Countdown visible antes del auto-retorno al lobby
- [ ] Tests de integración para el scheduler

### P3 — Bajo (mejoras futuras)
- [ ] WebSockets o SSE en lugar de polling cada 5s
- [ ] Audio opcional (efectos de sonido)
- [ ] RTL support para árabe
- [ ] Centralizar constants de timing en un archivo compartido
- [ ] Migrar a VRF on-chain (Chainlink) para fairness verificable

---

## Estado General del Sistema

```
Backend Bingo:  ✅ Funcional | ⚠️ Pagos no atómicos
Scheduler:      ✅ Funcional | ⚠️ Sin recovery al reinicio
Frontend:       ✅ Funcional | ⚠️ Anti-patrón setState
Sincronización: ✅ Implementada y funcionando
Premios:        ✅ Distribución correcta (15%/85%)
i18n:           ✅ 10 idiomas completos
Balance update: ✅ Fix implementado (DB directo)
```
