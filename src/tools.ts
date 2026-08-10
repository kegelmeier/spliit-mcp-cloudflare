import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ConfiguredGroup } from "./config";
import { ConfigurationError, findConfiguredGroup } from "./config";
import { SpliitAPIError, SpliitClient } from "./spliit/client";
import { currencySpec, decimalToMinor, moneyOutput } from "./spliit/money";
import {
  activitiesResponseSchema,
  balancesResponseSchema,
  categoriesResponseSchema,
  expenseIdResponseSchema,
  expenseResponseSchema,
  expensesResponseSchema,
  groupResponseSchema,
  type Group,
  type Participant
} from "./spliit/schemas";

const aliasSchema = z
  .string()
  .min(1)
  .max(40)
  .describe("Configured group alias; call list_groups to discover aliases");
const participantReferenceSchema = z
  .string()
  .min(1)
  .max(200)
  .describe("Participant ID or exact participant name");
const expenseIdSchema = z.string().min(1).max(200);
const amountSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^\d+(?:\.\d+)?$/, "Use a positive decimal string, for example 12.50");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional();

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
} as const;

interface ToolContext {
  groups: readonly ConfiguredGroup[];
  timeoutMs: number;
  writesEnabled: boolean;
}

export function createSpliitMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({
    name: "spliit-mcp-cloudflare",
    version: "0.1.0"
  });

  server.registerTool(
    "list_groups",
    {
      title: "List Spliit groups",
      description:
        "List the configured Spliit groups by safe alias. Secret group URLs and IDs are never returned.",
      inputSchema: z.object({}),
      annotations: readAnnotations
    },
    async () =>
      runTool(async () => {
        const groups = await Promise.all(
          context.groups.map(async (configured) => {
            const group = await getGroup(configured, context.timeoutMs);
            const activeParticipant = configured.participantId === undefined
              ? undefined
              : participants(group).find(
                  (participant) => participant.id === configured.participantId
                );
            return {
              alias: configured.alias,
              name: group.name,
              currency: group.currencyCode ?? group.currency,
              participantCount: participants(group).length,
              ...(activeParticipant === undefined
                ? {}
                : { activeParticipant: activeParticipant.name })
            };
          })
        );
        return { groups };
      })
  );

  server.registerTool(
    "get_group",
    {
      title: "Get Spliit group",
      description: "Get group details and participants using a configured alias.",
      inputSchema: z.object({ group: aliasSchema }),
      annotations: readAnnotations
    },
    async ({ group: alias }) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, alias);
        const group = await getGroup(configured, context.timeoutMs);
        return {
          alias: configured.alias,
          name: group.name,
          information: group.information ?? null,
          currency: group.currencyCode ?? group.currency,
          participants: participants(group).map((participant) => ({
            id: participant.id,
            name: participant.name,
            isActiveParticipant: participant.id === configured.participantId
          }))
        };
      })
  );

  server.registerTool(
    "get_balances",
    {
      title: "Get Spliit balances",
      description:
        "Get each participant's balance and Spliit's suggested reimbursements.",
      inputSchema: z.object({ group: aliasSchema }),
      annotations: readAnnotations
    },
    async ({ group: alias }) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, alias);
        const client = createClient(configured, context.timeoutMs);
        const [{ group }, result] = await Promise.all([
          client.query("groups.get", { groupId: configured.groupId }, groupResponseSchema),
          client.query(
            "groups.balances.list",
            { groupId: configured.groupId },
            balancesResponseSchema
          )
        ]);
        const people = participantMap(group);
        const currency = currencySpec(group);
        return {
          group: configured.alias,
          currency: currency.code ?? currency.symbol,
          balances: Object.entries(result.balances).map(([id, balance]) => ({
            participantId: id,
            participantName: people.get(id)?.name ?? "Unknown participant",
            paid: moneyOutput(balance.paid, currency),
            share: moneyOutput(balance.paidFor, currency),
            balance: moneyOutput(balance.total, currency)
          })),
          reimbursements: result.reimbursements.map((reimbursement) => ({
            from: people.get(reimbursement.from)?.name ?? "Unknown participant",
            fromParticipantId: reimbursement.from,
            to: people.get(reimbursement.to)?.name ?? "Unknown participant",
            toParticipantId: reimbursement.to,
            amount: moneyOutput(reimbursement.amount, currency)
          }))
        };
      })
  );

  server.registerTool(
    "list_expenses",
    {
      title: "List Spliit expenses",
      description: "List a page of expenses from a configured Spliit group.",
      inputSchema: z.object({
        group: aliasSchema,
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        filter: z.string().max(200).optional()
      }),
      annotations: readAnnotations
    },
    async ({ group: alias, cursor, limit, filter }) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, alias);
        const client = createClient(configured, context.timeoutMs);
        const [{ group }, result] = await Promise.all([
          client.query("groups.get", { groupId: configured.groupId }, groupResponseSchema),
          client.query(
            "groups.expenses.list",
            {
              groupId: configured.groupId,
              cursor,
              limit,
              ...(filter === undefined || filter === "" ? {} : { filter })
            },
            expensesResponseSchema
          )
        ]);
        const currency = currencySpec(group);
        return {
          group: configured.alias,
          expenses: result.expenses.map((expense) => ({
            id: expense.id,
            title: expense.title,
            amount: moneyOutput(expense.amount, currency),
            expenseDate: expense.expenseDate,
            createdAt: expense.createdAt,
            paidBy: expense.paidBy.name,
            paidByParticipantId: expense.paidBy.id,
            paidFor: expense.paidFor.map((share) => ({
              participantId: share.participant.id,
              participantName: share.participant.name,
              shares: share.shares
            })),
            category: expense.category?.name ?? null,
            isReimbursement: expense.isReimbursement,
            splitMode: expense.splitMode,
            recurrenceRule: expense.recurrenceRule
          })),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor
        };
      })
  );

  server.registerTool(
    "get_expense",
    {
      title: "Get Spliit expense",
      description: "Get full details for one expense.",
      inputSchema: z.object({ group: aliasSchema, expenseId: expenseIdSchema }),
      annotations: readAnnotations
    },
    async ({ group: alias, expenseId }) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, alias);
        const client = createClient(configured, context.timeoutMs);
        const [{ group }, { expense }] = await Promise.all([
          client.query("groups.get", { groupId: configured.groupId }, groupResponseSchema),
          client.query(
            "groups.expenses.get",
            { groupId: configured.groupId, expenseId },
            expenseResponseSchema
          )
        ]);
        const currency = currencySpec(group);
        const people = participantMap(group);
        return {
          group: configured.alias,
          expense: {
            id: expense.id,
            title: expense.title,
            amount: moneyOutput(expense.amount, currency),
            expenseDate: expense.expenseDate,
            createdAt: expense.createdAt,
            paidBy: expense.paidBy.name,
            paidByParticipantId: expense.paidBy.id,
            paidFor: expense.paidFor.map((share) => ({
              participantId: share.participantId,
              participantName:
                people.get(share.participantId)?.name ?? "Unknown participant",
              shares: share.shares
            })),
            categoryId: expense.categoryId,
            category: expense.category?.name ?? null,
            notes: expense.notes ?? null,
            isReimbursement: expense.isReimbursement,
            splitMode: expense.splitMode,
            recurrenceRule: expense.recurrenceRule ?? "NONE",
            ...(expense.originalAmount === null || expense.originalAmount === undefined
              ? {}
              : { originalAmountMinor: expense.originalAmount }),
            ...(expense.originalCurrency === null || expense.originalCurrency === undefined
              ? {}
              : { originalCurrency: expense.originalCurrency })
          }
        };
      })
  );

  server.registerTool(
    "list_categories",
    {
      title: "List Spliit categories",
      description: "List expense categories supported by a group's Spliit server.",
      inputSchema: z.object({ group: aliasSchema }),
      annotations: readAnnotations
    },
    async ({ group: alias }) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, alias);
        const result = await createClient(
          configured,
          context.timeoutMs
        ).queryWithoutInput("categories.list", categoriesResponseSchema);
        return { group: configured.alias, categories: result.categories };
      })
  );

  server.registerTool(
    "list_activities",
    {
      title: "List Spliit activities",
      description: "List recent group and expense activity.",
      inputSchema: z.object({
        group: aliasSchema,
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20)
      }),
      annotations: readAnnotations
    },
    async ({ group: alias, cursor, limit }) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, alias);
        const client = createClient(configured, context.timeoutMs);
        const [{ group }, result] = await Promise.all([
          client.query("groups.get", { groupId: configured.groupId }, groupResponseSchema),
          client.query(
            "groups.activities.list",
            { groupId: configured.groupId, cursor, limit },
            activitiesResponseSchema
          )
        ]);
        const people = participantMap(group);
        return {
          group: configured.alias,
          activities: result.activities.map((activity) => ({
            id: activity.id,
            time: activity.time,
            type: activity.activityType,
            participantId: activity.participantId ?? null,
            participantName:
              activity.participantId === null || activity.participantId === undefined
                ? null
                : (people.get(activity.participantId)?.name ?? "Unknown participant"),
            expenseId: activity.expenseId ?? null
          })),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor
        };
      })
  );

  if (context.writesEnabled) {
    registerWriteTools(server, context);
  }

  return server;
}

function registerWriteTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "create_expense",
    {
      title: "Create Spliit expense",
      description:
        "Create an evenly split expense. Writes must be explicitly enabled by the server owner.",
      inputSchema: z.object({
        group: aliasSchema,
        title: z.string().trim().min(2).max(200),
        amount: amountSchema,
        expenseDate: dateSchema,
        categoryId: z.number().int().min(0).default(0),
        paidBy: participantReferenceSchema.optional(),
        paidFor: z.array(participantReferenceSchema).min(1).max(100).optional(),
        notes: z.string().max(2000).optional()
      }),
      annotations: writeAnnotations
    },
    async (input) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, input.group);
        const client = createClient(configured, context.timeoutMs);
        const group = await getGroup(configured, context.timeoutMs);
        const allParticipants = participants(group);
        const defaultPayer = configured.participantId === undefined
          ? undefined
          : allParticipants.find(
              (participant) => participant.id === configured.participantId
            );
        const payer = input.paidBy === undefined
          ? defaultPayer
          : resolveParticipant(allParticipants, input.paidBy);
        if (payer === undefined) {
          throw new ToolInputError(
            "paidBy is required because this group has no valid configured participantId."
          );
        }
        const beneficiaries = input.paidFor === undefined
          ? allParticipants
          : uniqueParticipants(
              input.paidFor.map((reference) =>
                resolveParticipant(allParticipants, reference)
              )
            );
        if (beneficiaries.length === 0) {
          throw new ToolInputError("At least one participant must share the expense.");
        }
        const currency = currencySpec(group);
        const amount = decimalToMinor(input.amount, currency.decimalDigits);
        if (amount < 0) throw new ToolInputError("Amount must be positive.");
        const result = await client.mutation(
          "groups.expenses.create",
          {
            groupId: configured.groupId,
            expenseFormValues: expenseFormValues({
              date: input.expenseDate,
              title: input.title,
              categoryId: input.categoryId,
              amount,
              paidBy: payer.id,
              paidFor: beneficiaries.map((participant) => participant.id),
              notes: input.notes,
              reimbursement: false
            }),
            ...(configured.participantId === undefined
              ? {}
              : { participantId: configured.participantId })
          },
          expenseIdResponseSchema
        );
        return {
          created: true,
          group: configured.alias,
          expenseId: result.expenseId,
          title: input.title,
          amount: moneyOutput(amount, currency)
        };
      })
  );

  server.registerTool(
    "create_reimbursement",
    {
      title: "Create Spliit reimbursement",
      description:
        "Record a reimbursement from one participant to another. Writes must be explicitly enabled.",
      inputSchema: z.object({
        group: aliasSchema,
        from: participantReferenceSchema,
        to: participantReferenceSchema,
        amount: amountSchema,
        expenseDate: dateSchema,
        notes: z.string().max(2000).optional()
      }),
      annotations: writeAnnotations
    },
    async (input) =>
      runTool(async () => {
        const configured = resolveGroup(context.groups, input.group);
        const client = createClient(configured, context.timeoutMs);
        const group = await getGroup(configured, context.timeoutMs);
        const allParticipants = participants(group);
        const from = resolveParticipant(allParticipants, input.from);
        const to = resolveParticipant(allParticipants, input.to);
        if (from.id === to.id) {
          throw new ToolInputError("A reimbursement must use two different participants.");
        }
        const currency = currencySpec(group);
        const amount = decimalToMinor(input.amount, currency.decimalDigits);
        if (amount < 0) throw new ToolInputError("Amount must be positive.");
        const result = await client.mutation(
          "groups.expenses.create",
          {
            groupId: configured.groupId,
            expenseFormValues: expenseFormValues({
              date: input.expenseDate,
              title: "Reimbursement",
              categoryId: 1,
              amount,
              paidBy: from.id,
              paidFor: [to.id],
              notes: input.notes,
              reimbursement: true
            }),
            ...(configured.participantId === undefined
              ? {}
              : { participantId: configured.participantId })
          },
          expenseIdResponseSchema
        );
        return {
          created: true,
          group: configured.alias,
          expenseId: result.expenseId,
          from: from.name,
          to: to.name,
          amount: moneyOutput(amount, currency)
        };
      })
  );
}

