@echo off
chcp 65001 >nul
cls

echo.
echo ╔═══════════════════════════════════════════════════╗
echo ║                                                   ║
echo ║         🎰 LA BOLITA - SETUP RÁPIDO             ║
echo ║                                                   ║
echo ╚═══════════════════════════════════════════════════╝
echo.
echo.

:menu
echo 📋 MENÚ DE CONFIGURACIÓN:
echo.
echo    1. ✅ Verificar PostgreSQL
echo    2. 🗄️  Configurar Base de Datos (crear tablas)
echo    3. 👤 Crear Usuario Admin
echo    4. 🌱 Cargar Datos de Prueba
echo    5. 🚀 Iniciar Servidor
echo    6. 🧪 Probar API
echo    7. ❌ Salir
echo.
echo.

set /p choice="Selecciona una opción (1-7): "

if "%choice%"=="1" goto check
if "%choice%"=="2" goto setup
if "%choice%"=="3" goto admin
if "%choice%"=="4" goto seed
if "%choice%"=="5" goto start
if "%choice%"=="6" goto test
if "%choice%"=="7" goto end

echo.
echo ❌ Opción inválida
timeout /t 2 >nul
cls
goto menu

:check
cls
echo.
echo 🔍 Verificando PostgreSQL...
echo.
node scripts/check-postgres.js
echo.
pause
cls
goto menu

:setup
cls
echo.
echo 🗄️  Configurando Base de Datos...
echo.
node scripts/setup-db.js
echo.
pause
cls
goto menu

:admin
cls
echo.
echo 👤 Creando Usuario Admin...
echo.
node scripts/create-admin.js
echo.
pause
cls
goto menu

:seed
cls
echo.
echo 🌱 Cargando Datos de Prueba...
echo.
node scripts/seed-data.js
echo.
pause
cls
goto menu

:start
cls
echo.
echo 🚀 Iniciando Servidor...
echo.
echo ⚠️  Presiona Ctrl+C para detener el servidor
echo.
npm run dev
pause
cls
goto menu

:test
cls
echo.
echo 🧪 Probando API...
echo.
node scripts/test-api.js
echo.
pause
cls
goto menu

:end
cls
echo.
echo 👋 ¡Hasta luego!
echo.
timeout /t 2 >nul
exit
