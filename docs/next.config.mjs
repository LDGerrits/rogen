import { createMDX } from "fumadocs-mdx/next";
import path from "path";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	turbopack: {
		root: path.join(import.meta.dirname, ".."),
	},
};

export default withMDX(config);
