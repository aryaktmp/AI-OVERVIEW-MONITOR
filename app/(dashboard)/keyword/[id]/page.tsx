import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getKeywordDetailData } from "@/lib/dashboard-data";
import {
  formatDetectionTypeLabel,
  splitTextByBrandTerms,
} from "@/lib/analytics";
import { DemoDataBanner } from "@/components/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CheckStatus } from "@/lib/detect";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: CheckStatus }) {
  if (status === "detected") {
    return <Badge variant="cited">Detected</Badge>;
  }
  if (status === "not_detected") {
    return <Badge variant="notDetected">Not detected</Badge>;
  }
  return <Badge variant="none">No AI Overview</Badge>;
}

function formatDateTime(iso: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jakarta",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)) + " WIB"
    );
  } catch {
    return iso;
  }
}

export default async function KeywordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkId?: string }>;
}) {
  const { id } = await params;
  const { checkId } = await searchParams;

  const { keyword, checks, brandTerms, hasDemoData } =
    await getKeywordDetailData(id);

  if (!keyword) {
    notFound();
  }

  const selectedCheck =
    (checkId ? checks.find((c) => c.id === checkId) : checks[0]) ?? checks[0];

  const highlightedSegments = selectedCheck?.answer_text
    ? splitTextByBrandTerms(selectedCheck.answer_text, brandTerms)
    : [];

  return (
    <div className="space-y-5">
      <DemoDataBanner visible={hasDemoData} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--muted)]">
              {keyword.groupName}
            </span>
            {!keyword.active && <Badge variant="none">Inactive</Badge>}
          </div>
          <h2 className="m-0 text-xl font-extrabold">{keyword.text}</h2>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/keyword" className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to keywords list
          </Link>
        </Button>
      </div>

      {!selectedCheck ? (
        <Card>
          <CardHeader>
            <CardTitle>No check history yet</CardTitle>
            <CardDescription>
              This keyword has not been checked yet. Run a check from the
              Settings page to fetch AI Overview results.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="primary">
              <Link href="/pengaturan">Open Settings page</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>AI Overview answer text</CardTitle>
                  <StatusBadge status={selectedCheck.status} />
                </div>
                <CardDescription>
                  Checked on {formatDateTime(selectedCheck.checked_at)} ·
                  Matching brand terms highlighted in green.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedCheck.status === "no_ai_overview" ||
                !selectedCheck.answer_text ? (
                  <p className="rounded-md bg-[var(--none)] p-4 text-sm text-[var(--muted)]">
                    Google did not display AI Overview text for this check.
                  </p>
                ) : (
                  <div className="whitespace-pre-line rounded-md border border-[var(--line)] bg-[var(--bg)] p-4 text-sm leading-relaxed">
                    {highlightedSegments.map((seg, idx) =>
                      seg.highlighted ? (
                        <mark
                          key={idx}
                          className="rounded bg-[var(--cite-bg)] px-1 py-0.5 font-bold text-[var(--cite)]"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={idx}>{seg.text}</span>
                      )
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Badge
                    variant={selectedCheck.detected_domain ? "cited" : "none"}
                  >
                    Level 1 (Domain cited):{" "}
                    {selectedCheck.detected_domain ? "Yes" : "No"}
                  </Badge>
                  <Badge
                    variant={selectedCheck.detected_text ? "cited" : "none"}
                  >
                    Level 2 (Brand mentioned in text):{" "}
                    {selectedCheck.detected_text ? "Yes" : "No"}
                  </Badge>
                  <Badge
                    variant={
                      selectedCheck.detected_third_party ? "cited" : "none"
                    }
                  >
                    Level 3 (Mentioned in other sources):{" "}
                    {selectedCheck.detected_third_party ? "Yes" : "No"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  Sources list ({selectedCheck.sources.length})
                </CardTitle>
                <CardDescription>
                  References cited by Google AI Overview.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedCheck.sources.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    No source references for this check.
                  </p>
                ) : (
                  <ul className="space-y-3 p-0 m-0 list-none">
                    {selectedCheck.sources.map((src) => (
                      <li
                        key={src.id}
                        className="rounded-md border border-[var(--line)] p-2.5 text-xs"
                      >
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                          <span className="font-bold text-[var(--ink)]">
                            #{src.position + 1} · {src.domain}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {src.is_own && (
                              <Badge variant="cited">Own source</Badge>
                            )}
                            {src.is_competitor && (
                              <Badge variant="notDetected">
                                Competitor source
                              </Badge>
                            )}
                            {!src.is_own && src.mentions_brand && (
                              <Badge variant="cited">Mentions brand</Badge>
                            )}
                          </div>
                        </div>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 text-[var(--muted)] hover:text-[var(--ink)] hover:underline inline-flex items-center gap-1"
                        >
                          <span>{src.title || src.url}</span>
                          <ExternalLink className="h-3 w-3 inline shrink-0 opacity-70" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Check history</CardTitle>
              <CardDescription>
                Select a history row to view the answer text and sources for that check.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Check time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Detection type</TableHead>
                    <TableHead>Source count</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.map((chk) => {
                    const isCurrent = chk.id === selectedCheck.id;
                    return (
                      <TableRow
                        key={chk.id}
                        className={isCurrent ? "bg-[var(--none)]/50 font-medium" : ""}
                      >
                        <TableCell>
                          {formatDateTime(chk.checked_at)}
                          {chk.is_demo && (
                            <span className="ml-2 text-[11px] font-semibold text-[var(--seen)]">
                              (Demo)
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={chk.status} />
                        </TableCell>
                        <TableCell>
                          {formatDetectionTypeLabel(chk)}
                        </TableCell>
                        <TableCell>
                          {chk.sources.length} {chk.sources.length === 1 ? "source" : "sources"}
                        </TableCell>
                        <TableCell>
                          <Button asChild variant="outline" size="sm">
                            <Link
                              href={`/keyword/${keyword.id}?checkId=${chk.id}`}
                            >
                              {isCurrent ? "Currently viewing" : "View details"}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
