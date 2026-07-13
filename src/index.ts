import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { printHelp, parseCliArgs } from "./cli.js";
import { resolveConfigPath, loadAndValidateConfig, loadProjectTree, getEnvironment, resolveActiveModes } from "./config.js";
import { execute } from "./execute.js";
import { defaultConfig } from "./constants.js";

async function main(): Promise<void> {
	const cliArgs = parseCliArgs();

	if (cliArgs.help) {
		printHelp();
		process.exit(0);
	}

	if (cliArgs.init) {
		const targetPath = path.resolve(process.cwd(), ".rogen.json");
		
		if (fs.existsSync(targetPath)) {
			console.error(`\n❌ Initialization Failed: A .rogen.json file already exists in this directory.\n`);
			process.exit(1);
		}

		fs.writeFileSync(targetPath, JSON.stringify(defaultConfig, null, '\t'));
		console.log(`\n✅ Successfully created .rogen.json in the current directory.\n\n`);
		process.exit(0);
	}

	const configPath = resolveConfigPath(cliArgs.config);
	const { config, hasConfig, anchor } = loadAndValidateConfig(configPath);
	
	const rawSources = cliArgs.source || config.source || ["src"];
	const sourceDirs = Array.isArray(rawSources) ? rawSources : [rawSources];
	const resolveBase = cliArgs.source ? process.cwd() : anchor;

	const sourcePaths = sourceDirs.map(s => {
		const sourcePath = path.resolve(resolveBase, s);
		if (!fs.existsSync(sourcePath)) {
			throw new Error(`Source directory not found: ${sourcePath}`);
		}
		return sourcePath;
	});

	const env = getEnvironment(anchor, cliArgs.mode);
	const activeModes = resolveActiveModes(config, hasConfig, cliArgs.mode, env);
	const baseProjectTree = loadProjectTree(anchor, cliArgs.template, config.template);

	await execute(sourcePaths, env, activeModes, baseProjectTree, config, cliArgs, anchor);

	if (cliArgs.watch) {
		console.log(`\n👀 Watching for file changes in: "${sourceDirs.join(', ')}" (Press Ctrl+C to stop)...\n`);

		const watcher = chokidar.watch(sourcePaths, {
			persistent: true,
			ignoreInitial: true
		});

		let debounceTimeout: NodeJS.Timeout;

		watcher.on('all', () => {
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(() => {
				execute(sourcePaths, env, activeModes, baseProjectTree, config, cliArgs, anchor).catch(err => {
					console.error(`\n❌ Watcher Error: ${err instanceof Error ? err.message : String(err)}\n`);
				});
			}, 100);
		});

		watcher.on('error', (error) => console.error(`\n❌ Watcher Error: ${error}\n`));
		
		await new Promise(() => {}); // Keep alive
	}
}

export default function run(): void {
	main().catch((error) => {
		console.error(`\n❌ Fatal Error: ${error.message}\n`);
		process.exit(1);
	});
}