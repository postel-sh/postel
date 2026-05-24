import type { ReactNode } from "react";
import {
  Tabs as FumadocsTabs,
  TabsList,
  TabsTrigger,
  type TabsProps,
} from "fumadocs-ui/components/tabs";
import { GoIcon, PythonIcon, RustIcon, TypeScriptIcon } from "./lang-icons";

/**
 * `LANG_ICONS` keys map each accepted display name to its brand mark.
 * Used to decide whether an MDX `<Tabs items={...}>` is a language
 * switcher (and therefore deserves the icon + pitch-black treatment)
 * or a generic Tabs block (which falls through to Fumadocs defaults).
 */
const LANG_ICONS: Record<string, (props: { className?: string }) => ReactNode> = {
  TypeScript: TypeScriptIcon,
  Go: GoIcon,
  Python: PythonIcon,
  Rust: RustIcon,
};

const isLanguageItems = (items?: string[]): items is string[] =>
  Array.isArray(items) && items.length > 0 && items.every((item) => item in LANG_ICONS);

/**
 * Mirrors Fumadocs's internal `escapeValue` — `<Tab value="TypeScript">`
 * is rewritten to `"typescript"` before reaching Radix's TabsContent. Our
 * TabsTrigger values must apply the same transform or the trigger /
 * content pair won't match and the panel will never become active.
 */
const escapeValue = (v: string) => v.toLowerCase().replace(/\s/, "-");

/**
 * Drop-in replacement for Fumadocs's `<Tabs>` that, when every item is a
 * known programming language, swaps the simple text triggers for branded
 * icon + label triggers and applies the pitch-black canvas surface. Any
 * other `<Tabs>` usage falls through to Fumadocs's default rendering.
 *
 * The `value` of each `<Tab>` child must match the language label
 * verbatim — same contract as Fumadocs's simple items mode.
 */
export function LangTabs({
  items,
  defaultIndex = 0,
  className,
  children,
  ...rest
}: TabsProps) {
  if (!isLanguageItems(items)) {
    return (
      <FumadocsTabs items={items} defaultIndex={defaultIndex} className={className} {...rest}>
        {children}
      </FumadocsTabs>
    );
  }

  const mergedClassName = ["bg-fd-background", className].filter(Boolean).join(" ");

  return (
    <FumadocsTabs
      defaultValue={escapeValue(items[defaultIndex])}
      className={mergedClassName}
      {...rest}
    >
      <TabsList>
        {items.map((item) => {
          const Icon = LANG_ICONS[item];
          return (
            <TabsTrigger key={item} value={escapeValue(item)}>
              <Icon className="size-4" />
              {item}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {children}
    </FumadocsTabs>
  );
}
