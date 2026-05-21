const fs = require("fs");
const path = require("path");
const { build } = require("./build");

function execute(sourcePath, env, activeModes, baseProjectTree, config, cliArgs) {
	try {
		for (const targetConfig of activeModes) {
			const buildResult = build(targetConfig, baseProjectTree, config, env, sourcePath, cliArgs);

			// Add stub files so Rojo and the roblox-ts compiler don't crash 
			if (buildResult.missingPaths.length > 0) {
				for (const item of buildResult.missingPaths) {
					const ext = path.extname(item.absolutePath).toLowerCase();
					
					if (ext === '.luau' || ext === '.lua') {
						const dir = path.dirname(item.absolutePath);
						if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
						fs.writeFileSync(item.absolutePath, "");
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
	} catch (err) {
		console.error(`\nBuild Failed: ${err.message}\n`);
	}
}

module.exports = { execute };