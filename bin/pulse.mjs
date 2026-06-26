#!/usr/bin/env bun
// PULSE CLI entry — invoked as `pulse <cmd>` after `bun install -g @bryxen-ai/pulse`.
// Thin shim that prepares env vars and hands control to src/index.ts.

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const pkg = require(path.join(root, "package.json"));

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    port:      { type: "string",  short: "p" },
    host:      { type: "string",  short: "H" },
    "db-path": { type: "string",  short: "d" },
    auth:      { type: "boolean" },                  // opt back into login page
    help:      { type: "boolean", short: "h" },
    version:   { type: "boolean", short: "v" },
  },
});

const cmd = positionals[0] ?? (values.version ? "version" : values.help ? "help" : "run");

function usage() {
  console.log(`pulse ${pkg.version} — self-hosted AI gateway

Usage:
  pulse run [options]      Start the gateway (default)
  pulse version            Print version
  pulse help               Show this help

Options:
  -p, --port <n>           Listening port           (default 3000, env PORT)
  -H, --host <addr>        Bind address             (default 127.0.0.1, env HOST)
  -d, --db-path <file>     SQLite database path     (default ~/.pulse/pulse.db, env DB_PATH)
      --auth               Require login            (default off for local installs)
  -v, --version            Print version
  -h, --help               Show this help

Examples:
  pulse run
  pulse run --port 8080 --auth
  pulse run --db-path ./pulse.db
`);
}

switch (cmd) {
  case "version":
    console.log(pkg.version);
    break;

  case "help":
    usage();
    break;

  case "run":
  case "start": {
    process.env.NODE_ENV   = process.env.NODE_ENV   || "production";
    process.env.PORT       = values.port            ?? process.env.PORT       ?? "3000";
    process.env.HOST       = values.host            ?? process.env.HOST       ?? "127.0.0.1";
    process.env.DB_PATH    = values["db-path"]      ?? process.env.DB_PATH    ?? path.join(homedir(), ".pulse", "pulse.db");
    if (!values.auth) process.env.PULSE_NO_AUTH = "1";

    // Hand off to the server entry. Resolved relative to this file so the
    // CLI works wherever bun's global bin happens to symlink it from.
    await import(path.join(root, "src", "index.ts"));
    break;
  }

  default:
    console.error(`pulse: unknown command "${cmd}"\n`);
    usage();
    process.exit(2);
}
