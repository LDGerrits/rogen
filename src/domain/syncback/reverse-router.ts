import path from "path";
import { RojoFile } from "../rojo/rojo.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { PatternMatch, RoutePatterns } from "../config/route-patterns.js";
import {
	Donor,
	GITKEEP,
	NewStyle,
	Style,
	SyncbackLayout,
} from "./syncback-layout.js";

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
interface Mark {
	readonly text: string;
	/** The route key it spells. */
	readonly route: string;
}

/** Where a new instance is written, as the folder it goes into. */
interface NewHome {
	/** Absolute POSIX path of the folder to write into. */
	readonly dir: string;
	/** For a folder: its files go into `dir` and the folder itself is not made, as the routing folder is the folder. */
	readonly contents: boolean;
	readonly mark?: Mark;
}

/** A home and whether a routing folder, marker, mark or the folder of an init script decides where its files go; otherwise their names do. */
type PlacedHome = NewHome & { readonly governed: boolean };

type NewPlacement =
	| { readonly kind: "placed"; readonly home: NewHome }
	| { readonly kind: "conflict"; readonly reason: string };

type Conflict = { readonly kind: "conflict"; readonly reason: string };

type Placing =
	{ readonly kind: "placed"; readonly home: PlacedHome } | Conflict;

const conflict = (reason: string): Conflict => ({
	kind: "conflict",
	reason,
});

/** The name of the instance a file is, for a file of a folder as for a file of its own. */
export const instanceNameOf = (fileName: string): string =>
	RojoFile.metaStemOf(fileName) ??
	new RojoFile(fileName, SyncRules.DEFAULT).instanceName;

/** An `@` and a name at the end of a name, as a route suffix is spelled. */
const AT_KEY = /@([A-Za-z][A-Za-z0-9]*)$/;

/** A folder named in parentheses, which routing leaves out of the game. */
const INVISIBLE = /^\(.+\)$/;

/** The ways a file is routed that decide for a new sibling too, whatever its name. */
const GOVERNING: ReadonlySet<string> = new Set(["folder", "marker", "suffix"]);

/** Names Rojo gives a kind of file by, which never route a file. */
const FILE_KINDS = new Set(["meta", "model", "project"]);

