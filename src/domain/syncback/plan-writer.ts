import path from "path";
import { failureReason } from "../../base/errors.js";
import { PathSet, samePath, toNative } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { ConfigLocations, WriteService } from "../write/write-service.js";
import { instanceKey } from "../roblox/roblox.js";
import { Expected, MirrorPlan, Operation } from "./mirror-plan.js";
import { landingMiss } from "./draft-routing.js";
import {
	SyncbackRequest,
	SyncbackResult,
	UnplacedInstance,
} from "./syncback.js";

export class PlanWriter {
	constructor(
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@WriteService private readonly writeService: WriteService
	) {}

	async write(
		request: SyncbackRequest,
		plan: MirrorPlan
	): Promise<SyncbackResult> {
		const done = await this.apply(plan);
		const warnings = await this.verify(
			request,
			plan.expected.filter(({ file }) => !done.failed.has(file))
		);
		return {
			project: request.project,
			changes: plan.changes.filter(({ file }) => !done.failed.has(file)),
			listed: plan.listed.filter(({ file }) => !done.failed.has(file)),
			unplaced: [...plan.unplaced, ...done.unplaced],
			compiled: plan.compiled,
			warnings,
		};
	}

	private async apply(plan: MirrorPlan): Promise<{
		failed: Set<string>;
		unplaced: UnplacedInstance[];
	}> {
		const failed = new Set<string>();
		const unplaced: UnplacedInstance[] = [];
		const order = { write: 0, folder: 0, remove: 1, prune: 2 } as const;
		const writes = plan.operations.filter(({ kind }) => kind === "write");
		const created = new PathSet(
			plan.operations
				.filter(({ kind }) => kind === "write" || kind === "folder")
				.map(({ file }) => file)
		);
		// A rename that only changes case writes the old file where the file
		// system folds case, so the old file takes the new name first.
		const rank = (operation: Operation) =>
			operation.kind === "remove" && created.has(operation.file)
				? -1
				: order[operation.kind];
		const operations = [...plan.operations].sort(
			(a, b) => rank(a) - rank(b)
		);
		let mayRemoveOldFiles = true;
		for (const operation of operations) {
			if (!mayRemoveOldFiles && operation.kind === "remove") {
				failed.add(operation.file);
				unplaced.push({
					instance: operation.instance,
					reason: `${operation.file} was kept, since another file could not be written`,
				});
				continue;
			}
			try {
				if (operation.kind === "write")
					await this.fileSystemService.writeFileBytes(
						operation.file,
						operation.bytes
					);
				else if (operation.kind === "folder")
					await this.fileSystemService.createDirectory(
						operation.file
					);
				else if (operation.kind === "remove") {
					const renamed = writes.find(({ file }) =>
						samePath(file, operation.file)
					);
					if (renamed)
						await this.fileSystemService.rename(
							operation.file,
							renamed.file,
							true
						);
					else await this.fileSystemService.delete(operation.file);
				} else if (await this.isEmptyFolder(operation.file))
					await this.fileSystemService.delete(operation.file, true);
			} catch (error) {
				if (operation.kind === "write" || operation.kind === "folder")
					mayRemoveOldFiles = false;
				failed.add(operation.file);
				unplaced.push({
					instance: operation.instance,
					reason: `${operation.file} could not be changed: ${failureReason(error as Error)}`,
				});
			}
		}
		return { failed, unplaced };
	}

	private async isEmptyFolder(dir: string): Promise<boolean> {
		const entries = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(dir)
		);
		if (entries.isErr()) return false;
		for (const [name, type] of entries.value)
			if (
				!isDirectoryType(type) ||
				!(await this.isEmptyFolder(path.join(dir, name)))
			)
				return false;
		return true;
	}

	private async verify(
		request: SyncbackRequest,
		expected: readonly Expected[]
	): Promise<Diagnostic[]> {
		if (expected.length === 0 || request.project.compiledPath !== undefined)
			return [];
		const located = await this.writeService.locate(request.selection, {
			args: expected.map(({ file }) => file),
			cwd: request.cwd,
		});
		if (located.isErr()) return [];
		const warnings: Diagnostic[] = [];
		const here: ConfigLocations | undefined = located.value.configs.find(
			({ config }) => config.id === request.project.id
		);
		for (const landing of expected) {
			const { file, instance } = landing;
			if (
				landingMiss(
					landing,
					here?.files ?? [],
					request.project.syncRules
				) === undefined
			)
				continue;
			const location = here?.files.find(
				({ source }) => toNative(source) === file
			);
			const found = location?.status === "placed" ? location : undefined;
			warnings.push(
				warningDiagnostic(
					"syncback.misplaced",
					{ resource: file },
					found
						? `this file was written for ${instanceKey(instance)}, and lands at ${instanceKey(found.instancePath)}. Move it to where routing puts it at ${instanceKey(instance)}.`
						: `this file was written for ${instanceKey(instance)}, and no instance comes from it. Check the routes of ${request.project.label}.`
				)
			);
		}
		return warnings;
	}
}
