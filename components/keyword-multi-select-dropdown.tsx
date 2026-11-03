"use client";

import { useId, useMemo, useRef, useState, useEffect } from "react";
import { Check, ChevronDown, Lock, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SelectableKeyword {
  id: string;
  text: string;
  batch_id?: string | null;
  batch_name?: string | null;
  active?: boolean;
}

interface KeywordMultiSelectDropdownProps {
  keywords: SelectableKeyword[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function KeywordMultiSelectDropdown({
  keywords,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = "Select unassigned keywords...",
}: KeywordMultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      // Auto-focus search input when opened
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const unassignedKeywords = useMemo(
    () => keywords.filter((k) => !k.batch_id),
    [keywords]
  );

  const assignedKeywords = useMemo(
    () => keywords.filter((k) => Boolean(k.batch_id)),
    [keywords]
  );

  // Map of selected keywords
  const selectedMap = useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  );

  const selectedKeywordObjects = useMemo(
    () => keywords.filter((k) => selectedMap.has(k.id)),
    [keywords, selectedMap]
  );

  // Filtered keywords based on search and showOnlyUnassigned
  const filteredKeywords = useMemo(() => {
    const list = showOnlyUnassigned ? unassignedKeywords : keywords;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((k) => k.text.toLowerCase().includes(q));
  }, [keywords, unassignedKeywords, showOnlyUnassigned, searchQuery]);

  // Count visible selectable items
  const visibleSelectableCount = useMemo(
    () => filteredKeywords.filter((k) => !k.batch_id).length,
    [filteredKeywords]
  );

  function handleToggleKeyword(kw: SelectableKeyword) {
    if (disabled || kw.batch_id) return; // Strict: cannot select assigned keywords

    if (selectedMap.has(kw.id)) {
      onChange(selectedIds.filter((id) => id !== kw.id));
    } else {
      onChange([...selectedIds, kw.id]);
    }
  }

  function handleSelectAllVisible() {
    if (disabled) return;
    const visibleUnassignedIds = filteredKeywords
      .filter((k) => !k.batch_id)
      .map((k) => k.id);

    const merged = Array.from(new Set([...selectedIds, ...visibleUnassignedIds]));
    onChange(merged);
  }

  function handleClearSelection() {
    if (disabled) return;
    onChange([]);
  }

  function handleRemoveKeyword(id: string) {
    if (disabled) return;
    onChange(selectedIds.filter((item) => item !== id));
  }

  return (
    <div ref={containerRef} className="relative w-full space-y-2">
      {/* Dropdown Trigger */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={cn(
          "flex min-h-[38px] w-full items-center justify-between rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink)] transition-colors cursor-pointer select-none",
          disabled && "cursor-not-allowed opacity-50",
          isOpen && "ring-2 ring-[var(--cite)] border-[var(--cite)]"
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 flex-1 pr-2">
          {selectedIds.length === 0 ? (
            <span className="text-[var(--muted)]">
              {placeholder} ({unassignedKeywords.length} unassigned available)
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="bg-[var(--cite)]/10 text-[var(--cite)] border-[var(--cite)]/30 font-semibold px-2 py-0.5 text-[11px]"
              >
                {selectedIds.length} keyword{selectedIds.length === 1 ? "" : "s"} selected
              </Badge>
              <span className="text-[11px] text-[var(--muted)] truncate max-w-[200px]">
                {selectedKeywordObjects.map((k) => k.text).join(", ")}
              </span>
            </div>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-200",
            isOpen && "rotate-180 text-[var(--ink)]"
          )}
        />
      </div>

      {/* Selected Items Tags / Chips Preview */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {selectedKeywordObjects.slice(0, 8).map((kw) => (
            <span
              key={kw.id}
              className="inline-flex items-center gap-1 rounded bg-[var(--line)]/60 px-2 py-0.5 text-[11px] font-mono text-[var(--ink)] border border-[var(--line)] animate-in fade-in"
            >
              <span>{kw.text}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveKeyword(kw.id);
                }}
                disabled={disabled}
                className="rounded-full p-0.5 hover:bg-[var(--line)] hover:text-red-500 transition-colors"
                title={`Remove ${kw.text}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          {selectedKeywordObjects.length > 8 && (
            <Badge variant="outline" className="text-[10px] text-[var(--muted)]">
              +{selectedKeywordObjects.length - 8} more
            </Badge>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearSelection}
            disabled={disabled}
            className="h-5 px-1.5 text-[10px] text-[var(--muted)] hover:text-red-500"
          >
            Clear all
          </Button>
        </div>
      )}

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] shadow-lg animate-in fade-in-50 zoom-in-95">
          {/* Header Controls: Search & Tabs */}
          <div className="p-2 space-y-2 border-b border-[var(--line)] bg-[var(--surface-subtle,var(--surface))]">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--muted)]" />
              <Input
                ref={searchInputRef}
                id={searchInputId}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search keywords..."
                className="h-8 pl-8 text-xs font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-2 text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Toggle & Quick Actions */}
            <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowOnlyUnassigned(true)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                    showOnlyUnassigned
                      ? "bg-[var(--cite)]/15 text-[var(--cite)] font-semibold"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                >
                  Unassigned only ({unassignedKeywords.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowOnlyUnassigned(false)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                    !showOnlyUnassigned
                      ? "bg-[var(--cite)]/15 text-[var(--cite)] font-semibold"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  )}
                >
                  All ({keywords.length})
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {visibleSelectableCount > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    className="text-[10px] text-[var(--cite)] hover:underline font-semibold"
                  >
                    Select visible ({visibleSelectableCount})
                  </button>
                )}
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-[10px] text-[var(--muted)] hover:text-red-500 hover:underline"
                  >
                    Deselect all
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Keywords List */}
          <div className="max-h-56 overflow-y-auto p-1 divide-y divide-[var(--line)]/30">
            {filteredKeywords.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--muted)]">
                {searchQuery
                  ? "No keywords match your search query."
                  : showOnlyUnassigned
                  ? "No unassigned keywords available. All keywords belong to batches."
                  : "No keywords registered in the system."}
              </div>
            ) : (
              filteredKeywords.map((kw) => {
                const isSelected = selectedMap.has(kw.id);
                const isAssigned = Boolean(kw.batch_id);

                if (isAssigned) {
                  return (
                    <div
                      key={kw.id}
                      className="flex items-center justify-between px-2.5 py-1.5 text-xs opacity-50 bg-[var(--line)]/10 cursor-not-allowed select-none rounded"
                      title={`Cannot select: already assigned to ${kw.batch_name || "another batch"}`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <div className="h-3.5 w-3.5 rounded border border-[var(--muted)]/40 bg-[var(--line)] flex items-center justify-center shrink-0">
                          <Lock className="h-2.5 w-2.5 text-[var(--muted)]" />
                        </div>
                        <span className="font-mono text-[11px] truncate text-[var(--muted)] line-through">
                          {kw.text}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[9px] shrink-0 font-medium text-amber-500 border-amber-500/30 bg-amber-500/5 px-1.5 py-0"
                      >
                        In {kw.batch_name || "Batch"}
                      </Badge>
                    </div>
                  );
                }

                return (
                  <div
                    key={kw.id}
                    onClick={() => handleToggleKeyword(kw)}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-1.5 text-xs rounded cursor-pointer transition-colors select-none",
                      isSelected
                        ? "bg-[var(--cite)]/10 text-[var(--ink)] font-medium"
                        : "hover:bg-[var(--line)]/40 text-[var(--ink)]"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <div
                        className={cn(
                          "h-3.5 w-3.5 rounded border flex items-center justify-center transition-colors shrink-0",
                          isSelected
                            ? "bg-[var(--cite)] border-[var(--cite)] text-white"
                            : "border-[var(--line)] bg-[var(--surface)]"
                        )}
                      >
                        {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                      </div>
                      <span className="font-mono text-[11px] truncate">
                        {kw.text}
                      </span>
                    </div>

                    <Badge
                      variant="outline"
                      className="text-[9px] shrink-0 font-mono text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/5 px-1.5 py-0"
                    >
                      Available
                    </Badge>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Status Bar */}
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--surface-subtle,var(--surface))] border-t border-[var(--line)] text-[10px] text-[var(--muted)]">
            <span>
              {unassignedKeywords.length} unassigned • {assignedKeywords.length} in other batches
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-5 px-2 text-[10px]"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
