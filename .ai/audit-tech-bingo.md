# Auditoría Técnica — Bingo Game (Bolcoin)
**Fecha:** 2026-02-18
**Auditor:** Claude Opus 4.6
**Alcance:** Arquitectura, implementación y calidad técnica del sistema Bingo

---

## Resumen Ejecutivo

El juego Bingo implementa un sistema multiplayer sincronizado con arquitectura sólida para un MVP. La decisión de introducir el estado `drawing` con `draw_started_at` es técnicamente correcta y elegante. Las mayores deudas técnicas están en la falta de tests de integración y en algunos problemas de concurrencia potencial.

**Puntuación Técnica Global: 7.5/10**

---

## 1. Arquitectura del Estado `drawing`

### Flujo implementado
```
open (45s buy window)
  → closed
  → drawing (VRF generado, draw_started_at=NOW(), bolas en DB)
  → resolved (después de animación completa)
```

### Evaluación

**✅ Correcto:** El estado `drawing` permite que cualquier cliente que se una tarde calcule la bola actual desde `draw_started_at` sin necesidad de estado propio.

**✅ Correcto:** Los datos de ganadores se calculan al inicio del drawing (resolución instantánea), lo que evita latencia durante la animación.

**✅ Correcto:** `calcSyncState()` es una función pura sin efectos secundarios, fácil de testear.

**⚠️ Limitación:** El servidor "sabe" quién gana desde el momento que empieza `drawing`. Esto crea una ventana donde los datos de ganadores están en la DB pero el usuario no debería verlos aún.

**⚠️ Limitación:** Si el servidor se reinicia durante el estado `drawing`, el scheduler no tiene mecanismo de recovery para detectar rondas huérfanas en ese estado. La ronda quedará en `drawing` indefinidamente.

### Propuesta de mejora: Recovery de rondas huérfanas
```js
// Al arrancar el scheduler, detectar rondas en 'drawing' y finalizarlas
async function recoverStaleDrawings() {
  const stale = await pool.query(
    `SELECT round_id, draw_started_at, drawn_balls FROM bingo_rounds
     WHERE status = 'drawing'
     AND draw_started_at < NOW() - INTERVAL '10 minutes'`
  );
  for (const row of stale.rows) {
    await finalizeDrawing(row.round_id);
  }
}
```

---

## 2. Análisis del Scheduler

### Arquitectura de 4 salas paralelas
```
Room 1: start +0s    → ciclo ~7min (45s buy + 2s + drawing + 30s cooldown)
Room 2: start +103s  → stagger para ciclos escalonados
Room 3: start +206s
Room 4: start +309s
```

**✅ Correcto:** El stagger de 103s distribuye bien el tráfico y evita que 4 rondas se resuelvan simultáneamente.

**✅ Correcto:** Manejo de errores con sleep(10s) y retry en el loop.

**⚠️ Problema:** Si `BALL_INTERVAL_MS = 4500` en el scheduler y en el frontend, pero un admin cambia el intervalo en DB, habrá desincronización. El valor debería leerse de config, no estar hardcodeado.

**⚠️ Problema:** El sleep de la animación bloquea el loop de la sala. Si hay un error durante `finalizeDrawing`, el loop entra en `catch` y espera 10s antes de reintentar. Esto podría dejar la sala en estado `drawing` cuando debería estar en `results`.

**⚠️ Problema:** No hay telemetría. Si un room loop muere silenciosamente, no hay alerta. Solo se registra en consola.

---

## 3. Función `calcSyncState` — Análisis

```js
function calcSyncState(elapsedMs, lineWinnerBall, bingoWinnerBall, totalBalls) {
  const maxBall = bingoWinnerBall > 0 ? bingoWinnerBall : totalBalls;
  const linePauseStartMs = lineWinnerBall > 0 ? lineWinnerBall * DRAW_INTERVAL : Infinity;
  const linePauseEndMs = linePauseStartMs + LINE_PAUSE_MS;
  // ...
}
```

**✅ Función pura:** No tiene efectos secundarios, completamente determinística.

**✅ Maneja correctamente:** drawing → line_pause → drawing → bingo_pause → done

**⚠️ Edge case:** Si `lineWinnerBall === bingoWinnerBall` (imposible matemáticamente dado que línea siempre ocurre antes que bingo completo, pero vale verificar con tests).

**⚠️ Edge case:** Si `elapsedMs` es negativo (reloj del cliente desincronizado con el servidor), `ballIndex` sería -1. No hay protección:
```js
// Falta:
if (elapsedMs < 0) return { ballIndex: 0, phase: 'drawing' };
```

**⚠️ Edge case:** Si `bingoWinnerBall === 0` y `totalBalls === 0`, `maxBall` sería 0 y `Math.min(Math.floor(0/4500), -1)` = -1. Debería validarse que `totalBalls > 0`.

---

## 4. Distribución de Premios

