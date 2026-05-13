/*
 * InlineEditDiff — slim variant of the diff card used inline by the
 * Edit / Write permission-request approval surface.
 *
 * Receives either an Edit-mode payload (`oldString` / `newString`) or
 * a Write-mode payload (`content`), runs the appropriate synthesizer
 * once, and hands the resulting `DiffFile` to `<DiffFileCard>` with
 * `maxHeight="40vh"`. No scope toggle, no totals strip — the slim
 * variant.
 */
import { useMemo } from "react";

import { DiffFileCard } from "../diff/DiffFileCard";
import type { DiffFile } from "../diff/DiffPanel";
import {
  synthesizeEditDiff,
  synthesizeWriteDiff,
} from "../../lib/diff-synthesize";

export type InlineEditDiffProps =
  | { mode: "edit"; filePath: string; oldString: string; newString: string }
  | { mode: "write"; filePath: string; content: string };

export function InlineEditDiff(props: InlineEditDiffProps) {
  const file: DiffFile = useMemo(() => {
    if (props.mode === "edit") {
      return synthesizeEditDiff({
        filePath: props.filePath,
        oldString: props.oldString,
        newString: props.newString,
      });
    }
    return synthesizeWriteDiff({
      filePath: props.filePath,
      content: props.content,
    });
  }, [props]);

  return <DiffFileCard file={file} maxHeight="40vh" />;
}
