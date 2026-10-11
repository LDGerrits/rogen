import path from "path";
import { compareStrings, groupBy } from "../../base/collections.js";
import { containsPosix, joinPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys } from "../config/config.js";
import { DirClaims, InitRoute } from "./dir-claims.js";
import { NameReadings } from "./name-readings.js";
import { ScannedRoot } from "./root-scanner.js";

/** A directory whose markers, an init script's route suffix among them, route its folder to more than one place. */
interface MarkerClash {
	/** An absolute POSIX path. */
	readonly dir: string;
	/** The marker files and init scripts that route it, sorted. */
	readonly names: readonly string[];
	/** Set when only init scripts of variants route it apart and no route above it governs. */
	readonly variantClash?: {
		/** The folder beside it each set of variants needs, such as `Net.dev.mock@client`; none when its name carries more than a name. */
		readonly besideFolders: readonly string[];
	};
}

/** The directories whose markers disagree. Markers in one directory all sit at one level, so no order could choose between two routes; claiming them in scan order would pick one silently. */
export class MarkerClashes {
	private readonly clashes: readonly MarkerClash[];

	constructor(
		roots: readonly ScannedRoot[],
		private readonly readings: NameReadings,
		private readonly keys: DeclaredKeys
	) {
		this.clashes = roots.flatMap((root) =>
			this.clashesIn(root, new DirClaims(root, readings, keys))
		);
	}

	/** The marker files and init scripts of the clashes, as absolute POSIX paths. */
	get files(): ReadonlySet<string> {
		return new Set(
			this.clashes.flatMap(({ dir, names }) =>
				names.map((name) => joinPosix(dir, name))
			)
		);
	}

	/** Whether `dir`, an absolute POSIX path, is a clashing folder or lies in one. */
	covers(dir: string): boolean {
		return this.clashes.some((clash) => containsPosix(clash.dir, dir));
	}

	/** Two routes at one level of a folder leave nothing to decide between them; init scripts of variants never on together don't either, since a variant never moves a file. */
	diagnostics(): Diagnostic[] {
		return this.clashes.map(({ dir, names, variantClash }) => {
			const quoted = joinedWithAnd(names.map((name) => `"${name}"`));
			if (!variantClash)
				return errorDiagnostic(
					"route.markerClash",
					{ resource: dir },
					`${quoted} route this folder to different places, and nothing decides between them. Keep one.`
				);
			const { besideFolders } = variantClash;
			const folders =
				besideFolders.length > 0
					? `: ${joinedWithAnd(besideFolders.map((folder) => `${folder}/`))}`
					: "";
			return errorDiagnostic(
				"route.markerClash",
				{ resource: dir },
				`${quoted} route this folder to different places, but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one${folders}.`
			);
		});
	}

	private clashesIn(root: ScannedRoot, dirs: DirClaims): MarkerClash[] {
		const clashes: MarkerClash[] = [];
		for (const dir of dirs.dirs()) {
			const claims = [
				...dirs
					.markersAt(dir)
					.filter(({ key }) => this.keys.isRoute(key))
					.map(({ fileName, key }) => ({
						key,
						name: fileName,
						variants: [],
					})),
				...dirs.initRoutesAt(dir).map(({ key, source, variants }) => ({
					key,
					name: path.posix.basename(source),
					variants,
				})),
			];
			if (new Set(claims.map(({ key }) => key)).size > 1)
				clashes.push({
					dir: joinPosix(root.rootDir, dir),
					names: claims.map(({ name }) => name).sort(compareStrings),
					...(dir !== "" &&
						!dirs.isRoutedAbove(dir) &&
						this.variantClashOf(root.rootDir, dir, claims)),
				});
		}
		return clashes;
	}

	/** Markers and plain init scripts that agree leave the folder at most one route, so only the variants' init scripts route it apart, unless two of one set of variants disagree too. Each set's files then move to a folder beside it that names the set and its route. */
	private variantClashOf(
		rootDir: string,
		dir: string,
		claims: readonly Pick<InitRoute, "key" | "variants">[]
	): Pick<MarkerClash, "variantClash"> {
		const plainKeys = new Set(
			claims
				.filter(({ variants }) => variants.length === 0)
				.map(({ key }) => key)
		);
		if (plainKeys.size > 1) return {};
		const sets = [
			...groupBy(
				claims.filter(({ variants }) => variants.length > 0),
				({ variants }) =>
					[...new Set(variants)].sort(compareStrings).join(".")
			),
		].map(([set, scripts]) => ({
			set,
			keys: new Set(scripts.map(({ key }) => key)),
		}));
		if (sets.some(({ keys }) => keys.size > 1)) return {};
		const folder = this.readings.folders.get(joinPosix(rootDir, dir));
		if (!folder || folder.keptName !== folder.segment)
			return { variantClash: { besideFolders: [] } };
		const besideFolders = sets
			.flatMap(({ set, keys: [key] }) =>
				plainKeys.has(key) ? [] : [`${folder.segment}.${set}@${key}`]
			)
			.sort(compareStrings);
		return { variantClash: { besideFolders } };
	}
}
