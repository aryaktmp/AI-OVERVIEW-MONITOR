"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  addCompetitorAction,
  deleteCompetitorAction,
} from "@/app/(dashboard)/actions";
import { SimpleTooltip } from "@/components/ui/tooltip";

export interface CompetitorItem {
  id: string;
  name: string;
  domain: string;
}

interface CompetitorManagerCardProps {
  competitors: CompetitorItem[];
}

/**
 * Kartu Pengelolaan Kompetitor (components/competitor-manager-card.tsx).
 * 
 * Memungkinkan penambahan domain kompetitor baru dan penghapusan kompetitor yang dipantau,
 * langsung di halaman Competitors (/competitors).
 */
export function CompetitorManagerCard({
  competitors,
}: CompetitorManagerCardProps) {
  const [nameInput, setNameInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAddCompetitor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = nameInput.trim();
    const domain = domainInput.trim();
    if (!name || !domain) return;

    const fd = new FormData();
    fd.set("name", name);
    fd.set("domain", domain);

    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await addCompetitorAction(fd);
        if (res.ok) {
          setNameInput("");
          setDomainInput("");
          setFeedback({
            type: "success",
            text: res.message ?? `Competitor "${name}" added successfully.`,
          });
        } else {
          setFeedback({
            type: "error",
            text: res.message ?? "Failed to add competitor.",
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text:
            err instanceof Error ? err.message : "Failed to add competitor.",
        });
      }
    });
  }

  function handleDeleteCompetitor(id: string, name: string) {
    setDeletingId(id);
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await deleteCompetitorAction(id);
        if (res.ok) {
          setFeedback({
            type: "success",
            text: `Competitor "${name}" removed.`,
          });
        } else {
          setFeedback({
            type: "error",
            text: res.message ?? "Failed to delete competitor.",
          });
        }
      } catch (err) {
        setFeedback({
          type: "error",
          text:
            err instanceof Error ? err.message : "Failed to delete competitor.",
        });
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <Card id="competitor-list">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold text-[var(--ink)]">
                Monitored Competitors
              </CardTitle>
              <Badge variant="outline" className="font-mono text-xs">
                {competitors.length}{" "}
                {competitors.length === 1 ? "competitor" : "competitors"}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Competitor domains are automatically identified and tagged in
              Google AI Overview source citations and domain rankings.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {feedback && (
          <Alert variant={feedback.type === "success" ? "success" : "destructive"}>
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        )}

        {/* Add Competitor Form */}
        <form
          onSubmit={handleAddCompetitor}
          className="flex flex-wrap items-center gap-2.5 p-3 rounded-lg border border-[var(--line)] bg-[var(--surface-hover)]"
        >
          <div className="relative min-w-[200px] flex-1">
            <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)] pointer-events-none" />
            <Input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Competitor name (e.g. Mekari Talenta)"
              className="pl-8 text-xs h-9 bg-[var(--surface)]"
              disabled={isPending}
              required
            />
          </div>

          <div className="relative min-w-[200px] flex-1">
            <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)] pointer-events-none" />
            <Input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="Domain (e.g. talenta.co)"
              className="pl-8 font-mono text-xs h-9 bg-[var(--surface)]"
              disabled={isPending}
              required
            />
          </div>

          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={isPending}
            className="h-9 px-4 text-xs font-semibold gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {isPending && !deletingId ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add Competitor
          </Button>
        </form>

        {/* Competitors List */}
        {competitors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--muted)]">
            No competitors registered yet. Enter a competitor name and domain
            above to start monitoring their citations.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
            {competitors.map((c) => {
              const isDeleting = deletingId === c.id;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-xs shadow-xs hover:border-[var(--line)]/80 transition-colors"
                >
                  <div className="truncate min-w-0">
                    <div className="font-semibold text-[var(--ink)] truncate">
                      {c.name}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--muted)] truncate">
                      {c.domain}
                    </div>
                  </div>

                  <SimpleTooltip content={`Remove ${c.name}`}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleDeleteCompetitor(c.id, c.name)}
                      className="h-7 w-7 p-0 text-[var(--muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer shrink-0"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </SimpleTooltip>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
