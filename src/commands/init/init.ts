import { Command } from "../command.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { mergeDeep } from "../../base/object.js";
import { DEFAULT_CONFIG } from "../../platform/config/config.js";
import { detectToolchain } from "../../platform/config/toolchain.js";
import { ErrorUtils } from "../../base/errors.js";
import { RojoNode } from "../../platform/rojo/tree.js";
import path from "path";
import { injectWorkspacePackages } from "../../platform/rojo/packages.js";

export class InitCommand implements Command {
	constructor(
		private readonly cwd: string,
		private readonly fileSystemService: FileSystemService
	) {}

	async execute(): Promise<Result<void, Error>> {
		const targetPath = path.resolve(this.cwd, ".rogen.json");

		if (await this.fileSystemService.exists(targetPath)) {
			return err(
				new Error(
					"A .rogen.json file already exists in this directory."
				)
			);
		}

		const toolchain = await detectToolchain(
			this.cwd,
			this.fileSystemService
		);
		const baseTreeNode: RojoNode = { $className: "DataModel" };

		await injectWorkspacePackages(
			baseTreeNode,
			toolchain,
			this.cwd,
			this.fileSystemService
		);

		const smartConfig = mergeDeep<Record<string, unknown>>(DEFAULT_CONFIG, {
			template: {
				name: path.basename(this.cwd) || "roblox-game",
				tree: baseTreeNode,
				globIgnorePaths: toolchain.isTs
					? ["**/package.json", "**/tsconfig.json"]
					: [],
			},
		});

		// Prune config
		if (toolchain.isTs) {
			delete smartConfig.luau;
		} else {
			delete smartConfig.ts;
		}
		if (!toolchain.isDarklua) {
			delete smartConfig.darklua;
		}

		delete smartConfig.globIgnorePaths;
		delete smartConfig.aliases;
		delete smartConfig.verbatim;
		delete smartConfig.casing;
		delete smartConfig.unwrap;

		// Write to disk
		try {
			const content = JSON.stringify(smartConfig, null, "\t");
			await this.fileSystemService.writeFile(targetPath, content);
			return ok(undefined);
		} catch (error) {
			return err(
				new Error(
					`Failed to write .rogen.json: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}
	}
}
