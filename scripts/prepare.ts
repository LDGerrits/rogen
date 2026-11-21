import { spawnSync } from "child_process";
import fs from "fs";

const devDependenciesInstalled = fs.existsSync("node_modules/.bin/tsx");

if (!devDependenciesInstalled) process.exit(0);

const { status } = spawnSync("npm", ["run", "generate"], {
	stdio: "inherit",
	shell: true,
});
process.exit(status ?? 1);
