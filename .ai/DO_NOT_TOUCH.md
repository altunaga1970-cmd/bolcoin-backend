# DO NOT TOUCH — gold (protecciones)

Qwen NO debe modificar nada de esta lista salvo instrucción explícita del usuario.

## 1) Integración Claude (no interferir)
- /.claude/**
- /.claude/skills/**

## 2) Frontend/Backend secundarios (evitar mezclar proyectos)
- /frontend/**           (frontend secundario legacy)
- /backend/**            (backend secundario)
Regla: solo tocar si el usuario dice explícitamente que esa tarea es allí.

## 3) Build outputs / artefactos generados (no editar)
- /contracts/artifacts/**
- /contracts/artifacts-v2/**
- /contracts/cache/**
- /frontend/build/**
- /frontend/dist/**

## 4) Zonas de alto riesgo (requieren Senior Review + plan + rollback)
- /src/db/migrations/**   (migraciones)
- /src/db/schema.sql
- /src/scheduler/**
- /src/workers/**
- /contracts/contracts/** (cambios en smart contracts)
- /contracts/scripts/**   (deploy scripts)

## 5) Secrets / credenciales
- /.env (no escribir nunca)
- cualquier private key / seed / mnemonic (prohibido almacenar)

## 6) Non-custodial guard (si el contrato lo marca)
- Cualquier lógica de “custodia” o balances internos transferibles queda bloqueada.

## Regla de duda
Si no estás seguro de si un archivo es sensible:
- trátalo como DO_NOT_TOUCH
- propone alternativa o pide confirmación.