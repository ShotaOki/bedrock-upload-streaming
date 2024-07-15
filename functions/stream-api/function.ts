import { Writable } from "stream";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { createMessage } from "./create_message";
import { singDaisyBell } from "./daisy_bell";
import { delayReturn } from "./delay-return";

export async function streamFunction(
  event: any,
  responseStream: Writable,
  _context: any
) {
  // BedrockRuntimeのクライアントを生成する
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

  // 関数URLが受け取ったパラメータを、そのままBedrockRuntimeに渡す
  const headers = event["headers"];
  const requestPath: string = event["requestContext"]["http"]["path"];
  const command = new InvokeModelWithResponseStreamCommand({
    contentType: headers["content-type"],
    accept: headers["x-amzn-bedrock-accept"],
    body: event["body"],
    modelId: requestPath.split("/")[2],
  });

  // 独自定義したモデルIDの場合は、それに対応する処理を行う
  if (command.input.modelId === "hal.daisy-bell") {
    // モデルIDがhal.daisy-bellの場合は、Daisy Bellを歌う
    await singDaisyBell(responseStream);
    responseStream.end();
    return;
  }

  if (command.input.modelId?.startsWith("delay-upload::")) {
    command.input.modelId = command.input.modelId.replace("delay-upload::", "");
    await delayReturn({
      responseStream,
      input: command,
    });
    responseStream.end();
    return;
  }

  // BedrockRuntimeを実行する
  const apiResponse = await client.send(command);
  if (apiResponse === undefined || apiResponse.body === undefined) {
    // 実行結果が不正なら終了する
    responseStream.end();
    return;
  }

  // 実行結果をストリーム形式で読み込む
  for await (const item of apiResponse.body) {
    if (item.chunk === undefined) {
      continue;
    }
    // 受け取ったデータにプレリュードをつけて変換する
    const data = createMessage(
      {
        ":event-type": "chunk",
        ":content-type": "application/json",
        ":message-type": "event",
      },
      new TextDecoder().decode(item.chunk.bytes)
    );
    // ストリームに書き出す
    responseStream.write(data);
  }

  // ストリームを終了する
  responseStream.end();
}
