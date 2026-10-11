import path from "path";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { PackageManager } from "./toolchain.js";

/** A test runner's name, as `init` says it, and how a package source names it: as a whole path segment, so `ts-jest` is no runner. */
const RUNNERS = [
	{ name: "Jest", pattern: /(?:^|\/)jest(?:-[a-z]+)?(?:@|$)/i },
	{ name: "TestEZ", pattern: /(?:^|\/)testez(?:@|$)/i },
] as const;

const NPM_SECTIONS = ["dependencies", "devDependencies"];
const TOML_SECTION = /^\s*\[([^\]]*)\]/;
const TOML_STRING = /"([^"]*)"/g;

/** The test runner a workspace's package manifests name, which tells that it has specs a release can leave out. */
export class TestRunnerDetector {
	constructor(private readonly fileSystemService: FileReader) {}

	/** The first runner a manifest in `cwd` depends on, or `undefined` when none does. */
	async detect(cwd: string): Promise<string | undefined> {
		const [npm, ...toml] = await Promise.all(
			[
				"package.json",
				...PackageManager.PRIORITY.map(({ manifest }) => manifest),
			].map((name) => this.read(path.join(cwd, name)))
		);
		const packages = [
			...TestRunnerDetector.npmPackages(npm),
			...toml.flatMap((text) => TestRunnerDetector.tomlPackages(text)),
		];
		return RUNNERS.find(({ pattern }) =>
			packages.some((name) => pattern.test(name))
		)?.name;
	}

	private async read(file: string): Promise<string | undefined> {
		if (!(await this.fileSystemService.exists(file))) return undefined;
		try {
			return await this.fileSystemService.readFile(file);
		} catch {
			return undefined;
		}
	}

	/** The strings under a `dependencies` table of a manifest, which name the packages. */
	private static tomlPackages(text: string | undefined): string[] {
		let inDependencies = false;
		const sources: string[] = [];
		for (const line of (text ?? "").split("\n")) {
			const section = TOML_SECTION.exec(line);
			if (section) inDependencies = /dependencies/i.test(section[1]);
			else if (inDependencies) {
				for (const [, source] of line.matchAll(TOML_STRING))
					sources.push(source);
			}
		}
		return sources;
	}

	private static npmPackages(text: string | undefined): string[] {
		if (text === undefined) return [];
		try {
			const manifest = JSON.parse(text) as Record<string, unknown>;
			return NPM_SECTIONS.flatMap((section) => {
				const dependencies = manifest[section];
				return typeof dependencies === "object" && dependencies
					? Object.keys(dependencies)
					: [];
			});
		} catch {
			return [];
		}
	}
}
