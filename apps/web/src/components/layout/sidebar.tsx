"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  SquaresFour,
  TreeStructure,
  Lightning,
  ArrowsClockwise,
  Stack,
  Megaphone,
  ClipboardText,
  Users,
  ChartBar,
  Gear,
  SignOut,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: Icon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", labelKey: "dashboard", icon: SquaresFour },
  { href: "/scenarios", labelKey: "scenarios", icon: TreeStructure },
  { href: "/triggers", labelKey: "triggers", icon: Lightning },
  { href: "/automations", labelKey: "automations", icon: ArrowsClockwise },
  { href: "/templates", labelKey: "templates", icon: Stack },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Megaphone },
  { href: "/campaigns", labelKey: "campaigns", icon: Megaphone },
  { href: "/surveys", labelKey: "surveys", icon: ClipboardText },
  { href: "/users", labelKey: "users", icon: Users },
  { href: "/analytics", labelKey: "analytics", icon: ChartBar },
  { href: "/settings", labelKey: "settings", icon: Gear },
];

export function Sidebar() {
  const pathname = usePathname();
  const segments = pathname.split("/");
  const locale = segments[1] ?? "ja";
  const t = useTranslations("nav");

  function isActive(href: string): boolean {
    const fullPath = `/${locale}${href === "/" ? "" : href}`;
    if (href === "/") return pathname === `/${locale}` || pathname === `/${locale}/`;
    return pathname.startsWith(fullPath);
  }

  return (
    <aside className="w-60 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cobalt-700 text-white flex items-center justify-center text-sm font-bold">
            G
          </div>
          <h1 className="text-lg font-semibold text-cobalt-700">GramStep</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const IconComp = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={`/${locale}${item.href === "/" ? "" : item.href}`}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-steel-50 text-steel-600 font-medium border-l-2 border-steel-500 -ml-px"
                  : "text-gray-600 hover:bg-gray-50 hover:text-cobalt-700"
              }`}
            >
              <IconComp
                size={18}
                weight={active ? "fill" : "regular"}
                className={active ? "text-steel-500" : "text-gray-400"}
              />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom: Logout */}
      <div className="px-3 py-3 border-t border-gray-100">
        <button
          onClick={() => {
            sessionStorage.removeItem("accessToken");
            sessionStorage.removeItem("refreshToken");
            window.location.href = `/${locale}/login`;
          }}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-50 hover:text-cobalt-700 transition-colors w-full"
        >
          <SignOut size={18} className="text-gray-400" />
          <span>{t("logout")}</span>
        </button>
      </div>
    </aside>
  );
}
