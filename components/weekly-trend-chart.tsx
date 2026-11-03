"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeekBucket } from "@/lib/analytics";

export function WeeklyTrendChart({ weeks }: { weeks: WeekBucket[] }) {
  return (
    <div
      className="h-[285px] w-full"
      role="img"
      aria-label="Weekly detection rate chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={weeks}
          margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
        >
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            stroke="var(--muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value: unknown, name: unknown, item) => {
              const week = item?.payload as WeekBucket | undefined;
              const label =
                name === "detectionRate" || name === "Detection Rate (%)"
                  ? "LinovHR Detection Rate"
                  : String(name);
              const extra = week
                ? ` (${week.detectedCount} of ${week.aiOverviewCount} keywords cited)`
                : "";
              return [`${String(value)}%${extra}`, label];
            }}
            labelFormatter={(label) => `Week of ${String(label)}`}
            contentStyle={{
              backgroundColor: "var(--surface)",
              borderColor: "var(--line)",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--ink)",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.08)",
            }}
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
          <Line
            type="monotone"
            name="Detection Rate (%)"
            dataKey="detectionRate"
            stroke="var(--cite)"
            strokeWidth={3}
            dot={{ r: 4, fill: "var(--cite)", strokeWidth: 0 }}
            activeDot={{ r: 6, fill: "var(--cite)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
