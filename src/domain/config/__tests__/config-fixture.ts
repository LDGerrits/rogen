import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../resolved-config.js";
import { ReloadableSelection, buildableConfig } from "../config-service.js";
import { CoreConfigService } from "../core-config-service.js";

export interface Refs {
	readonly names?: string[];
}

export let fs: MemoryFileSystemService;
export let service: CoreConfigService;
export let selection: ReloadableSelection;

export function useConfigFixture(): void {
	beforeEach(() => useFileSystem(new MemoryFileSystemService()));
}

export async function useFileSystem(
	next: MemoryFileSystemService,
	home = "/repo"
): Promise<void> {
	fs = next;
	await fs.createDirectory(home);
	service = new CoreConfigService(fs, new MockEnvironmentService(home));
}

export const write = (file: string, config: Record<string, unknown> | string) =>
	fs.writeFile(
		file,
		typeof config === "string" ? config : JSON.stringify(config)
	);

export const plain = (config: ResolvedConfig | undefined) =>
	config && {
		file: config.file,
		name: config.projectName,
		sourcePaths: config.sourcePaths,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, String(target)])
		),
		ignored: config.ignored,
		syncPath: config.syncPath,
		projectFile: config.projectFile,
		project: config.project.getFile(),
	};

export const start = async ({ names = [] }: Refs = {}, cwd = "/repo") => {
	service = new CoreConfigService(fs, new MockEnvironmentService(cwd));
	const result = await service.select(names);
	if (result.isOk()) selection = result.value;
	return result;
};

export const resolved = (index = 0) =>
	buildableConfig(selection.entries[index]);

export const errors = (index = 0) => {
	const entry = selection.entries[index];
	return entry.status === "broken" ? entry.errors : [];
};
