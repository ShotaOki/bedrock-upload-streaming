import { mqtt5, mqtt, iot } from "aws-iot-device-sdk-v2";
import { once } from "events";
import { isArrayBuffer, isArrayBufferView } from "util/types";

function wait(milliSeconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliSeconds));
}

export interface Payload {
  topic: string;
  qos: mqtt5.QoS;
  payload: string;
}

function toPayload(packet: mqtt5.PublishPacket | undefined): Payload {
  if (packet !== undefined) {
    if (isArrayBuffer(packet.payload) || isArrayBufferView(packet.payload)) {
      return {
        topic: packet.topicName,
        qos: packet.qos,
        payload: new TextDecoder().decode(packet.payload),
      };
    }
    if (typeof packet.payload == "string") {
      return {
        topic: packet.topicName,
        qos: packet.qos,
        payload: packet.payload,
      };
    }
  }
  return {
    topic: "",
    qos: mqtt5.QoS.AtLeastOnce,
    payload: `${packet?.payload}`,
  };
}

export class MQTTBaseClass {
  private _client: mqtt5.Mqtt5Client;
  private _waitingFlag;

  constructor(certificates: { hostName: string }) {
    const { Mqtt5Client } = mqtt5;
    const { AwsIotMqtt5ClientConfigBuilder } = iot;

    console.log("Create Client");
    const client = new Mqtt5Client(
      AwsIotMqtt5ClientConfigBuilder.newWebsocketMqttBuilderWithSigv4Auth(
        certificates.hostName
      ).build()
    );

    this._client = client;
    this._waitingFlag = true;
  }

  /**
   * 初期化処理を実行する
   */
  async awake(process?: {
    onInitialize?: (client: mqtt5.Mqtt5Client) => Promise<void>;
    onReceivedMessage?: (payload: Payload) => void;
  }) {
    const client = this._client;
    client.on("messageReceived", (message) => {
      console.log("Message Received");
      if (process?.onReceivedMessage !== undefined) {
        process.onReceivedMessage(toPayload(message.message));
      } else {
        this.onReceivedMessage(toPayload(message.message));
      }
      this._waitingFlag = false;
    });

    await this.start(client);

    if (process?.onInitialize !== undefined) {
      await process.onInitialize(client);
    } else {
      await this.onInitialize(client);
    }

    while (this._waitingFlag) {
      // setTimeoutで一時的にメインスレッドから離れないと、MQTTのメッセージを受信できない
      await wait(100);
    }

    await this.close(client);
  }

  public async waitForMessage(
    subscriptions: mqtt5.Subscription[],
    options?: {
      onStartSubscribe?: () => void;
    }
  ) {
    await this.awake({
      async onInitialize(client) {
        const rejected = await client.subscribe({
          subscriptions: subscriptions,
        });
        console.log("START SUBSCRIBE");
        console.log(rejected);
        if (options?.onStartSubscribe !== undefined) {
          options.onStartSubscribe();
        }
      },
    });
  }

  /**
   * MQTT接続を開始する
   */
  private async start(client: mqtt5.Mqtt5Client) {
    console.log("START");
    const connectionSuccess = once(client, "connectionSuccess");
    client.start();
    await connectionSuccess;
  }

  /**
   * MQTT接続を終了する
   */
  private async close(client: mqtt5.Mqtt5Client) {
    console.log("STOP --> ");
    const stopped = once(client, "stopped");
    client.stop();
    await stopped;
    client.close();
  }

  /**
   * 待機を終了する
   */
  public abort() {
    this._waitingFlag = false;
  }

  /** 子クラスで継承: 初期化処理を実施した */
  async onInitialize(client: mqtt5.Mqtt5Client) {}

  /** 子クラスで継承: メッセージを受信した */
  onReceivedMessage(payload: Payload) {}
}
