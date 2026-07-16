"use client";

// TemplateMenu (viewer-shell §4.3, D6) — the chevron half of a TopToolbar split
// button. Lists one primitive's templates from the static catalog
// (lib/viewer/templates.ts) with icon, label and hint; selecting a template
// launches it via the parent's `onSelect` (which routes point → startProbe,
// line/polygon → startDraw with the template's kind/params/folder/slope and
// `toolKey: tpl:<id>`, §3.5).

import React from "react";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  templatesForPrimitive,
  type MeasurementTemplate,
} from "@/lib/viewer/templates";

interface TemplateMenuProps {
  primitive: MeasurementTemplate["primitive"];
  /** Human name of the primitive for the menu header ("Point", "Line", …). */
  primitiveLabel: string;
  /** Shared tool highlight key (§3.5) — the active template's item tints. */
  activeToolKey: string | null;
  onSelect: (template: MeasurementTemplate) => void;
}

export function TemplateMenu({
  primitive,
  primitiveLabel,
  activeToolKey,
  onSelect,
}: TemplateMenuProps) {
  const templates = templatesForPrimitive(primitive);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${primitiveLabel} templates`}
          className="flex h-8 w-4 shrink-0 items-center justify-center rounded-r-2xl text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200 data-[state=open]:bg-white/5 data-[state=open]:text-[#C97A4E]"
        >
          <ChevronDown size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[13rem]">
        <DropdownMenuLabel>{primitiveLabel} templates</DropdownMenuLabel>
        {templates.map((t) => {
          const Icon = t.icon;
          const active = activeToolKey === `tpl:${t.id}`;
          return (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => onSelect(t)}
              className={active ? "text-[#C97A4E] [&>svg]:text-[#C97A4E]" : ""}
            >
              <Icon />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{t.label}</span>
                {t.hint && (
                  <span className="truncate text-[10px] font-normal text-gray-500">
                    {t.hint}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
