/** Grey placeholder shapes shown while the page's data loads. The pulse stops for people who turn off motion. */
const Bar = ({ className = '' }: { className?: string }) => <div className={`rounded-md bg-muted motion-safe:animate-pulse ${className}`} />;

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <Bar className="h-4 w-32" />
        <Bar className="h-4 w-16" />
      </div>
      <div className="grid gap-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="grid flex-1 gap-1.5">
              <Bar className={`h-3.5 ${i % 2 ? 'w-2/5' : 'w-3/5'}`} />
              <Bar className="h-2.5 w-1/4" />
            </div>
            <Bar className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4" role="status" aria-live="polite">
      <span className="sr-only">Loading your accounts…</span>
      <div className="flex items-center justify-between pt-2">
        <div className="grid gap-2">
          <Bar className="h-6 w-24" />
          <Bar className="h-3.5 w-16" />
        </div>
        <Bar className="h-9 w-24 rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-2 rounded-2xl border bg-card p-4">
            <Bar className="h-3 w-20" />
            <Bar className="h-7 w-28" />
            <Bar className="h-3 w-24" />
          </div>
        ))}
      </div>
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={2} />
    </div>
  );
}
