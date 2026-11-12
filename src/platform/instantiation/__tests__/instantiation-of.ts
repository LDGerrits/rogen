import { CoreInstantiationService } from "../core-instantiation-service.js";
import { ServiceIdentifier } from "../instantiation.js";
import { ServiceCollection } from "../service-collection.js";

/** A strict instantiation service that knows the services it is given: `instantiationOf([FileSystemService, fs], [LogService, log])`. A service built from the result with `createInstance` asks for these and nothing else. */
export function instantiationOf(
	...entries: readonly (readonly [ServiceIdentifier<unknown>, unknown])[]
): CoreInstantiationService {
	return new CoreInstantiationService(
		new ServiceCollection(...entries),
		true
	);
}
