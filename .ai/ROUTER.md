# AGENT ROUTER — gold (determinista)

Siempre activo:
- CTO

Seleccionar agentes según TAREA + PATHS:

## Frontend principal (React)
Si la tarea afecta:
- /bolcoin-frontend/src/**  (api, contexts, hooks, pages, components, i18n)
Activar:
- FRONTEND_SENIOR
- QA_SENIOR
Añadir SECURITY_SENIOR si toca auth/wallet/session.

## Backend principal (Node)
Si la tarea afecta:
- /src/controllers, /src/routes, /src/services, /src/middleware, /src/indexer, /src/scheduler, /src/workers
Activar:
- BACKEND_SENIOR
- QA_SENIOR
Añadir SECURITY_SENIOR si toca auth/admin/JWT/captcha/pagos.

## Base de datos (PostgreSQL)
Si la tarea afecta:
- /src/db/migrations, /src/db/schema.sql, /src/models
Activar:
- DATABASE_SENIOR
- BACKEND_SENIOR
- QA_SENIOR
Requiere auditoría de migración (AUDITOR_MODE).

## Smart contracts (Hardhat)
Si la tarea afecta:
- /contracts/contracts/**, /contracts/scripts/**, /contracts/test/**
Activar:
- SECURITY_SENIOR
- QA_SENIOR
- ARCHITECT (si es cambio grande)
Nota: /contracts/artifacts* y /contracts/cache son build outputs (no tocar).

## DevOps/Deploy
Si la tarea afecta:
- railway.toml, workflows, docker, build pipelines
Activar:
- DEVOPS_SENIOR
- SECURITY_SENIOR

## Arquitectura/refactor grande
Si la tarea incluye:
- “refactor”, “reestructura”, “migrar”, “cambiar stack”, “unificar frontends”
Activar:
- ARCHITECT
- QA_SENIOR
- (SECURITY_SENIOR si afecta auth/cripto/datos)
Requiere Senior Review Board (bloqueo hasta plan + rollback).

## Reglas anti-lío
- NO tocar /frontend (secundario) salvo orden explícita.
- NO tocar /backend (secundario) salvo orden explícita.
- Preferencia por /bolcoin-frontend como único frontend activo.
- Preferencia por /src como único backend activo.