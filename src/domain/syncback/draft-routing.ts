import path from "path";
import { isSameJson } from "../../base/objects.js";
import { containsPosix, toNative, toPosix } from "../../base/path.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { DraftFileReader } from "../../platform/fs/draft-file-reader.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { instanceKey } from "../roblox/roblox.js";
import { FileLocation, WriteService } from "../write/write-service.js";
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
		.some((file) => paths.some((made) => containsPosix(made, file)));

const stopsOn = ({ code, resource, message }: Diagnostic) =>
	`the write would stop on ${toNative(resource)} (${code}: ${message.replace(/\.$/, "")})`;

export function landingMiss(
	{ file, instance, folder }: Landing,
	files: readonly FileLocation[]
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
	if (landed.some((at) => isSameJson(at, instance))) return undefined;
	return landed.length > 0
		? `routing would read ${file} as ${instanceKey(landed[0])}; rename it in Studio`
		: `routing would make no instance of ${file}`;
}

export class DraftRouting {
	private readonly known: ReadonlySet<string>;

	constructor(
		private readonly request: SyncbackRequest,
		known: readonly Diagnostic[],
		@WriteService private readonly writeService: WriteService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
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
					located.files
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
		reader?: DraftFileReader
	): Promise<
		| {
				readonly files: readonly FileLocation[];
				readonly diagnostics: readonly Diagnostic[];
		  }
		| undefined
	> {
		const { request } = this;
		const located = await this.writeService.locate(
			request.selection,
			{ args, cwd: request.cwd },
			reader
		);
		if (located.isErr()) return undefined;
		return located.value.configs.find(
			({ config }) => config.id === request.project.id
		);
	}

	private draftOf(operations: readonly Operation[]): DraftFileReader {
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
		return this.instantiationService.createInstance(DraftFileReader, {
			files,
			directories,
			moves: [],
			removed,
		});
	}
}
