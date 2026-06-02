import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({
  title,
  description = 'Dialog content',
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-foreground/40" />
      <RadixDialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2
                   border-2 border-foreground bg-background p-8 focus:outline-none"
      >
        <RadixDialog.Title className="mb-6 font-display text-3xl tracking-tight">
          {title}
        </RadixDialog.Title>
        <RadixDialog.Description className="sr-only">{description}</RadixDialog.Description>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export const DialogClose = RadixDialog.Close;
