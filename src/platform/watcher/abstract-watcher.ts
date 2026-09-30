import { AbstractDisposable } from "../../base/disposable.js";
import { onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { FileChange } from "../fs/file-events.js";
import { LogService } from "../log/log-service.js";
import { WatchOptions, WatchRequest, Watcher } from "./watcher.js";

/** The events and disposal every watcher shares; a subclass reports what it sees through `fireChange` and `fireError`. */
export abstract class AbstractWatcher
	extends AbstractDisposable
	implements Watcher
{
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeFile = this._register(
		new Emitter<FileChange[]>()
	);
	readonly onDidChangeFile: Event<FileChange[]> = this._onDidChangeFile.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	constructor(protected readonly logService: LogService) {
		super();
	}

	/** Replaces whatever was being watched. */
	async watch(
		requests: WatchRequest[],
		options: WatchOptions = {}
	): Promise<void> {
		this.logService.debug(
			`Started watching paths: ${requests.map(({ path }) => path).join(", ")}`
		);
		await this.startWatching(requests, options);
	}

	abstract stop(): Promise<void>;

	protected abstract startWatching(
		requests: WatchRequest[],
		options: WatchOptions
	): Promise<void>;

	protected fireChange(change: FileChange): void {
		this._onDidChangeFile.fire([change]);
	}

	protected fireError(error: Error): void {
		this._onDidError.fire(error);
	}

	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}
}
