import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { aliasSchema, ConfigurationError, type ConfiguredGroup } from "./config";
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
import type {
  ClaimedDraft,
  ExpenseDraft,
  GroupRegistryItem,
  JsonObject
} from "./state";
import { StateError } from "./state";

const participantReferenceSchema = z
  .string()
  .min(1)
  .max(200)
  .describe("Participant ID or exact participant name");
const expenseIdSchema = z.string().min(1).max(200);
const draftIdSchema = z.uuid();
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

const stateAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const;

export interface SpliitStateStore {
  listGroups(): Promise<GroupRegistryItem[]>;
  selectGroup(alias: string): Promise<GroupRegistryItem>;
  getActiveGroup(): Promise<ConfiguredGroup>;
  createDraft(
    payload: ExpenseDraft,
    ttlSeconds: number
  ): Promise<{ draftId: string; expiresAt: string }>;
  claimDraft(id: string): Promise<
    | { state: "claimed"; draft: ClaimedDraft }
    | { state: "complete"; result: JsonObject }
  >;
  completeDraft(
    id: string,
    claimToken: string,
    result: JsonObject
  ): Promise<void>;
  releaseDraft(id: string, claimToken: string): Promise<void>;
}

export interface ToolContext {
  state: SpliitStateStore;
  timeoutMs: number;
  draftTtlSeconds: number;
  writesEnabled: boolean;
  clientFactory?: (group: ConfiguredGroup, timeoutMs: number) => SpliitClient;
}

export function createSpliitMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({
    name: "spliit-mcp-cloudflare",
    version: "1.0.1"
  });

  server.registerTool(
    "list_groups",
    {
      title: "List remembered Spliit groups",
      description:
        "List safe aliases and identify the active group. Secret group URLs and IDs are never returned.",
      inputSchema: z.object({}),
      annotations: readAnnotations
    },
    async () => runTool(async () => ({ groups: await context.state.listGroups() }))
  );

  server.registerTool(
    "select_group",
    {
      title: "Select active Spliit group",
      description:
        "Set the group used by subsequent read and prepare tools on this authenticated MCP server.",
      inputSchema: z.object({ group: aliasSchema }),
      annotations: stateAnnotations
    },
    async ({ group }) =>
      runTool(async () => ({ selected: (await context.state.selectGroup(group)).alias }))
  );

  server.registerTool(
    "get_group",
    {
      title: "Get active Spliit group",
      description: "Get group details and participants for the active group.",
      inputSchema: z.object({}),
      annotations: readAnnotations
    },
    async () =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const group = await getGroup(context, configured);
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
      title: "Get active-group balances",
      description:
        "Get each participant's balance and Spliit's suggested reimbursements for the active group.",
      inputSchema: z.object({}),
      annotations: readAnnotations
    },
    async () =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const client = createClient(context, configured);
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
      title: "List active-group expenses",
      description: "List a page of expenses from the active Spliit group.",
      inputSchema: z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        filter: z.string().max(200).optional()
      }),
      annotations: readAnnotations
    },
    async ({ cursor, limit, filter }) =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const client = createClient(context, configured);
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
      title: "Get active-group expense",
      description: "Get full details for one expense in the active group.",
      inputSchema: z.object({ expenseId: expenseIdSchema }),
      annotations: readAnnotations
    },
    async ({ expenseId }) =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const client = createClient(context, configured);
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
      title: "List active-group categories",
      description: "List expense categories supported by the active group's Spliit server.",
      inputSchema: z.object({}),
      annotations: readAnnotations
    },
    async () =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const result = await createClient(context, configured).queryWithoutInput(
          "categories.list",
          categoriesResponseSchema
        );
        return { group: configured.alias, categories: result.categories };
      })
  );

  server.registerTool(
    "list_activities",
    {
      title: "List active-group activities",
      description: "List recent activity from the active group.",
      inputSchema: z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(20)
      }),
      annotations: readAnnotations
    },
    async ({ cursor, limit }) =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const client = createClient(context, configured);
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

  if (context.writesEnabled) registerWriteTools(server, context);
  return server;
}

function registerWriteTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "prepare_expense",
    {
      title: "Prepare an expense",
      description:
        "Validate and preview an evenly split expense for the currently active group. This does not change Spliit.",
      inputSchema: z.object({
        title: z.string().trim().min(2).max(200),
        amount: amountSchema,
        expenseDate: dateSchema,
        categoryId: z.number().int().min(0).default(0),
        paidBy: participantReferenceSchema.optional(),
        paidFor: z.array(participantReferenceSchema).min(1).max(100).optional(),
        notes: z.string().max(2000).optional()
      }),
      annotations: stateAnnotations
    },
    async (input) =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const group = await getGroup(context, configured);
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
        const expenseDate = input.expenseDate ?? new Date().toISOString().slice(0, 10);
        const mutationInput = {
          groupId: configured.groupId,
          expenseFormValues: expenseFormValues({
            date: expenseDate,
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
        };
        const preview = {
          group: configured.alias,
          groupName: group.name,
          kind: "expense",
          title: input.title,
          amount: moneyOutput(amount, currency),
          paidBy: payer.name,
          paidFor: beneficiaries.map((participant) => participant.name),
          expenseDate
        };
        const draft = await context.state.createDraft(
          { kind: "expense", group: configured, mutationInput, preview },
          context.draftTtlSeconds
        );
        return { prepared: true, ...draft, preview };
      })
  );

  server.registerTool(
    "prepare_reimbursement",
    {
      title: "Prepare a reimbursement",
      description:
        "Validate and preview a reimbursement for the currently active group. This does not change Spliit.",
      inputSchema: z.object({
        from: participantReferenceSchema,
        to: participantReferenceSchema,
        amount: amountSchema,
        expenseDate: dateSchema,
        notes: z.string().max(2000).optional()
      }),
      annotations: stateAnnotations
    },
    async (input) =>
      runTool(async () => {
        const configured = await context.state.getActiveGroup();
        const group = await getGroup(context, configured);
        const allParticipants = participants(group);
        const from = resolveParticipant(allParticipants, input.from);
        const to = resolveParticipant(allParticipants, input.to);
        if (from.id === to.id) {
          throw new ToolInputError("A reimbursement must use two different participants.");
        }
        const currency = currencySpec(group);
        const amount = decimalToMinor(input.amount, currency.decimalDigits);
        const expenseDate = input.expenseDate ?? new Date().toISOString().slice(0, 10);
        const mutationInput = {
          groupId: configured.groupId,
          expenseFormValues: expenseFormValues({
            date: expenseDate,
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
        };
        const preview = {
          group: configured.alias,
          groupName: group.name,
          kind: "reimbursement",
          from: from.name,
          to: to.name,
          amount: moneyOutput(amount, currency),
          expenseDate
        };
        const draft = await context.state.createDraft(
          { kind: "reimbursement", group: configured, mutationInput, preview },
          context.draftTtlSeconds
        );
        return { prepared: true, ...draft, preview };
      })
  );

  server.registerTool(
    "commit_draft",
    {
      title: "Commit a prepared Spliit write",
      description:
        "Commit one immutable prepared draft to its bound group. Changing the active group cannot redirect it.",
      inputSchema: z.object({ draftId: draftIdSchema }),
      annotations: writeAnnotations
    },
    async ({ draftId }) =>
      runTool(async () => {
        const claim = await context.state.claimDraft(draftId);
        if (claim.state === "complete") {
          return { ...claim.result, alreadyCommitted: true };
        }
        let result: { expenseId: string };
        try {
          result = await createClient(context, claim.draft.payload.group).mutation(
            "groups.expenses.create",
            claim.draft.payload.mutationInput,
            expenseIdResponseSchema
          );
        } catch (error) {
          await context.state.releaseDraft(draftId, claim.draft.claimToken);
          throw error;
        }
        const committed = {
          committed: true,
          draftId,
          group: claim.draft.payload.group.alias,
          kind: claim.draft.payload.kind,
          expenseId: result.expenseId
        };
        // Do not release the claim if persistence fails after the upstream
        // mutation: an ambiguous draft is safer than a duplicate expense.
        await context.state.completeDraft(draftId, claim.draft.claimToken, committed);
        return committed;
      })
  );
}

function expenseFormValues(input: {
  date: string;
  title: string;
  categoryId: number;
  amount: number;
  paidBy: string;
  paidFor: readonly string[];
  notes?: string | undefined;
  reimbursement: boolean;
}): JsonObject {
  return {
    expenseDate: input.date,
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

function createClient(context: ToolContext, group: ConfiguredGroup): SpliitClient {
  return context.clientFactory?.(group, context.timeoutMs) ?? new SpliitClient(group, context.timeoutMs);
}

async function getGroup(context: ToolContext, configured: ConfiguredGroup): Promise<Group> {
  const response = await createClient(context, configured).query(
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
  if (
    error instanceof ToolInputError ||
    error instanceof ConfigurationError ||
    error instanceof StateError
  ) {
    return error.message;
  }
  if (error instanceof SpliitAPIError) return error.message;
  if (error instanceof Error && error.message.startsWith("Amount")) return error.message;
  return "The operation failed without exposing configuration secrets.";
}
