import { docs } from "@/.source/server";
import { icons } from "@/components/icons";
import { loader } from "fumadocs-core/source";
import { createElement } from "react";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon(name) {
    if (name && name in icons) return createElement(icons[name]);
  },
});
