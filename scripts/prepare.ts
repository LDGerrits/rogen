import { spawnSync } from "child_process";
import fs from "fs";

if (!fs.existsSync("node_modules/.bin/tsx")) process.exit(0);

const { status } = spawnSync("npm", ["run", "generate"], {
	stdio: "inherit",
	shell: true,
});
process.exit(status ?? 1);
