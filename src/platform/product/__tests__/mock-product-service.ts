import { ProductService } from "../product-service.js";

export class MockProductService implements ProductService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly version = "0.0.0") {}

	async readVersion(): Promise<string> {
		return this.version;
	}
}
