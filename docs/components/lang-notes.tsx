import {
  Tabs as FumadocsTabs,
  type TabsProps,
} from "fumadocs-ui/components/tabs";

/**
 * Companion to LangTabs. Renders a Fumadocs Tabs block with the same
 * `groupId="lang"` as the surrounding code Tabs but without items, so no
 * language bar appears — the user only sees the active language's notes.
 * Fumadocs's groupId listener registry syncs the active value across every
 * Tabs with the same groupId, including this one.
 *
 * Use for prose that should follow the user's language choice (caveats,
 * idiom notes, framework-specific deployment tips). The component itself
 * carries `data-lang-notes` so global.css can strip the inherited Tabs
 * card chrome — prose flows with the surrounding article instead of
 * sitting inside a visible card.
 *
 * Tabs that only have notes for some languages (e.g. only TypeScript)
 * render nothing when the active language has no matching child Tab —
 * that's the correct fallthrough.
 */
export function LangNotes({
  children,
  groupId = "lang",
  defaultValue = "typescript",
  ...rest
}: TabsProps) {
  return (
    <FumadocsTabs
      groupId={groupId}
      defaultValue={defaultValue}
      data-lang-notes
      {...rest}
    >
      {children}
    </FumadocsTabs>
  );
}
