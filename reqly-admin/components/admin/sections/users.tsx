"use client";

import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal, Search, ShieldBan, ShieldCheck, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { syncApi, type AdminUser, type AdminUserDetail as Detail } from "@/lib/api";
import type { AdminConfig } from "@/lib/config";
import { fmtDate, fmtAgo } from "@/lib/utils";

export function UsersSection({ config }: { config: AdminConfig }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await syncApi(config).users(query.trim());
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [config, query]);

  useEffect(() => {
    const t = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  async function act(id: string, action: "disable" | "enable" | "revoke") {
    setBusyId(id);
    try {
      const api = syncApi(config);
      if (action === "disable") await api.disableUser(id);
      else if (action === "enable") await api.enableUser(id);
      else await api.revokeSessions(id);
      toast.success(
        action === "disable"
          ? "Utilisateur désactivé (sessions révoquées)"
          : action === "enable"
            ? "Utilisateur réactivé"
            : "Sessions révoquées",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Utilisateurs <span className="text-muted-foreground text-sm font-normal">({total})</span>
        </h2>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Rechercher email ou nom…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 pl-8"
          />
        </div>
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead>Dernière activité</TableHead>
                <TableHead>Créé le</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!users &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {users?.map((u) => (
                <TableRow
                  key={u.id}
                  className={`cursor-pointer ${u.disabled ? "opacity-60" : ""}`}
                  onClick={() =>
                    void syncApi(config)
                      .userDetail(u.id)
                      .then((r) => setDetail(r.user))
                      .catch(() => {})
                  }
                >
                  <TableCell>
                    <p className="font-medium">{u.email}</p>
                    <p className="text-muted-foreground text-xs">{u.name ?? "—"}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.provider === "oauth" ? "secondary" : "outline"}>
                      {u.provider === "oauth" ? "OAuth" : "Mot de passe"}
                    </Badge>
                  </TableCell>
                  <TableCell className="metric-mono">{u.workspaceCount}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {fmtAgo(u.lastActivityAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {fmtDate(u.createdAt)}
                  </TableCell>
                  <TableCell>
                    {u.disabled ? (
                      <Badge variant="destructive">Désactivé</Badge>
                    ) : u.lockedUntil && u.lockedUntil > Date.now() ? (
                      <Badge className="bg-chart-4/15 text-chart-4">Verrouillé</Badge>
                    ) : u.verified ? (
                      <Badge variant="outline" className="text-primary border-primary/40">
                        Actif
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Non vérifié</Badge>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" disabled={busyId === u.id}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void act(u.id, "revoke")}>
                          <KeyRound className="size-4" /> Révoquer les sessions
                        </DropdownMenuItem>
                        {u.disabled ? (
                          <DropdownMenuItem
                            onClick={() => void act(u.id, "enable")}
                            className="text-primary"
                          >
                            <ShieldCheck className="size-4" /> Réactiver
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => void act(u.id, "disable")}
                            className="text-destructive"
                          >
                            <ShieldBan className="size-4" /> Désactiver
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {users?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    Aucun utilisateur trouvé
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog détail utilisateur */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.email}</DialogTitle>
            <DialogDescription>
              Inscrit {fmtDate(detail?.createdAt)} · fournisseur{" "}
              {detail?.provider === "oauth" ? "OAuth" : "mot de passe"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Workspaces
            </p>
            {detail?.memberships.length === 0 && <p className="text-sm">Aucun workspace</p>}
            {detail?.memberships.map((m) => (
              <div
                key={m.workspace_id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{m.workspace_name}</span>
                <Badge variant="secondary">{m.role}</Badge>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5">
        <RefreshCw className="size-3.5" /> Rafraîchir
      </Button>
    </div>
  );
}
