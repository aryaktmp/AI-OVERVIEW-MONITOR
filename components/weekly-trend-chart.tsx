"use client";

import {
  CartesianGrid,
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
      className="h-[210px] w-full"
      role="img"
      aria-label="Grafik tingkat kutipan per minggu"
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
            formatter={(value: unknown) => [`${String(value)}%`, "Tingkat deteksi"]}
            labelFormatter={(label) => `Minggu ${String(label)}`}
            contentStyle={{
              backgroundColor: "var(--surface)",
              borderColor: "var(--line)",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--ink)",
            }}
          />
          <Line
            type="linear"
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
