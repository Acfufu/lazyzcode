@echo off
rem lzy hook launcher (Windows twin of the POSIX `run-hook`, one manifest line across both
rem platforms): the engine spawns hook commands with its own env, whose PATH is not guaranteed
rem to resolve node (2026-09-07 macOS GUI-startup incident; Windows keeps the same contract).
rem Usage (hooks.json): "${ZCODE_PLUGIN_ROOT}/hooks/run-hook" <script.js> [args...]
rem   cmd.exe resolves the extensionless name to this .cmd twin via PATHEXT
rem   (docs/design-crossplatform.md §1; schema has no per-OS fields).
rem Discipline: when node cannot be resolved, log one line to %TEMP%\lzy-hook-launcher.log and
rem   exit 0 (fail-open, never block the session). Mirrors run-hook.sh, including --print-node.
rem Style note: goto flow throughout - %PATH%/%APPDATA% may contain parentheses (x86) which
rem   would break parse-time expansion inside parenthesized blocks; no delayed expansion either.
setlocal
set "DIR=%~dp0"
set "NODE="

where node >nul 2>nul || goto nvm
for /f "usebackq delims=" %%i in (`where node`) do set "NODE=%%~fi"
if defined NODE goto have_node

:nvm
rem nvm-windows layout is %APPDATA%\nvm\<ver>\node.exe (no versions segment); the plain
rem wildcard for iterates all matches and the last one wins, same as the POSIX launcher.
for %%i in ("%APPDATA%\nvm\*\node.exe") do set "NODE=%%~fi"
if defined NODE goto have_node

if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"

:have_node
if "%~1"=="--print-node" goto print
goto run_or_fail

:print
if not defined NODE exit /b 1
echo %NODE%
exit /b 0

:run_or_fail
set "SCRIPT=%~1"
if "%SCRIPT%"=="" exit /b 0
if defined NODE goto run
>> "%TEMP%\lzy-hook-launcher.log" echo %DATE% %TIME% lzy hook: node unresolvable (PATH=%PATH%); %SCRIPT% skipped (fail-open)
exit /b 0

:run
shift
"%NODE%" "%DIR%%SCRIPT%" %1 %2 %3 %4 %5 %6 %7 %8
