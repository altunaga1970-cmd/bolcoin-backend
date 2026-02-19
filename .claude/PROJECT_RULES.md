# PROJECT_RULES

Reglas específicas de ESTE repo:
- No cambiar stack sin editar SCOPE_CONTRACT.md.
- No romper endpoints existentes.
- Migraciones DB: reversibles y documentadas.
- Cambios en auth/roles: requieren Senior Review + QA.
- Secrets: solo .env / secret manager, nunca en código.