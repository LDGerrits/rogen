import path from "path";
import { joinPosix, stemOf } from "../../base/path.js";
import { closestMatches, editDistance } from "../../base/strings.js";
import { DeclaredKeys } from "../config/config.js";
import { RojoFile, RojoFileKind, RojoScriptSuffix } from "../rojo/rojo.js";
import { ScannedFile, ScannedRoot } from "./root-scanner.js";

/** What a folder's name declares once its parentheses are off: the route and variants it claims, and the name it keeps. */
export interface FolderReading {
	readonly invisible: boolean;
	/** Written `^Name`: it lands at its route's target, and the folders above it are dropped. */
	readonly hoisted: boolean;
	/** Its whole name, or an `@key` at its end. */
	readonly route?: string;
	/** Whether its route is spelled `@key`: a bare `server` may only be a name, but an `@` means to route. */
	readonly at: boolean;
	/** Its whole name, or `.variant` parts at its end. */
	readonly variants: readonly string[];
	/** Its name with its keys off; none for a folder named after a key alone, which exists only to declare it. */
	readonly keptName?: string;
	/** The name it keeps when an outer route outranks its own: only its variants come off. */
	readonly outrankedName: string;
}

/** A folder that never becomes an instance, as a warning names it. */
export type InstancelessFolder =
	| "a root dir"
	| "a routing folder"
	| "a variant folder"
	| "an invisible folder";

export interface SuffixSpan {
	readonly key: string;
	/** Where the key and its sign begin in the stem. */
	readonly start: number;
	readonly length: number;
}

/** An `@` followed by a near miss of a declared route, by a route that isn't at the end of the name, or by a declared variant, which takes a dot. */
export interface StrayAt {
	/** The name after the `@`, up to the next dot. */
	readonly text: string;
	/** What to write instead: the closest route key's `@` form, or a variant's dot form. */
	readonly suggestion: string;
	/** `text` is a declared route, but dot parts follow it, so it isn't at the end of the name. */
	readonly notLast: boolean;
	/** The one rename that fixes it: none when another key is as close, or `notLast`. */
	readonly respelling?: Respelling;
}

/** A declared route key after a dot, where only `@` routes: a dot-file, or a dot part of a name. */
export interface DotRoute {
	readonly text: string;
	readonly key: string;
	readonly respelling: Respelling;
}

/** A trailing dot part that is one edit from a declared variant. */
export interface VariantTypo {
	readonly text: string;
	readonly variant: string;
	/** The one rename that fixes it: none when another variant is as close. */
	readonly respelling?: Respelling;
}

/** Part of a name, written at `start`, and how to spell it instead. */
export interface Respelling {
	readonly start: number;
	readonly written: string;
	readonly spelling: string;
}

/** A misspelled name as the readings note it, with the path it's renamed to when one rename fixes it. */
export type NotedName<T> = T & { readonly renamedTo?: string };

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	/** In match order: the trailing key first. */
	readonly spans: readonly SuffixSpan[];
	/** An `@` left in the base name that doesn't route. */
	readonly strayAt?: StrayAt;
	/** An undeclared dot part left at the end of the base name that looks like a mistyped variant. */
	readonly variantTypo?: VariantTypo;
	/** A route key left after a dot at the end of the base name, where it doesn't route. */
	readonly dotRoute?: DotRoute;
}

/** The script suffixes Rojo reads from a dot, which route when a key of that name is declared. */
const DOT_ROUTE_KEYS: ReadonlySet<string> = new Set(["server", "client"]);

/** Finds the config's declared keys in folder names, marker files and file suffixes. */
export class NameReader {
	private static readonly INVISIBLE_FOLDER = /^\((.+)\)$/;

	constructor(private readonly keys: DeclaredKeys) {}

	/** A folder written `(name)` is the folder `name`, left out of the tree. */
	static unwrapInvisibleFolder(folderName: string): {
		readonly name: string;
		readonly invisible: boolean;
	} {
		const inner = NameReader.INVISIBLE_FOLDER.exec(folderName)?.[1];
		return inner === undefined
			? { name: folderName, invisible: false }
			: { name: inner, invisible: true };
	}

