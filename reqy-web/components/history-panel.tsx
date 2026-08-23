"use client";

import { useState } from "react";
import {
  Clock,
  Trash2,
  Search,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sparkles,
  Loader2,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { methodSubtle } from "@/lib/http-method-colors";
import { getStatusTextClass } from "@/lib/http-status-colors";
import type { HistoryItem, HttpMethod } from "@/hooks/use-request-store";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

interface HistoryPanelProps {
  history: HistoryItem[];
  onSelectRequest: (item: HistoryItem) => void;
  /** Rejouer = charger ET envoyer. Absent → repli sur le chargement seul. */
  onReplayRequest?: (item: HistoryItem) => void;
  onClearHistory: () => void;
  onRemoveItem: (id: string) => void;
  onGenerateFollowUp?: (item: HistoryItem) => void;
  generatingFollowUpId?: string | null;
}

function formatTimeAgo(t: TFunction, timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return t("history.timeAgo.days", { count: days });
  if (hours > 0) return t("history.timeAgo.hours", { count: hours });
  if (minutes > 0) return t("history.timeAgo.minutes", { count: minutes });
  return t("history.timeAgo.justNow");
}

export function HistoryPanel({
  history,
  onSelectRequest,
  onReplayRequest,
  onClearHistory,
  onRemoveItem,
  onGenerateFollowUp,
  generatingFollowUpId,
}: HistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<HttpMethod[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const ALL_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  const toggleMethodFilter = (method: HttpMethod) => {
    setMethodFilter((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method],
    );
  };

  const filteredHistory = history.filter((item) => {
    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        item.name.toLowerCase().includes(q) ||
        item.endpoint.toLowerCase().includes(q) ||
        item.method.toLowerCase().includes(q) ||
        String(item.responseStatus || "").includes(q);
      if (!matchesSearch) return false;
    }

    // Method filter
    if (methodFilter.length > 0 && !methodFilter.includes(item.method)) return false;

    // Status filter
    if (statusFilter) {
      const s = item.responseStatus;
      if (statusFilter === "2xx" && (!s || s < 200 || s >= 300)) return false;
      if (statusFilter === "4xx" && (!s || s < 400 || s >= 500)) return false;
      if (statusFilter === "5xx" && (!s || s < 500)) return false;
      if (statusFilter === "error" && s && s < 400) return false;
    }

    return true;
  });

  // Pagination
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const paginatedHistory = filteredHistory.slice(0, visibleCount);
  const hasMore = visibleCount < filteredHistory.length;

  // Group by date
  const groupedHistory = paginatedHistory.reduce(
    (acc, item) => {
      const date = new Date(item.executedAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());

      let key: string;
      if (date.toDateString() === today.toDateString()) {
        key = t("history.groups.today");
      } else if (date.toDateString() === yesterday.toDateString()) {
        key = t("history.groups.yesterday");
      } else if (date >= startOfWeek) {
        key = t("history.groups.thisWeek");
      } else {
        key = date.toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
      }

      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    },
    {} as Record<string, HistoryItem[]>,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{t("history.title")}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowClearConfirm(true)}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          {t("history.clear")}
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="border-b border-border p-3 space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("history.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>

        {/* Method filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ALL_METHODS.map((method) => {
            const active = methodFilter.includes(method);
            return (
              <button
                key={method}
                onClick={() => toggleMethodFilter(method)}
                className={cn(
                  "h-6 rounded px-2 text-[10px] font-bold border transition-colors",
                  active
                    ? methodSubtle[method]
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {method}
              </button>
            );
          })}

          <span className="w-px h-4 bg-border mx-1" />

          {/* Status filter chips */}
          {[
            { label: "2xx", value: "2xx" },
            { label: "4xx", value: "4xx" },
            { label: "5xx", value: "5xx" },
            { label: t("history.errors"), value: "error" },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(statusFilter === f.value ? "" : f.value)}
              className={cn(
                "h-6 rounded px-2 text-[10px] font-medium border transition-colors",
                statusFilter === f.value
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}

          {/* Clear all filters */}
          {(methodFilter.length > 0 || statusFilter || searchQuery) && (
            <button
              onClick={() => {
                setMethodFilter([]);
                setStatusFilter("");
                setSearchQuery("");
              }}
              className="h-6 rounded px-2 text-[10px] font-medium text-muted-foreground hover:text-destructive transition-colors"
            >
              {t("history.clearFilters")}
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      <div className="flex-1 overflow-y-auto hide-scrollbar p-2">
        {Object.entries(groupedHistory).map(([date, items]) => (
          <div key={date} className="mb-4">
            <h4 className="mb-2 px-2 text-xs font-medium text-muted-foreground">{date}</h4>
            <div className="space-y-0.5">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center gap-2 rounded-lg border border-border/40 bg-card px-2.5 py-2.5 transition-all duration-150 hover:translate-x-0.5 hover:border-border/80 hover:bg-accent hover:shadow-sm"
                >
                  <button
                    onClick={() => onSelectRequest(item)}
                    className="flex flex-1 items-center gap-2"
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 shrink-0 px-1.5 text-[10px] font-bold",
                        methodSubtle[item.method],
                      )}
                    >
                      {item.method}
                    </Badge>
                    <div className="flex flex-1 flex-col items-start overflow-hidden">
                      <span className="w-full truncate text-left text-sm text-foreground">
                        {item.name}
                      </span>
                      <span className="w-full truncate text-left text-xs text-muted-foreground">
                        {item.endpoint}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.responseStatus != null &&
                      item.responseStatus >= 200 &&
                      item.responseStatus < 300 ? (
                        <CheckCircle2
                          className={cn("size-3.5", getStatusTextClass(item.responseStatus))}
                        />
                      ) : item.responseStatus != null &&
                        item.responseStatus >= 400 &&
                        item.responseStatus < 500 ? (
                        <XCircle
                          className={cn("size-3.5", getStatusTextClass(item.responseStatus))}
                        />
                      ) : item.responseStatus != null && item.responseStatus >= 500 ? (
                        <AlertCircle
                          className={cn("size-3.5", getStatusTextClass(item.responseStatus))}
                        />
                      ) : (
                        <Clock className="size-3.5 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "text-xs font-medium",
                          getStatusTextClass(item.responseStatus),
                        )}
                      >
                        {item.responseStatus || "-"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(t, item.executedAt)}
                      </span>
                    </div>
                  </button>
                  <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                    {onGenerateFollowUp && item.responseBody && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onGenerateFollowUp(item)}
                        disabled={generatingFollowUpId === item.id}
                        className="size-6 p-0"
                        title={t("history.aiFollowUp")}
                      >
                        {generatingFollowUpId === item.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3 text-primary" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => (onReplayRequest ?? onSelectRequest)(item)}
                      className="size-6 p-0"
                      title={t("history.replay")}
                    >
                      <RotateCcw className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingRemoveId(item.id)}
                      className="size-6 p-0 text-muted-foreground hover:text-destructive"
                      title={t("history.remove")}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {hasMore && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              {t("history.loadMore", { count: filteredHistory.length - visibleCount })}
            </Button>
          </div>
        )}

        {filteredHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="rounded-full bg-muted/30 p-3 mb-2">
              <Clock className="size-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {searchQuery ? t("history.noMatching") : t("history.empty")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {searchQuery ? t("history.noMatchingHint") : t("history.emptyHint")}
            </p>
            {!searchQuery && (
              <p className="text-xs text-muted-foreground/60 mt-2 max-w-[220px]">
                {t("history.emptySubHint")}
              </p>
            )}
          </div>
        )}
      </div>

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("history.clearTitle")}</DialogTitle>
            <DialogDescription>{t("history.clearDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onClearHistory();
                setShowClearConfirm(false);
              }}
            >
              {t("history.clearConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRemoveId}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null);
        }}
        title={t("history.deleteTitle")}
        description={t("history.deleteDescription")}
        confirmLabel={t("history.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingRemoveId) onRemoveItem(pendingRemoveId);
          setPendingRemoveId(null);
        }}
      />
    </div>
  );
}
