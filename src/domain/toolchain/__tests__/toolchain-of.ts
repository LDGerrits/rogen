import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { CoreToolchainService } from "../core-toolchain-service.js";

/** A toolchain service over `fs`, built as Rogen builds it. */
export function toolchainOf(fs: FileSystemService): CoreToolchainService {
	return instantiationOf([FileSystemService, fs]).createInstance(
		CoreToolchainService
	);
}
