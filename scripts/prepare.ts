import { spawnSync } from "child_process";
import fs from "fs";

// The docs site installs this workspace without dev dependencies and needs none of the generated modules.
if (!fs.existsSync("node_modules/.bin/tsx")) process.exit(0);

const { status } = spawnSync("npm", ["run", "generate"], {
	stdio: "inherit",
	shell: true,
});
process.exit(status ?? 1);
