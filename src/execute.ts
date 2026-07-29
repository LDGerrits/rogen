import fs from "fs";
import path from "path";
import { build } from "./build.js";
import { CliArgs, Environment, Config, RojoTree } from "./types.js";
import { ActiveMode } from "./config.js";
import { Logger, ConsoleLogger } from "./logger.js";

export async function execute(
	sourcePaths: string[],
	env: Environment,
	activeModes: ActiveMode[],
	baseProjectTree: RojoTree,
	config: Config,
	cliArgs: CliArgs,
	anchor: string,
	logger: Logger = new ConsoleLogger()
): Promise<boolean> {
	try {
		for (const activeMode of activeModes) {
			const targetConfig = activeMode.config;
			const modeName = activeMode.name;

			logger.debug(
				`Executing build for mode "${modeName}" (Output: ${targetConfig.output}, Build: ${targetConfig.build})`
			);

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

			const finalContent = JSON.stringify(buildResult.tree, null, "\t");
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

			if (!shouldWrite) {
				logger.debug(
					`Skipping write for "${buildResult.output}" because content was unchanged.`
				);
				continue;
			}

			const outputDir = path.dirname(buildResult.output);
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			fs.writeFileSync(buildResult.output, finalContent);

			const totalRemoved = buildResult.removed.length + dropped.length;
			if (totalRemoved > 0) {
				if (cliArgs.watch) {
					logger.warn(`Pruned ${totalRemoved} unresolvable paths.`);
				} else {
					logger.warn(`Removed entries whose paths do not exist:`);
					for (const item of buildResult.removed) {
						logger.info(
							`  - ${item.treePath} ($path "${item.rojoPath}")`
						);
					}
					for (const item of dropped) {
						logger.info(`  - ${item}`);
					}
				}
			}

			if (buildResult.collisions.length > 0) {
				for (const collision of buildResult.collisions) {
					logger.warn(collision);
				}
			}

			if (cliArgs.watch) {
				const outputName = path.basename(buildResult.output);
				logger.success(
					` [${modeName}] Rebuilt "${buildResult.name}" -> ${outputName}`
				);
			} else {
				logger.success(`Generated Rojo tree for "${buildResult.name}"`);
				logger.info(`  Processed: ${buildResult.fileCount} files`);
				logger.info(`  Build dir: ${buildResult.buildDir}`);
				if (targetConfig.activeFlags?.length > 0) {
					logger.info(
						`  Flags: ${targetConfig.activeFlags.join(", ")}`
					);
				}
				logger.info(`  Output to: ${buildResult.output}`);
			}
		}
		return true;
	} catch (error) {
		if (error instanceof Error) {
			logger.error(`failed to execute build - ${error.message}`);
		} else {
			logger.error(`failed to execute build due to an unknown error`);
		}
		return false;
	}
}
