import { FileSystemService } from "../../fs/file-system-service.js";
import { CoreInstantiationService } from "../core-instantiation-service.js";
import { ServiceCollection } from "../service-collection.js";

/** An instantiation service that knows only the file system, enough for instance classes that ask for nothing else. */
export function instantiationOf(
	fs: FileSystemService
): CoreInstantiationService {
	const services = new ServiceCollection();
	services.set(FileSystemService, fs);
	return new CoreInstantiationService(services);
}
