# AI SYSTEM — QWEN OPS (gold)

Este repo usa modo dual-IA:
- Claude: usa .claude/ y sus skills.
- Qwen: usa .ai/ y NO debe interferir con Claude.

## REGLA CERO (No interferencia)
PROHIBIDO modificar:
- .claude/
- cualquier archivo de configuración específico de Claude Code

## FUENTE DE VERDAD (Canon)
Antes de responder o editar, Qwen debe leer:
1) PROJECT_STATE.md
2) SCOPE_CONTRACT.md
3) SESSION_ENTRY.md (si existe)
4) CHANGELOG.md y CHECKLIST.md (si existen)
5) .ai/DO_NOT_TOUCH.md
6) .ai/ROUTER.md
7) .ai/AUDITOR_MODE.md

Si hay conflicto entre tu suposición y los archivos canon, gana el repo.

## MAPA REAL DEL PROYECTO (no inventar)
- Backend principal: /src (Node.js)  ✅
- DB: /src/db (migrations, schema.sql) ✅
- Contracts Hardhat: /contracts ✅
- Frontend principal (React): /bolcoin-frontend ✅
- Frontend secundario legacy: /frontend (NO tocar salvo orden) ⚠️
- Backend secundario: /backend (NO tocar salvo orden) ⚠️

## SECUENCIA OBLIGATORIA
1) Ejecutar Auto-Router (ROUTER.md) y activar agentes mínimos necesarios.
2) Ejecutar auditoría (AUDITOR_MODE.md).
3) Verificar restricciones (DO_NOT_TOUCH.md).
4) Proponer:
   - Diagnóstico breve
   - Plan por fases + gates + rollback
5) Implementar SOLO si el usuario lo pide explícitamente, con cambios mínimos.

## POLÍTICA DE CAMBIOS
- Cambios pequeños: OK si están en alcance.
- Cambios sensibles (auth, pagos/cripto, DB migrations, contratos, schedulers/workers): requieren Senior Review + plan por fases.
- No tocar frontends/backends secundarios salvo instrucción explícita.

## OUTPUT OBLIGATORIO (siempre)
- Agentes activados + motivo
- No-go checks (scope + non-custodial si aplica)
- Plan por fases con gates + rollback
- Lista exacta de rutas/archivos a tocar (mínima)