/** A name without the `^` that hoists it, as routing reads it. */
const unhoisted = (name: string) => name.replace(/^\^/, "");

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
		const placing = this.placeInSources(instance);
		if (placing.kind !== "placed") return placing;
		const { governed, ...home } = placing.home;
		const misread = this.misreadName(
			instance,
			governed && home.mark === undefined
		);
		if (misread !== undefined)
			return conflict(
				`routing reads its name "${misread}" as a route, so the file would land elsewhere; rename it in Studio`
			);
		const routed = governed ? home : this.routedBack(instance, home);
		if ("kind" in routed) return routed;
		return {
			kind: "placed",
			home: { ...routed, dir: this.layout.synced(routed.dir) },
		};
	}

	/** The first name of `instance` or of what it holds that routing reads as more than a name: one that starts with `^`, a folder in parentheses, an `@` that spells a route key, or a folder named after a route key where no outer route `governs` and outranks it. */
	misreadName(instance: NewInstance, governs: boolean): string | undefined {
		const { keys } = this.layout.config;
		const folders = new Set<string>();
		const names = new Set([instance.name]);
		for (const file of instance.files ?? []) {
			for (const folder of file.slice(0, -1)) folders.add(folder);
			const leaf = file[file.length - 1];
			if (!isInitFile(file) && RojoFile.metaStemOf(leaf) === undefined)
				names.add(instanceNameOf(leaf));
		}
		if (instance.folder) folders.add(instance.name);
		const atKey = (name: string) => {
			const key = AT_KEY.exec(name)?.[1];
			return key !== undefined && keys.resolve(key) !== undefined;
		};
		for (const name of [...names, ...folders])
			if (name.startsWith("^") || atKey(name)) return name;
		for (const folder of folders) {
			if (INVISIBLE.test(folder)) return folder;
			const bare = folder.startsWith("@") ? folder.slice(1) : folder;
			if (!governs && keys.resolve(bare) !== undefined) return folder;
		}
		return undefined;
	}

	/** `home`, where only the names of the instance's files decide where they go, marked with the route of where it is when a pattern or `*` would send one elsewhere. */
	private routedBack(
		instance: NewInstance,
		home: NewHome
	): NewHome | Conflict {
		if (home.mark || !instance.files) return home;
		const intended = this.targetUnder(instance.parent);
		if (intended === undefined) return home;
		const lands = this.targetsOf(instance);
		if (lands.every((target) => target === intended)) return home;
		const keys = [...this.layout.config.keys.routeKeys].filter(
			(key) =>
				this.layout.config.routes.get(key)?.instancePath.join("/") ===
				intended
		);
		if (keys.length !== 1)
			return conflict(
				`its name would route it elsewhere, and no route key names ${intended} to write it with`
			);
		return { ...home, mark: { text: `@${keys[0]}`, route: keys[0] } };
	}

	/** The target of the deepest route whose target holds `parent`, by pattern routes and `*` too. */
	private targetUnder(parent: readonly string[]): string | undefined {
		let deepest: readonly string[] | undefined;
		for (const target of this.layout.config.routes.values()) {
			const path = target.instancePath;
			if (
				path.every((part, at) => parent[at] === part) &&
				path.length > (deepest?.length ?? -1)
			)
				deepest = path;
		}
		return deepest?.join("/");
	}

	/** Where routing sends each file of `instance` when nothing but its names decide, as the write reads them: by the name of the instance it makes, which for an init script is its folder's with the script's extension, else to `*`. A meta file follows its script. */
	private targetsOf(instance: NewInstance): (string | undefined)[] {
		return (instance.files ?? [])
			.filter(
				(file) =>
					RojoFile.metaStemOf(file[file.length - 1]) === undefined
			)
			.map((file) => {
				const name = file[file.length - 1];
				if (!isInitFile(file))
					return this.targetOfName(unhoisted(name));
				const folder =
					file.length > 1 ? file[file.length - 2] : instance.name;
				return this.targetOfName(
					RoutePatterns.initName(unhoisted(folder), name)
				);
			});
	}

	private targetOfMatch(match: PatternMatch): string | undefined {
		return match.kind === "clash" ? undefined : this.targetOf(match.key);
	}

	private targetOfName(name: string): string | undefined {
		const match = this.layout.config.patterns.match(name);
		return match ? this.targetOfMatch(match) : this.fallbackTarget();
	}

	private fallbackTarget(): string | undefined {
		return this.targetOf(DeclaredKeys.FALLBACK_ROUTE);
	}

	private targetOf(key: string): string | undefined {
		return this.layout.config.routes.get(key)?.instancePath.join("/");
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
			if (file[file.length - 1] === GITKEEP)
				return [...file.slice(0, -1), mark.text, GITKEEP];
			return [
				...file.slice(0, -1),
				this.marked(file, instance.files ?? [file], mark),
			];
		}
		if (mark && !contents && file[file.length - 1] === GITKEEP)
			return [...file.slice(0, -1), mark.text, GITKEEP];
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
							this.layout.config.keys.resolveDotRoute(part) ===
								mark.route
					)
			);
		});
		if (routed || !name.startsWith(stem)) return name;
		return `${stem}${mark.text}${name.slice(stem.length)}`;
	}

	private placeInSources(instance: NewInstance): Placing {
		const { parent } = instance;
		for (let depth = parent.length; depth >= 1; depth--) {
			const node = parent.slice(0, depth);
			const below = parent.slice(depth);
			const maker = this.layout.fileMaking(node);
			const donors = this.layout.donorsAt(node);
			if (donors.length > 0) return this.besideDonors(donors, below);
			if (maker && SyncbackLayout.makesItsFolder(maker))
				return {
					kind: "placed",
					home: {
						dir: path.posix.join(
							path.posix.dirname(maker.source),
							...below
						),
						contents: false,
						governed: GOVERNING.has(maker.routeMatch),
						...(maker.routeMatch === "suffix" && {
							mark: {
								text: `@${maker.route}`,
								route: maker.route,
							},
						}),
					},
				};
			if (maker)
				return conflict(
					`${maker.source} makes ${node.join("/")}, and a file holds no other files; make it a folder with an init file`
				);
		}
		return this.asNewFeature(instance);
	}

	/** Beside the files at the nearest node that has some, an init script's children included: in the layout most of them share, a tie going to the style of the route, then of the project. */
	private besideDonors(
		donors: readonly Donor[],
		below: readonly string[]
	): Placing {
		const layouts = new Map<string, { donor: Donor; count: number }>();
		for (const donor of donors) {
			const key = `${donor.dir}\0${donor.style}\0${donor.route}`;
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
				governed: GOVERNING.has(donor.style),
				...(donor.style === "suffix" && {
					mark: {
						text: `@${donor.route}`,
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
			"pattern",
			"fallback",
		].filter((style): style is Style => style !== undefined);
	}

	private routeTo(parent: readonly string[]): ParentRoute {
		const { config } = this.layout;
		const candidates = [...config.routes]
			.filter(
				([key]) =>
					DeclaredKeys.isName(key) ||
					key === DeclaredKeys.FALLBACK_ROUTE
			)
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

	private asNewFeature(instance: NewInstance): Placing {
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
				home: {
					dir: path.posix.join(root, ...below),
					contents: false,
					governed: false,
				},
			};
		if (this.styleFor(route.key) === "suffix")
			return {
				kind: "placed",
				home: {
					dir: path.posix.join(root, ...below),
					contents: false,
					governed: true,
					mark: {
						text: `@${route.key}`,
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
							governed: true,
						}
					: {
							dir: path.posix.join(root, ...below, routingFolder),
							contents: false,
							governed: true,
						},
		};
	}
}
