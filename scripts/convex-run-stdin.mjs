// Invoke the installed Convex CLI with private function arguments from stdin,
// keeping recipients and template values out of the operating-system argv.
import { readFileSync } from "node:fs";

const functionName = process.argv[2];
if (!functionName || !/^[A-Za-z][A-Za-z0-9:./_-]*$/.test(functionName))
  throw new Error("Invalid local Convex function name");
const args = readFileSync(0, "utf8");
JSON.parse(args);
process.argv = [process.execPath, "convex", "run", functionName, args];
await import("../node_modules/convex/bin/main.js");
