import { Writable } from "stream";
import { mqtt5 } from "aws-iot-device-sdk-v2";
import { MQTTBaseClass, Payload } from "./mqtt-client/mqtt-base-class";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { ClaudeDummy, messagePipe } from "./claude_dummy";

class MqttClientClass extends MQTTBaseClass {
  private _bucketName: string = "";
  private _objectKey: string = "";

  /**
   * メッセージ受信時の挙動を実装する
   * @param payload
   */
  onReceivedMessage(payload: Payload): void {
    console.log(payload.payload);
    const message = JSON.parse(payload.payload);
    this._bucketName = message.bucketName;
    this._objectKey = message.objectKey;
  }

  get bucketName(): string {
    return this._bucketName;
  }

  get objectKey(): string {
    return this._objectKey;
  }
}

export async function delayReturn(input: {
  responseStream: Writable;
  input: InvokeModelWithResponseStreamCommand;
}) {
  try {
    /** S3のクライアント */
    const s3Client = new S3Client({});

    /** Bodyからアイテム情報を参照する */
    const body = JSON.parse(input.input.input.body as string);
    const objectKey = body.objectKey;

    /** Claudeからの受信結果の一部を差し替えて返却する */
    const dummyPipe = [
      // Message Startは固定値で送信する
      ClaudeDummy.messageStart({
        modelId: input.input.input.modelId ?? "",
      }),
    ];

    /** 受付処理開始宣言 */
    messagePipe(input.responseStream, "message_start", dummyPipe);

    /** クライアントを作成する */
    const mqttClient = new MqttClientClass({
      hostName: process.env.IOT_ENDPOINT ?? "",
    });

    /** メッセージの受信を待つ */
    await mqttClient.waitForMessage(
      [
        {
          topicFilter: process.env.TOPIC_NAME ?? "",
          qos: mqtt5.QoS.AtLeastOnce,
        },
      ],
      {
        /** サブスクライブ開始時の処理 */
        onStartSubscribe() {
          // S3にオブジェクトがあるのなら、MQTTを待機せず、そのまま受信処理を実施する
          s3Client
            .send(
              // オブジェクトの存在確認を投げる
              new HeadObjectCommand({
                Bucket: process.env.BUCKET_NAME ?? "",
                Key: objectKey,
              })
            )
            .then(() => {
              // データが存在するのなら、受信したことにして次の処理に進める
              mqttClient.onReceivedMessage({
                topic: "",
                qos: mqtt5.QoS.AtLeastOnce,
                payload: JSON.stringify({
                  bucketName: process.env.BUCKET_NAME,
                  objectKey: objectKey,
                }),
              });
              mqttClient.abort();
            })
            .catch(() => {});
        },
      }
    );

    /** 受信したオブジェクトを参照する */
    const command = new GetObjectCommand({
      Bucket: mqttClient.bucketName,
      Key: mqttClient.objectKey,
    });
    const result = await s3Client.send(command);
    const data = await result.Body?.transformToString();

    /** 受信したS3オブジェクトをBedrockのペイロードに設定する */
    if (data !== undefined) {
      input.input.input.body = data;
    }

    // BedrockRuntimeを実行する
    const apiResponse = await new BedrockRuntimeClient().send(input.input);
    if (apiResponse === undefined || apiResponse.body === undefined) {
      // 実行結果が不正なら終了する
      input.responseStream.end();
      return;
    }

    // 実行結果をストリーム形式で読み込む
    for await (const item of apiResponse.body) {
      if (item.chunk === undefined) {
        continue;
      }
      messagePipe(input.responseStream, item.chunk.bytes, dummyPipe);
    }
  } catch (e) {
    console.log(e);
  }
}
