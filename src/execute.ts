import fs from "fs";
import path from "path";
import { build } from "./build.js";
import { CliArgs, Environment, RogenConfig, RogenMode, RojoTree } from "./types.js";

export function execute(
	sourcePaths: string[], 
	env: Environment, 
	activeModes: RogenMode[], 
	baseProjectTree: RojoTree, 
	config: RogenConfig, 
	cliArgs: CliArgs
): void {
	try {
		for (const targetConfig of activeModes) {
			const buildResult = build(targetConfig, baseProjectTree, config, env, sourcePaths, cliArgs);

			// Add stub files so Rojo and the roblox-ts compiler don't crash
			if (buildResult.missingPaths.length > 0) {
				for (const item of buildResult.missingPaths) {
					const ext = path.extname(item.absolutePath).toLowerCase();
					if (ext === '.luau' || ext === '.lua') {
						const dir = path.dirname(item.absolutePath);
						if (!fs.existsSync(dir)) {
							fs.mkdirSync(dir, { recursive: true });
						} 
						fs.writeFileSync(item.absolutePath, "");
					} else if (ext === "") {
						fs.mkdirSync(item.absolutePath, { recursive: true });
					} else {
						delete item.parent[item.key];
					}
				}
			}

			const finalContent = JSON.stringify(buildResult.tree, null, 2);
			let shouldWrite = true;

			if (fs.existsSync(buildResult.output)) {
				const existingContent = fs.readFileSync(buildResult.output, "utf-8");
				if (existingContent === finalContent) shouldWrite = false;
			}

			if (shouldWrite) {
				fs.writeFileSync(buildResult.output, finalContent);
				console.log(`\nSuccess! Generated Rojo tree for "${buildResult.name}"`);
				console.log(`   Build:     ${buildResult.buildDir}`);
				console.log(`   Processed: ${buildResult.fileCount} source files`);
				console.log(`   Output:    ${buildResult.output}\n`);
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			console.error(`\nBuild Failed: ${error.message}\n`);
		} else {
			console.error(`\nBuild Failed: Unknown Error\n`);
		}
	}
}