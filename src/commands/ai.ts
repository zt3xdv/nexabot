import { Client, MessageFlags, MessageContextMenuCommandInteraction, ChatInputCommandInteraction, ApplicationCommandType } from "discord.js";
import { TextDisplay } from "../utils/component.ts";
import { getEmoji } from "../utils/emojis.ts";
import { Settings } from "../utils/settings.ts";
import { safeText, parseToolArgs } from "../utils/utils.ts";
import type { ToolArgs, ToolDef } from "../types/types.ts";

const model = "openai/gpt-oss-120b";
const maxToolRounds = 5;

export default {
  category: "utility",
  data: {
    type: [ApplicationCommandType.ChatInput, ApplicationCommandType.Message],
    options: [{ type: 3, name: "prompt", description: "Prompt", required: true }],
    name: "ai",
    description: "Ask a question to the AI",
    context: {
      name: "Ask AI",
    },
  },
  async execute(interaction: any, client: Client) {
    await interaction.deferReply();

    const isMessageContext = interaction instanceof MessageContextMenuCommandInteraction;

    const prompt =
      isMessageContext
        ? interaction.targetMessage?.content?.trim() ?? ""
        : interaction.options.getString("prompt", true).trim();

    if (!prompt) {
      await interaction.editReply({
        components: [new TextDisplay({ content: `${getEmoji("wrong")} No prompt provided.` })],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const userSystemPrompt = await Settings.get(client.db, interaction.user.id, "ai_system_prompt");

    const history: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> = [
      {
        role: "system",
        content: `You are Argo, an efficient Discord bot.

# TOOL USAGE
- Use tools only when needed.
- If you already know the answer, do not use tools.
- If you cannot find information after a few attempts, answer briefly.

# STYLE
- Be concise.
- Use clean Markdown when useful.

# LANGUAGE
- Use gender-neutral language.

# EXTRA
${safeText(userSystemPrompt)}`,
      },
      { role: "user", content: prompt },
    ];

    const tools: ToolDef[] = [
      {
        type: "function",
        function: {
          name: "webSearch",
          icon: getEmoji("search"),
          description: "Search the web for current information, news, or general knowledge.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to look up on the web.",
              },
            },
            required: ["query"],
          },
          execute: async (args: ToolArgs) => {
            const query = String(args.query ?? "").trim();
            if (!query) return "Search failed: empty query.";

            try {
              const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.TAVILY_TOKEN}`,
                },
                body: JSON.stringify({
                  query,
                  include_answer: "basic",
                  max_results: 3,
                }),
              });

              if (!response.ok) {
                return `Search failed: HTTP ${response.status}`;
              }

              const data = await response.json();
              return JSON.stringify(data);
            } catch (error: any) {
              return `Search failed: ${error?.message ?? "unknown error"}`;
            }
          },
          formatArgs: (args: ToolArgs) => String(args.query ?? ""),
        },
      },
      {
        type: "function",
        function: {
          name: "date",
          icon: getEmoji("clock"),
          description: "Get the actual time and date",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
          execute: async () => new Date().toLocaleString(),
          formatArgs: () => "",
        },
      },
    ];

    const toolMap = new Map(tools.map((t) => [t.function.name, t]));

    const cleanToolsPayload = tools.map(({ type, function: fn }) => ({
      type,
      function: {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      },
    }));

    let lastToolIcons: string[] = [];
    let finalContent = "";

    try {
      for (let round = 0; round < maxToolRounds; round++) {
        await interaction.editReply({
          components: [
            new TextDisplay({
              content: `${getEmoji("settings")} **Fetching** • using ${model}`,
            }),
          ],
          flags: MessageFlags.IsComponentsV2,
        });

        const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NVIDIA_TOKEN}`,
          },
          body: JSON.stringify({
            model: model,
            messages: history,
            tools: cleanToolsPayload,
            tool_choice: "auto",
            temperature: 0.7,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const message = data?.choices?.[0]?.message;

        if (!message) {
          throw new Error("Empty model response");
        }

        history.push({
          role: message.role ?? "assistant",
          content: message.content ?? "",
          tool_calls: message.tool_calls,
        });

        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

        if (toolCalls.length === 0) {
          finalContent = message.content ?? "";
          break;
        }

        lastToolIcons = [];

        const toolResults = await Promise.all(
          toolCalls.map(async (toolCall: any) => {
            const toolName = toolCall?.function?.name;
            const tool = toolName ? toolMap.get(toolName) : undefined;
            if (!tool) return null;

            const args = parseToolArgs(toolCall?.function?.arguments ?? "");
            lastToolIcons.push(tool.function.icon);

            await interaction.editReply({
              components: [
                new TextDisplay({
                  content: `${message.reasoning ? `-# ${message.reasoning}\n` : ""}${getEmoji("oauth2")} Executing...\n    ${getEmoji("text1")} \`${tool.function.name}\` **${tool.function.formatArgs(args)}**`,
                }),
              ],
              flags: MessageFlags.IsComponentsV2,
            });

            const result = await tool.function.execute(args);

            return {
              tool_call_id: toolCall.id,
              role: "tool",
              name: tool.function.name,
              content: result,
            };
          })
        );

        for (const result of toolResults) {
          if (result) history.push(result);
        }
      }

      await interaction.editReply({
        components: [
          new TextDisplay({
            content: `${finalContent || "No response."}\n-# **${lastToolIcons.length ? `${lastToolIcons.join(" ")} • ` : ""}using ${model}**`,
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      console.error(error);
      await interaction.editReply({
        components: [
          new TextDisplay({
            content: `${getEmoji("wrong")} An error occurred while processing your request.`,
          }),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  },
};
