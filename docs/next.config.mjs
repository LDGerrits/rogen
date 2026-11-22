import { createMDX } from "fumadocs-mdx/next";
import path from "path";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	turbopack: {
		root: path.join(import.meta.dirname, ".."),
	},
	async redirects() {
		return [
			{
				source: "/docs",
				destination: "/docs/v2",
				permanent: false,
			},
			{
				source: "/docs/v2/core-concepts/routing/:path*",
				destination: "/docs/v2/routing/:path*",
				permanent: true,
			},
			{
				source: "/docs/v2/migrating-from-v1",
				destination: "/docs/v1/migrating-to-v2",
				permanent: true,
			},
			{
				source: "/docs/v2/setups/places",
				destination: "/docs/v2/multi-place",
				permanent: true,
			},
			{
				source: "/docs/v2/setups/:page(luau|roblox-ts)",
				destination: "/docs/v2/:page",
				permanent: true,
			},
		];
	},
};

export default withMDX(config);