	/** A name that starts with `^` is hoisted to its route's target; the `^` comes off it. */
	static unhoisted(name: string): {
		readonly name: string;
		readonly hoisted: boolean;
	} {
		return name.length > 1 && name.startsWith("^")
			? { name: name.slice(1), hoisted: true }
			: { name, hoisted: false };
	}

	/** A folder's name with its parentheses, then its `^`, off; `offset` is where that name starts in the folder's. */
	private static readFolderName(folderName: string): {
		readonly name: string;
		readonly invisible: boolean;
		readonly hoisted: boolean;
		readonly offset: number;
	} {
		const unwrapped = NameReader.unwrapInvisibleFolder(folderName);
		const { name, hoisted } = NameReader.unhoisted(unwrapped.name);
		return {
			name,
			invisible: unwrapped.invisible,
			hoisted,
			offset: (unwrapped.invisible ? 1 : 0) + (hoisted ? 1 : 0),
		};
	}

	/** A folder declares a key as its whole name (`server`, `mock`, `@server`, `.mock`) or as suffixes after a name it keeps (`Name@server`, `Name.mock`); parentheses come off first. Only a file's dot routes to Rojo's script class. */
	folder(folderName: string): FolderReading {
		const { name, invisible, hoisted } =
			NameReader.readFolderName(folderName);
		const bareRoute = this.keys.resolveRoute(name);
		const route =
			bareRoute ??
			(name.startsWith("@")
				? this.keys.resolveRoute(name.slice(1))
				: undefined);
		if (route)
			return {
				invisible,
				hoisted,
				route,
				at: bareRoute === undefined,
				variants: [],
				outrankedName: name,
			};
		const variant = this.keys.resolveVariant(
			name.startsWith(".") ? name.slice(1) : name
		);
		if (variant)
			return {
				invisible,
				hoisted,
				at: false,
				variants: [variant],
				outrankedName: name,
			};

		const { spans } = this.suffixes(name, false);
		const variantSpans = spans.filter(({ key }) =>
			this.keys.isVariant(key)
		);
		const routeSpan = spans.find(({ key }) => !this.keys.isVariant(key));
		return {
			invisible,
			hoisted,
			...(routeSpan && { route: routeSpan.key }),
			at: routeSpan !== undefined,
			variants: variantSpans.map(({ key }) => key),
			keptName: NameReader.withoutSpans(
				name,
				routeSpan ? [...variantSpans, routeSpan] : variantSpans
			),
			outrankedName: NameReader.withoutSpans(name, variantSpans),
		};
	}

	/** A dot part at the end of a folder name that is one edit from a declared variant. */
	folderVariantTypo(folderName: string): VariantTypo | undefined {
		const { name, offset } = NameReader.readFolderName(folderName);
		return NameReader.inFolderName(
			this.suffixes(name, false).variantTypo,
			offset
		);
	}

	/** The `@` in a folder name that no declared route follows. */
	folderStrayAt(folderName: string): StrayAt | undefined {
		const { name, offset } = NameReader.readFolderName(folderName);
		return NameReader.inFolderName(this.strayAt(name), offset);
	}

	/** A route key after a dot at the end of a folder name, which only `@` routes. */
	folderDotRoute(folderName: string): DotRoute | undefined {
		const { name, offset } = NameReader.readFolderName(folderName);
		return NameReader.inFolderName(
			this.suffixes(name, false).dotRoute,
			offset
		);
	}

	/** A misspelling read in a folder's name, with its respelling measured on the folder's whole name. */
	private static inFolderName<T extends { readonly respelling?: Respelling }>(
		misspelt: T | undefined,
		offset: number
	): T | undefined {
		if (!misspelt?.respelling || offset === 0) return misspelt;
		const { respelling } = misspelt;
		return {
			...misspelt,
			respelling: { ...respelling, start: respelling.start + offset },
		};
	}

	/** The declared key a marker file spells with its sign: `@server` for a route, `.mock` for a variant. */
	marker(fileName: string): MarkerRead {
		const text = fileName.slice(1);
		const nearMiss = this.keys.nearMiss(text);
		if (fileName.startsWith("@")) {
			const key = this.keys.resolveRoute(text);
			return {
				key,
				nearMissKey:
					nearMiss && !this.keys.isVariant(nearMiss)
						? nearMiss
						: undefined,
				// A case-only miss gets the letter-case warning instead.
				...(key === undefined &&
					!nearMiss && { strayAt: this.strayAt(fileName) }),
			};
		}
		const key = this.keys.resolveVariant(text);
		const route = key === undefined && this.keys.resolveRoute(text);
		return {
			key,
			nearMissKey:
				nearMiss && this.keys.isVariant(nearMiss)
					? nearMiss
					: undefined,
			...(route && { dotRoute: NameReader.dotRouteOf(text, route, 0) }),
		};
	}

