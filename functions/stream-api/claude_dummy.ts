import { Writable } from "stream";
import { createMessage } from "./create_message";

interface ClaudeMessageReplacement {
  type:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop";
  content: string;
}

export class ClaudeDummy {
  static messageStart(parameter: {
    messageId?: string;
    modelId: string;
  }): ClaudeMessageReplacement {
    return {
      type: "message_start",
      content: JSON.stringify({
        type: "message_start",
        message: {
          id: parameter.messageId ?? "message",
          type: "message",
          role: "assistant",
          model: parameter.modelId,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    };
  }

  static contentBlockStart(): ClaudeMessageReplacement {
    return {
      type: "content_block_start",
      content: JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
    };
  }

  static contentBlockDelta(text: string): ClaudeMessageReplacement {
    return {
      type: "content_block_delta",
      content: JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: text },
      }),
    };
  }

  static contentBlockStop(): ClaudeMessageReplacement {
    return {
      type: "content_block_stop",
      content: JSON.stringify({ type: "content_block_stop", index: 0 }),
    };
  }

  static messageDelta(): ClaudeMessageReplacement {
    return {
      type: "message_delta",
      content: JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 },
      }),
    };
  }

  static messageStop(): ClaudeMessageReplacement {
    return {
      type: "message_stop",
      content: JSON.stringify({
        type: "message_stop",
        "amazon-bedrock-invocationMetrics": {
          inputTokenCount: 0,
          outputTokenCount: 0,
          invocationLatency: 0,
          firstByteLatency: 0,
        },
      }),
    };
  }
}

export function messagePipe(
  writable: Writable,
  message: string | Uint8Array | undefined,
  replacements: ClaudeMessageReplacement[]
) {
  if (message === undefined) {
    return;
  }
  let text = "";
  let type = "";
  if (message instanceof Uint8Array) {
    text = new TextDecoder().decode(message);
    type = JSON.parse(text).type;
  } else {
    text = message;
    type = message;
  }
  const replacement = replacements.find((item) => item.type === type);
  // 受け取ったデータにプレリュードをつけて変換する
  const data = createMessage(
    {
      ":event-type": "chunk",
      ":content-type": "application/json",
      ":message-type": "event",
    },
    replacement === undefined ? text : replacement.content
  );
  writable.write(data);
}
