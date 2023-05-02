import {
  checkPackage,
  checkTgz,
  summarizeProblems,
  type Analysis,
  type SummarizedProblems,
} from "@arethetypeswrong/core";

export interface CheckPackageEventData {
  kind: "check-package";
  packageName: string;
  version: string | undefined;
}

export interface CheckFileEventData {
  kind: "check-file";
  file: Uint8Array;
}

export interface ResultMessage {
  kind: "result";
  data: {
    analysis: Analysis;
    problemSummaries?: SummarizedProblems;
  };
}

onmessage = async (event: MessageEvent<CheckPackageEventData | CheckFileEventData>) => {
  const analysis =
    event.data.kind === "check-file"
      ? await checkTgz(event.data.file)
      : await checkPackage(event.data.packageName, event.data.version);
  const problemSummaries = analysis.containsTypes ? summarizeProblems(analysis) : undefined;
  postMessage({
    kind: "result",
    data: {
      analysis,
      problemSummaries,
    },
  } satisfies ResultMessage);
};
