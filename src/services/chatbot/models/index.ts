import { ChatOpenAI } from "@langchain/openai";
import { RunnableConfig } from "@langchain/core/runnables";
import * as https from "node:https";
import {
  AIMessage,
  BaseMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { IState } from "../types";
import MessageStream from "../../../entities/messageStream";
import { getDataSourceInstance } from "../../../instances/dataSource";
import { getConnectionParams } from "../../../config";
import { personalityPreamble, responseFormat } from "./prompts";
import { getTools } from "../tools";

const model = new ChatOpenAI(
  { model: "gpt-4o-mini" },
  {
    httpAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
    fetch: async (url, init) => {
      const response = await fetch(url, init);
      console.info("response", { response });
      return response;
    },
  },
);

export const callModel = async (state: IState, config?: RunnableConfig) => {
  console.log("colling model");
  const { messages } = state;
  const botName = config?.metadata?.bot_name;
  const personalPreamble =
    typeof botName === "string"
      ? await personalityPreamble(botName)
      : await personalityPreamble();
  const enhancedMessages: BaseMessage[] = [];
  if (personalPreamble) {
    enhancedMessages.push(
      new SystemMessage({
        content: personalPreamble,
      }),
    );
  }
  enhancedMessages.push(new SystemMessage({ content: responseFormat }));
  enhancedMessages.push(...messages);
  const tools =
    typeof botName === "string" ? await getTools(botName) : await getTools();
  const boundModel = tools.length > 0 ? model.bindTools(tools) : model;
  if (config.metadata.mode === "invoke") {
    const response = await boundModel.invoke(enhancedMessages, config);
    return { messages: [response] };
  }
  const stream = await boundModel.stream(enhancedMessages, config);
  let fullMessage = ""; // Initialize an empty string to accumulate the chunks
  const dataSource = await getDataSourceInstance(getConnectionParams());
  const streamRepo = dataSource.getRepository(MessageStream);
  // Iterate through each chunk of the streamed response
  const { message_id: messageId } = config.metadata;
  let first = true;
  for await (const messageChunk of stream) {
    const { content } = messageChunk;
    if (typeof content === "string" && typeof messageId === "string") {
      fullMessage += content; // Append each chunk to the full message
      try {
        await streamRepo.insert({
          message_id: messageId,
          content: fullMessage,
          //           .replace(/<(\w+)(\s+[^>]*)?>\s*<\/\1>/g, ""),
          ended: first === false && content === "",
          timestamp: Date.now(),
        });
        if (first && content === "") {
          first = false;
        }
      } catch (e) {
        console.error(e);
      }
    }
  }
  return {
    messages: [
      new AIMessage({
        content: fullMessage,
      }),
    ],
  };
};
