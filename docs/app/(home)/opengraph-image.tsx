import { ImageResponse } from "next/og";
import { generate as DefaultImage } from "fumadocs-ui/og";
import { appName, siteUrl } from "@/lib/shared";

export const alt = "Rogen - Rojo with file-system routing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
	return new ImageResponse(
		<DefaultImage
			title={appName}
			description="Rojo with file-system routing"
			site={new URL(siteUrl).host}
		/>,
		size
	);
}
