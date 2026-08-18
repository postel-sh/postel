import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// The site is statically exported, so the search index is baked at build time
// and the client queries it locally (see the `type: "static"` search dialog).
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