function expenseFormValues(input: {
  date?: string | undefined;
  title: string;
  categoryId: number;
  amount: number;
  paidBy: string;
  paidFor: readonly string[];
  notes?: string | undefined;
  reimbursement: boolean;
}): Record<string, unknown> {
  return {
    expenseDate: input.date ?? new Date().toISOString().slice(0, 10),
    title: input.title,
    category: input.categoryId,
    amount: input.amount,
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    paidBy: input.paidBy,
    paidFor: input.paidFor.map((participant) => ({ participant, shares: 1 })),
    splitMode: "EVENLY",
    saveDefaultSplittingOptions: false,
    isReimbursement: input.reimbursement,
    documents: [],
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    recurrenceRule: "NONE"
  };
}

function resolveGroup(
  groups: readonly ConfiguredGroup[],
  alias: string
): ConfiguredGroup {
  return findConfiguredGroup(groups, alias);
}

function createClient(group: ConfiguredGroup, timeoutMs: number): SpliitClient {
  return new SpliitClient(group, timeoutMs);
}

async function getGroup(
  configured: ConfiguredGroup,
  timeoutMs: number
): Promise<Group> {
  const response = await createClient(configured, timeoutMs).query(
    "groups.get",
    { groupId: configured.groupId },
    groupResponseSchema
  );
  return response.group;
}

