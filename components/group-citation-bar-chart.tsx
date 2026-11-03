"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KeywordWeeklyRow } from "@/lib/analytics";
import { cn } from "@/lib/utils";

interface GroupCitationBarChartProps {
  rows: KeywordWeeklyRow[];
}

interface CustomTooltipPayload {
  name: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayload[];
  label?: string;
  dataMap?: Map<
    string,
    { total: number; detected: number; aiOverview: number; rate: number }
  >;
}

function CustomBarTooltip({
  active,
  payload,
  label,
  dataMap,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !label) {
    return null;
  }

  const extra = dataMap?.get(label);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 shadow-md text-xs space-y-1">
      <div className="font-bold text-[var(--ink)]">{label}</div>
      <div className="space-y-0.5 pt-0.5 text-[11px]">
        {payload.map((entry, index) => (
          <div
            key={`item-${index}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-1.5 text-[var(--muted)]">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}:
            </span>
            <span className="font-bold font-mono text-[var(--ink)]">
              {entry.value} keywords
            </span>
          </div>
        ))}

        {extra && (
          <>
            <div className="mt-1 pt-1 border-t border-[var(--line)] flex items-center justify-between gap-3 text-[11px]">
              <span className="text-[var(--muted)]">Total Keywords:</span>
              <span className="font-semibold text-[var(--ink)] font-mono">
                {extra.total} keywords
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-[var(--muted)]">Detection Rate:</span>
              <span className="font-bold text-[var(--cite)] font-mono">
                {extra.rate}%
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function GroupCitationBarChart({ rows }: GroupCitationBarChartProps) {
  const [viewMode, setViewMode] = useState<"active" | "top8" | "all">("active");

  const { chartData, dataMap, activeGroups } = useMemo(() => {
    const map = new Map<
      string,
      { total: number; detected: number; aiOverview: number; rate: number }
    >();

    for (const r of rows) {
      const group = r.groupName || "No Group";
      const current = map.get(group) ?? {
        total: 0,
        detected: 0,
        aiOverview: 0,
        rate: 0,
      };

      current.total += 1;
      if (r.currentState === 2) {
        current.detected += 1;
      }
      if (r.currentState >= 1) {
        current.aiOverview += 1;
      }

      current.rate =
        current.aiOverview > 0
          ? Math.round((current.detected / current.aiOverview) * 100)
          : 0;

      map.set(group, current);
    }

    const data = Array.from(map.entries())
      .map(([group, counts]) => ({
        group,
        detected: counts.detected,
        aiOverview: counts.aiOverview,
        total: counts.total,
        rate: counts.rate,
      }))
      .sort((a, b) => {
        // Prioritaskan grup dengan sitasi detected terlebih dahulu, lalu kehadiran AI Overview, lalu total keywords
        if (b.detected !== a.detected) return b.detected - a.detected;
        if (b.aiOverview !== a.aiOverview) return b.aiOverview - a.aiOverview;
        if (b.total !== a.total) return b.total - a.total;
        return a.group.localeCompare(b.group);
      });

    const active = data.filter((d) => d.aiOverview > 0 || d.detected > 0);

    return { chartData: data, dataMap: map, activeGroups: active };
  }, [rows]);

  const displayData = useMemo(() => {
    if (viewMode === "active") {
      return activeGroups.length > 0 ? activeGroups : chartData.slice(0, 8);
    }
    if (viewMode === "top8") {
      return chartData.slice(0, 8);
    }
    return chartData;
  }, [viewMode, activeGroups, chartData]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-xs text-[var(--muted)]">
        No keyword groups recorded yet.
      </div>
    );
  }

  const needsScroll = displayData.length > 8;
  const minWidth = needsScroll ? Math.max(500, displayData.length * 60) : "100%";

  return (
    <div
      className="w-full flex flex-col"
      role="img"
      aria-label="Citations by keyword group bar chart"
    >
      {/* Top Controls & Custom Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-[var(--line)]">
        {/* View Mode Filters */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode("active")}
            className={cn(
              "px-2.5 py-1 text-xs font-semibold rounded-md transition-colors",
              viewMode === "active"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "bg-[var(--secondary)] text-[var(--muted)] hover:text-[var(--ink)]"
            )}
            title="Show only groups with AI Overview or citations"
          >
            Active ({activeGroups.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("top8")}
            className={cn(
              "px-2.5 py-1 text-xs font-semibold rounded-md transition-colors",
              viewMode === "top8"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "bg-[var(--secondary)] text-[var(--muted)] hover:text-[var(--ink)]"
            )}
            title="Show top 8 most relevant groups"
          >
            Top 8
          </button>
          <button
            type="button"
            onClick={() => setViewMode("all")}
            className={cn(
              "px-2.5 py-1 text-xs font-semibold rounded-md transition-colors",
              viewMode === "all"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "bg-[var(--secondary)] text-[var(--muted)] hover:text-[var(--ink)]"
            )}
            title="Show all groups (horizontally scrollable)"
          >
            All ({chartData.length})
          </button>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--cite)] shrink-0" />
            <span className="text-[var(--muted)] font-medium">
              LinovHR Detected
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--seen)] shrink-0" />
            <span className="text-[var(--muted)] font-medium">
              AI Overview Present
            </span>
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div
        className="w-full overflow-x-auto pb-1 custom-scrollbar"
        tabIndex={0}
        role="region"
        aria-label="Keyword group citation chart container"
      >
        <div
          style={{
            width: typeof minWidth === "number" ? `${minWidth}px` : minWidth,
            height: "235px",
            minWidth: "100%",
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={displayData}
              margin={{ top: 8, right: 12, left: -20, bottom: 45 }}
            >
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis
                dataKey="group"
                stroke="var(--muted)"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: "var(--line)" }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={50}
                tickMargin={6}
                tickFormatter={(val: string) =>
                  val.length > 16 ? `${val.slice(0, 14)}…` : val
                }
              />
              <YAxis
                stroke="var(--muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<CustomBarTooltip dataMap={dataMap} />} />
              <Bar
                dataKey="detected"
                name="LinovHR Detected"
                fill="var(--cite)"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                dataKey="aiOverview"
                name="AI Overview Present"
                fill="var(--seen)"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Scroll indicator hint if many groups */}
      {needsScroll && (
        <div className="text-[11px] text-[var(--muted)] text-right pt-1 flex items-center justify-end gap-1">
          <span>
            Showing all {displayData.length} groups · Scroll horizontally to
            explore →
          </span>
        </div>
      )}
    </div>
  );
}
