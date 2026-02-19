# Auditoría de UX — Bingo Game (Bolcoin)
**Fecha:** 2026-02-18
**Auditor:** Claude Opus 4.6
**Alcance:** Flujo completo del usuario en el juego Bingo, desde el lobby hasta los resultados

---

## Resumen Ejecutivo

La UX del Bingo tiene una base sólida con información clara sobre fases, precios y premios estimados. Los puntos de fricción principales están en el feedback visual durante el sorteo y en la ausencia de confirmaciones explícitas antes de gastos reales. El auto-retorno al lobby es una decisión UX acertada pero necesita refinamiento.

**Puntuación UX Global: 6.8/10**

---

## 1. Pantalla Lobby (`BingoLobby.jsx` / `RoomCard.jsx`)

### Lo que muestra bien
- ✅ 4 salas con colores distintos y nombres temáticos (La Purpura, La Esmeralda, La Royal, La Dorada)
- ✅ Badge de fase claramente visible (COMPRANDO, SORTEANDO, RESULTADOS, ESPERANDO)
- ✅ Countdown en tiempo real con formato MM:SS
- ✅ Estadísticas por sala: jugadores, cartones vendidos, precio por cartón
- ✅ Desglose de premios estimados (Línea / Bingo / Jackpot)
- ✅ Badge "Mis cartones: X" cuando el usuario tiene cartones en una sala
- ✅ Soporte multiidioma (10 idiomas)

### Problemas identificados

**🔴 CRÍTICO — Precios estimados vs reales confusos**
Los premios en `RoomCard` son **estimados** basados en cartones actuales, pero cambian constantemente al entrar nuevos jugadores. Un usuario puede ver "Premio Bingo: $34" y entrar a la sala esperando ganar $34, pero en el momento del sorteo podría ser $51 si entraron más jugadores. No hay disclaimer de "estimado" visible.

**Recomendación:** Añadir label "~" o "estimado" junto a los valores de premio, o solo mostrar el % del pot en lugar de valores absolutos.

**🟡 MEDIA — CTA confuso cuando la sala está en fase drawing**
El botón muestra "Ver Sorteo" pero al hacer clic, el usuario entra a ver la animación en curso. No hay indicación de que ya no puede comprar cartones para esa ronda.

**Recomendación:** Añadir texto aclaratorio: "Ver sorteo en curso (no puedes participar en esta ronda)".

**🟡 MEDIA — No hay indicación de cuándo abre la siguiente ronda**
Cuando una sala está en `waiting` o `results`, el countdown muestra el tiempo hasta que abre. Pero el usuario no sabe si "5 minutos" es mucho o poco en contexto.

**Recomendación:** Añadir una barra de progreso visual del ciclo de la sala.

---

## 2. Pantalla de Compra de Cartones (`BingoRoom.jsx` — fase BUYING)

### Lo que muestra bien
- ✅ Panel de compra con selector de número de cartones (1-5)
- ✅ Precio total calculado en tiempo real
- ✅ Countdown de cierre visible
- ✅ Balance del usuario visible en el nav

### Problemas identificados

**🔴 CRÍTICO — Sin confirmación antes del cargo**
Al pulsar "Comprar X cartones" el cargo se realiza inmediatamente sin un paso de confirmación. En un juego con dinero real, esto puede llevar a compras accidentales, especialmente en mobile.

**Flujo actual:** Pulsar botón → transacción inmediata → cartones asignados
**Flujo recomendado:** Pulsar botón → Modal de confirmación ("¿Confirmar compra de 3 cartones por $3 USDT?") → Confirmar → transacción

**🟡 MEDIA — Cartones mostrados son números, no cuadrícula visual**
Los cartones de bingo muestran los 15 números pero no en el formato tradicional de cuadrícula 3x5. Los jugadores esperan ver la estructura de cartón real.

**Recomendación:** Mostrar los cartones en cuadrícula 3 filas × 5 columnas con columnas B-I-N-G-O.

**🟡 MEDIA — No hay feedback claro del estado "WAITING_CLOSE"**
Después de comprar, el estado cambia a "esperando cierre" pero el mensaje puede no ser suficientemente claro sobre qué está pasando.

**Recomendación:** Mensaje más claro: "✅ Cartones comprados. El sorteo comenzará en [countdown]."

**🟢 BAJA — Auto-mark no explicado**
El botón "Auto-marcar" en `BallDraw` no tiene tooltip ni explicación. Usuarios nuevos no saben qué hace.

---

## 3. Pantalla de Sorteo (`BallDraw.jsx` — fase DRAWING)

### Lo que muestra bien
- ✅ Bola actual mostrada prominentemente
- ✅ Historial de bolas dibujadas
- ✅ Número de bola actual (X / 75)
- ✅ Sincronización entre todos los clientes (misma bola al mismo tiempo) ← **gran mejora**

### Problemas identificados

**🔴 CRÍTICO — Sin indicador de sincronización de tiempo**
El usuario no sabe que está viendo la misma bola que otros jugadores. Podría pensar que tiene un bug si ve a otro usuario "más avanzado" (ej: comparando por pantalla).

