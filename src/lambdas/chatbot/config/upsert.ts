import "reflect-metadata";
import { getDataSourceInstance } from "../../../instances/dataSource";
import { HandlerResponse, response } from "../../../middleware/response";
import { getConnectionParams } from "../../../config";
import Bot from "../../../entities/bot";
import {
  botConfigSchema,
  BotConfigSchemaType,
} from "../../../validation/botConfig";
import { validate } from "../../../middleware/validate";
import Tool from "../../../entities/tool";

export const logic = async (
  validRequest: BotConfigSchemaType,
): Promise<HandlerResponse> => {
  const dataSource = await getDataSourceInstance(getConnectionParams());

  const botRepo = dataSource.getRepository(Bot);
  const toolRepo = dataSource.getRepository(Tool);
  let bot = await botRepo.findOne({
    where: {
      name: validRequest.botName,
    },
  });
  if (bot) {
    await botRepo.update(
      {
        name: validRequest.botName,
      },
      {
        name: validRequest.botName,
        personal_preamble: validRequest.personalPreamble,
      },
    );
  } else {
    await botRepo.insert({
      name: validRequest.botName,
      personal_preamble: validRequest.personalPreamble,
    });
  }

  bot = await botRepo.findOne({
    relations: {
      tools: {
        tool_schema_responses: true,
      },
    },
    where: {
      name: validRequest.botName,
    },
  });

  if (!bot) {
    throw new Error(`bot isn't created with name ${validRequest.botName}`);
  }

  await toolRepo.save(
    validRequest.tools.map((tool) => {
      const foundTool = bot.tools.find((t) => t.name === tool.name);
      return {
        id: foundTool?.id || undefined,
        name: tool.name,
        description: tool.description,
        response: tool.response,
        type: tool.type,
        source: tool.source,
        bot,
        tool_schema_responses: foundTool?.tool_schema_responses || [],
        tool_schema_properties: tool.props.map((p) => ({
          type: p.type,
          name: p.name,
          description: p.description,
        })),
      };
    }),
  );

  const toolsToRemove = bot.tools.filter((tool) => {
    const foundTool = validRequest.tools.find((t) => t.name === tool.name);
    return !foundTool && tool.type === "FUNCTION";
  });
  await toolRepo.remove(toolsToRemove);
  return {
    data: {
      message: "success",
    },
    statusCode: 200,
  };
};

export const handler = response(validate(logic, botConfigSchema, "body"));
