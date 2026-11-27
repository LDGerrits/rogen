import path from "path";
import { RojoFile } from "../rojo/rojo.js";
import { PlacedLocation } from "../write/write-service.js";
import { routeMarkOf } from "../write/write.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import {
	Donor,
	GITKEEP,
	NewStyle,
	Style,
	SyncbackLayout,
} from "./syncback-layout.js";

export interface NewInstance {
	readonly parent: readonly string[];
	readonly name: string;
	readonly folder: boolean;
	readonly files?: readonly (readonly string[])[];
}

export interface Mark {
	readonly text: string;
	readonly route: string;
}

export interface NewHome {
	readonly dir: string;
	readonly contents: boolean;
	readonly mark?: Mark;
}

type NewPlacement =
	| { readonly kind: "placed"; readonly home: NewHome }
	| { readonly kind: "conflict"; readonly reason: string };

type Conflict = { readonly kind: "conflict"; readonly reason: string };

const conflict = (reason: string): Conflict => ({
	kind: "conflict",
	reason,
});

export const instanceNameOf = (fileName: string): string =>
	RojoFile.metaStemOf(fileName) ??
	new RojoFile(fileName, SyncRules.DEFAULT).instanceName;

const isInitName = (fileName: string) =>
	fileName.startsWith(`${RojoFile.INIT_NAME}.`);

export const instancePathIn = (
	folder: readonly string[],
	fileName: string
): string[] =>
	isInitName(fileName) ? [...folder] : [...folder, instanceNameOf(fileName)];

const isInitFile = (file: readonly string[]) =>
	isInitName(file[file.length - 1]);

const holdsScript = (instance: NewInstance) =>
	(instance.files ?? []).some(isInitFile);

const isScript = (instance: NewInstance) =>
	(instance.files ?? []).some(
		(file) => file.length === 2 && isInitFile(file)
	);

type ParentRoute =
	| { readonly kind: "keyed"; readonly key: string; readonly depth: number }
	| { readonly kind: "fallback"; readonly depth: number }
	| { readonly kind: "conflict"; readonly reason: string };

export class ReverseRouter {
	constructor(private readonly layout: SyncbackLayout) {}

	place(instance: NewInstance): NewPlacement {
		const placing = this.placeInSources(instance);
		if (placing.kind !== "placed") return placing;
		return {
			kind: "placed",
			home: {
				...placing.home,
				dir: this.layout.synced(placing.home.dir),
			},
		};
	}

	marksFor(parent: readonly string[]): Mark[] {
		return [...this.layout.config.routes]
			.filter(
				([key, target]) =>
					DeclaredKeys.isName(key) &&
					target.instancePath.every((part, at) => parent[at] === part)
			)
			.sort(
				([, a], [, b]) => b.instancePath.length - a.instancePath.length
			)
			.map(([key]) => ({ text: routeMarkOf(key), route: key }));
	}

	private patternAdvice(maker: PlacedLocation): string {
		if (maker.routeMatch !== "pattern") return "";
		const key = this.layout.config.patterns.nameKeyFor(maker.route);
		const folder = instanceNameOf(path.posix.basename(maker.source));
		return key === undefined
			? `, and route that folder by its name, since the pattern ${maker.route} matches no folder`
			: `, named ${folder}${routeMarkOf(key)}/ to keep its route, since the pattern ${maker.route} matches no folder`;
	}

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
			const suffix = new RojoFile(otherName, SyncRules.DEFAULT)
				.scriptSuffix;
			return (
				other.slice(0, -1).join("/") === dir &&
				instanceNameOf(otherName) === stem &&
				suffix !== undefined &&
				this.layout.config.keys.resolveDotRoute(suffix) === mark.route
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
						...(maker.routeMatch === "suffix" && {
							mark: {
								text: routeMarkOf(maker.route),
								route: maker.route,
							},
						}),
					},
				};
			if (maker)
				return conflict(
					`${maker.source} makes ${node.join("/")}, and a file holds no other files; make it a folder with an init file${this.patternAdvice(maker)}`
				);
		}
		return this.asNewFeature(instance);
	}

	private besideDonors(
		donors: readonly Donor[],
		below: readonly string[]
	): NewPlacement {
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
				...(donor.style === "suffix" && {
					mark: {
						text: routeMarkOf(donor.route),
						route: donor.route,
					},
				}),
			},
		};
	}

	private styleFor(route: string): NewStyle {
		return this.layout.styleOf(route) ?? this.layout.styleOf() ?? "folder";
	}

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
				home: {
					dir: path.posix.join(root, ...below),
					contents: false,
				},
			};
		if (this.styleFor(route.key) === "suffix")
			return {
				kind: "placed",
				home: {
					dir: path.posix.join(root, ...below),
					contents: false,
					mark: {
						text: routeMarkOf(route.key),
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
