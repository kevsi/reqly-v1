"use client";

import {
  AreaChart,
  Area,
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
import { useTranslation } from "react-i18next";

const CHART_MARGIN = { top: 10, right: 10, left: -10, bottom: 0 } as const;

// R29 — couleurs injectées par dashboard/page.tsx depuis les variables CSS du
// thème (--chart-1..5 / --success…). Fallbacks = anciens hex si variable vide.
export interface DashboardChartColors {
  volume: string;
  errorRate: string;
  avgTime: string;
}

const DEFAULT_CHART_COLORS: DashboardChartColors = {
  volume: "#22c55e",
  errorRate: "#f97316",
  avgTime: "#8b5cf6",
};

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
  colors = DEFAULT_CHART_COLORS,
}: {
  data: ChartDataPoint[];
  methodData: MethodDataPoint[];
  statusData: StatusDataPoint[];
  colors?: DashboardChartColors;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-6">
      {/* Row: Volume + Error Rate side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-success inline-block" />
              {t("dashboard.requestVolume")}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[180px] sm:h-[220px] pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="requestsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.volume} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={colors.volume} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <Tooltip cursor={false} content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="requests"
                  name={t("dashboard.requests")}
                  stroke={colors.volume}
                  strokeWidth={2}
                  fill="url(#requestsGradient)"
                  dot={{ r: 3, fill: colors.volume, strokeWidth: 0 }}
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
              {t("dashboard.errorRate")}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[180px] sm:h-[220px] pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors.errorRate} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={colors.errorRate} stopOpacity={0} />
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
                  name={t("dashboard.errorRateName")}
                  stroke={colors.errorRate}
                  strokeWidth={2}
                  fill="url(#errorGradient)"
                  dot={{ r: 3, fill: colors.errorRate, strokeWidth: 0 }}
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
              {t("dashboard.avgResponseTimeMs")}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] pt-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} unit="ms" />
                <Tooltip cursor={false} content={<CustomTooltip />} />
                <Bar
                  dataKey="avgTime"
                  name={t("dashboard.avgTime")}
                  fill={colors.avgTime}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-blue-500 inline-block" />
              {t("dashboard.httpMethods")}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[160px] sm:h-[200px] pt-0 flex items-center">
            {methodData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center w-full">
                {t("dashboard.noData")}
              </p>
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
              {t("dashboard.statusCodes")}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[160px] sm:h-[200px] pt-0 flex items-center">
            {statusData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center w-full">
                {t("dashboard.noData")}
              </p>
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
                  <Bar dataKey="count" name={t("dashboard.requests")} radius={[0, 4, 4, 0]}>
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
