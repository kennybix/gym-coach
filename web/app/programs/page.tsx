import Link from "next/link";
import ProgramsLibrary from "@/components/ProgramsLibrary";

export default function ProgramsPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-bold rise">Programs</h1>
        <Link href="/settings" className="text-dim text-sm active:text-volt">Setup ›</Link>
      </div>
      <ProgramsLibrary />
    </div>
  );
}
