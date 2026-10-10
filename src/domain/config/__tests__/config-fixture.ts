import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../config.js";
import { ConfigSelection, buildableConfig } from "../config-service.js";
import { CoreConfigService } from "../core-config-service.js";

export interface Refs {
	/** Names or paths; the default config when absent. */
	readonly names?: string[];
	readonly overrides?: {
		readonly outFile?: string;
		readonly mode?: string;
		readonly variants: Record<string, boolean>;
	};
}

export let fs: MemoryFileSystemService;
export let service: CoreConfigService;
export let selection: ConfigSelection;

/** A fresh `/repo` and a config service over it before each test. */
export function useConfigFixture(): void {
	beforeEach(() => useFileSystem(new MemoryFileSystemService()));
}

/** Runs the service over `next` from `home`, for a test that needs another file system. */
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
		name: config.name,
		rootDirs: config.rootDirs,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, String(target)])
		),
		variants: config.variants,
		exclude: config.exclude,
		syncDir: config.syncDir,
		outFile: config.outFile,
		template: config.template && {
			file: config.template.file,
			project: config.template.project.getTree(),
		},
	};

/** Selects the configs `refs` names, as the matching command line would. */
export const start = async (
	{ names = ["default"], overrides }: Refs = {},
	cwd = "/repo"
) => {
	const variants = Object.entries(overrides?.variants ?? {});
	service = new CoreConfigService(fs, new MockEnvironmentService(cwd));
	const result = await service.select(names, {
		"out-file": overrides?.outFile,
		mode: overrides?.mode,
		variant: variants.filter(([, on]) => on).map(([variant]) => variant),
		"no-variant": variants
			.filter(([, on]) => !on)
			.map(([variant]) => variant),
	});
	if (result.isOk()) selection = result.value;
	return result;
};

export const resolved = (index = 0) =>
	buildableConfig(selection.entries[index]);

export const errors = (index = 0) => {
	const entry = selection.entries[index];
	return entry.status === "broken" ? entry.errors : [];
};
