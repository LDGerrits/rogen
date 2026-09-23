import { Event } from "../../base/event.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface LifecycleService {
	readonly _serviceBrand: undefined;

	readonly onWillShutdown: Event<void>;
}

export const LifecycleService =
	createServiceIdentifier<LifecycleService>("lifecycleService");
