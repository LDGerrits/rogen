import { Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { FileChange } from "../fs/file-changes.js";
import { LogService } from "../log/log-service.js";
import { WatchOptions, Watcher } from "./watcher.js";

/** The events, ordering and disposal every watcher shares; a subclass reports what it sees through `fireChange`. */
export abstract class AbstractWatcher
	extends AbstractDisposable
	implements Watcher
{
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeFile = this._register(
		new Emitter<FileChange[]>()
	);
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	/** Watches and stops run one at a time, so neither tears down a watch that is still starting. */
	private readonly operations = new Sequencer();

	constructor(protected readonly logService: LogService) {
		super();
	}

	watch(paths: readonly string[], options: WatchOptions = {}): Promise<void> {
		return this.operations.queue(async () => {
			this.logService.debug(
				`Started watching paths: ${paths.join(", ")}`
			);
			await this.stopWatching();
			await this.startWatching(paths, options);
		});
	}

	stop(): Promise<void> {
		return this.operations.queue(() => this.stopWatching());
	}

	/** Called with nothing being watched. */
	protected abstract startWatching(
		paths: readonly string[],
		options: WatchOptions
	): Promise<void>;

	protected abstract stopWatching(): Promise<void>;

	protected fireChange(change: FileChange): void {
		this._onDidChangeFile.fire([change]);
	}

	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}
}