### Configuración actual (DB + código)
```
feeBps = 1000        → 10% fee de la casa
reserveBps = 1000    → 10% reserva/jackpot pool
linePrizeBps = 1500  → 15% del winner pot (80% del revenue)
bingoPrizeBps = 8500 → 85% del winner pot
Total del pot: 15% + 85% = 100% ✅
```

### Ejemplo con 50 cartones a $1
```
Revenue = $50
Fee = $5
Reserve = $5
Winner Pot = $40
Line Prize = $6   (15% de $40)
Bingo Prize = $34 (85% de $40)
```

**✅ Math correcta:** No queda pot sin distribuir.

**⚠️ Problema:** Los `config.linePrizeBps` se leen de `game_config` en DB pero hay valores fallback hardcodeados en el código (`|| 1500`). Si alguien actualiza el código pero no la DB (o viceversa), los valores pueden divergir. Esto ya ocurrió durante el desarrollo (valores antiguos 1000/7000 en DB).

**Solución:** Añadir una validación al arranque que compare los defaults del código con los valores DB y loguee warning si difieren.

---

## 5. Internacionalización (i18n)

### Estado actual
- 10 idiomas implementados: en, es, fr, pt, zh, ja, ko, ru, ar, hi
- Namespace `games` con sección `bingo` completa
- Subsecciones: `lobby`, `room`, `room_card`, `results_panel`, `ball_draw`

**✅ Correcto:** `PHASE_LABELS` movidos dentro del componente para acceder a `t()`.

**⚠️ No verificado:** Las traducciones en idiomas no-latinos (zh, ja, ko, ar, hi) deben ser revisadas por hablantes nativos. Las traducciones automáticas pueden tener errores de contexto de juego de azar.

**⚠️ Faltante:** RTL (right-to-left) para árabe. Los estilos CSS del frontend no tienen `[dir="rtl"]` adaptaciones para el Bingo lobby.

---

## 6. Balance Context — Fix Aplicado

### Cambio implementado
```js
// loadDatabaseBalance ahora actualiza effectiveBalance si DB > prev
setEffectiveBalance(prev => {
  return dbVal > prevVal ? formatted : prev;
});
```

**✅ Correcto:** Soluciona el problema de balance no actualizado al ganar.

**⚠️ Lógica de "el mayor gana" puede ser incorrecta** en casos donde el usuario haya apostado en Keno y tenga pérdidas pendientes de sesión. En ese caso, `effectiveBalance` debería ser `DB balance + session netResult`, no simplemente el DB balance. Al tomar el mayor valor, podría mostrar un balance "inflado" si hay pérdidas de keno no settladas.

**Alternativa más correcta:**
```js
// Después de ganar bingo, forzar refresh completo incluyendo keno session
await loadEffectiveBalance(); // Esto llama kenoApi.getSession()
```
Pero esto falla si el keno flag está desactivado. La solución real es hacer que `/keno/session` no requiera `requireFlag('game_keno')` para leer el balance (solo para apostar).

---

## 7. Deuda Técnica Identificada

| Item | Severidad | Esfuerzo |
|------|-----------|---------|
| Recovery de rondas huérfanas en `drawing` | Alta | 2h |
| `calcSyncState` sin protección para elapsedMs < 0 | Media | 30min |
| Pagos de premios en misma transacción DB | Alta | 3h |
| Tests de integración scheduler + DB | Alta | 1 día |
| Validación de config BPS al arranque | Baja | 1h |
| RTL support para árabe | Baja | 4h |
| Telemetría y alertas de rooms | Media | 1 día |

---

## 8. Escalabilidad

### Carga actual esperada
- 4 salas, 5 usuarios máx por sala = ~20 usuarios concurrentes
- 1 poll cada 5s por usuario = ~4 req/s
- Muy por debajo de límites de un servidor Node.js + PostgreSQL típico

### Cuellos de botella al escalar
1. **Polling de 5s:** Con 1000 usuarios concurrentes, serían 200 req/s solo en `/rooms`. Solución: WebSockets o SSE.
2. **4 room loops en un solo proceso:** Si el proceso Node muere, todas las salas se detienen. Solución: usar un job scheduler externo (Bull, pg-boss).
3. **Transacciones de compra:** Con muchos usuarios comprando simultáneamente, pueden haber deadlocks en `UPDATE bingo_rounds SET total_cards...`. Solución: batch updates o cola.

---

## Recomendaciones Priorizadas

| P | Acción | Impacto |
|---|--------|---------|
| P0 | Recovery de rondas en estado `drawing` al reiniciar servidor | Evita rondas huérfanas |
| P1 | Pagos de premios dentro de transacción DB atómica | Evita pérdida de fondos |
| P1 | Proteger `calcSyncState` contra elapsedMs < 0 | Evita -1 ballIndex en UI |
| P2 | Fix lógica de balance: no usar "el mayor gana" sino refresh completo | Balance más preciso |
| P2 | Leer BALL_INTERVAL_MS de config en scheduler (no hardcoded) | Consistencia config |
| P3 | Migrar polling a SSE/WebSocket | Escalabilidad |
| P3 | Añadir pg-boss o similar para job scheduling | Resilencia |
