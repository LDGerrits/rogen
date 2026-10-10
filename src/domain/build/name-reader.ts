import { DeclaredKeys } from "../config/config.js";
import {
	DOT_ROUTE_KEYS,
	Misspelling,
	MisspellingFinder,
} from "./misspelling-finder.js";

/** What a folder's name declares once its parentheses are off: the route and variants it claims, and the name it keeps. */
export interface FolderReading {
	readonly invisible: boolean;
	/** Written `^Name`: it lands at its route's target, and the folders above it are dropped. */
	readonly hoisted: boolean;
	/** Its whole name, or an `@key` at its end. */
	readonly route?: string;
	/** Whether its route is spelled `@key`: a bare `server` may only be a name, but an `@` means to route. */
	readonly at: boolean;
	/** Route keys its name spells before the one it routes by, which that one outranks. */
	readonly innerRoutes: readonly string[];
	/** Its whole name, or `.variant` parts at its end. */
	readonly variants: readonly string[];
	/** Its name with its keys off; none for a folder named after a key alone, which exists only to declare it. */
	readonly keptName?: string;
	/** The name it keeps when an outer route outranks its own: only its variants come off. */
	readonly outrankedName: string;
	/** What its name misspells, measured on the folder's whole name: an `@` when it declares no route, a dot part only when it declares nothing. */
	readonly misspellings: readonly Misspelling[];
}

export interface SuffixSpan {
	readonly key: string;
	/** Where the key and its sign begin in the stem. */
	readonly start: number;
	readonly length: number;
}

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	/** In match order: the trailing key first. */
	readonly spans: readonly SuffixSpan[];
	/** What the base name misspells: an `@` that doesn't route, a dot part one edit from a variant, or a route key after a dot. */
	readonly misspellings: readonly Misspelling[];
}

/** Finds the config's declared keys in folder names, marker files and file suffixes. */
export class NameReader {
	private static readonly INVISIBLE_FOLDER = /^\((.+)\)$/;

	private readonly finder: MisspellingFinder;

	constructor(private readonly keys: DeclaredKeys) {
		this.finder = new MisspellingFinder(keys);
	}

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
		const { name, invisible, hoisted, offset } =
			NameReader.readFolderName(folderName);
		const bareRoute = this.keys.resolveRoute(name);
		const route =
			bareRoute ??
			(name.startsWith("@")
				? this.keys.resolveRoute(name.slice(1))
				: undefined);
		const lead = { invisible, hoisted };
		if (route)
			return NameReader.reading(lead, name, {
				route,
				at: bareRoute === undefined,
			});
		const dotted = name.startsWith(".") ? name.slice(1) : undefined;
		const variant = this.keys.resolveVariant(dotted ?? name);
		if (variant)
			return NameReader.reading(lead, name, {
				variants: [variant],
				misspellings: NameReader.inFolderName(
					NameReader.present([this.finder.strayAt(name)]),
					offset
				),
			});

		const dotName =
			dotted !== undefined && this.finder.dotNameMisspelling(dotted);
		if (dotName)
			return NameReader.reading(lead, name, {
				keptName: name,
				misspellings: NameReader.inFolderName([dotName], offset),
			});
		const suffixed = this.suffixes(name, false);
		const leading =
			suffixed.spans.length > 0
				? this.leadingKey(suffixed.baseName, suffixed.spans)
				: undefined;
		const leadingTypo =
			!leading && suffixed.baseName.startsWith(".")
				? this.finder.dotNameTypo(suffixed.baseName.slice(1))
				: undefined;
		const spans = leading ? [...suffixed.spans, leading] : suffixed.spans;
		const variantSpans = spans.filter(({ key }) =>
			this.keys.isVariant(key)
		);
		const [routeSpan, ...innerRouteSpans] = spans.filter(({ key }) =>
			this.keys.isRoute(key)
		);
		const keptName = NameReader.withoutSpans(
			name,
			routeSpan ? [...variantSpans, routeSpan] : variantSpans
		);
		return {
			invisible,
			hoisted,
			...(routeSpan && { route: routeSpan.key }),
			at: routeSpan !== undefined,
			innerRoutes: innerRouteSpans.map(({ key }) => key),
			variants: variantSpans.map(({ key }) => key),
			...(keptName !== "" && { keptName }),
			outrankedName: NameReader.withoutSpans(name, variantSpans),
			misspellings: NameReader.inFolderName(
				[
					...(routeSpan
						? []
						: NameReader.present([this.finder.strayAt(name)])),
					...suffixed.misspellings.filter(
						({ kind }) => kind !== "strayAt"
					),
					...NameReader.present([leadingTypo]),
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
		claims: Partial<FolderReading>
	): FolderReading {
		return {
			invisible,
			hoisted,
			at: false,
			innerRoutes: [],
			variants: [],
			outrankedName: name,
			misspellings: [],
			...claims,
		};
	}

	/** The rest of a folder's name once its suffixes are off, when that is one more signed key (`.mock` in `.mock@server`): the folder then leaves no name. */
	private leadingKey(
		baseName: string,
		spans: readonly SuffixSpan[]
	): SuffixSpan | undefined {
		const text = baseName.slice(1);
		const routed = spans.some(({ key }) => this.keys.isRoute(key));
		let key: string | undefined;
		if (baseName.startsWith("@") && !routed)
			key = this.keys.resolveRoute(text);
		else if (baseName.startsWith(".")) key = this.keys.resolveVariant(text);
		return key ? { key, start: 0, length: baseName.length } : undefined;
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
				misspellings:
					key === undefined && !nearMiss
						? NameReader.present([this.finder.strayAt(fileName)])
						: [],
			};
		}
		const key = this.keys.resolveVariant(text);
		return {
			key,
			nearMissKey:
				nearMiss && this.keys.isVariant(nearMiss)
					? nearMiss
					: undefined,
			misspellings: NameReader.present([
				key === undefined
					? this.finder.dotNameMisspelling(text)
					: undefined,
			]),
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
				this.finder.variantTypo(remaining),
				this.finder.dotRoute(remaining, dotRoutes, stem),
			]),
		};
	}

	/** `@route` at the end, or a trailing dot part that is a variant or Rojo's `.server`/`.client` of a declared route. */
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
				this.keys.resolveVariant(part) ??
				(dotRoutes && DOT_ROUTE_KEYS.has(part)
					? this.keys.resolveRoute(part)
					: undefined);
			return key && dot > 0
				? { key, start: dot, length: remaining.length - dot }
				: undefined;
		}
		// A bare `@key` names nothing alone, but before another route it is one more route the name spells.
		const key = this.keys.resolveRoute(remaining.slice(at + 1));
		return (at > 0 || (at === 0 && routed)) && key
			? { key, start: at, length: remaining.length - at }
			: undefined;
	}

	/** Only a folder named by keys alone loses all of its name. */
	static withoutSpans(name: string, spans: readonly SuffixSpan[]): string {
		return [...spans]
			.sort((a, b) => b.start - a.start)
			.reduce(
				(kept, span) =>
					kept.slice(0, span.start) +
					kept.slice(span.start + span.length),
				name
			);
	}
}

export interface MarkerRead {
	/** The declared route or variant key the marker spells. */
	readonly key: string | undefined;
	readonly nearMissKey: string | undefined;
	/** An `@` that doesn't route, or a route key after the dot of a variant marker. */
	readonly misspellings: readonly Misspelling[];
}
