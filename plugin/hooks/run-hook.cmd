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
rem nvm candidate order (V021-ADJ-57): the wildcard's last match used to win, but plain name
rem   order puts a v9 residue after v24 ("v9" > "v2x" bytewise) => Node 9 ran the ESM hooks and
rem   all five hooks died with no fail-open log on that path. Now every %APPDATA%\nvm\* dir is
rem   scored by its v<major>.<minor>.<patch> name through a zero-padded sort key (equal-width
rem   digits => string compare == version compare) and the highest one wins. Fallback semantics
rem   when a dir name carries no parseable version: it still gets a padded key, so plain string
rem   order decides (an unversioned name loses to a real version); with no nvm candidate at all
rem   the fixed system path below is used. The chosen binary stays observable via --print-node
rem   (lzy doctor hook-node row).
setlocal
set "DIR=%~dp0"
set "NODE="

where node >nul 2>nul || goto nvm
for /f "usebackq delims=" %%i in (`where node`) do set "NODE=%%~fi"
if defined NODE goto have_node

:nvm
rem nvm-windows layout is %APPDATA%\nvm\<ver>\node.exe (no versions segment).
set "BESTKEY="
for /d %%d in ("%APPDATA%\nvm\*") do call :nvm_try "%%~fd"
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

rem subroutines: reached only via call - normal flow never falls through into them
:nvm_try
rem %~1 = candidate version dir; keeps the highest version seen so far in NODE/BESTKEY.
if not exist "%~1\node.exe" exit /b 0
set "VDIR=%~1"
for %%v in ("%VDIR%") do set "VER=%%~nxv"
set "VER=%VER:v=%"
set "MAJ="
set "MIN="
set "PAT="
for /f "tokens=1,2,3 delims=." %%a in ("%VER%") do set "MAJ=%%a" & set "MIN=%%b" & set "PAT=%%c"
if not defined MAJ set "MAJ=0"
if not defined MIN set "MIN=0"
if not defined PAT set "PAT=0"
set "MAJP=0000%MAJ%"
set "MAJP=%MAJP:~-4%"
set "MINP=0000%MIN%"
set "MINP=%MINP:~-4%"
set "PATP=0000%PAT%"
set "PATP=%PATP:~-4%"
set "KEY=%MAJP%%MINP%%PATP%"
if "%KEY%" gtr "%BESTKEY%" goto nvm_take
exit /b 0

:nvm_take
set "NODE=%VDIR%\node.exe"
set "BESTKEY=%KEY%"
exit /b 0
