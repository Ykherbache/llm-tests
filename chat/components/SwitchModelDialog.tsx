"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { modelInfo, modelLabel } from "@/lib/models";

interface Props {
  from: string;
  to: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SwitchModelDialog({ from, to, onConfirm, onCancel }: Props) {
  const target = to ? modelInfo(to) : undefined;
  return (
    <AlertDialog open={to !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to {to ? modelLabel(to) : ""}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only one model fits in memory. {modelLabel(from)} will be unloaded and{" "}
            {target ? `${target.label} (${target.size})` : "the new model"} loaded, so the next reply will take
            10–40 s before its first token. The conversation history is kept and sent to the new model.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Switch model</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
