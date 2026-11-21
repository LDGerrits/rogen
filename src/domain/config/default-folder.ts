import { RojoFile } from "../rojo/rojo.js";
import { isDefaultConfigFileName } from "./config.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { PickedFolder } from "./core-config-selection.js";

export type DefaultFolderState = "adopting" | "configured";

export class DefaultFolder implements PickedFolder {
	constructor(
		readonly directory: string,
		private readonly discovery: ConfigDiscovery,
		private state: DefaultFolderState
	) {}

	async list(): Promise<readonly string[]> {
		const [config] = await this.discovery.defaultConfigs(this.directory);
		if (config) this.state = "configured";
		if (this.state === "configured") return config ? [config] : [];
		const project = await this.discovery.adoptable(this.directory);
		return project ? [project] : [];
	}

	holds(fileName: string): boolean {
		return (
			isDefaultConfigFileName(fileName) ||
			(this.state === "adopting" &&
				RojoFile.DEFAULT_PROJECTS.includes(fileName))
		);
	}
}
