import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { printHelp, parseCliArgs } from "./cli.js";
import {
	resolveConfigPath,
	loadConfig,
	getEnvironment,
	resolveActiveModes,
	createFallbackConfig,
} from "./config.js";
import { execute } from "./execute.js";
import { Config, Mode } from "./types.js";
import { version } from "./constants.js";
import { ConsoleLogger } from "./logger.js";

async function main(): Promise<void> {
	const logger = new ConsoleLogger();
	const cliArgs = parseCliArgs(process.argv.slice(2), logger);

	if (cliArgs.help) {
		printHelp(logger);
		process.exit(0);
	}

	if (cliArgs.version) {
		logger.info(`rogen ${version}`);
		process.exit(0);
	}

	if (cliArgs.init) {
		const cwd = process.cwd();
		const targetPath = path.resolve(cwd, ".rogen.json");

		if (fs.existsSync(targetPath)) {
			logger.error(
				`a .rogen.json file already exists in this directory.`
			);
			process.exit(1);
		}

		const config = createFallbackConfig(cwd) as Partial<Config>;

		const isTs = fs.existsSync(path.join(cwd, "tsconfig.json"));
		const isDarklua =
			fs.existsSync(path.join(cwd, ".darklua.json")) ||
			fs.existsSync(path.join(cwd, ".darklua.json5"));

		if (isTs) {
			delete config.luau;
		} else {
			delete config.ts;
		}

		if (!isDarklua) {
			delete config.darklua;
		}

		for (const mode of ["luau", "ts", "darklua"] as const) {
			if (config[mode]) {
				delete (config[mode] as Partial<Mode>).tags;
				delete (config[mode] as Partial<Mode>).globIgnorePaths;
			}
		}

		delete config.globIgnorePaths;
		delete config.tags;
		delete config.aliases;
		delete config.verbatim;
		delete config.casing;
		delete config.unwrap;

		fs.writeFileSync(targetPath, JSON.stringify(config, null, "\t"));
		logger.success(`Created .rogen.json in the current directory.`);
		process.exit(0);
	}

	const configPath = resolveConfigPath(cliArgs.config, logger);
	const { config, anchor } = loadConfig(configPath, cliArgs.project);

	const rawSources = cliArgs.source || config.source;
	const sourceDirs = Array.isArray(rawSources) ? rawSources : [rawSources];
	const resolveBase = cliArgs.source ? process.cwd() : anchor;

	const sourcePaths = sourceDirs.map((s) => {
		const sourcePath = path.resolve(resolveBase, s);
		if (!fs.existsSync(sourcePath)) {
			throw new Error(`Source directory not found: ${sourcePath}`);
		}
		return sourcePath;
	});

	const env = getEnvironment(anchor, cliArgs.mode);
	const activeModes = resolveActiveModes(config, cliArgs.mode, env);

	const success = await execute(
		sourcePaths,
		env,
		activeModes,
		config.project,
		config,
		cliArgs,
		anchor,
		logger
	);

	if (!success) {
		process.exit(1);
	}

	if (cliArgs.watch) {
		logger.info(
			`Watching for file changes in: "${sourceDirs.join(", ")}" (Ctrl+C to stop)`
		);

		const watcher = chokidar.watch(sourcePaths, {
			persistent: true,
			ignoreInitial: true,
		});

		let debounceTimeout: NodeJS.Timeout;
		let isBuilding = false;

		watcher.on("all", (event, filePath) => {
			logger.trace(`File change detected (${event}): ${filePath}`);
			clearTimeout(debounceTimeout);

			debounceTimeout = setTimeout(() => {
				if (isBuilding) return;

				isBuilding = true;
				try {
					execute(
						sourcePaths,
						env,
						activeModes,
						config.project,
						config,
						cliArgs,
						anchor,
						logger
					);
				} catch (err) {
					logger.error(err instanceof Error ? err : String(err));
				} finally {
					isBuilding = false;
				}
			}, 100);
		});

		watcher.on("error", (error) => logger.error(`${error}`));

		await new Promise(() => {}); // Keep alive
	}
}

export default function run(): void {
	const logger = new ConsoleLogger();
	main().catch((error) => {
		logger.error(`${error.message}`);
		process.exit(1);
	});
}
