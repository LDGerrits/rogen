import fs from "fs";
import path from "path";
import { build } from "./build.js";
import { CliArgs, Environment, Config, RojoTree } from "./types.js";
import { ActiveMode } from "./config.js";

function getTimeStamp(): string {
	const now = new Date();
	const h = String(now.getHours()).padStart(2, "0");
	const m = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	return `[${h}:${m}:${s}]`;
}

export async function execute(
	sourcePaths: string[],
	env: Environment,
	activeModes: ActiveMode[],
	baseProjectTree: RojoTree,
	config: Config,
	cliArgs: CliArgs,
	anchor: string
): Promise<void> {
	try {
		for (const activeMode of activeModes) {
			const targetConfig = activeMode.config;
			const modeName = activeMode.name;

			const buildResult = await build(
				targetConfig,
				baseProjectTree,
				config,
				env,
				sourcePaths,
				cliArgs,
				anchor
			);
			const dropped: string[] = [];

			if (buildResult.missingPaths.length > 0) {
				for (const item of buildResult.missingPaths) {
					const ext = path.extname(item.absolutePath).toLowerCase();
					if (ext === ".luau" || ext === ".lua") {
						const dir = path.dirname(item.absolutePath);
						if (!fs.existsSync(dir)) {
							fs.mkdirSync(dir, { recursive: true });
						}
						fs.writeFileSync(item.absolutePath, "");
					} else if (ext === "") {
						if (!fs.existsSync(item.absolutePath)) {
							fs.mkdirSync(item.absolutePath, {
								recursive: true,
							});
						}
					} else {
						delete item.parent[item.key];
						dropped.push(`${item.treePath} ($path "${item.path}")`);
					}
				}
			}

			const finalContent = JSON.stringify(buildResult.tree, null, 2);
			let shouldWrite = true;

			if (fs.existsSync(buildResult.output)) {
				const existingContent = fs.readFileSync(
					buildResult.output,
					"utf-8"
				);
				if (existingContent === finalContent) {
					shouldWrite = false;
				}
			}

			if (!shouldWrite) continue;

			const outputDir = path.dirname(buildResult.output);
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			fs.writeFileSync(buildResult.output, finalContent);

			const timeStamp = getTimeStamp();

			const totalRemoved = buildResult.removed.length + dropped.length;
			if (totalRemoved > 0) {
				if (cliArgs.watch) {
					console.log(
						`${timeStamp} ⚠️ Pruned ${totalRemoved} unresolvable paths.`
					);
				} else {
					console.log(
						`\n${timeStamp} ⚠️ Removed entries whose paths do not exist (checked relative to ${path.dirname(buildResult.output)}):`
					);
					for (const item of buildResult.removed) {
						console.log(
							`   - ${item.treePath} ($path "${item.rojoPath}")`
						);
					}
					for (const item of dropped) {
						console.log(`   - ${item}`);
					}
				}
			}

			if (buildResult.collisions.length > 0) {
				for (const collision of buildResult.collisions) {
					console.log(`${timeStamp} ⚠️ ${collision}`);
				}
			}

			if (cliArgs.watch) {
				const outputName = path.basename(buildResult.output);
				const envString =
					targetConfig.env.length > 0
						? ` (env: ${targetConfig.env.join(", ")})`
						: "";
				console.log(
					`${timeStamp} ✅ Built "${buildResult.name}" [${modeName}]${envString} (${buildResult.fileCount} files) -> ${outputName}`
				);
			} else {
				console.log(
					`\n${timeStamp} ✅ Successfully generated Rojo tree for "${buildResult.name}"`
				);
				console.log(
					`   ▶ Processed: ${buildResult.fileCount} source files`
				);
				console.log(`   ▶ Build Dir: ${buildResult.buildDir}`);
				if (targetConfig.env.length > 0) {
					console.log(
						`   ▶ knownEnvs: ${targetConfig.env.join(", ")}`
					);
				}
				console.log(`   ▶ Output To: ${buildResult.output}\n`);
			}
		}
	} catch (error) {
		const timeStamp = getTimeStamp();

		if (error instanceof Error) {
			console.error(`\n${timeStamp} ❌ Build Failed: ${error.message}\n`);
		} else {
			console.error(`\n${timeStamp} ❌ Build Failed: Unknown Error\n`);
		}
	}
}
