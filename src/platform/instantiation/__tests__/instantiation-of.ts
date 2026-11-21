import { CoreInstantiationService } from "../core-instantiation-service.js";
import { ServiceIdentifier } from "../instantiation.js";
import { ServiceCollection } from "../service-collection.js";

export function instantiationOf(
	...entries: readonly (readonly [ServiceIdentifier<unknown>, unknown])[]
): CoreInstantiationService {
	return new CoreInstantiationService(
		new ServiceCollection(...entries),
		true
	);
}
