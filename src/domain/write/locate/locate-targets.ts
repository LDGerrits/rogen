import path from "path";
import { toPosix } from "../../../base/path.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { RojoFile } from "../../rojo/rojo.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { Asked, LocateQuery } from "../write-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { OnDiskCase } from "../../../platform/fs/on-disk-case.js";

export interface Targets {
	readonly paths: readonly string[];
	readonly folders: ReadonlySet<string>;
	readonly instances: readonly InstanceReference[];
	readonly asked: readonly Asked[];
}

/** Windows' `\\?\` prefix names the same file as the path without it. */
function withoutExtendedPrefix(posix: string): string {
	return posix.replace(/^\/\/\?\/(UNC\/)?/, (_prefix, unc) =>
		unc ? "//" : ""
	);
}

export class LocateTargets {
	private readonly onDiskCase: OnDiskCase;

	constructor(
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {
		this.onDiskCase = new OnDiskCase(fileSystemService);
	}

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
				const arg = await this.withoutPosition(
					withoutExtendedPrefix(toPosix(given)),
					cwd
				);
				const resolved = await this.onDiskCase.of(
					path.resolve(cwd, arg)
				);
				paths.push(resolved);
				asked.push({ path: toPosix(resolved) });
				if (arg.endsWith("/")) folders.add(toPosix(resolved));
			}
		}
		return { paths, folders, instances, asked };
	}
}