	/** Only a trailing run counts: in `Foo.mock.Bar`, `Bar` stops it before `mock`. `dotRoutes` reads Rojo's `.server`/`.client`, which only a file has. */
	suffixes(stem: string, dotRoutes = true): SuffixMatch {
		let remaining = stem;
		const matched = new Set<string>();
		const spans: SuffixSpan[] = [];

		for (
			let span = this.trailingSpan(remaining, dotRoutes);
			span;
			span = this.trailingSpan(remaining, dotRoutes)
		) {
			matched.add(span.key);
			remaining = remaining.slice(0, span.start);
			spans.push(span);
		}

		return {
			baseName: remaining,
			matchedKeys: matched,
			spans,
			strayAt: this.strayAt(remaining),
			variantTypo: this.variantTypo(remaining),
			dotRoute: this.dotRoute(remaining),
		};
	}

	/** Only `@` routes, and Rojo's `.server`/`.client` on a script, which `suffixes` already took. */
	private dotRoute(remaining: string): DotRoute | undefined {
		const dot = remaining.lastIndexOf(".");
		if (dot <= 0 || dot < remaining.lastIndexOf("@")) return undefined;
		const text = remaining.slice(dot + 1);
		const key = this.keys.resolveRoute(text);
		return key ? NameReader.dotRouteOf(text, key, dot) : undefined;
	}

	/** `.text` at `start`, which spells the route `key`, respelt with its `@`. */
	private static dotRouteOf(
		text: string,
		key: string,
		start: number
	): DotRoute {
		return {
			text,
			key,
			respelling: { start, written: `.${text}`, spelling: `@${key}` },
		};
	}

	/** `@route` at the end, or a trailing dot part that is a variant or Rojo's `.server`/`.client` of a declared route. */
	private trailingSpan(
		remaining: string,
		dotRoutes: boolean
	): SuffixSpan | undefined {
		const dot = remaining.lastIndexOf(".");
		const at = remaining.lastIndexOf("@");
		if (dot > at) {
			const part = remaining.slice(dot + 1);
			const key =
				this.keys.resolveVariant(part) ??
				(dotRoutes && DOT_ROUTE_KEYS.has(part)
					? this.keys.resolveRoute(part)
					: undefined);
			return key && dot > 0
				? { key, start: dot, length: remaining.length - dot }
				: undefined;
		}
		const key = this.keys.resolveRoute(remaining.slice(at + 1));
		return at > 0 && key
			? { key, start: at, length: remaining.length - at }
			: undefined;
	}

	/** `.spec` and `.story` are ordinary names, so only a part one edit from a declared variant is reported. */
	private variantTypo(remaining: string): VariantTypo | undefined {
		const dot = remaining.lastIndexOf(".");
		if (dot <= 0 || dot < remaining.lastIndexOf("@")) return undefined;
		const text = remaining.slice(dot + 1);
		if (DOT_ROUTE_KEYS.has(text) || this.keys.resolveRoute(text))
			return undefined;
		const distances = [...this.keys.variantKeys]
			.map((key) => ({
				key,
				distance: editDistance(text.toLowerCase(), key.toLowerCase()),
			}))
			.filter(({ distance }) => distance <= 1);
		const nearest = Math.min(...distances.map(({ distance }) => distance));
		const variants = distances
			.filter(({ distance }) => distance === nearest)
			.map(({ key }) => key);
		if (variants.length === 0) return undefined;
		const [variant] = variants;
		return {
			text,
			variant,
			...(variants.length === 1 && {
				respelling: {
					start: dot,
					written: `.${text}`,
					spelling: `.${variant}`,
				},
			}),
		};
	}

	/** Spans start past the first character, so a name never loses all of it. */
	private static withoutSpans(
		name: string,
		spans: readonly SuffixSpan[]
	): string {
		return [...spans]
			.sort((a, b) => b.start - a.start)
			.reduce(
				(kept, span) =>
					kept.slice(0, span.start) +
					kept.slice(span.start + span.length),
				name
			);
	}

