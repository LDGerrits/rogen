import path from "path";
import { FileSystemService } from "../fs/file-system-service.js";
import { REPOSITORY } from "../product/product-service.js";
import { RequestService, readBody } from "../request/request-service.js";
import { ReleaseService } from "./release-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 2_000;
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

interface Cache {
	/** When the last check ended, however it ended. */
	readonly checkedAt: number;
	readonly versions: readonly string[];
	readonly announced?: { readonly version: string; readonly at: number };
}

const EMPTY: Cache = { checkedAt: 0, versions: [] };

/** The versions the tags of a release listing name, read leniently: a listing in any other shape names none. */
function versionsOf(listing: unknown): string[] {
	if (!Array.isArray(listing)) return [];
	const versions: string[] = [];
	for (const release of listing as unknown[]) {
		const { tag_name, draft } = (release ?? {}) as {
			tag_name?: unknown;
			draft?: unknown;
		};
		const version =
			typeof tag_name === "string" &&
			/^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag_name)?.[1];
		if (version && draft !== true) versions.push(version);
	}
	return versions;
}

/** Reads GitHub's release listing once a day into a file of the user's cache folder, and never lets a failure of any step reach the caller. A command that ends before a check does keeps the process open until it ends, which the timeout bounds. */
export class CoreReleaseService implements ReleaseService {
	declare readonly _serviceBrand: undefined;

	private readonly cacheFile: string;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly requestService: RequestService,
		cacheDir: string,
		private readonly now: () => number = Date.now
	) {
		this.cacheFile = path.join(cacheDir, "rogen", "update-check.json");
	}

	async published(): Promise<readonly string[]> {
		const cache = await this.read();
		if (this.now() - cache.checkedAt >= DAY_MS)
			this.refresh().catch(() => {});
		return cache.versions;
	}

	async announce(version: string): Promise<boolean> {
		const cache = await this.read();
		const { announced } = cache;
		if (
			announced?.version === version &&
			this.now() - announced.at < DAY_MS
		)
			return false;
		await this.write({
			...cache,
			announced: { version, at: this.now() },
		});
		return true;
	}

	/** Reads the listing, not `releases/latest`, which never names a prerelease. */
	private async refresh(): Promise<void> {
		const response = await this.requestService.request(RELEASES_URL, {
			timeout: CHECK_TIMEOUT_MS,
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": "rogen",
			},
		});
		const cache = await this.read();
		const listing =
			response.isOk() && response.value.status === 200
				? readBody(response.value)
				: undefined;
		const versions = listing?.isOk() ? versionsOf(listing.value) : [];
		// A failed check is not tried again for a day, so an offline machine isn't asked each run.
		await this.write({
			...cache,
			checkedAt: this.now(),
			versions: versions.length > 0 ? versions : cache.versions,
		});
	}

	private async read(): Promise<Cache> {
		try {
			const value = JSON.parse(
				await this.fileSystemService.readFile(this.cacheFile)
			) as Partial<Cache> | null;
			return {
				checkedAt:
					typeof value?.checkedAt === "number" ? value.checkedAt : 0,
				versions: Array.isArray(value?.versions)
					? value.versions.filter((v) => typeof v === "string")
					: [],
				announced:
					typeof value?.announced?.version === "string" &&
					typeof value.announced.at === "number"
						? value.announced
						: undefined,
			};
		} catch {
			return EMPTY;
		}
	}

	private async write(cache: Cache): Promise<void> {
		try {
			await this.fileSystemService.writeFile(
				this.cacheFile,
				JSON.stringify(cache)
			);
		} catch {
			// A cache folder that can't be written only costs the next run a new check.
		}
	}
}
