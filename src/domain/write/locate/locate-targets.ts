import path from "path";
import { toPosix } from "../../../base/path.js";
import { FileReader } from "../../../platform/fs/file-system-service.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { RojoFile } from "../../rojo/rojo.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { Asked, LocateQuery } from "../write-service.js";

export interface Targets {
	readonly paths: readonly string[];
	readonly folders: ReadonlySet<string>;
	readonly instances: readonly InstanceReference[];
	readonly asked: readonly Asked[];
}

/** Reads what a `check` or `where` was asked about: each argument is a path or an instance. */
export class LocateTargets {
	constructor(private readonly fileSystemService: FileReader) {}

	private async withoutPosition(arg: string, cwd: string): Promise<string> {
		const head = (/^(.+?):\d+(?::\d+)?(?:[:\s].*)?$/.exec(arg) ??
			/^(.+):$/.exec(arg))?.[1];
		if (head === undefined) return arg;
		return new RojoFile(path.basename(head), SyncRules.DEFAULT).kind !==
			undefined ||
			(await this.fileSystemService.exists(path.resolve(cwd, head)))
			? head
			: arg;
	}

	async classify({ args, cwd }: LocateQuery): Promise<Targets> {
		const paths: string[] = [];
		const folders = new Set<string>();
		const instances: InstanceReference[] = [];
		const asked: Asked[] = [];
		for (const given of args) {
			const reference = InstanceReference.parse(given);
			if (
				reference &&
				!(await this.fileSystemService.exists(
					path.resolve(cwd, reference.service)
				))
			) {
				instances.push(reference);
				asked.push({ instance: reference.text });
			} else {
				const arg = await this.withoutPosition(toPosix(given), cwd);
				const resolved = path.resolve(cwd, arg);
				paths.push(resolved);
				asked.push({ path: toPosix(resolved) });
				if (arg.endsWith("/")) folders.add(toPosix(resolved));
			}
		}
		return { paths, folders, instances, asked };
	}
}
