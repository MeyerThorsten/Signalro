#!/usr/bin/env node
// Signalro launcher — enables `npx signalro` and a global `signalro` command.
// Live capture still needs privileges (run with sudo, or grant tcpdump caps).
require('../server.js').start();
