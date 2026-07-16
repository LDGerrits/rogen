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
import { Config } from "./types.js";
import { version } from "./constants.js";

async function main(): Promise<void> {
	const cliArgs = parseCliArgs();

	if (cliArgs.help) {
		printHelp();
		process.exit(0);
	}

	if (cliArgs.version) {
		console.log(`rogen ${version}`);
		process.exit(0);
	}

	if (cliArgs.init) {
		const cwd = process.cwd();
		const targetPath = path.resolve(cwd, ".rogen.json");

		if (fs.existsSync(targetPath)) {
			console.error(
				`\n❌ Initialization Failed: A .rogen.json file already exists in this directory.\n`
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

		delete config.exclude;
		delete config.aliases;
		delete config.verbatim;
		delete config.casing;
		delete config.unwrap;

		fs.writeFileSync(targetPath, JSON.stringify(config, null, "\t"));
		console.log(
			`\n✅ Successfully created .rogen.json in the current directory.\n\n`
		);
		process.exit(0);
	}

	const configPath = resolveConfigPath(cliArgs.config);
	const { config, anchor } = loadConfig(configPath, cliArgs.template);

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

	await execute(
		sourcePaths,
		env,
		activeModes,
		config.template,
		config,
		cliArgs,
		anchor
	);

	if (cliArgs.watch) {
		console.log(
			`\n👀 Watching for file changes in: "${sourceDirs.join(", ")}" (Press Ctrl+C to stop)...\n`
		);

		const watcher = chokidar.watch(sourcePaths, {
			persistent: true,
			ignoreInitial: true,
		});

		let debounceTimeout: NodeJS.Timeout;

		watcher.on("all", () => {
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(() => {
				execute(
					sourcePaths,
					env,
					activeModes,
					config.template,
					config,
					cliArgs,
					anchor
				).catch((err) => {
					console.error(
						`\n❌ Watcher Error: ${err instanceof Error ? err.message : String(err)}\n`
					);
				});
			}, 100);
		});

		watcher.on("error", (error) =>
			console.error(`\n❌ Watcher Error: ${error}\n`)
		);

		await new Promise(() => {}); // Keep alive
	}
}

export default function run(): void {
	main().catch((error) => {
		console.error(`\n❌ Fatal Error: ${error.message}\n`);
		process.exit(1);
	});
}
