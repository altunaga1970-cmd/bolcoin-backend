# WORKFLOW — Dual AI Safe Mode (gold)

Objetivo: alternar Claude ↔ Qwen sin perder continuidad.

## Canon
PROJECT_STATE.md + SCOPE_CONTRACT.md mandan.

## Regla "una IA por tarea"
Una tarea = una IA (plan→implement→verify→doc).
Al cambiar de IA: usar HANDOFF.md.

## Gates mínimos
- Gate 1: compila/corre
- Gate 2: smoke test reproducible
- Gate 3: PROJECT_STATE actualizado
- Gate 4: CHANGELOG actualizado

## No interferencia
Qwen no toca .claude.
Claude no necesita tocar .ai.