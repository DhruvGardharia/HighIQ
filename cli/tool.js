#!/usr/bin/env node

require('dotenv').config();

const axios = require("axios");
const readline = require("readline");

/*
  CONFIG
*/
const BASE_URL = process.env.TOOL_URL || "http://localhost:3000";
const command = process.argv[2];
const ROLE = process.argv[3] || process.env.ROLE;

if (!ROLE || !["p1", "p2"].includes(ROLE)) {
  console.log("Usage: tool start p1");
  console.log("       tool start p2");
  process.exit(1);
}

/*
  DRAMA ENGINE
*/
const DRAMA_LINES = [
  "[INFO] scanning buffer",
  "[INFO] verifying cursor integrity",
  "[WARN] delayed cursor",
  "[INFO] syncing volatile state",
  "[WARN] partial read detected",
  "[INFO] advancing read pointer",
  "[INFO] flushing local cache",
  "[WARN] upstream latency detected",
  "[INFO] reconciling offsets",
  "[INFO] applying delta window",
  "[WARN] stale segment ignored",
  "[INFO] buffer stable"
];

function drama(min = 8, max = 12) {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  for (let i = 0; i < count; i++) {
    const line = DRAMA_LINES[Math.floor(Math.random() * DRAMA_LINES.length)];
    console.log(line);
  }
}

/*
  SESSION MODE
*/
async function startSession() {
  await axios.post(`${BASE_URL}/start`, { role: ROLE });

  console.log("Subsystem active");
  console.log("Commands: tail | dump | state | connect | destroy | exit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> "
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    try {
      // EXIT
      if (input === "exit") {
        rl.close();
        return;
      }

      // STATE
      if (input === "state") {
        drama();
        const res = await axios.post(`${BASE_URL}/state`);
        console.log("  state:", JSON.stringify(res.data));
        rl.prompt();
        return;
      }

      // TAIL (drama + unread messages, single command)
      if (input === "tail") {
        const res = await axios.get(`${BASE_URL}/tail`, {
          params: { role: ROLE }
        });

        drama();

        if (res.data.messages.length > 0) {
          res.data.messages.forEach(m => {
            console.log("  " + m);
          });
        }

        rl.prompt();
        return;
      }

      // DUMP (drama + full log)
      if (input === "dump") {
        const res = await axios.get(`${BASE_URL}/dump`);

        drama(10, 15);

        res.data.messages.forEach(m => {
          console.log("  " + m);
        });

        rl.prompt();
        return;
      }

      // CONNECT (send notification)
      if (input === "connect") {
        const res = await axios.post(`${BASE_URL}/notify`, {
          role: ROLE
        });

        drama();
        console.log("  " + res.data.message);
        rl.prompt();
        return;
      }

      // DESTROY (clear all messages)
      if (input === "destroy") {
        const res = await axios.post(`${BASE_URL}/destroy`, {
          role: ROLE
        });

        drama();
        console.log("  " + res.data.message);
        rl.prompt();
        return;
      }

      // ANY OTHER INPUT = MESSAGE SEND
      if (input.length > 0) {
        await axios.post(`${BASE_URL}/push`, {
          role: ROLE,
          data: input
        });

        // drama only — never echo message
        drama(6, 10);
      }

    } catch {
      // silent failure on purpose
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

/*
  ENTRY POINT
*/
(async () => {
  if (command === "start") {
    await startSession();
  } else {
    console.log("Usage: tool start p1");
    console.log("       tool start p2");
  }
})();
