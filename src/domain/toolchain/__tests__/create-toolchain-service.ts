import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Registry } from "../../../platform/registry/registry.js";
import { CoreToolchainService } from "../core-toolchain-service.js";
import "../luau.js";
import "../roblox-ts.js";
import { Extensions, LanguageRegistry } from "../toolchain.js";

/** The real languages over `fileSystemService`, for tests that plan around a language. */
export const createToolchainService = (
	fileSystemService: FileSystemService = new MemoryFileSystemService()
) =>
	new CoreToolchainService(
		fileSystemService,
		Registry.as<LanguageRegistry>(Extensions.Languages)
	);
