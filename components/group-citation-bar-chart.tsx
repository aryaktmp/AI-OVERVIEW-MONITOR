"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KeywordWeeklyRow } from "@/lib/analytics";

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
  dataMap?: Map<string, { total: number; detected: number; aiOverview: number; rate: number }>;
}

function CustomBarTooltip({ active, payload, label, dataMap }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !label) {
    return null;
  }

  const extra = dataMap?.get(label);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 shadow-md text-xs space-y-1">
      <div className="font-bold text-[var(--ink)]">{label}</div>
      <div className="space-y-0.5 pt-0.5 text-[11px]">
        {payload.map((entry, index) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-3">
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
          <div className="mt-1 pt-1 border-t border-[var(--line)] flex items-center justify-between gap-3 text-[11px]">
            <span className="text-[var(--muted)]">Citation Rate:</span>
            <span className="font-bold text-[var(--cite)] font-mono">
              {extra.rate}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function GroupCitationBarChart({ rows }: GroupCitationBarChartProps) {
  const { chartData, dataMap } = useMemo(() => {
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
      .sort((a, b) => b.total - a.total);

    return { chartData: data, dataMap: map };
  }, [rows]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-[210px] items-center justify-center text-xs text-[var(--muted)]">
        No keyword groups recorded yet.
      </div>
    );
  }

  return (
    <div
      className="h-[210px] w-full"
      role="img"
      aria-label="Citations by keyword group bar chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 12, right: 12, left: -16, bottom: 4 }}
        >
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="group"
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
            interval={0}
            tickFormatter={(val: string) =>
              val.length > 12 ? `${val.slice(0, 10)}…` : val
            }
          />
          <YAxis
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            content={<CustomBarTooltip dataMap={dataMap} />}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            wrapperStyle={{
              fontSize: "11px",
              paddingBottom: "8px",
            }}
          />
          <Bar
            dataKey="detected"
            name="LinovHR Detected"
            fill="var(--cite)"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            dataKey="aiOverview"
            name="AI Overview Present"
            fill="var(--seen)"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
