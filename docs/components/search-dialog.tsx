"use client";

import type { SharedProps } from "fumadocs-ui/contexts/search";
import DefaultSearchDialog from "fumadocs-ui/components/dialog/search-default";

// Static-export search: the dialog loads the build-time index from
// /api/search and queries it client-side.
export default function SearchDialog(props: SharedProps) {
  return <DefaultSearchDialog {...props} type="static" />;
}
