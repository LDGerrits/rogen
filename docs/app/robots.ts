import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/shared";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{ userAgent: "*", allow: "/" },
			{ userAgent: "meta-webindexer", allow: "/" },
		],
		sitemap: `${siteUrl}/sitemap.xml`,
	};
}
