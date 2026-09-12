"use client";
/* App-global offline-queue flusher. Mounted once at the root so queued writes retry on
   load / reconnect / foreground from ANY screen — previously this lived only in the Today
   session logger, so a vital logged on Progress never got retried if its first flush failed. */
import { useEffect } from "react";
import { installQueueAutoFlush } from "@/lib/queue";

export default function QueueSync() {
  useEffect(() => installQueueAutoFlush(), []);
  return null;
}
