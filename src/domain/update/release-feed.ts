import {
	RequestService,
	readBody,
} from "../../platform/request/request-service.js";
import {
	PRODUCT_NAME,
	REPOSITORY,
} from "../../platform/product/product-service.js";
import { Version } from "./version.js";

const CHECK_TIMEOUT_MS = 2_000;
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

export class ReleaseFeed {
	constructor(
		@RequestService private readonly requestService: RequestService
	) {}

	/**
	 * Reads the listing, not `releases/latest`, which never names a prerelease.
	 * Answers none when the listing can't be read.
	 */
	async fetch(): Promise<readonly string[]> {
		const response = await this.requestService.request(RELEASES_URL, {
			timeout: CHECK_TIMEOUT_MS,
			headers: {
				accept: "application/vnd.github+json",
				"user-agent": PRODUCT_NAME,
			},
		});
		if (response.isErr() || response.value.status !== 200) return [];
		const listing = readBody(response.value);
		return listing.isOk() ? versionsOf(listing.value) : [];
	}
}

function versionsOf(listing: unknown): string[] {
	if (!Array.isArray(listing)) return [];
	const versions: string[] = [];
	for (const release of listing as unknown[]) {
		const { tag_name, draft } = (release ?? {}) as {
			tag_name?: unknown;
			draft?: unknown;
		};
		const version =
			typeof tag_name === "string" ? Version.parse(tag_name) : undefined;
		if (version && draft !== true) versions.push(version.toString());
	}
	return versions;
}