**Recomendación:** Añadir pequeño indicador "🔴 EN VIVO" o "Sincronizado con X jugadores".

**🟠 ALTA — Pausa de Línea no indica quién ganó**
Durante la pausa de 5 segundos al detectar una línea, se muestra un anuncio, pero si el usuario NO ganó la línea, no sabe si su cartón tiene chance aún para el bingo.

**Recomendación:** Durante `LINE_ANNOUNCED`, mostrar: "🏆 Línea ganada por [dirección corta]. El sorteo continúa para el BINGO..."

**🟡 MEDIA — No hay audio/vibración en móvil**
En los juegos de bingo tradicionales, el audio es parte clave de la experiencia. Sin audio, la experiencia de ver cada bola es menos emocionante.

**Recomendación:** Añadir audio opcional (sonido de bola cayendo, fanfarria en línea/bingo).

**🟡 MEDIA — El botón "Saltar al resultado" puede ser tentador**
`skipToResults` muestra los resultados inmediatamente. Si un usuario lo hace y no ganó, podría confundirse sobre el estado del juego.

**Recomendación:** Añadir confirmación: "¿Saltar al resultado? Verás quién ganó inmediatamente."

---

## 4. Pantalla de Resultados (`ResultsPanel.jsx`)

### Lo que muestra bien
- ✅ Ganador de línea y bingo claramente mostrados
- ✅ Premio exacto indicado
- ✅ Auto-retorno al lobby en 3 segundos

### Problemas identificados

**🔴 CRÍTICO — 3 segundos es demasiado poco para leer resultados**
3 segundos no es suficiente para que el usuario procese: quién ganó, cuánto ganó, si él ganó, y cómo quedan sus fondos. En particular si el usuario ganó y quiere ver su nuevo balance.

**Evidencia:** El usuario mismo reportó que el balance no actualizaba — en parte porque la pantalla desaparecía antes de que el usuario pudiera verificarlo.

**Recomendación:**
- Si el usuario GANÓ: No auto-retornar. Mostrar celebración y botón manual "Volver al Lobby".
- Si el usuario PERDIÓ: Auto-retorno en 5-8 segundos con countdown visible.

**🟠 ALTA — Balance actualizado pero sin celebración**
Cuando el usuario gana, el balance en el nav se actualiza (con el fix implementado), pero no hay ningún elemento visual que celebre la ganancia (confeti, animación, sonido).

**Recomendación:** Al detectar que el usuario es `lineWinner` o `bingoWinner`, mostrar animación de celebración prominente con el monto ganado.

**🟡 MEDIA — No se muestra el propio cartón ganador**
En los resultados, se muestra quién ganó pero no se resalta el cartón ganador del usuario en la cuadrícula.

**Recomendación:** Mostrar el cartón ganador con las 5 bolas de la línea marcadas en color especial.

**🟢 BAJA — Dirección de wallet truncada pero no copiable**
Los ganadores se muestran como `0x1234...5678`. En Web3 los usuarios esperan poder copiar la dirección completa.

---

## 5. Flujos Críticos con Dinero en Riesgo

| Momento | Riesgo | Mitigación Actual | Recomendación |
|---------|--------|-------------------|---------------|
| Compra de cartones | Cargo accidental por doble-tap | Rate limiting backend | Modal de confirmación |
| Countdown llega a 0 durante compra | Error "Round buy window has closed" | Error mostrado en UI | Deshabilitar botón al llegar a 0 |
| Cierre de ventana durante sorteo | Se pierde la animación, resultados disponibles en DB | Poll al regresar | Notificación push o badge en lobby |
| Pérdida de conexión durante compra | Transacción puede haber procesado | Cartones en DB | Verificar state en /my-cards al reconnectar |

---

## 6. Accesibilidad

| Item | Estado |
|------|--------|
| Textos en 10 idiomas | ✅ Implementado |
| Contraste de colores (badge fases) | ⚠️ Sin verificar (needs manual check) |
| Navegación por teclado | ⚠️ No probada |
| Screen reader (ARIA labels) | ❌ No implementado |
| RTL para árabe | ❌ No implementado |
| Responsive móvil | ⚠️ Header tiene hamburger menu, pero Bingo components no están verificados en móvil |

---

## 7. Recomendaciones Priorizadas

| P | Pantalla | Recomendación |
|---|----------|---------------|
| P0 | Compra | Modal de confirmación antes de cargo |
| P0 | Resultados | No auto-retornar si el usuario GANÓ |
| P1 | Resultados | Celebración visual al ganar (confeti / animación) |
| P1 | Sorteo | Indicador "EN VIVO / Sincronizado" |
| P1 | Sorteo | Mostrar quién ganó la línea durante la pausa |
| P2 | Lobby | Label "estimado" en precios de premios |
| P2 | Compra | Cuadrícula 3x5 visual para los cartones |
| P2 | Resultados | Countdown visible antes de auto-retorno |
| P3 | Global | Audio opcional (efectos de sonido) |
| P3 | Global | RTL support para árabe |
