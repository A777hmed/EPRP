import * as React from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SectionCardProps extends React.ComponentProps<typeof Card> {
  title: string;
  description?: string;
  /** Right-aligned header action (button, menu, link). */
  action?: React.ReactNode;
  footer?: React.ReactNode;
  contentClassName?: string;
}

/**
 * Titled content section — the standard container for grouping related
 * content on a page. Wraps the shadcn Card with a consistent header layout
 * and the platform's soft shadow.
 */
export function SectionCard({
  title,
  description,
  action,
  footer,
  className,
  contentClassName,
  children,
  ...props
}: SectionCardProps) {
  return (
    <Card
      data-slot="section-card"
      className={cn("shadow-soft", className)}
      {...props}
    >
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}
