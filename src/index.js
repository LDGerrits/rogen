const fs = require("fs");
const path = require("path");
const { printHelp, parseCliArgs } = require("./cli");
const { resolveConfigPath, loadAndValidateConfig, loadProjectTree, getEnvironment, resolveActiveModes } = require("./config");
const { execute } = require("./core/pipeline");

async function main() {
	const cliArgs = parseCliArgs();

	if (cliArgs.help) {
		printHelp();
		process.exit(0);
	}

	const configPath = resolveConfigPath(cliArgs.config);
	const { config, hasConfig } = loadAndValidateConfig(configPath);
	
	const source = cliArgs.source || config.source || "src";
	const sourcePath = path.resolve(process.cwd(), source);
	
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`Source directory not found: ${sourcePath}`);
	}

	const env = getEnvironment();
	const activeModes = resolveActiveModes(config, hasConfig, cliArgs.mode, env);
	const baseProjectTree = loadProjectTree(cliArgs.template, config.template);

	execute(sourcePath, env, activeModes, baseProjectTree, config, cliArgs);

	if (cliArgs.watch) {
		console.log(`Rogen watching for file changes in "${source}"... (Press Ctrl+C to stop)`);
		
		let debounceTimeout;
		fs.watch(sourcePath, { recursive: true }, (_, filename) => {
			if (!filename) return;
			clearTimeout(debounceTimeout);
			debounceTimeout = setTimeout(() => {
				execute(sourcePath, env, activeModes, baseProjectTree, config, cliArgs);
			}, 100);
		});
		
		await new Promise(() => {}); // Keep alive
	}
}

module.exports = () => {
	main().catch((error) => {
		console.error(`\nBuild Failed: ${error.message}\n`);
		process.exit(1);
	});
};