	private strayAt(name: string): StrayAt | undefined {
		const at = name.lastIndexOf("@");
		if (at < 0) return undefined;
		const text = name.slice(at + 1).split(".")[0];
		if (text === "") return undefined;
		const written = `@${text}`;
		const variant = this.keys.resolveVariant(text);
		if (variant) {
			const suggestion = `.${variant}`;
			return {
				text,
				suggestion,
				notLast: false,
				respelling: { start: at, written, spelling: suggestion },
			};
		}
		const closest = closestMatches(text, this.keys.routeKeys);
		const notLast = this.keys.resolveRoute(text) !== undefined;
		// Package names use `@` too (`@rbxts`, `owner_name@1.5.1`), so only a near miss of a route is a typo.
		if (closest.length === 0 || (at === 0 && notLast)) return undefined;
		const suggestion = `@${closest[0]}`;
		return {
			text,
			suggestion,
			notLast,
			...(closest.length === 1 &&
				!notLast && {
					respelling: { start: at, written, spelling: suggestion },
				}),
		};
	}
}

/** A folder read once: what its name means, and the declared key it only differs from in case. */
export type FolderRead = FolderReading & {
	readonly segment: string;
	/** The folder relative to the root dir. */
	readonly dir: string;
	readonly nearMissKey?: string;
	readonly strayAt?: StrayAt;
	readonly variantTypo?: VariantTypo;
	readonly dotRoute?: DotRoute;
};

export interface MarkerRead {
	/** The declared route or variant key the marker spells. */
	readonly key: string | undefined;
	readonly nearMissKey: string | undefined;
	readonly strayAt?: StrayAt;
	readonly dotRoute?: DotRoute;
}

/** An entry read once: its folders and the suffixes on its name. */
export interface EntryRead {
	/** The folders above the entry, outermost first. */
	readonly folders: readonly FolderRead[];
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
	/** The script class Rojo reads from the stem: a `.server`, `.client` or `.plugin` script; none for any other file. */
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	readonly match: SuffixMatch;
}

/** Every folder, marker and suffix the declared keys can claim, read once and shared by the stages and rules. */
export class NameReadings {
	/** By absolute POSIX path; holds every folder above an entry, marker or meta file. */
	readonly folders = new Map<string, FolderRead>();
	/** By absolute POSIX path. */
	readonly markers = new Map<string, MarkerRead>();
	/** By the entry's source. */
	readonly entries = new Map<string, EntryRead>();
	/** Each marker or folder above an entry whose name only differs from a declared key in letter case, with that key; first found first. */
	readonly nearMisses = new Map<string, string>();
	/** Each folder above an entry, or entry, with an `@` that doesn't route; first found first. */
	readonly strayAts = new Map<string, NotedName<StrayAt>>();
	/** Each folder above an entry, or entry, whose name ends in a dot part one edit from a declared variant; first found first. */
	readonly variantTypos = new Map<string, NotedName<VariantTypo>>();
	/** Each dot-file, folder above an entry, or entry, that writes a declared route key after a dot; first found first. */
	readonly dotRoutes = new Map<string, NotedName<DotRoute>>();

	constructor(
		private readonly reader: NameReader,
		private readonly keys: DeclaredKeys,
		roots: readonly ScannedRoot[]
	) {
		for (const root of roots) {
			for (const marker of root.markers) {
				this.readFoldersAbove(root.rootDir, marker);
				const resource = joinPosix(root.rootDir, marker);
				const read = this.reader.marker(path.posix.basename(marker));
				this.markers.set(resource, read);
				this.noteNearMiss(resource, read.nearMissKey);
				NameReadings.note(this.strayAts, resource, read.strayAt);
				NameReadings.note(this.dotRoutes, resource, read.dotRoute);
			}
			for (const metaFile of root.metaFiles)
				this.readFoldersAbove(root.rootDir, metaFile);
			for (const entry of root.entries) {
				const { fileName, kind, stem } =
					NameReadings.suffixedNameOf(entry);
				const folders = this.readFoldersAbove(
					root.rootDir,
					entry.relativePath
				);
				const match = this.reader.suffixes(stem);
				this.entries.set(entry.source, {
					folders,
					fileName,
					kind,
					stem,
					scriptSuffix:
						kind === "script"
							? RojoFile.scriptSuffixOf(stem)
							: undefined,
					match,
				});
				for (const folder of folders) {
					const resource = joinPosix(root.rootDir, folder.dir);
					this.noteNearMiss(resource, folder.nearMissKey);
					NameReadings.note(this.strayAts, resource, folder.strayAt);
					NameReadings.note(
						this.variantTypos,
						resource,
						folder.variantTypo
					);
					NameReadings.note(
						this.dotRoutes,
						resource,
						folder.dotRoute
					);
				}
				NameReadings.note(this.strayAts, entry.source, match.strayAt);
				NameReadings.note(
					this.variantTypos,
					entry.source,
					match.variantTypo
				);
				NameReadings.note(this.dotRoutes, entry.source, match.dotRoute);
			}
		}
	}

