@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo MPBook Desktop - build Windows x64
echo ============================================================

where dotnet >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro el SDK de .NET 8.
  echo Instala .NET 8 SDK y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

dotnet restore
if errorlevel 1 goto :fail

dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "%~dp0publish"
if errorlevel 1 goto :fail

echo.
echo [OK] Compilado en:
echo %~dp0publish\MPBook.Desktop.exe
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] La compilacion fallo. Revisa los mensajes de arriba.
pause
exit /b 1
