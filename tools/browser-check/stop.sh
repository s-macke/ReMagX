#!/usr/bin/env bash
# Stops the server and Chrome started by start.sh (the bracket keeps pkill from matching itself).
pkill -f "remote-debugging-por[t]=9333" || true
pkill -f "http.serve[r] 8765" || true
