import { Disposable, toDisposable } from "../../base/disposable.js";
import { ConfigFileCheck, ConfigFolderCheck } from "./config-service.js";

export class ConfigChecks {
	private readonly fileChecks = new Set<ConfigFileCheck>();
	private readonly folderChecks = new Set<ConfigFolderCheck>();

	get file(): ReadonlySet<ConfigFileCheck> {
		return this.fileChecks;
	}

	get folder(): ReadonlySet<ConfigFolderCheck> {
		return this.folderChecks;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		this.fileChecks.add(check);
		return toDisposable(() => this.fileChecks.delete(check));
	}

	registerFolderCheck(check: ConfigFolderCheck): Disposable {
		this.folderChecks.add(check);
		return toDisposable(() => this.folderChecks.delete(check));
	}
}
