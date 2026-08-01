"use client";

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CHART_MARGIN = { top: 10, right: 10, left: -10, bottom: 0 } as const;

interface ChartDataPoint {
  label: string;
  requests: number;
  errorRate: number;
  avgTime: number;
}

interface MethodDataPoint {
  method: string;
  count: number;
  color: string;
}

interface StatusDataPoint {
  range: string;
  count: number;
  color: string;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p) => (
          <p key={p.name} className="font-medium text-foreground flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const PieTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg text-xs text-foreground">
        {payload.map((p) => (
          <p key={p.name} className="font-medium flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
            />
            {p.name}: {p.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function ChartsContent({
  data,
  methodData,
  statusData,
}: {
  data: ChartDataPoint[];
  methodData: MethodDataPoint[];
  statusData: StatusDataPoint[];
}) {
  return (
    <div className="grid gap-6">
      {/* Row: Volume + Error Rate side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-success inline-block" />
              Request Volume — 7 days
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[220px] pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="requestsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <Tooltip cursor={false} content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="requests"
                  name="Requests"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#requestsGradient)"
                  dot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-orange-500 inline-block" />
              Error Rate — 7 days
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[220px] pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <YAxis
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11 }}
                  domain={[0, 100]}
                  unit="%"
                />
                <Tooltip cursor={false} content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="errorRate"
                  name="Error rate"
                  stroke="#f97316"
                  strokeWidth={2}
                  fill="url(#errorGradient)"
                  dot={{ r: 3, fill: "#f97316", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row: Avg Response Time + Method Breakdown + Status Codes */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-violet-500 inline-block" />
              Avg Response Time (ms)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} unit="ms" />
                <Tooltip cursor={false} content={<CustomTooltip />} />
                <Bar dataKey="avgTime" name="Avg time" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-blue-500 inline-block" />
              HTTP Methods
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] pt-0 flex items-center">
            {methodData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center w-full">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={methodData}
                    dataKey="count"
                    nameKey="method"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                  >
                    {methodData.map((entry) => (
                      <Cell key={entry.method} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip cursor={false} content={<PieTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ fontSize: 11 }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-sky-500 inline-block" />
              Status Codes
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] pt-0 flex items-center">
            {statusData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center w-full">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={statusData}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 20, bottom: 5 }}
                >
                  <XAxis type="number" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="range"
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11 }}
                    width={32}
                  />
                  <Tooltip cursor={false} content={<PieTooltip />} />
                  <Bar dataKey="count" name="Requests" radius={[0, 4, 4, 0]}>
                    {statusData.map((entry) => (
                      <Cell key={entry.range} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