function participants(group: Group): Participant[] {
  return group.participants ?? [];
}

function participantMap(group: Group): Map<string, Participant> {
  return new Map(participants(group).map((participant) => [participant.id, participant]));
}

function resolveParticipant(
  allParticipants: readonly Participant[],
  reference: string
): Participant {
  const byId = allParticipants.find((participant) => participant.id === reference);
  if (byId !== undefined) return byId;
  const normalized = reference.trim().toLocaleLowerCase("en");
  const byName = allParticipants.filter(
    (participant) => participant.name.trim().toLocaleLowerCase("en") === normalized
  );
  if (byName.length === 1 && byName[0] !== undefined) return byName[0];
  if (byName.length > 1) {
    throw new ToolInputError(
      `Participant name ${JSON.stringify(reference)} is ambiguous; use the participant ID.`
    );
  }
  throw new ToolInputError(
    `No participant matches ${JSON.stringify(reference)}. Call get_group first.`
  );
}

function uniqueParticipants(values: readonly Participant[]): Participant[] {
  return [...new Map(values.map((participant) => [participant.id, participant])).values()];
}

class ToolInputError extends Error {
  override name = "ToolInputError";
}

async function runTool(
  operation: () => Promise<Record<string, unknown>>
): Promise<
  | {
      content: [{ type: "text"; text: string }];
      structuredContent: Record<string, unknown>;
    }
  | { isError: true; content: [{ type: "text"; text: string }] }
> {
  try {
    const result = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ToolInputError || error instanceof ConfigurationError) {
    return error.message;
  }
  if (error instanceof SpliitAPIError) {
    return error.message;
  }
  if (error instanceof Error && error.message.startsWith("Amount")) {
    return error.message;
  }
  return "The operation failed without exposing configuration secrets.";
}
