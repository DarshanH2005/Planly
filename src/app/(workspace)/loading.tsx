import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-10" aria-busy="true" aria-label="Loading">
      <div className="space-y-2 border-b border-border pb-5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-44 w-full !rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Skeleton className="h-40 md:col-span-3 !rounded-xl" />
        <Skeleton className="h-40 md:col-span-2 !rounded-xl" />
      </div>
    </div>
  );
}
