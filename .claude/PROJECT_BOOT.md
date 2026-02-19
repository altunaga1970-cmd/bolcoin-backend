
# PROJECT_BOOT

Este proyecto debe ejecutarse con la skill:
- project-squad-orchestrator

Antes de cualquier cambio de código, hacer SIEMPRE:
1) Leer: SESSION_ENTRY.md, PROJECT_STATE.md, SCOPE_CONTRACT.md, README.md.
2) Si faltan artefactos (PROJECT_STATE/SCOPE/SESSION_ENTRY/CHECKLIST/CHANGELOG):
   - crear usando plantillas de la skill (sin sobrescribir existentes).
3) Realizar REPASO del repo:
   - arquitectura (módulos)
   - stack real detectado
   - riesgos/deuda técnica
   - puntos críticos
4) Ejecutar Auto-Router (roles mínimos) y listar “Agentes activados” con motivo.
5) Si el cambio es sensible (auth/pagos/db/refactor): aplicar Senior Review Board antes de tocar código.
6) Proponer plan por fases + gates + rollback.
Regla: cambios mínimos; no reescribir el proyecto.