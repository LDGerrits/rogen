import { ProductService } from "../product-service.js";

export class MockProductService implements ProductService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly version = "0.0.0") {}

	async getVersion(): Promise<string> {
		return this.version;
	}
}
