import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { ConfigDiscovery } from "../config-discovery.js";
import { ConfigFormatter } from "../config-formatter.js";
import { CoreConfigService } from "../core-config-service.js";

/** The config classes built as Rogen builds them, over the fakes of a test. */
export const configServiceOf = (
	fs: FileSystemService,
	environment: EnvironmentService
): CoreConfigService =>
	instantiationOf(
		[FileSystemService, fs],
		[EnvironmentService, environment]
	).createInstance(CoreConfigService);

export const discoveryOf = (
	fs: FileSystemService,
	environment: EnvironmentService
): ConfigDiscovery =>
	instantiationOf([EnvironmentService, environment]).createInstance(
		ConfigDiscovery,
		fs,
		undefined
	);

export const formatterOf = (fs: FileSystemService): ConfigFormatter =>
	instantiationOf([FileSystemService, fs]).createInstance(ConfigFormatter);
