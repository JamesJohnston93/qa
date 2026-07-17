#!/usr/bin/env node
import { runCli } from "./cli";

async function main(): Promise<void> {
  await runCli();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
