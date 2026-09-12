import Link from "next/link";
import ProgramsLibrary from "@/components/ProgramsLibrary";
import PageHeader from "@/components/ui/PageHeader";

export default function TrainPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Programs · history"
        title="Train"
        right={<Link href="/history" className="btn btn-ghost h-10 px-4 text-sm">History</Link>}
      />
      <ProgramsLibrary />
    </div>
  );
}
