import { createServiceIdentifier } from "../instantiation/instantiation.js";

/** Where this release's documentation lives; every link the CLI prints starts here. */
export const DOCS_URL = "https://rogen-playfully.vercel.app/docs/v2";

/** Facts about the installed program. */
export interface ProductService {
	readonly _serviceBrand: undefined;

	/** The installed version, or `unknown` when it can't be read. */
	getVersion(): Promise<string>;
}

export const ProductService =
	createServiceIdentifier<ProductService>("productService");
