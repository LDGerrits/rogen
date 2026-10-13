import { DeclaredKeys } from "../config/config.js";
import { RUN_SCRIPT_SUFFIXES } from "../rojo/rojo.js";
import { InstanceName, SuffixSpan } from "./instance-name.js";
import { Misspelling, MisspellingFinder } from "./misspelling-finder.js";

/** What a folder's name declares once its parentheses are off: the route it claims, and the name it keeps. */
export interface FolderNameReading {
	readonly invisible: boolean;
	/** Written `^Name`: it lands at its route's target, and the folders above it are dropped. */
	readonly hoisted: boolean;
	/** Its whole name, or an `@key` at its end. */
	readonly route?: string;
	/** Whether its route is spelled `@key`: a bare `server` may only be a name, but an `@` means to route. */
	readonly at: boolean;
	/** Route keys its name spells before the one it routes by, which that one outranks. */
	readonly innerRoutes: readonly string[];
	/** Its name with its route off; none for a folder named after a key alone, which exists only to declare it. */
	readonly keptName?: string;
	/** The name it keeps when an outer route outranks its own: its whole name, with its parentheses and `^` off. */
	readonly outrankedName: string;
	/** What its name misspells, measured on the folder's whole name: an `@` when it declares no route, a dot-folder that spells a route key. */
	readonly misspellings: readonly Misspelling[];
}

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	/** In match order: the trailing key first. */
	readonly spans: readonly SuffixSpan[];
	/** What the base name misspells: an `@` that doesn't route, or a route key after a dot. */
	readonly misspellings: readonly Misspelling[];
}

/** Finds the config's route keys in folder names, marker files and file suffixes. */
export class NameReader {
	private readonly finder: MisspellingFinder;

	constructor(private readonly keys: DeclaredKeys) {
		this.finder = new MisspellingFinder(keys);
	}

	/** A folder's name with its parentheses and its `^` off, in either order (`(^Name)` and `^(Name)`); `offset` is where that name starts in the folder's. */
	private static readFolderName(folderName: string): {
		readonly name: string;
		readonly invisible: boolean;
		readonly hoisted: boolean;
		readonly offset: number;
	} {
		const outer = InstanceName.unwrapInvisibleFolder(folderName);
		const hoisted = InstanceName.unhoisted(outer.name);
		const inner = hoisted.hoisted
			? InstanceName.unwrapInvisibleFolder(hoisted.name)
			: { name: hoisted.name, invisible: false };
		const invisible = outer.invisible || inner.invisible;
		return {
			name: inner.name,
			invisible,
			hoisted: hoisted.hoisted,
			offset: (invisible ? 1 : 0) + (hoisted.hoisted ? 1 : 0),
		};
	}

	/** A folder declares a route as its whole name (`server`, `@server`) or as a suffix after a name it keeps (`Name@server`); parentheses come off first. Only a file's dot routes to Rojo's script class. */
	folder(folderName: string): FolderNameReading {
		const { name, invisible, hoisted, offset } =
			NameReader.readFolderName(folderName);
		const bareRoute = this.keys.resolve(name);
		const route =
			bareRoute ??
			(name.startsWith("@")
				? this.keys.resolve(name.slice(1))
				: undefined);
		const lead = { invisible, hoisted };
		if (route)
			return NameReader.reading(lead, name, {
				route,
				at: bareRoute === undefined,
			});

		const dotted = name.startsWith(".") ? name.slice(1) : undefined;
		const dotName =
			dotted !== undefined && this.finder.dotNameMisspelling(dotted);
		if (dotName)
			return NameReader.reading(lead, name, {
				keptName: name,
				misspellings: NameReader.inFolderName([dotName], offset),
			});
		return this.suffixedFolder(name, lead, offset);
	}

	/** A folder named by a suffix after a name it keeps, such as `Name@server`. */
	private suffixedFolder(
		name: string,
		{
			invisible,
			hoisted,
		}: { readonly invisible: boolean; readonly hoisted: boolean },
		offset: number
	): FolderNameReading {
		const suffixed = this.suffixes(name, false);
		const [routeSpan, ...innerRouteSpans] = suffixed.spans;
		const keptName = InstanceName.withoutSpans(
			name,
			routeSpan ? [routeSpan] : []
		);
		return {
			invisible,
			hoisted,
			...(routeSpan && { route: routeSpan.key }),
			at: routeSpan !== undefined,
			innerRoutes: innerRouteSpans.map(({ key }) => key),
			...(keptName !== "" && { keptName }),
			outrankedName: name,
			misspellings: NameReader.inFolderName(
				[
					...(routeSpan
						? []
						: NameReader.present([this.finder.strayAt(name)])),
					...suffixed.misspellings.filter(
						({ kind }) => kind !== "strayAt"
					),
					...(routeSpan
						? []
						: NameReader.present([
								this.finder.folderTypo(keptName),
							])),
				],
				offset
			),
		};
	}

