@echo off
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Dogear.exe" "%~dp0nm-bridge-worker.cjs"
