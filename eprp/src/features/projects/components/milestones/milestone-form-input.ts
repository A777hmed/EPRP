import type { MasterMilestone } from "@/types";
import type { MilestoneInput } from "@/services/milestone-service";

/** Numbers stay as text so a half-entered value is not coerced. */
const numberText = (value: number | undefined) =>
  value === undefined ? "" : String(value);

/** Keep stored identity fields when an existing milestone is edited. */
export function milestoneFormInput(milestone?: MasterMilestone): MilestoneInput {
  return {
    code: milestone?.code ?? "",
    name: milestone?.name ?? "",
    description: milestone?.description ?? "",
    departmentId: milestone?.departmentId ?? "",
    systemId: milestone?.systemId ?? "",
    disciplineId: milestone?.disciplineId ?? "",
    baselineDate: milestone?.baselineDate ?? "",
    priority: milestone?.priority ?? "medium",
    ownerContactId: milestone?.ownerContactId ?? "",

    type: milestone?.type ?? "technical",
    category: milestone?.category ?? "",
    plannedDate: milestone?.plannedDate ?? "",
    weightPercent: numberText(milestone?.weightPercent),
    plannedProgressPercent: numberText(milestone?.plannedProgressPercent),
    predecessorMilestoneId: milestone?.predecessorMilestoneId ?? "",
    clientApprovalRequired: milestone?.clientApprovalRequired ?? false,
    notes: milestone?.notes ?? "",

    paymentPercent: numberText(milestone?.paymentPercent),
    paymentAmount: numberText(milestone?.paymentAmount),
    paymentDueDate: milestone?.paymentDueDate ?? "",
    isAdvancePayment: milestone?.isAdvancePayment ?? false,
  };
}
