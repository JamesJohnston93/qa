#!/usr/bin/env node
import { runCli } from "./cli";
import { runOrderCli } from "./cli-order";
import { runFulfilCli } from "./cli-fulfil";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "order") {
    await runOrderCli(argv.slice(1));
  } else if (argv[0] === "fulfil") {
    await runFulfilCli(argv.slice(1));
  } else {
    await runCli();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
