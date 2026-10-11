import http from "http";
import https from "https";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	HttpResponse,
	RequestError,
	RequestFailure,
	RequestOptions,
	RequestService,
} from "./request-service.js";

const REFUSED_CODES = ["ECONNREFUSED", "EADDRNOTAVAIL"];

/** The socket's error carries the code, or the aggregate of the addresses tried does. */
function failureOf(error: unknown): RequestFailure {
	const name = (error as { name?: unknown } | null)?.name;
	if (name === "TimeoutError" || name === "AbortError") return "timeout";
	return ErrorUtils.hasCode(error, ...REFUSED_CODES) ||
		ErrorUtils.hasCode(
			(error as { cause?: unknown } | null)?.cause,
			...REFUSED_CODES
		)
		? "refused"
		: "failed";
}

/** Speaks HTTP over Node's own client, not `fetch`, which refuses ports a browser would, such as 6000 or 10080. */
export class NativeRequestService implements RequestService {
	declare readonly _serviceBrand: undefined;

	request(
		url: string,
		options: RequestOptions
	): Promise<Result<HttpResponse, RequestError>> {
		return new Promise((resolve) => {
			const fail = (caught: unknown) => {
				const message = (caught as { message?: unknown } | null)
					?.message;
				resolve(
					err(
						new RequestError(
							typeof message === "string" && message !== ""
								? message
								: ErrorUtils.fromUnknown(caught).message,
							failureOf(caught),
							{ cause: caught }
						)
					)
				);
			};
			const client = url.startsWith("https:") ? https : http;
			try {
				client
					.get(
						url,
						{ signal: AbortSignal.timeout(options.timeout) },
						(response) => {
							const chunks: Buffer[] = [];
							response.on("data", (chunk: Buffer) =>
								chunks.push(chunk)
							);
							response.on("error", fail);
							response.on("end", () =>
								resolve(
									ok({
										status: response.statusCode ?? 0,
										contentType:
											response.headers["content-type"],
										body: new Uint8Array(
											Buffer.concat(chunks)
										),
									})
								)
							);
						}
					)
					.on("error", fail);
			} catch (caught) {
				fail(caught);
			}
		});
	}
}
