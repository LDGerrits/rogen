import path from "path";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { Donor, NewStyle, Style, SyncbackLayout } from "./syncback-layout.js";

/** An instance the place holds that no file of the project makes. */
export interface NewInstance {
	/** The instance path of the node it is a child of. */
	readonly parent: readonly string[];
	readonly name: string;
	/** Whether it is a folder of other instances rather than a file. */
	readonly folder: boolean;
	/** Its files, each as the path from its own file or folder down. */
	readonly files?: readonly (readonly string[])[];
}

/** The route spelled into the names of what is written, such as `@server`. */
export interface Mark {
	readonly text: string;
	/** The route key it spells. */
	readonly route: string;
}

/** Where a new instance is written, as the folder it goes into. */
export interface NewHome {
	/** Absolute POSIX path of the folder to write into. */
	readonly dir: string;
	/** For a folder: its files go into `dir` and the folder itself is not made, as the routing folder is the folder. */
	readonly contents: boolean;
	readonly mark?: Mark;
}

export type NewPlacement =
	| { readonly kind: "placed"; readonly home: NewHome }
	| { readonly kind: "conflict"; readonly reason: string };

const conflict = (reason: string): NewPlacement => ({
	kind: "conflict",
	reason,
});

/** The name of the instance a file is, for a file of a folder as for a file of its own. */
export const instanceNameOf = (fileName: string): string =>
	RojoFile.metaStemOf(fileName) ??
	new RojoFile(fileName, SyncRules.DEFAULT).instanceName;

/** Names Rojo gives a kind of file by, which never route a file. */
const FILE_KINDS = new Set(["meta", "model", "project"]);

const isInitFile = (file: readonly string[]) =>
	file[file.length - 1].startsWith("init.");

/** Whether an init file makes the folder instance, or a folder in it, a script. */
const holdsScript = (instance: NewInstance) =>
	(instance.files ?? []).some(isInitFile);

/** Whether an init file right in the folder makes the folder instance itself a script. */
const isScript = (instance: NewInstance) =>
	(instance.files ?? []).some(
		(file) => file.length === 2 && isInitFile(file)
	);

/** The route that puts files where `parent` is, and how deep its target is. */
type ParentRoute =
	| { readonly kind: "keyed"; readonly key: string; readonly depth: number }
	| { readonly kind: "fallback"; readonly depth: number }
	| { readonly kind: "conflict"; readonly reason: string };

/** Runs routing backwards: from the instance path of an instance the place added to the folder a file for it goes in, written like the nearest code that shows a style. */
export class ReverseRouter {
	constructor(private readonly layout: SyncbackLayout) {}

	place(instance: NewInstance): NewPlacement {
		const placement = this.placeInSources(instance);
		return placement.kind === "placed"
			? {
					...placement,
					home: {
						...placement.home,
						dir: this.layout.synced(placement.home.dir),
					},
				}
			: placement;
	}

	/** Where a file of `instance` goes in `home`: a folder's files drop the folder when the routing folder stands for it, and the mark is spelled into the name of each file, or of a folder that holds a script, as an init file can't carry one. */
	destination(
		instance: NewInstance,
		file: readonly string[],
		{ contents, mark }: NewHome
	): string[] {
		if (instance.folder) {
			if (contents) return file.slice(1);
			if (!mark) return [...file];
			if (holdsScript(instance))
				return [`${file[0]}${mark.text}`, ...file.slice(1)];
			return [
				...file.slice(0, -1),
				this.marked(file, instance.files ?? [file], mark),
			];
		}
		return mark && file[0].startsWith(instance.name)
			? [this.marked(file, instance.files ?? [file], mark)]
			: [...file];
	}

	/** The last name of `file` with the mark after its instance name, unless a script suffix of a file of the same instance already routes it there. */
	private marked(
		file: readonly string[],
		files: readonly (readonly string[])[],
		mark: Mark
	): string {
		const name = file[file.length - 1];
		const stem = instanceNameOf(name);
		const dir = file.slice(0, -1).join("/");
		const routed = files.some((other) => {
			const otherName = other[other.length - 1];
			return (
				other.slice(0, -1).join("/") === dir &&
				instanceNameOf(otherName) === stem &&
				otherName
					.slice(stem.length)
					.split(".")
					.slice(1, -1)
					.some(
						(part) =>
							!FILE_KINDS.has(part) &&
							this.layout.config.keys.resolve(part) === mark.route
					)
			);
		});
		if (routed || !name.startsWith(stem)) return name;
		return `${stem}${mark.text}${name.slice(stem.length)}`;
	}

