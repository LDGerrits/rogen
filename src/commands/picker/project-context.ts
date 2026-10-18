import path from "path";
import { toPosix } from "../../base/path.js";
import { CONFIG_FILE_NAMES } from "../../domain/config/config.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	FileReader,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { ProductService } from "../../platform/product/product-service.js";
import { PickerProject } from "./command-picker.js";

const FILE_DEPTH = 3;
const FILES_SHOWN = 20;

/** The folder the picker runs in, as the services see it. */
export class ProjectContext implements PickerProject {
	constructor(
		private readonly configService: ConfigService,
		private readonly fileReader: FileReader,
		private readonly productService: ProductService,
		private readonly cwd: string
	) {}

	async describe(): Promise<{
		readonly version: string;
		readonly name: string | undefined;
	}> {
		return {
			version: await this.productService.readVersion(),
			name: await this.projectName(),
		};
	}

	/** The name of the project the commands here answer for; the folder's, when its config doesn't load. */
	private async projectName(): Promise<string | undefined> {
		const selected = await this.configService.select([]);
		const loaded = selected.isOk() ? selected.value.configs[0] : undefined;
		if (loaded) return loaded.projectName;
		const folder = (await this.hasConfig(this.cwd))
			? this.cwd
			: (await this.configService.findEnclosing(this.cwd))?.directory;
		return folder === undefined ? undefined : path.basename(folder);
	}

	private async hasConfig(folder: string): Promise<boolean> {
		for (const name of CONFIG_FILE_NAMES)
			if (await this.fileReader.isFile(path.join(folder, name)))
				return true;
		return false;
	}

	async files(extensions: readonly string[]): Promise<readonly string[]> {
		const found: string[] = [];
		const visit = async (directory: string, depth: number) => {
			for (const [name, type] of await this.fileReader.readDirectory(
				directory
			)) {
				if (found.length >= FILES_SHOWN) return;
				const full = path.join(directory, name);
				if (isDirectoryType(type)) {
					if (
						depth < FILE_DEPTH &&
						!name.startsWith(".") &&
						name !== "node_modules"
					)
						await visit(full, depth + 1);
				} else if (
					extensions.includes(path.extname(name).toLowerCase())
				)
					found.push(toPosix(path.relative(this.cwd, full)));
			}
		};
		await visit(this.cwd, 0);
		return found;
	}
}
