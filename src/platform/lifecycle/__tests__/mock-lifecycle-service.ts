import { Emitter, Event } from "../../../base/event.js";
import { LifecycleService } from "../lifecycle-service.js";

export class MockLifecycleService implements LifecycleService {
	declare readonly _serviceBrand: undefined;

	private readonly _onWillShutdown = new Emitter<void>();
	readonly onWillShutdown: Event<void> = this._onWillShutdown.event;

	shutdown(): void {
		this._onWillShutdown.fire();
	}
}
