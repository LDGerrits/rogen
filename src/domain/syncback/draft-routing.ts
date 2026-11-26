import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix, toNative, toPosix } from "../../base/path.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { FileDraft } from "../../platform/fs/draft-file-reader.js";
import { instanceKey } from "../roblox/roblox.js";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { FileLocation, WriteService } from "../write/write-service.js";
import { isFixedByRenaming } from "../write/write.js";
import { Expected, Operation } from "./mirror-plan.js";
import { SyncbackRequest } from "./syncback.js";

export type Landing = Expected & { readonly folder?: true };

export interface Proposal {
	readonly operations: readonly Operation[];
	readonly landings: readonly Landing[];
}

const decoder = new TextDecoder();

const keyOf = ({ code, resource, message }: Diagnostic) =>
	`${code}\0${resource}\0${message}`;

const madeBy = (
	{ operations, landings }: Proposal,
	absolute: (file: string) => string
): string[] =>
	[
		...operations
			.filter(({ kind }) => kind === "write" || kind === "folder")
			.map(({ file }) => file),
		...landings.filter(({ folder }) => folder).map(({ file }) => file),
	].map(absolute);

const isAboutAny = (diagnostic: Diagnostic, paths: readonly string[]) =>
	[
		diagnostic.resource,
		...(diagnostic.related ?? []).map(({ resource }) => resource),
	]
		.map(toPosix)
		.some((file) =>
			paths.some(
				(made) => containsPosix(made, file) || containsPosix(file, made)
			)
		);

const stopsOn = (diagnostic: Diagnostic) => {
	const { code, resource, related } = diagnostic;
	const partner = related?.[0];
	const clash = partner ? `, like ${toNative(partner.resource)}` : "";
	return `the write would stop on ${toNative(resource)} (${code}${clash}); ${
		isFixedByRenaming(diagnostic)
			? "rename it in Studio"
			: `see \`rogen help ${code}\``
	}`;
};

export function landingMiss(
	{ file, instance, folder }: Landing,
	files: readonly FileLocation[],
	rules: SyncRules
): string | undefined {
	const source = toPosix(file);
	const found = files.find((location) => location.source === source);
	if (
		found?.status === "mounted" ||
		found?.status === "inProject" ||
		found?.status === "outside"
	)
		return undefined;
	const landed =
		found?.status === "placed"
			? [found.instancePath]
			: found?.status === "empty" && found.instancePath
				? [found.instancePath]
				: [];
	if (folder)
		for (const location of files)
			if (
				location.status === "placed" &&
				containsPosix(source, location.source)
			)
				landed.push(
					...(location.folderNodes ?? [])
						.filter((node) => node.folder === source)
						.map(({ instancePath }) => instancePath)
				);
	if (folder && found?.status === "empty" && !found.instancePath)
		for (const location of files)
			if (
				location.status === "empty" &&
				location.instancePath &&
				location.source !== source &&
				containsPosix(source, location.source)
			)
				landed.push(
					location.instancePath.slice(
						0,
						location.instancePath.length -
							path.posix
								.relative(source, location.source)
								.split("/").length
					)
				);
	if (landed.some((at) => isSameJson(at, instance))) return undefined;
	if (landed.length === 0) return `routing would make no instance of ${file}`;
	const read = `routing would read ${file} as ${instanceKey(landed[0])}`;
	return RojoFile.at(file, rules).scriptSuffix !== undefined
		? `${read}; make it a ModuleScript, or move it to where that type runs`
		: `${read}; rename it in Studio`;
}

export class DraftRouting {
	private readonly known: ReadonlySet<string>;

	constructor(
		private readonly request: SyncbackRequest,
		known: readonly Diagnostic[],
		@WriteService private readonly writeService: WriteService
	) {
		this.known = new Set(known.map(keyOf));
	}

	async misses(
		operations: readonly Operation[],
		proposals: readonly Proposal[]
	): Promise<Map<Proposal, string>> {
		const misses = new Map<Proposal, string>();
		if (proposals.length === 0) return misses;
		const located = await this.locate(
			proposals.flatMap(({ landings }) =>
				landings.map(({ file }) => this.absolute(file))
			),
			this.draftOf([
				...operations,
				...proposals.flatMap(({ operations }) => operations),
			])
		);
		if (!located) {
			for (const proposal of proposals)
				misses.set(proposal, "the project would fail to load");
			return misses;
		}
		const raised = located.diagnostics.filter(
			(diagnostic) =>
				isError(diagnostic) && !this.known.has(keyOf(diagnostic))
		);
		const blocked = new Map<Proposal, string>();
		for (const proposal of proposals) {
			const made = madeBy(proposal, (file) => this.absolute(file));
			const about = raised.find((diagnostic) =>
				isAboutAny(diagnostic, made)
			);
			if (about) {
				misses.set(proposal, stopsOn(about));
				continue;
			}
			for (const landing of proposal.landings) {
				const found = located.files.find(
					({ source }) => source === this.absolute(landing.file)
				);
				if (found?.status === "blocked") {
					blocked.set(proposal, stopsOn(found.by));
					break;
				}
				const why = landingMiss(
					{ ...landing, file: this.absolute(landing.file) },
					located.files,
					this.request.project.syncRules
				);
				if (why === undefined) continue;
				misses.set(proposal, why);
				break;
			}
		}
		return misses.size > 0 ? misses : blocked;
	}

	private absolute(file: string): string {
		return toPosix(path.resolve(this.request.cwd, file));
	}

	private async locate(
		args: readonly string[],
		files: FileDraft
	): Promise<
		| {
				readonly files: readonly FileLocation[];
				readonly diagnostics: readonly Diagnostic[];
		  }
		| undefined
	> {
		const { request } = this;
		const draft = this.writeService.openDraft(files);
		try {
			const located = await draft.writeService.locate(request.selection, {
				args,
				cwd: request.cwd,
			});
			if (located.isErr()) return undefined;
			return located.value.configs.find(
				({ config }) => config.id === request.project.id
			);
		} finally {
			draft[Symbol.dispose]();
		}
	}

	private draftOf(operations: readonly Operation[]): FileDraft {
		const files = new Map<string, string>();
		const directories: string[] = [];
		const removed: string[] = [];
		for (const operation of operations)
			if (operation.kind === "write")
				files.set(
					toNative(this.absolute(operation.file)),
					decoder.decode(operation.bytes)
				);
			else if (operation.kind === "folder")
				directories.push(toNative(this.absolute(operation.file)));
			else removed.push(toNative(this.absolute(operation.file)));
		return { files, directories, moves: [], removed };
	}
}