	private placeInSources(instance: NewInstance): NewPlacement {
		const { parent } = instance;
		for (let depth = parent.length; depth >= 1; depth--) {
			const node = parent.slice(0, depth);
			const below = parent.slice(depth);
			const maker = this.layout.fileMaking(node);
			if (maker && isInitFile([path.posix.basename(maker.source)]))
				return {
					kind: "placed",
					home: {
						dir: path.posix.join(
							path.posix.dirname(maker.source),
							...below
						),
						contents: false,
					},
				};
			if (maker)
				return conflict(
					`${maker.source} makes ${node.join("/")}, and a file holds no other files; make it a folder with an init file`
				);
			const donors = this.layout.donorsAt(node);
			if (donors.length > 0) return this.besideDonors(donors, below);
		}
		return this.asNewFeature(instance);
	}

	/** Beside the files at the nearest node that has some: in the layout most of them share, a tie going to the style of the route, then of the project. */
	private besideDonors(
		donors: readonly Donor[],
		below: readonly string[]
	): NewPlacement {
		const layouts = new Map<string, { donor: Donor; count: number }>();
		for (const donor of donors) {
			const key = `${donor.dir}\0${donor.style}\0${donor.spelled ?? ""}`;
			const known = layouts.get(key);
			if (known) known.count++;
			else layouts.set(key, { donor, count: 1 });
		}
		const most = Math.max(
			...[...layouts.values()].map(({ count }) => count)
		);
		let tied = [...layouts.values()]
			.filter(({ count }) => count === most)
			.map(({ donor }) => donor);
		for (const style of this.tieBreakers(tied[0].route)) {
			if (tied.length === 1) break;
			const styled = tied.filter((donor) => donor.style === style);
			if (styled.length > 0) tied = styled;
		}
		if (tied.length > 1)
			return conflict(
				`files beside it are in more than one place, as many in each: ${tied.map(({ dir }) => dir).join(", ")}`
			);
		const [donor] = tied;
		return {
			kind: "placed",
			home: {
				dir: path.posix.join(donor.dir, ...below),
				contents: false,
				...(donor.style === "suffix" && {
					mark: {
						text: `@${donor.spelled ?? donor.route}`,
						route: donor.route,
					},
				}),
			},
		};
	}

	/** The style the files of `route` are written in most, else the whole project's, else folders. */
	private styleFor(route: string): NewStyle {
		return this.layout.styleOf(route) ?? this.layout.styleOf() ?? "folder";
	}

	/** The styles that break a tie, in order: the route's, the project's, then each style in a fixed order. */
	private tieBreakers(route: string): Style[] {
		return [
			this.layout.styleOf(route),
			this.layout.styleOf(),
			"folder",
			"suffix",
			"marker",
			"fallback",
		].filter((style): style is Style => style !== undefined);
	}

	private routeTo(parent: readonly string[]): ParentRoute {
		const { config } = this.layout;
		const candidates = [...config.routes]
			.filter(([, target]) =>
				target.instancePath.every((part, at) => parent[at] === part)
			)
			.map(([key, target]) => ({
				key,
				depth: target.instancePath.length,
			}));
		if (candidates.length === 0)
			return {
				kind: "conflict",
				reason: "no route puts files where its parent is",
			};
		const depth = Math.max(
			...candidates.map((candidate) => candidate.depth)
		);
		const keyed = candidates.filter(
			(candidate) => candidate.depth === depth && candidate.key !== "*"
		);
		if (keyed.length > 1)
			return {
				kind: "conflict",
				reason: `more than one route puts files there: ${keyed.map(({ key }) => key).join(", ")}`,
			};
		return keyed.length === 0
			? { kind: "fallback", depth }
			: { kind: "keyed", key: keyed[0].key, depth };
	}

	private asNewFeature(instance: NewInstance): NewPlacement {
		const { parent, name, folder } = instance;
		const roots = this.layout.sourcePaths;
		const route = this.routeTo(parent);
		const below =
			route.kind === "conflict" ? [] : parent.slice(route.depth);
		const root =
			this.layout.sourcePathHolding(path.posix.join(...below, name)) ??
			this.layout.ownSourcePath;
		if (root === undefined)
			return conflict(
				roots.length === 0
					? "the project has no source path"
					: `no file beside it says which source path holds it: ${roots.join(", ")}`
			);
		if (route.kind === "conflict") return conflict(route.reason);
		if (route.kind === "fallback")
			return {
				kind: "placed",
				home: { dir: path.posix.join(root, ...below), contents: false },
			};
		if (this.styleFor(route.key) === "suffix")
			return {
				kind: "placed",
				home: {
					dir: path.posix.join(root, ...below),
					contents: false,
					mark: {
						text: `@${this.layout.spellingOf(route.key)}`,
						route: route.key,
					},
				},
			};
		const routingFolder = this.layout.folderNameFor(route.key);
		return {
			kind: "placed",
			home:
				folder && !isScript(instance)
					? {
							dir: path.posix.join(
								root,
								...below,
								name,
								routingFolder
							),
							contents: true,
						}
					: {
							dir: path.posix.join(root, ...below, routingFolder),
							contents: false,
						},
		};
	}
}