	/** The entry's reading. Every scanned entry has one, so a miss is a programmer error. */
	entryAt(source: string): EntryRead {
		const read = this.entries.get(source);
		if (!read) throw new Error(`${source} was not scanned.`);
		return read;
	}

	/** Why the folder `dir` of a root dir can never become an instance by its name; `undefined` for one that can, if a route places something through it. */
	instanceless(rootDir: string, dir: string): InstancelessFolder | undefined {
		if (dir === "") return "a root dir";
		const folder = this.folders.get(joinPosix(rootDir, dir));
		if (folder?.keptName !== undefined)
			return folder.invisible ? "an invisible folder" : undefined;
		if (folder?.route !== undefined) return "a routing folder";
		return folder?.variants.length ? "a variant folder" : undefined;
	}

	private noteNearMiss(resource: string, key: string | undefined): void {
		if (key && !this.nearMisses.has(resource))
			this.nearMisses.set(resource, key);
	}

	/** Notes the first misspelling found at `resource`, with the path it's renamed to. */
	private static note<T extends { readonly respelling?: Respelling }>(
		noted: Map<string, NotedName<T>>,
		resource: string,
		misspelt: T | undefined
	): void {
		if (!misspelt || noted.has(resource)) return;
		const { respelling } = misspelt;
		noted.set(resource, {
			...misspelt,
			...(respelling && {
				renamedTo: NameReadings.respelled(resource, respelling),
			}),
		});
	}

	private static respelled(
		resource: string,
		{ start, written, spelling }: Respelling
	): string {
		const name = path.posix.basename(resource);
		return joinPosix(
			path.posix.dirname(resource),
			name.slice(0, start) + spelling + name.slice(start + written.length)
		);
	}

	private folderAt(rootDir: string, dir: string): FolderRead {
		const key = joinPosix(rootDir, dir);
		let read = this.folders.get(key);
		if (!read) {
			const segment = path.posix.basename(dir);
			const reading = this.reader.folder(segment);
			const plain =
				reading.route === undefined && reading.variants.length === 0;
			read = {
				...reading,
				segment,
				dir,
				nearMissKey: plain
					? this.keys.nearMiss(reading.outrankedName)
					: undefined,
				strayAt:
					reading.route === undefined
						? this.reader.folderStrayAt(segment)
						: undefined,
				variantTypo: plain
					? this.reader.folderVariantTypo(segment)
					: undefined,
				dotRoute: plain
					? this.reader.folderDotRoute(segment)
					: undefined,
			};
			this.folders.set(key, read);
		}
		return read;
	}

	private readFoldersAbove(
		rootDir: string,
		relativePath: string
	): FolderRead[] {
		const above: FolderRead[] = [];
		let dir = "";
		for (const segment of relativePath.split("/").slice(0, -1)) {
			dir = dir ? `${dir}/${segment}` : segment;
			above.push(this.folderAt(rootDir, dir));
		}
		return above;
	}

	private static suffixedNameOf(entry: ScannedFile): {
		readonly fileName: string;
		readonly kind: RojoFileKind;
		readonly stem: string;
	} {
		const { kind } = entry;
		const fileName = path.posix.basename(entry.relativePath);
		const stem = stemOf(fileName);
		return {
			fileName,
			kind,
			stem: kind === "data" ? RojoFile.dataNameOf(stem) : stem,
		};
	}
}
