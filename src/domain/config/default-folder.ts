import { RojoFile } from "../rojo/rojo.js";
import { isDefaultConfigFileName } from "./config.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { PickedFolder } from "./core-config-selection.js";

/** `adopting` while the folder's project file stands in for a config; `configured` once a config has been picked, for good. */
export type DefaultFolderState = "adopting" | "configured";

/** The default of a folder as a fresh run picks it, except that a project file is adopted only while no config has been picked, as it may be what that config wrote. */
export class DefaultFolder implements PickedFolder {
	private _state: DefaultFolderState;

	constructor(
		readonly directory: string,
		private readonly discovery: ConfigDiscovery,
		state: DefaultFolderState
	) {
		this._state = state;
	}

	get state(): DefaultFolderState {
		return this._state;
	}

	async list(): Promise<readonly string[]> {
		const [config] = await this.discovery.defaultConfigs(this.directory);
		if (config) this._state = "configured";
		if (this._state === "configured") return config ? [config] : [];
		const project = await this.discovery.adoptable(this.directory);
		return project ? [project] : [];
	}

	holds(fileName: string): boolean {
		return (
			isDefaultConfigFileName(fileName) ||
			(this._state === "adopting" &&
				RojoFile.DEFAULT_PROJECTS.includes(fileName))
		);
	}
}
