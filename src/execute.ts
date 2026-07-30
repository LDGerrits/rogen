import fs from "fs";
import path from "path";
import { build } from "./build.js";
import { CliArgs, Environment, Config, RojoTree } from "./types.js";
import { ActiveMode } from "./config.js";
import { Logger, ConsoleLogger, getTimeStamp } from "./logger.js";

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

			if (buildResult.exposedDataFiles.length > 0) {
				logger.warn(
					`${getTimeStamp()} [${modeName}] Skipping project file generation. Rogen cannot map data files directly.`
				);
				for (const exposedPath of buildResult.exposedDataFiles) {
					const ext = path.extname(exposedPath);
					const fileName = path.basename(exposedPath);
					const baseName = fileName.substring(
						0,
						fileName.length - ext.length
					);
					const dirName = path.dirname(exposedPath);

					logger.info(
						`  - Cannot resolve data type "${ext}" for: "${exposedPath}"`
					);
					logger.info(
						`    Fix: Wrap it in a folder (e.g., move it to "${dirName}/${baseName}/data${ext}")`
					);
				}
				continue;
			}

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
					`[${modeName}] Rebuilt "${buildResult.name}" -> ${outputName}`
				);
			} else {
				logger.success(`Generated Rojo tree for "${buildResult.name}"`);
				logger.info(`  Processed: ${buildResult.fileCount} files`);
				logger.info(`  Build dir: ${buildResult.buildDir}`);
				const activeTags = Object.keys(targetConfig.tags || {}).filter(
					(t) => targetConfig.tags[t]
				);
				if (activeTags.length > 0) {
					logger.info(`  Tags: ${activeTags.join(", ")}`);
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
