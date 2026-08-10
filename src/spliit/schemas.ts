import { z } from "zod";

export const participantSchema = z.object({
  id: z.string(),
  name: z.string()
});

export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  information: z.string().nullish(),
  currency: z.string(),
  currencyCode: z.string().nullish(),
  participants: z.array(participantSchema).nullish()
});

export const groupsResponseSchema = z.object({
  groups: z.array(groupSchema)
});

export const groupResponseSchema = z.object({
  group: groupSchema
});

export const expenseParticipantSchema = z.object({
  participant: participantSchema,
  shares: z.number()
});

export const expenseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number().int(),
  expenseDate: z.string(),
  createdAt: z.string(),
  paidBy: participantSchema,
  paidFor: z.array(expenseParticipantSchema),
  category: z
    .object({ id: z.number().int(), grouping: z.string(), name: z.string() })
    .nullish(),
  isReimbursement: z.boolean(),
  splitMode: z.enum(["EVENLY", "BY_SHARES", "BY_PERCENTAGE", "BY_AMOUNT"]),
  recurrenceRule: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"])
});

export const expensesResponseSchema = z.object({
  expenses: z.array(expenseSummarySchema),
  hasMore: z.boolean(),
  nextCursor: z.number().int()
});

export const expenseDetailsSchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number().int(),
  originalAmount: z.number().int().nullish(),
  originalCurrency: z.string().nullish(),
  conversionRate: z.union([z.number(), z.string()]).nullish(),
  expenseDate: z.string(),
  createdAt: z.string(),
  categoryId: z.number().int(),
  category: z
    .object({ id: z.number().int(), grouping: z.string(), name: z.string() })
    .nullish(),
  paidById: z.string(),
  paidBy: participantSchema,
  paidFor: z.array(
    z.object({ participantId: z.string(), shares: z.number() })
  ),
  isReimbursement: z.boolean(),
  splitMode: z.enum(["EVENLY", "BY_SHARES", "BY_PERCENTAGE", "BY_AMOUNT"]),
  notes: z.string().nullish(),
  recurrenceRule: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).nullish()
});

export const expenseResponseSchema = z.object({ expense: expenseDetailsSchema });

export const balancesResponseSchema = z.object({
  balances: z.record(
    z.string(),
    z.object({
      paid: z.number().int(),
      paidFor: z.number().int(),
      total: z.number().int()
    })
  ),
  reimbursements: z.array(
    z.object({ from: z.string(), to: z.string(), amount: z.number().int() })
  )
});

export const activitiesResponseSchema = z.object({
  activities: z.array(
    z.object({
      id: z.string(),
      groupId: z.string(),
      time: z.string(),
      activityType: z.enum([
        "UPDATE_GROUP",
        "CREATE_EXPENSE",
        "UPDATE_EXPENSE",
        "DELETE_EXPENSE"
      ]),
      participantId: z.string().nullish(),
      expenseId: z.string().nullish(),
      data: z.string().nullish()
    })
  ),
  hasMore: z.boolean(),
  nextCursor: z.number().int()
});

export const categorySchema = z.object({
  id: z.number().int(),
  grouping: z.string(),
  name: z.string()
});

export const categoriesResponseSchema = z.object({
  categories: z.array(categorySchema)
});

export const expenseIdResponseSchema = z.object({ expenseId: z.string() });

export type Participant = z.infer<typeof participantSchema>;
export type Group = z.infer<typeof groupSchema>;
export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;
export type ExpenseDetails = z.infer<typeof expenseDetailsSchema>;