	/** A reading that claims nothing, but for `claims`. */
	private static reading(
		{
			invisible,
			hoisted,
		}: { readonly invisible: boolean; readonly hoisted: boolean },
		name: string,
		claims: Partial<FolderNameReading>
	): FolderNameReading {
		return {
			invisible,
			hoisted,
			at: false,
			innerRoutes: [],
			outrankedName: name,
			misspellings: [],
			...claims,
		};
	}

	/** Misspellings read in a folder's name, with their respellings measured on the folder's whole name. */
	private static inFolderName(
		misspellings: readonly Misspelling[],
		offset: number
	): Misspelling[] {
		return misspellings.map((misspelt) =>
			!misspelt.respelling || offset === 0
				? misspelt
				: {
						...misspelt,
						respelling: {
							...misspelt.respelling,
							start: misspelt.respelling.start + offset,
						},
					}
		);
	}

	private static present(
		misspellings: readonly (Misspelling | undefined)[]
	): Misspelling[] {
		return misspellings.filter((misspelt) => misspelt !== undefined);
	}

	/** The route a marker file spells with its `@`. A dot-file claims nothing, but warns when it spells a route key. */
	marker(fileName: string): MarkerReading {
		const text = fileName.slice(1);
		if (!fileName.startsWith("@"))
			return {
				key: undefined,
				nearMissKey: undefined,
				misspellings: NameReader.present([
					this.finder.dotNameMisspelling(text),
				]),
			};
		const key = this.keys.resolve(text);
		const nearMiss = this.keys.nearMiss(text);
		return {
			key,
			nearMissKey: nearMiss,
			// A case-only miss gets the letter-case warning instead.
			misspellings:
				key === undefined && !nearMiss
					? NameReader.present([this.finder.strayAt(fileName)])
					: [],
		};
	}

	/** Only a trailing run counts: in `Foo.mock.Bar`, `Bar` stops it before `mock`. `dotRoutes` reads Rojo's `.server`/`.client`, which only a script has. */
	suffixes(stem: string, dotRoutes = true): SuffixMatch {
		let remaining = stem;
		const matched = new Set<string>();
		const spans: SuffixSpan[] = [];

		const routed = () => spans.some(({ key }) => this.keys.isRoute(key));
		for (
			let span = this.trailingSpan(remaining, dotRoutes, routed());
			span;
			span = this.trailingSpan(remaining, dotRoutes, routed())
		) {
			matched.add(span.key);
			remaining = remaining.slice(0, span.start);
			spans.push(span);
		}

		return {
			baseName: remaining,
			matchedKeys: matched,
			spans,
			misspellings: NameReader.present([
				this.finder.strayAt(remaining),
				this.finder.dotRoute(remaining, dotRoutes, stem),
			]),
		};
	}

	/** `@route` at the end, or Rojo's `.server`/`.client` of a declared route as a trailing dot part. */
	private trailingSpan(
		remaining: string,
		dotRoutes: boolean,
		routed: boolean
	): SuffixSpan | undefined {
		const dot = remaining.lastIndexOf(".");
		const at = remaining.lastIndexOf("@");
		if (dot > at) {
			const part = remaining.slice(dot + 1);
			const key =
				dotRoutes && RUN_SCRIPT_SUFFIXES.has(part)
					? this.keys.resolve(part)
					: undefined;
			return key && dot > 0
				? { key, start: dot, length: remaining.length - dot }
				: undefined;
		}
		// A bare `@key` names nothing alone, but before another route it is one more route the name spells.
		const key = this.keys.resolve(remaining.slice(at + 1));
		return (at > 0 || (at === 0 && routed)) && key
			? { key, start: at, length: remaining.length - at }
			: undefined;
	}
}

export interface MarkerReading {
	/** The declared route key the marker spells. */
	readonly key: string | undefined;
	readonly nearMissKey: string | undefined;
	/** An `@` that doesn't route, or a route key written as a dot-file. */
	readonly misspellings: readonly Misspelling[];
}
